// TrollNet desktop host — feasibility spike (PHASE3 §7).
//
// One process that composes AuthService + SocialService + GameService by reusing their public
// extension methods (MapAuthEndpoints / MapPostEndpoints / MapInternalEndpoints / MapGameEndpoints /
// MapDevEndpoints) and service registrations. No business logic is copied: only the per-service
// Program.cs plumbing (DI wiring + middleware order) is merged here, exactly as PHASE3 §6 anticipated.
//
// Differences vs the Docker build, all intentional:
//   1. SQLite instead of PostgreSQL (three .db files in the user's local data dir).
//   2. The YARP gateway is gone: endpoints are mapped directly, so path-based routing is reproduced
//      by the mapping itself. The one routing rule the gateway enforced that a single port would break
//      is the SSRF vault isolation (#06): /internal/vault must NOT be reachable from the browser, only
//      server-side. We reproduce that by listening on TWO loopback ports — a public one for the UI and
//      an internal one that serves ONLY the vault (the link-preview SSRF target points at it).
//   3. ai-service stays a separate sidecar (§2); if Services:Ai is unset the engine falls back to the
//      static ContentLibrary, so the host boots with no AI dependency.

using AuthService;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using AiService;
using AiService.Endpoints;
using AuthService.Data;
using AuthService.Endpoints;
using GameService.Data;
using GameService.Endpoints;
using GameService.Engine;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using SocialService.Data;
using SocialService.Endpoints;
using TrollNet.Shared;

var builder = WebApplication.CreateBuilder(args);

// ---- Desktop data directory: three SQLite files under the OS local-app-data dir (~/.local/share/TrollNet). ----
var dataDir = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
    "TrollNet");
Directory.CreateDirectory(dataDir);
string Sqlite(string file) => $"Data Source={Path.Combine(dataDir, file)}";

// ---- Two loopback listeners: public UI port + internal dead-drop port for the SSRF vault. ----
var publicPort = builder.Configuration.GetValue("Desktop:PublicPort", 5080);
var internalPort = builder.Configuration.GetValue("Desktop:InternalPort", 5081);
builder.WebHost.ConfigureKestrel(k =>
{
    k.ListenLocalhost(publicPort);
    k.ListenLocalhost(internalPort);
});

InternalApi.EnsureConfigured(builder.Configuration);

// ---- DbContexts (three, as today) on SQLite. EnsureCreated builds each schema (HostingExtensions). ----
builder.Services.AddDbContext<AuthDbContext>(o => o.UseSqlite(Sqlite("trollnet_auth.db")));
builder.Services.AddDbContext<SocialDbContext>(o => o.UseSqlite(Sqlite("trollnet_social.db")));
builder.Services.AddDbContext<GameDbContext>(o => o.UseSqlite(Sqlite("trollnet_game.db")));

// ---- Shared registrations (called once, not once-per-service). ----
builder.Services.AddTrollNetAuthentication(builder.Configuration);
builder.Services.AddSingleton(TimeProvider.System);

// ---- Auth service wiring. ----
builder.Services.AddSingleton<TokenService>();

// ---- Game service wiring (replicated from GameService/Program.cs). ----
builder.Services.Configure<GameEngineOptions>(builder.Configuration.GetSection(GameEngineOptions.SectionName));
builder.Services.Configure<DevToolsOptions>(builder.Configuration.GetSection(DevToolsOptions.SectionName));
builder.Services.AddTransient<InternalApiKeyHandler>();
// VULN-SPOT #06 (SSRF): the generic, unrestricted HttpClient used by POST /api/link-preview — unchanged.
builder.Services.AddHttpClient();
// In-process loopback to the PUBLIC port: /internal/posts is a public route (#08), so this reaches it.
// Config returns "" (not null) for an unset key, so guard with IsNullOrWhiteSpace — a bare ?? would keep the
// empty string, and on Linux `new Uri("/")` becomes file:/// → "The 'file' scheme is not supported."
var socialConfigured = builder.Configuration["Services:Social"];
var socialBase = string.IsNullOrWhiteSpace(socialConfigured)
    ? $"http://127.0.0.1:{publicPort}/"
    : (socialConfigured.EndsWith('/') ? socialConfigured : socialConfigured + "/");
builder.Services.AddHttpClient<SocialClient>(client =>
    {
        client.BaseAddress = new Uri(socialBase);
        client.Timeout = TimeSpan.FromSeconds(10);
    })
    .AddHttpMessageHandler<InternalApiKeyHandler>();
builder.Services.AddSingleton<AiPostCache>();
// AiContentClient calls the host's own /internal/generate (loopback) for troll-feed content. Falls back to
// the loopback public port when Services:Ai is unset — same empty-string guard as SocialClient.
var aiConfigured = builder.Configuration["Services:Ai"];
var aiContentBase = string.IsNullOrWhiteSpace(aiConfigured)
    ? $"http://127.0.0.1:{publicPort}/"
    : (aiConfigured.EndsWith('/') ? aiConfigured : aiConfigured + "/");
builder.Services.AddHttpClient<AiContentClient>(client =>
{
    client.BaseAddress = new Uri(aiContentBase);
    client.Timeout = TimeSpan.FromSeconds(60);
});
builder.Services.AddHostedService<AiContentRefiller>();
builder.Services.AddHostedService<GameEngineService>();

// ---- AI assistant (merged AiService): serves /api/assistant/* + /internal/generate. AssistantClient talks
//      to an OpenAI-compatible model server (llama.cpp). When Assistant:Enabled/BaseUrl/Model are unset it
//      reports disabled and the UI falls back to the local heuristic bot — no error, no empty block. ----
var assistantOptions = builder.Configuration.GetSection(AssistantOptions.SectionName).Get<AssistantOptions>() ?? new AssistantOptions();
builder.Services.AddSingleton(assistantOptions);
builder.Services.AddHttpClient<AssistantClient>(client =>
{
    if (!string.IsNullOrWhiteSpace(assistantOptions.BaseUrl))
    {
        var b = assistantOptions.BaseUrl.EndsWith('/') ? assistantOptions.BaseUrl : assistantOptions.BaseUrl + "/";
        client.BaseAddress = new Uri(b);
    }
    client.Timeout = TimeSpan.FromSeconds(assistantOptions.TimeoutSeconds + 10);
});

// ---- One rate limiter with all three services' policies (AddRateLimiter can only be called once). ----
builder.Services.AddRateLimiter(options => options
    .AddPerClientFixedWindow(AuthEndpoints.RateLimitPolicy, permitLimit: 10, window: TimeSpan.FromMinutes(1))
    .AddPerClientFixedWindow(PostEndpoints.WriteRateLimitPolicy, permitLimit: 30, window: TimeSpan.FromMinutes(1))
    .AddPerClientFixedWindow(GameEndpoints.SubmitRateLimitPolicy, permitLimit: 10, window: TimeSpan.FromMinutes(1))
    .AddPerClientFixedWindow(AssistantEndpoints.RateLimitPolicy, permitLimit: 20, window: TimeSpan.FromMinutes(1)));

// VULN-SPOT #05: Cross-Site Request Forgery (CWE-352) — INTENTIONAL FOR TRAINING.
//   Ported from the gateway (which the desktop host replaces): any origin may send credentialed cross-origin
//   requests to every API route. On desktop this also lets the Tauri loading page (tauri://localhost origin)
//   reach the host before the same-origin SPA loads.
builder.Services.AddCors(options =>
    options.AddDefaultPolicy(policy => policy
        .SetIsOriginAllowed(_ => true)
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials()));

// SQLite round-trips DateTime as Kind=Unspecified, so System.Text.Json would emit timestamps with no 'Z' and
// the browser would read them as LOCAL time (making every objective look already-expired off-UTC). Force all
// DateTimes to serialize as UTC with a 'Z', matching what Postgres (Kind=Utc) produces in the Docker build.
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new UtcDateTimeJsonConverter()));

builder.Services.AddProblemDetails();
builder.Services.AddHealthChecks();

var app = builder.Build();

// ---- Vault isolation (reproduces the gateway NOT routing /internal/vault to the public surface). ----
// /internal/vault is served only on the internal port; the internal port serves only /internal/vault.
// On a single host this is softer than Docker's network namespace (a determined local user could still
// hit 127.0.0.1:<internalPort> directly), but the UI/terminal only ever talk to the public port, so the
// taught path — reach the vault via the link-preview SSRF — is preserved. Hardening (UDS/named pipe) is
// a later step; this is enough to validate the merge.
app.Use(async (ctx, next) =>
{
    var isVault = ctx.Request.Path.StartsWithSegments("/internal/vault");
    var onInternal = ctx.Connection.LocalPort == internalPort;
    if (isVault != onInternal)
    {
        ctx.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }
    await next();
});

app.UseTrollNetForwardedHeaders();
// VULN-SPOT #18: developer exception page returned to clients — unchanged from the service builds.
app.UseDeveloperExceptionPage();

// Serve the built SPA so this one host plays nginx + gateway together: the frontend is same-origin with the
// API, so its relative /api calls and the in-app terminal's http://localhost:<port> calls work with NO
// frontend changes. Dev default: the repo's frontend/dist (run `npm run build` in frontend/ first).
// Release (Tauri bundle): set Desktop:WebRoot to the bundled dist path. Served only on the public port —
// the vault-isolation middleware above already 404s everything non-vault on the internal port.
var webRoot = builder.Configuration["Desktop:WebRoot"];
if (string.IsNullOrWhiteSpace(webRoot))
    webRoot = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "..", "..", "frontend", "dist"));
Microsoft.Extensions.FileProviders.IFileProvider? spaFiles =
    Directory.Exists(webRoot) ? new Microsoft.Extensions.FileProviders.PhysicalFileProvider(webRoot) : null;
if (spaFiles is not null)
{
    app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = spaFiles });
    app.UseStaticFiles(new StaticFileOptions { FileProvider = spaFiles });
    app.Logger.LogInformation("Serving SPA from {WebRoot}", webRoot);
}
else
{
    app.Logger.LogWarning("SPA web root not found ({WebRoot}); running API-only. Build it: cd frontend && npm run build", webRoot);
}

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapHealthChecks("/health");
app.MapAuthEndpoints();
app.MapPostEndpoints();
app.MapInternalEndpoints();
app.MapGameEndpoints();
app.MapAssistantEndpoints();

// Testing console, same gate as GameService: only when DevTools:Enabled is true.
if (app.Configuration.GetSection(DevToolsOptions.SectionName).Get<DevToolsOptions>()?.Enabled == true)
{
    app.MapDevEndpoints();
    app.Logger.LogWarning("DevTools endpoints are ENABLED (/api/dev/*). Testing only.");
}

// SPA fallback: any unmatched GET serves index.html for client-side routing. API/vault routes are already
// matched or 404'd above, so this only catches front-end app routes.
if (spaFiles is not null)
    app.MapFallbackToFile("index.html", new StaticFileOptions { FileProvider = spaFiles });

// Create all three schemas before the game engine starts. Auth also seeds the admin account.
await app.InitializeDatabaseAsync<AuthDbContext>((db, ct) =>
    DbSeeder.SeedAsync(db, app.Configuration, app.Services.GetRequiredService<TimeProvider>(), ct));
await app.InitializeDatabaseAsync<SocialDbContext>();
await app.InitializeDatabaseAsync<GameDbContext>();

app.Logger.LogInformation(
    "TrollNet desktop host ready. Public UI: http://127.0.0.1:{Public}  |  internal vault: http://127.0.0.1:{Internal}  |  SocialClient base: {Social}  |  data: {Data}",
    publicPort, internalPort, socialBase, dataDir);

await app.RunAsync();

/// Serializes every DateTime as UTC ISO-8601 with a trailing 'Z'. Values from SQLite come back as
/// Kind=Unspecified but represent UTC (the engine stores UtcNow), so treat Unspecified as UTC rather than
/// shifting it by the local offset. Reads accept any ISO form and normalize to UTC.
sealed class UtcDateTimeJsonConverter : JsonConverter<DateTime>
{
    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        var s = reader.GetString();
        return DateTime.Parse(s!, CultureInfo.InvariantCulture,
            DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);
    }

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options)
    {
        var utc = value.Kind == DateTimeKind.Unspecified
            ? DateTime.SpecifyKind(value, DateTimeKind.Utc)
            : value.ToUniversalTime();
        writer.WriteStringValue(utc.ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'", CultureInfo.InvariantCulture));
    }
}
