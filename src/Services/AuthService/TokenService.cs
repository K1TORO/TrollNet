using AuthService.Data;
using AuthService.Endpoints;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using TrollNet.Shared;

namespace AuthService;

public sealed class TokenService(JwtOptions options, TimeProvider time)
{
    private readonly JsonWebTokenHandler _handler = new();

    public AuthResponse CreateResponse(User user, bool isGuest = false)
    {
        var lifetime = isGuest ? options.GuestExpiryMinutes : options.ExpiryMinutes;
        var expiresAt = time.GetUtcNow().UtcDateTime.AddMinutes(lifetime);

        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = options.Issuer,
            Audience = options.Audience,
            Expires = expiresAt,
            SigningCredentials = new SigningCredentials(options.GetSigningKey(), SecurityAlgorithms.HmacSha256),
            Claims = new Dictionary<string, object>
            {
                [TrollNetClaims.Subject] = user.Id.ToString(),
                [TrollNetClaims.Name] = user.Username,
                [TrollNetClaims.Role] = user.Role,
            },
        };

        return new AuthResponse(_handler.CreateToken(descriptor), expiresAt, UserDto.From(user));
    }
}
