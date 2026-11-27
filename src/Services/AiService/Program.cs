using AiService;
using AiService.Endpoints;
using TrollNet.Shared;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddTrollNetAuthentication(builder.Configuration);
builder.Services.AddSingleton(TimeProvider.System);

var assistantOptions = builder.Configuration.GetSection(AssistantOptions.SectionName).Get<AssistantOptions>() ?? new AssistantOptions();
builder.Services.AddSingleton(assistantOptions);
builder.Services.AddHttpClient<AssistantClient>(client =>
{
    if (!string.IsNullOrWhiteSpace(assistantOptions.BaseUrl))
    {
        var baseUrl = assistantOptions.BaseUrl.EndsWith('/') ? assistantOptions.BaseUrl : assistantOptions.BaseUrl + "/";
        client.BaseAddress = new Uri(baseUrl);
    }
    // A little above the per-call timeout so the client's linked token is what cancels, not HttpClient itself.
    client.Timeout = TimeSpan.FromSeconds(assistantOptions.TimeoutSeconds + 10);
});

builder.Services.AddRateLimiter(options =>
    options.AddPerClientFixedWindow(AssistantEndpoints.RateLimitPolicy, permitLimit: 20, window: TimeSpan.FromMinutes(1)));
builder.Services.AddProblemDetails();
builder.Services.AddHealthChecks();

var app = builder.Build();

app.UseTrollNetForwardedHeaders();
app.UseDeveloperExceptionPage();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapHealthChecks("/health");
app.MapAssistantEndpoints();

await app.RunAsync();
