using AuthService;
using AuthService.Data;
using AuthService.Endpoints;
using Microsoft.EntityFrameworkCore;
using TrollNet.Shared;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<AuthDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("AuthDb")));
builder.Services.AddTrollNetAuthentication(builder.Configuration);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<TokenService>();
builder.Services.AddRateLimiter(options =>
    options.AddPerClientFixedWindow(AuthEndpoints.RateLimitPolicy, permitLimit: 10, window: TimeSpan.FromMinutes(1)));
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
app.MapAuthEndpoints();

await app.InitializeDatabaseAsync<AuthDbContext>((db, ct) =>
    DbSeeder.SeedAsync(db, app.Configuration, app.Services.GetRequiredService<TimeProvider>(), ct));

await app.RunAsync();
