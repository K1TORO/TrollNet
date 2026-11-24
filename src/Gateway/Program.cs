var builder = WebApplication.CreateBuilder(args);

// Routes and destinations live in appsettings.json ("ReverseProxy" section).
// Only public /api/* routes are proxied; the services' /internal/* endpoints are never exposed.
builder.Services.AddReverseProxy()
    .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));
builder.Services.AddHealthChecks();

var app = builder.Build();

app.MapHealthChecks("/health");
app.MapReverseProxy();

await app.RunAsync();
