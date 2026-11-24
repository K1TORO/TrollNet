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
// VULN-SPOT #18: Error Message Information Leak (CWE-209)
//   Typical mistake: returning stack traces, SQL errors or exception messages to the client.
//   Here: unhandled exceptions become a generic ProblemDetails response; details go only to the server log.
//   (The same is configured in AuthService and GameService.)
app.UseExceptionHandler();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapHealthChecks("/health");
app.MapPostEndpoints();
app.MapInternalEndpoints();

await app.InitializeDatabaseAsync<SocialDbContext>();

await app.RunAsync();
