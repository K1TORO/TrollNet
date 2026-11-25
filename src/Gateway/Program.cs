var builder = WebApplication.CreateBuilder(args);

// Routes and destinations live in appsettings.json ("ReverseProxy" section).
// Only public /api/* routes are proxied — plus /internal/posts/*, intentionally exposed (VULN-SPOT #08).
builder.Services.AddReverseProxy()
    .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));

// VULN-SPOT #05: Cross-Site Request Forgery (CWE-352) — INTENTIONAL FOR TRAINING
//   Any origin is allowed to send credentialed cross-origin requests to every API route. Together with the
//   cookie-based JWT auth in the services, a malicious page can perform state-changing requests as the victim.
//   Fix: restrict origins and require anti-forgery tokens; never combine AllowCredentials with any origin.
builder.Services.AddCors(options =>
    options.AddDefaultPolicy(policy => policy
        .SetIsOriginAllowed(_ => true)
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials()));

builder.Services.AddHealthChecks();

var app = builder.Build();

app.UseCors();
app.MapHealthChecks("/health");
app.MapReverseProxy();

await app.RunAsync();
