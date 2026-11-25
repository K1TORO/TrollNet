using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;

namespace TrollNet.Shared;

/// <summary>JWT settings shared by the service that issues tokens (auth) and the services that validate them.</summary>
public sealed class JwtOptions
{
    public const string SectionName = "Jwt";

    public string Issuer { get; set; } = "trollnet-auth";
    public string Audience { get; set; } = "trollnet";
    public string Secret { get; set; } = string.Empty;
    public int ExpiryMinutes { get; set; } = 120;

    /// <summary>Lifetime of automatically created guest sessions (default 30 days), so players keep their identity locally.</summary>
    public int GuestExpiryMinutes { get; set; } = 43_200;

    public SymmetricSecurityKey GetSigningKey() => new(Encoding.UTF8.GetBytes(Secret));
}

public static class Roles
{
    public const string User = "User";
    public const string Moderator = "Moderator";
    public const string Admin = "Admin";
}

public static class Policies
{
    public const string Moderator = "Moderator";
    public const string Admin = "Admin";
}

public static class TrollNetClaims
{
    public const string Subject = "sub";
    public const string Name = "name";
    public const string Role = "role";
}

public static class AuthenticationExtensions
{
    public static IServiceCollection AddTrollNetAuthentication(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection(JwtOptions.SectionName).Get<JwtOptions>() ?? new JwtOptions();
        if (Encoding.UTF8.GetByteCount(options.Secret) < 32)
        {
            throw new InvalidOperationException("Configuration value 'Jwt:Secret' must be set and be at least 32 bytes long.");
        }

        services.AddSingleton(options);

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(jwt =>
            {
                // VULN-SPOT #13: Improper Verification of Token Signature (CWE-347) — INTENTIONAL FOR TRAINING
                //   Signature, issuer, audience and lifetime checks are all disabled, and unsigned tokens are accepted.
                //   A player can forge a JWT with "alg":"none" and {"role":"Admin"} to get admin rights.
                //   The 32-byte secret check below is now pointless: the signature is never checked.
                //   Fix: keep all four validations enabled and require signed tokens.
                jwt.MapInboundClaims = false;
                jwt.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = false,
                    ValidIssuer = options.Issuer,
                    ValidateAudience = false,
                    ValidAudience = options.Audience,
                    ValidateIssuerSigningKey = false,
                    RequireSignedTokens = false,
                    IssuerSigningKey = options.GetSigningKey(),
                    ValidateLifetime = false,
                    ClockSkew = TimeSpan.FromSeconds(30),
                    NameClaimType = TrollNetClaims.Name,
                    RoleClaimType = TrollNetClaims.Role,
                };

                // VULN-SPOT #05: Cross-Site Request Forgery (CWE-352) — INTENTIONAL FOR TRAINING
                //   The same JWT is also accepted from a cookie, which browsers attach to cross-site requests
                //   automatically. There are no anti-forgery tokens and the gateway permits any CORS origin,
                //   so a malicious page can call state-changing APIs as the victim.
                //   Fix: keep the token in an Authorization header or add anti-forgery tokens + SameSite cookies.
                jwt.Events = new JwtBearerEvents
                {
                    OnMessageReceived = context =>
                    {
                        if (context.Request.Cookies.TryGetValue("trollnet.token", out var token)
                            && !string.IsNullOrEmpty(token))
                        {
                            context.Token = token;
                        }
                        return Task.CompletedTask;
                    },
                };
            });

        services.AddAuthorizationBuilder()
            .AddPolicy(Policies.Moderator, p => p.RequireRole(Roles.Moderator, Roles.Admin))
            .AddPolicy(Policies.Admin, p => p.RequireRole(Roles.Admin));

        return services;
    }
}

public static class ClaimsPrincipalExtensions
{
    public static int GetUserId(this ClaimsPrincipal user) =>
        int.TryParse(user.FindFirstValue(TrollNetClaims.Subject), out var id)
            ? id
            : throw new InvalidOperationException("Authenticated user has no valid 'sub' claim.");

    public static string GetUserName(this ClaimsPrincipal user) =>
        user.FindFirstValue(TrollNetClaims.Name) ?? "unknown";

    public static bool IsModerator(this ClaimsPrincipal user) =>
        user.IsInRole(Roles.Moderator) || user.IsInRole(Roles.Admin);
}
