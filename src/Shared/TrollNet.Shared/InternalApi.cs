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

    // VULN-SPOT #09: Observable Timing Discrepancy (CWE-208) — INTENTIONAL FOR TRAINING
    //   Ordinary string equality can return as soon as a byte differs, so the response time leaks how many
    //   leading characters of the secret key were guessed correctly.
    //   Try measuring many requests with different X-Internal-Key values and keep the slower prefix.
    //   Fix: CryptographicOperations.FixedTimeEquals on the UTF-8 bytes of both values.
    private static bool KeysMatch(string? expected, string? provided) =>
        !string.IsNullOrEmpty(expected)
        && !string.IsNullOrEmpty(provided)
        && expected == provided;
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

/// <summary>Well-known AuthorIds for engine-generated content (real players start at 1).</summary>
public static class SystemAuthors
{
    public const int System = 0;

    /// <summary>Mass-assignment decree target posts (#04). Lets the create endpoint echo the RIGHT decree's
    /// secret instead of whichever system post most recently stored a note.</summary>
    public const int Decree = 777;
}

// Contracts used for service-to-service communication.
// SystemNote and AuthorId let the game engine seed objective target posts with a hidden flag and a
// forged system author for the social-side vulnerability objectives (SQLi/IDOR/mass-assign/missing-auth).
public sealed record SystemPostRequest(string? AuthorName, string? Content, bool IsTrending, string? SystemNote = null, int? AuthorId = null);

public sealed record SystemCommentRequest(string? AuthorName, string? Content);

public sealed record CreatedIdResponse(int Id);

/// <summary>Uniform error body returned by all services: { "error": "..." }.</summary>
public sealed record ErrorResponse(string Error);
