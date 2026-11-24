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
                // VULN-SPOT #13: Improper Verification of Token Signature (CWE-347)
                //   Typical mistakes: not validating the signature, issuer, audience or expiry; accepting
                //   unsigned tokens; using a short or guessable signing secret.
                //   Here: all four are validated, and startup fails if the secret is shorter than 32 bytes.
                jwt.MapInboundClaims = false;
                jwt.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidIssuer = options.Issuer,
                    ValidateAudience = true,
                    ValidAudience = options.Audience,
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = options.GetSigningKey(),
                    ValidateLifetime = true,
                    ClockSkew = TimeSpan.FromSeconds(30),
                    NameClaimType = TrollNetClaims.Name,
                    RoleClaimType = TrollNetClaims.Role,
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
