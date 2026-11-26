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

// VULN-SPOT #16: body of the leaky debug-config endpoint — exposes the admin credentials.
public sealed record DebugConfigDto(string Environment, string AdminUsername, string AdminPassword, string Warning);

public static partial class PasswordRules
{
    public const int MinPasswordLength = 8;
    public const int MaxPasswordBytes = 72;

    [GeneratedRegex("^[A-Za-z0-9_]{3,32}$")]
    public static partial Regex UsernamePattern();

    // VULN-SPOT #12: Weak Password Hashing (CWE-916) — INTENTIONAL FOR TRAINING
    //   A single fast SHA-256 with no per-user salt. GPU rigs can test billions of guesses per second,
    //   and identical passwords produce identical hashes.
    //   Fix: use a salted, deliberately slow KDF such as BCrypt/Argon2id/scrypt.
    public static string Hash(string password) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(password)));

    public static bool Verify(string password, string storedHash) =>
        string.Equals(Hash(password), storedHash, StringComparison.Ordinal);
}

public static class AuthEndpoints
{
    public const string RateLimitPolicy = "auth";

    private const string InvalidCredentials = "Invalid username or password.";

    // VULN-SPOT #10: User Enumeration (CWE-204) — INTENTIONAL FOR TRAINING
    //   Login reveals whether an account exists: a missing user gets 404 + "No account with username ...",
    //   while a wrong password gets 401 + a different message. Attackers can build a list of valid players.
    //   Fix: return one generic message/status for both cases and do comparable work in both paths.

    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth");
        // VULN-SPOT #11: Brute Force / Missing Rate Limiting (CWE-307) — INTENTIONAL FOR TRAINING
        //   Register and login have no rate limiter at all, so password guessing and account farming are unlimited.
        //   (/guest keeps its limiter so the training instance stays usable; see also CWE-348 for bypassing it.)
        //   Fix: apply a per-IP/per-account fixed-window limiter to login and register.
        // Used by the web app: creates a guest player automatically, so no sign-in screen is needed.
        group.MapPost("/guest", Guest).RequireRateLimiting(RateLimitPolicy);
        // Register/login stay available for the API (e.g. the seeded admin account), but the UI doesn't use them.
        group.MapPost("/register", Register);
        group.MapPost("/login", Login);
        group.MapGet("/me", Me).RequireAuthorization();
        // VULN-SPOT #16: Hard-coded / Exposed Credentials (CWE-798) — INTENTIONAL FOR TRAINING
        //   A "debug config" endpoint left enabled leaks the seeded admin username and password to anyone.
        //   Try: curl http://localhost:8080/api/auth/config
        //   Fix: never expose configuration/secrets over an API; load secrets from a vault and keep them off responses.
        group.MapGet("/config", LeakConfig);
        return app;
    }

    // VULN-SPOT #16 (continued): dumps the seeded admin credentials. The real lesson is that the credentials
    // are committed in docker-compose.yml; this endpoint just makes them trivially discoverable in-game.
    private static IResult LeakConfig(IConfiguration configuration)
    {
        var adminUsername = configuration["Seed:AdminUsername"] ?? "admin";
        var adminPassword = configuration["Seed:AdminPassword"] ?? "";
        return Results.Ok(new DebugConfigDto(
            "development",
            adminUsername,
            adminPassword,
            "Remove this endpoint before production. Secrets must never be returned by an API."));
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

        // VULN-SPOT #12: Weak Password Hashing (CWE-916) — see PasswordRules.Hash above.
        var user = new User
        {
            Username = username,
            NormalizedUsername = normalized,
            PasswordHash = PasswordRules.Hash(request.Password!),
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
                PasswordHash = PasswordRules.Hash(RandomNumberGenerator.GetHexString(32)),
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

        // VULN-SPOT #10: User Enumeration (CWE-204) — INTENTIONAL FOR TRAINING
        //   The two branches return different status codes and messages, so an attacker learns which usernames exist.
        if (user is null)
        {
            return Results.Json(new ErrorResponse($"No account with username '{request.Username}' exists."),
                statusCode: StatusCodes.Status404NotFound);
        }

        if (!PasswordRules.Verify(request.Password, user.PasswordHash))
        {
            return Results.Json(new ErrorResponse($"Wrong password for user '{request.Username}'."),
                statusCode: StatusCodes.Status401Unauthorized);
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
