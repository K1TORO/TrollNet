using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using GameService.Data;
using Microsoft.EntityFrameworkCore;
using TrollNet.Shared;

namespace GameService.Endpoints;

// VULN-SPOT #15: Exposure of Sensitive Information (CWE-200)
//   Typical mistake: returning the database entity directly, which would include the secret Flag.
//   Here: a dedicated DTO lists exactly the fields the client may see.
public sealed record ObjectiveDto(
    int Id,
    string Title,
    string Description,
    string Category,
    int Difficulty,
    int Points,
    int? TargetPostId,
    DateTime CreatedAt,
    DateTime ExpiresAt,
    bool IsCompleted,
    string? CompletedByUsername);

public sealed record SubmitFlagRequest(string? Flag);

public sealed record SubmitFlagResponse(bool Correct, int PointsAwarded, string Message);

public sealed record ScoreDto(int UserId, string Username, int Points);

public sealed record FlagDto(int ObjectiveId, string Flag);

public static class GameEndpoints
{
    public const string SubmitRateLimitPolicy = "flag-submit";
    private const int MaxFlagLength = 100;
    private const int LeaderboardSize = 20;

    public static IEndpointRouteBuilder MapGameEndpoints(this IEndpointRouteBuilder app)
    {
        var objectives = app.MapGroup("/api/objectives");
        objectives.MapGet("/", GetObjectives);
        // VULN-SPOT #11: Brute Force / Missing Rate Limiting (CWE-307). Flag guessing is limited to 10 tries per minute per user.
        objectives.MapPost("/{id:int}/submit", SubmitFlag).RequireAuthorization().RequireRateLimiting(SubmitRateLimitPolicy);
        // Lets teachers verify the scoring flow end-to-end. Admin only.
        objectives.MapGet("/{id:int}/flag", RevealFlag).RequireAuthorization(Policies.Admin);

        var scores = app.MapGroup("/api/scores");
        scores.MapGet("/leaderboard", GetLeaderboard);
        scores.MapGet("/me", GetMyScore).RequireAuthorization();

        return app;
    }

    private static async Task<IResult> GetObjectives(GameDbContext db, TimeProvider time, CancellationToken ct)
    {
        var now = time.GetUtcNow().UtcDateTime;
        var items = await db.Objectives.AsNoTracking()
            .Where(o => o.IsCompleted || o.ExpiresAt > now)
            .OrderBy(o => o.IsCompleted).ThenBy(o => o.ExpiresAt).ThenByDescending(o => o.CompletedAt)
            .Take(50)
            .Select(o => new ObjectiveDto(
                o.Id, o.Title, o.Description, o.Category, o.Difficulty, o.Points, o.TargetPostId,
                o.CreatedAt, o.ExpiresAt, o.IsCompleted, o.CompletedByUsername))
            .ToListAsync(ct);

        return Results.Ok(items);
    }

    private static async Task<IResult> SubmitFlag(int id, SubmitFlagRequest request, ClaimsPrincipal user, GameDbContext db, TimeProvider time, CancellationToken ct)
    {
        var flag = request.Flag?.Trim();
        if (string.IsNullOrEmpty(flag) || flag.Length > MaxFlagLength)
        {
            return Results.BadRequest(new ErrorResponse("Flag is required."));
        }

        var objective = await db.Objectives.AsNoTracking().FirstOrDefaultAsync(o => o.Id == id, ct);
        if (objective is null)
        {
            return Results.NotFound(new ErrorResponse("Objective not found."));
        }

        var now = time.GetUtcNow().UtcDateTime;
        if (objective.IsCompleted)
        {
            return Results.Conflict(new ErrorResponse($"Already captured by @{objective.CompletedByUsername}."));
        }

        if (objective.ExpiresAt <= now)
        {
            return Results.Json(new ErrorResponse("Too late: the moderator already reviewed this post."), statusCode: StatusCodes.Status410Gone);
        }

        if (!FlagsMatch(objective.Flag, flag))
        {
            return Results.Ok(new SubmitFlagResponse(false, 0, "Incorrect flag. Keep digging."));
        }

        var userId = user.GetUserId();
        var username = user.GetUserName();
        var points = objective.Points;

        await using var transaction = await db.Database.BeginTransactionAsync(ct);

        // VULN-SPOT #14: Race Condition, TOCTOU (CWE-362)
        //   Typical mistake: "read IsCompleted, then write" in two steps. Parallel requests can all pass the
        //   check and award points several times.
        //   Here: a single conditional UPDATE claims the objective atomically. Only one request can succeed.
        var claimed = await db.Objectives
            .Where(o => o.Id == id && !o.IsCompleted && o.ExpiresAt > now)
            .ExecuteUpdateAsync(s => s
                .SetProperty(o => o.IsCompleted, true)
                .SetProperty(o => o.CompletedByUserId, userId)
                .SetProperty(o => o.CompletedByUsername, username)
                .SetProperty(o => o.CompletedAt, now), ct);

        if (claimed == 0)
        {
            return Results.Conflict(new ErrorResponse("Someone else captured this flag first."));
        }

        var updated = await db.Scores
            .Where(s => s.UserId == userId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(x => x.Points, x => x.Points + points)
                .SetProperty(x => x.Username, username)
                .SetProperty(x => x.UpdatedAt, now), ct);

        if (updated == 0)
        {
            db.Scores.Add(new Score { UserId = userId, Username = username, Points = points, UpdatedAt = now });
            await db.SaveChangesAsync(ct);
        }

        await transaction.CommitAsync(ct);
        return Results.Ok(new SubmitFlagResponse(true, points, $"Flag captured! +{points} points."));
    }

    private static async Task<IResult> RevealFlag(int id, GameDbContext db, CancellationToken ct)
    {
        var flag = await db.Objectives.AsNoTracking()
            .Where(o => o.Id == id)
            .Select(o => o.Flag)
            .FirstOrDefaultAsync(ct);

        return flag is null ? Results.NotFound(new ErrorResponse("Objective not found.")) : Results.Ok(new FlagDto(id, flag));
    }

    private static async Task<IResult> GetLeaderboard(GameDbContext db, CancellationToken ct)
    {
        var items = await db.Scores.AsNoTracking()
            .OrderByDescending(s => s.Points).ThenBy(s => s.UpdatedAt)
            .Take(LeaderboardSize)
            .Select(s => new ScoreDto(s.UserId, s.Username, s.Points))
            .ToListAsync(ct);

        return Results.Ok(items);
    }

    private static async Task<IResult> GetMyScore(ClaimsPrincipal user, GameDbContext db, CancellationToken ct)
    {
        var userId = user.GetUserId();
        var score = await db.Scores.AsNoTracking().FirstOrDefaultAsync(s => s.UserId == userId, ct);
        return Results.Ok(new ScoreDto(userId, user.GetUserName(), score?.Points ?? 0));
    }

    // VULN-SPOT #09: Observable Timing Discrepancy (CWE-208). Constant-time comparison of the secret flag.
    private static bool FlagsMatch(string expected, string provided) =>
        CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(provided));
}
