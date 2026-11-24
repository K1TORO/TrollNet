using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace TrollNet.Shared;

/// <summary>
/// Service-to-service calls (e.g. game engine -> social service) are authenticated with a shared key.
/// Internal routes are additionally never exposed through the gateway.
/// </summary>
public static class InternalApi
{
    public const string HeaderName = "X-Internal-Key";
    public const string ConfigKey = "InternalApi:Key";
    private const int MinKeyLength = 16;

    public static void EnsureConfigured(IConfiguration configuration)
    {
        if ((configuration[ConfigKey]?.Length ?? 0) < MinKeyLength)
        {
            throw new InvalidOperationException($"Configuration value '{ConfigKey}' must be set and be at least {MinKeyLength} characters long.");
        }
    }

    public static TBuilder RequireInternalApiKey<TBuilder>(this TBuilder builder) where TBuilder : IEndpointConventionBuilder =>
        builder.AddEndpointFilter(async (context, next) =>
        {
            var http = context.HttpContext;
            var expected = http.RequestServices.GetRequiredService<IConfiguration>()[ConfigKey];
            var provided = http.Request.Headers[HeaderName].ToString();

            return KeysMatch(expected, provided) ? await next(context) : Results.Unauthorized();
        });

    // VULN-SPOT #09: Observable Timing Discrepancy (CWE-208)
    //   Typical mistake: comparing secrets with == / string.Equals, which can stop at the first differing character.
    //   Here: FixedTimeEquals takes the same time regardless of where the values differ.
    private static bool KeysMatch(string? expected, string? provided) =>
        !string.IsNullOrEmpty(expected)
        && !string.IsNullOrEmpty(provided)
        && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(provided));
}

/// <summary>Adds the internal API key to outgoing HttpClient requests.</summary>
public sealed class InternalApiKeyHandler(IConfiguration configuration) : DelegatingHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        request.Headers.Remove(InternalApi.HeaderName);
        request.Headers.Add(InternalApi.HeaderName, configuration[InternalApi.ConfigKey]);
        return base.SendAsync(request, cancellationToken);
    }
}

// Contracts used for service-to-service communication.
public sealed record SystemPostRequest(string? AuthorName, string? Content, bool IsTrending);

public sealed record SystemCommentRequest(string? AuthorName, string? Content);

public sealed record CreatedIdResponse(int Id);

/// <summary>Uniform error body returned by all services: { "error": "..." }.</summary>
public sealed record ErrorResponse(string Error);
