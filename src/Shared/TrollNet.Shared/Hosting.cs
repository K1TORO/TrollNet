using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace TrollNet.Shared;

public static class HostingExtensions
{
    /// <summary>
    /// Creates the service's database/schema (with retries while PostgreSQL is starting) and runs an optional seed.
    /// </summary>
    public static async Task InitializeDatabaseAsync<TContext>(this WebApplication app, Func<TContext, CancellationToken, Task>? seed = null)
        where TContext : DbContext
    {
        const int maxAttempts = 10;
        var logger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("DatabaseInitializer");

        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await using var scope = app.Services.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<TContext>();
                await db.Database.EnsureCreatedAsync();
                if (seed is not null)
                {
                    await seed(db, CancellationToken.None);
                }

                logger.LogInformation("Database for {Context} is ready.", typeof(TContext).Name);
                return;
            }
            catch (Exception ex) when (attempt < maxAttempts)
            {
                logger.LogWarning(ex, "Database not ready (attempt {Attempt}/{Max}). Retrying in 3 seconds...", attempt, maxAttempts);
                await Task.Delay(TimeSpan.FromSeconds(3));
            }
        }
    }

    // VULN-SPOT #17: Reliance on Reverse DNS / Spoofable Client IP (CWE-348)
    //   Typical mistake: trusting any X-Forwarded-For value, so a client can fake its IP and bypass rate limits.
    //   Here: nginx overwrites the header, and only the last two hops (nginx + gateway) are processed.
    /// <summary>
    /// Restores the real client IP behind nginx -> gateway (two hops), so rate limits are per client.
    /// Services are only reachable on the internal Docker network, so the proxies in front of them are trusted.
    /// </summary>
    public static WebApplication UseTrollNetForwardedHeaders(this WebApplication app)
    {
        var options = new ForwardedHeadersOptions
        {
            ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
            ForwardLimit = 2,
        };
        options.KnownIPNetworks.Clear();
        options.KnownProxies.Clear();
        app.UseForwardedHeaders(options);
        return app;
    }

    /// <summary>Fixed-window rate limit partitioned by authenticated user, or by client IP for anonymous requests.</summary>
    public static RateLimiterOptions AddPerClientFixedWindow(this RateLimiterOptions options, string policyName, int permitLimit, TimeSpan window)
    {
        options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
        options.AddPolicy(policyName, context => RateLimitPartition.GetFixedWindowLimiter(
            PartitionKey(context),
            _ => new FixedWindowRateLimiterOptions { PermitLimit = permitLimit, Window = window, QueueLimit = 0 }));
        return options;
    }

    private static string PartitionKey(HttpContext context) =>
        context.User.FindFirstValue(TrollNetClaims.Subject) is { } subject
            ? $"user:{subject}"
            : $"ip:{context.Connection.RemoteIpAddress}";
}
