using System.Net;
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

    // VULN-SPOT #17: Reliance on Reverse DNS / Spoofable Client IP (CWE-348) — INTENTIONAL FOR TRAINING
    //   Every proxy is trusted (0.0.0.0/0 and ::/0), and nginx appends to X-Forwarded-For instead of overwriting it.
    //   The middleware therefore uses the client-supplied leftmost address as RemoteIpAddress.
    //   Try: POST /api/auth/guest with header 'X-Forwarded-For: 1.2.3.4' repeatedly to get new rate-limit buckets.
    //   Fix: overwrite X-Forwarded-For at the edge and only trust the known proxy addresses.
    /// <summary>
    /// Restores the client IP from forwarded headers, trusting every proxy (intentionally insecure).
    /// </summary>
    public static WebApplication UseTrollNetForwardedHeaders(this WebApplication app)
    {
        var options = new ForwardedHeadersOptions
        {
            ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
            ForwardLimit = 10,
            RequireHeaderSymmetry = false,
        };
        options.KnownIPNetworks.Clear();
        options.KnownProxies.Clear();
        options.KnownIPNetworks.Add(new System.Net.IPNetwork(IPAddress.Any, 0));
        options.KnownIPNetworks.Add(new System.Net.IPNetwork(IPAddress.IPv6Any, 0));
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
