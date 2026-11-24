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
app.UseExceptionHandler();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapHealthChecks("/health");
app.MapAuthEndpoints();

await app.InitializeDatabaseAsync<AuthDbContext>((db, ct) =>
    DbSeeder.SeedAsync(db, app.Configuration, app.Services.GetRequiredService<TimeProvider>(), ct));

await app.RunAsync();
