using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using AuthService.Data;
using Microsoft.EntityFrameworkCore;
using TrollNet.Shared;

namespace AuthService.Endpoints;

public sealed record CredentialsRequest(string? Username, string? Password);

public sealed record UserDto(int Id, string Username, string Role)
{
    public static UserDto From(User user) => new(user.Id, user.Username, user.Role);
}

public sealed record AuthResponse(string Token, DateTime ExpiresAt, UserDto User);

public static partial class PasswordRules
{
    public const int BcryptWorkFactor = 11;
    public const int MinPasswordLength = 8;
    public const int MaxPasswordBytes = 72; // bcrypt ignores everything after 72 bytes

    [GeneratedRegex("^[A-Za-z0-9_]{3,32}$")]
    public static partial Regex UsernamePattern();
}

public static class AuthEndpoints
{
    public const string RateLimitPolicy = "auth";

    private const string InvalidCredentials = "Invalid username or password.";

    // VULN-SPOT #10: User Enumeration (CWE-204)
    //   Typical mistake: different error messages or response times for "no such user" and "wrong password".
    //   Here: one generic message, and a dummy hash is verified when the user does not exist,
    //   so response time does not reveal which usernames are registered.
    //   (Registration still has to say "username taken"; rate limiting (#11) limits abuse of that.)
    private static readonly Lazy<string> DummyHash =
        new(() => BCrypt.Net.BCrypt.HashPassword(Guid.NewGuid().ToString(), PasswordRules.BcryptWorkFactor));

    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth");
        // VULN-SPOT #11: Brute Force / Missing Rate Limiting (CWE-307)
        //   Typical mistake: unlimited login attempts allow password guessing.
        //   Here: 10 attempts per minute per client (see Program.cs).
        // Used by the web app: creates a guest player automatically, so no sign-in screen is needed.
        group.MapPost("/guest", Guest).RequireRateLimiting(RateLimitPolicy);
        // Register/login stay available for the API (e.g. the seeded admin account), but the UI doesn't use them.
        group.MapPost("/register", Register).RequireRateLimiting(RateLimitPolicy);
        group.MapPost("/login", Login).RequireRateLimiting(RateLimitPolicy);
        group.MapGet("/me", Me).RequireAuthorization();
        return app;
    }

    private static async Task<IResult> Register(CredentialsRequest request, AuthDbContext db, TokenService tokens, TimeProvider time, CancellationToken ct)
    {
        var errors = Validate(request);
        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        var username = request.Username!;
        var normalized = username.ToLowerInvariant();
        if (await db.Users.AnyAsync(u => u.NormalizedUsername == normalized, ct))
        {
            return Results.Conflict(new ErrorResponse("Username is already taken."));
        }

        // VULN-SPOT #12: Weak Password Hashing (CWE-916)
        //   Typical mistake: storing plain text, or a fast unsalted hash (MD5/SHA-1/SHA-256).
        //   Here: BCrypt, which is salted and deliberately slow (work factor 11).
        var user = new User
        {
            Username = username,
            NormalizedUsername = normalized,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password, PasswordRules.BcryptWorkFactor),
            Role = Roles.User,
            CreatedAt = time.GetUtcNow().UtcDateTime,
        };
        db.Users.Add(user);

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Unique index hit by a concurrent registration with the same name.
            return Results.Conflict(new ErrorResponse("Username is already taken."));
        }

        return Results.Ok(tokens.CreateResponse(user));
    }

    private static async Task<IResult> Guest(AuthDbContext db, TokenService tokens, TimeProvider time, CancellationToken ct)
    {
        const int maxAttempts = 5;
        for (var attempt = 0; attempt < maxAttempts; attempt++)
        {
            var username = $"troll_{RandomNumberGenerator.GetInt32(10_000, 100_000)}";
            var user = new User
            {
                Username = username,
                NormalizedUsername = username,
                // Random password that is never shown: guests can't sign in with a password, only via their token.
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(RandomNumberGenerator.GetHexString(32), PasswordRules.BcryptWorkFactor),
                Role = Roles.User,
                CreatedAt = time.GetUtcNow().UtcDateTime,
            };
            db.Users.Add(user);

            try
            {
                await db.SaveChangesAsync(ct);
                return Results.Ok(tokens.CreateResponse(user, isGuest: true));
            }
            catch (DbUpdateException)
            {
                // Name already taken: try another one.
                db.ChangeTracker.Clear();
            }
        }

        return Results.Json(new ErrorResponse("Could not create a player. Please try again."), statusCode: StatusCodes.Status503ServiceUnavailable);
    }

    private static async Task<IResult> Login(CredentialsRequest request, AuthDbContext db, TokenService tokens, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(request.Username) || string.IsNullOrEmpty(request.Password)
            || Encoding.UTF8.GetByteCount(request.Password) > PasswordRules.MaxPasswordBytes)
        {
            return Results.Json(new ErrorResponse(InvalidCredentials), statusCode: StatusCodes.Status401Unauthorized);
        }

        var normalized = request.Username.ToLowerInvariant();
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.NormalizedUsername == normalized, ct);

        var passwordOk = BCrypt.Net.BCrypt.Verify(request.Password, user?.PasswordHash ?? DummyHash.Value);
        if (user is null || !passwordOk)
        {
            return Results.Json(new ErrorResponse(InvalidCredentials), statusCode: StatusCodes.Status401Unauthorized);
        }

        return Results.Ok(tokens.CreateResponse(user));
    }

    private static async Task<IResult> Me(ClaimsPrincipal principal, AuthDbContext db, CancellationToken ct)
    {
        var userId = principal.GetUserId();
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId, ct);
        return user is null ? Results.Unauthorized() : Results.Ok(UserDto.From(user));
    }

    private static Dictionary<string, string[]> Validate(CredentialsRequest request)
    {
        var errors = new Dictionary<string, string[]>();

        if (string.IsNullOrEmpty(request.Username) || !PasswordRules.UsernamePattern().IsMatch(request.Username))
        {
            errors["username"] = ["Username must be 3-32 characters: letters, digits or underscore."];
        }

        if (string.IsNullOrEmpty(request.Password) || request.Password.Length < PasswordRules.MinPasswordLength)
        {
            errors["password"] = [$"Password must be at least {PasswordRules.MinPasswordLength} characters."];
        }
        else if (Encoding.UTF8.GetByteCount(request.Password) > PasswordRules.MaxPasswordBytes)
        {
            errors["password"] = [$"Password must be at most {PasswordRules.MaxPasswordBytes} bytes."];
        }

        return errors;
    }
}
