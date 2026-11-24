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
builder.Services.AddTransient<InternalApiKeyHandler>();
// VULN-SPOT #06: Server-Side Request Forgery, SSRF (CWE-918)
//   Typical mistake: a feature (link preview, image fetch, webhook) makes the server request a URL
//   supplied by the user, letting them reach internal services or metadata endpoints.
//   Here: the only outgoing HTTP client has a fixed base address from configuration; no URL comes from users.
//   If you add such a feature: allow-list schemes/hosts, block private IP ranges, resolve DNS before checking.
builder.Services.AddHttpClient<SocialClient>(client =>
    {
        var baseUrl = builder.Configuration["Services:Social"]
            ?? throw new InvalidOperationException("Configuration value 'Services:Social' is required.");
        client.BaseAddress = new Uri(baseUrl.EndsWith('/') ? baseUrl : baseUrl + "/");
        client.Timeout = TimeSpan.FromSeconds(10);
    })
    .AddHttpMessageHandler<InternalApiKeyHandler>();
builder.Services.AddHostedService<GameEngineService>();

builder.Services.AddRateLimiter(options =>
    options.AddPerClientFixedWindow(GameEndpoints.SubmitRateLimitPolicy, permitLimit: 10, window: TimeSpan.FromMinutes(1)));
builder.Services.AddProblemDetails();
builder.Services.AddHealthChecks();

var app = builder.Build();

app.UseTrollNetForwardedHeaders();
app.UseExceptionHandler();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapHealthChecks("/health");
app.MapGameEndpoints();

// Runs before the host starts, so the game engine only begins once the schema exists.
await app.InitializeDatabaseAsync<GameDbContext>();

await app.RunAsync();
