using GameService.Data;
using GameService.Endpoints;
using GameService.Engine;
using Microsoft.EntityFrameworkCore;
using TrollNet.Shared;

var builder = WebApplication.CreateBuilder(args);

InternalApi.EnsureConfigured(builder.Configuration);

builder.Services.AddDbContext<GameDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("GameDb")));
builder.Services.AddTrollNetAuthentication(builder.Configuration);
builder.Services.AddSingleton(TimeProvider.System);

builder.Services.Configure<GameEngineOptions>(builder.Configuration.GetSection(GameEngineOptions.SectionName));
builder.Services.Configure<DevToolsOptions>(builder.Configuration.GetSection(DevToolsOptions.SectionName));
builder.Services.AddTransient<InternalApiKeyHandler>();
// VULN-SPOT #06: Server-Side Request Forgery, SSRF (CWE-918) — INTENTIONAL FOR TRAINING
//   The generic HttpClient factory has no restrictions and is used by POST /api/link-preview with a
//   client-supplied absolute URL. It can reach internal services on the Docker network and cloud metadata IPs.
//   Fix: allow-list schemes/hosts, resolve DNS and reject private/link-local addresses, disable redirects.
builder.Services.AddHttpClient();
builder.Services.AddHttpClient<SocialClient>(client =>
    {
        var baseUrl = builder.Configuration["Services:Social"]
            ?? throw new InvalidOperationException("Configuration value 'Services:Social' is required.");
        client.BaseAddress = new Uri(baseUrl.EndsWith('/') ? baseUrl : baseUrl + "/");
        client.Timeout = TimeSpan.FromSeconds(10);
    })
    .AddHttpMessageHandler<InternalApiKeyHandler>();

// Phase 2: AI-generated troll feed content. AiContentRefiller fills AiPostCache in the background; the game
// engine consumes it and falls back to the static ContentLibrary when the assistant is unavailable.
builder.Services.AddSingleton<AiPostCache>();
builder.Services.AddHttpClient<AiContentClient>(client =>
{
    var baseUrl = builder.Configuration["Services:Ai"];
    if (!string.IsNullOrWhiteSpace(baseUrl))
    {
        client.BaseAddress = new Uri(baseUrl.EndsWith('/') ? baseUrl : baseUrl + "/");
    }
    client.Timeout = TimeSpan.FromSeconds(60); // model generation can be slow on CPU
});
builder.Services.AddHostedService<AiContentRefiller>();

builder.Services.AddHostedService<GameEngineService>();

builder.Services.AddRateLimiter(options =>
    options.AddPerClientFixedWindow(GameEndpoints.SubmitRateLimitPolicy, permitLimit: 10, window: TimeSpan.FromMinutes(1)));
builder.Services.AddProblemDetails();
builder.Services.AddHealthChecks();

var app = builder.Build();

app.UseTrollNetForwardedHeaders();
// VULN-SPOT #18: Error Message Information Leak (CWE-209) — INTENTIONAL FOR TRAINING
//   Detailed developer exception pages are returned to clients (stack traces, file paths, SQL errors).
//   Fix: app.UseExceptionHandler() with a generic ProblemDetails response; log details only on the server.
app.UseDeveloperExceptionPage();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapHealthChecks("/health");
app.MapGameEndpoints();

// Testing console: only mapped when DevTools:Enabled is true (set via compose). When off, /api/dev/* 404s.
if (app.Configuration.GetSection(DevToolsOptions.SectionName).Get<DevToolsOptions>()?.Enabled == true)
{
    app.MapDevEndpoints();
    app.Logger.LogWarning("DevTools endpoints are ENABLED (/api/dev/*). Do not use this configuration in production.");
}

// Runs before the host starts, so the game engine only begins once the schema exists.
await app.InitializeDatabaseAsync<GameDbContext>();

await app.RunAsync();
