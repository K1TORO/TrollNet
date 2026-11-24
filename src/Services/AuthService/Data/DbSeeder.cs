using System.Security.Cryptography;
using AuthService.Endpoints;
using Microsoft.EntityFrameworkCore;
using TrollNet.Shared;

namespace AuthService.Data;

public static class DbSeeder
{
    public const string ModeratorBotName = "moderator_bot";

    public static async Task SeedAsync(AuthDbContext db, IConfiguration configuration, TimeProvider time, CancellationToken ct)
    {
        // The simulated moderator account. Its password is random and never stored anywhere, so nobody can sign in as it.
        await EnsureUserAsync(db, ModeratorBotName, RandomNumberGenerator.GetHexString(64), Roles.Moderator, time, ct);

        // Optional admin (teacher) account, created only when a password is configured.
        var adminPassword = configuration["Seed:AdminPassword"];
        if (!string.IsNullOrWhiteSpace(adminPassword))
        {
            var adminName = configuration["Seed:AdminUsername"] ?? "admin";
            await EnsureUserAsync(db, adminName, adminPassword, Roles.Admin, time, ct);
        }

        await db.SaveChangesAsync(ct);
    }

    private static async Task EnsureUserAsync(AuthDbContext db, string username, string password, string role, TimeProvider time, CancellationToken ct)
    {
        var normalized = username.ToLowerInvariant();
        if (await db.Users.AnyAsync(u => u.NormalizedUsername == normalized, ct))
        {
            return;
        }

        db.Users.Add(new User
        {
            Username = username,
            NormalizedUsername = normalized,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(password, PasswordRules.BcryptWorkFactor),
            Role = role,
            CreatedAt = time.GetUtcNow().UtcDateTime,
        });
    }
}
