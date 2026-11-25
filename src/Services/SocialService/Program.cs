using Microsoft.EntityFrameworkCore;
using SocialService.Data;
using SocialService.Endpoints;
using TrollNet.Shared;

var builder = WebApplication.CreateBuilder(args);

InternalApi.EnsureConfigured(builder.Configuration);

builder.Services.AddDbContext<SocialDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("SocialDb")));
builder.Services.AddTrollNetAuthentication(builder.Configuration);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddRateLimiter(options =>
    options.AddPerClientFixedWindow(PostEndpoints.WriteRateLimitPolicy, permitLimit: 30, window: TimeSpan.FromMinutes(1)));
builder.Services.AddProblemDetails();
builder.Services.AddHealthChecks();

var app = builder.Build();

app.UseTrollNetForwardedHeaders();
// VULN-SPOT #18: Error Message Information Leak (CWE-209) — INTENTIONAL FOR TRAINING
//   Unhandled exceptions return the developer exception page: stack traces, file paths, query details and
//   inner exception messages. Try a broken SQLi query such as /api/posts/search?query=' to see the SQL error.
//   Fix: UseExceptionHandler() with a generic ProblemDetails body and log details server-side only.
//   (The same insecure middleware is configured in AuthService and GameService.)
app.UseDeveloperExceptionPage();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapHealthChecks("/health");
app.MapPostEndpoints();
app.MapInternalEndpoints();

await app.InitializeDatabaseAsync<SocialDbContext>();

await app.RunAsync();
