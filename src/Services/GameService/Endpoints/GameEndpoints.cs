using System.Security.Claims;
using GameService.Data;
using GameService.Engine;
using Microsoft.EntityFrameworkCore;
using TrollNet.Shared;

namespace GameService.Endpoints;

// VULN-SPOT #15: Exposure of Sensitive Information (CWE-200) — INTENTIONAL FOR TRAINING
//   GET /api/objectives is anonymous, and for the data-exposure objective (Vector == DataLeak) the public
//   DTO still returns the secret Flag, so anyone can read that flag without solving anything. Every other
//   objective now returns Flag = null and must be earned through its own vulnerability.
//   Try: curl -s /api/objectives | jq '.[] | select(.vector=="DataLeak") | .flag'
//   Fix: never put Flag on a public DTO; reveal it only to a completed solver or an admin.
public sealed record ObjectiveDto(
    int Id,
    string Title,
    string Description,
    string Category,
    string TipId,
    string Vector,
    int Difficulty,
    int Points,
    int? TargetPostId,
    DateTime CreatedAt,
    DateTime ExpiresAt,
    bool IsCompleted,
    string? CompletedByUsername,
    string? Flag);

public sealed record SubmitFlagRequest(string? Flag);

public sealed record SubmitFlagResponse(bool Correct, int PointsAwarded, string Message);

public sealed record ScoreDto(int UserId, string Username, int Points);

public sealed record FlagDto(int ObjectiveId, string Flag);

public sealed record LinkPreviewRequest(string? Url);

public sealed record LinkPreviewDto(string Url, int StatusCode, string BodyPreview);

public static class GameEndpoints
{
    public const string SubmitRateLimitPolicy = "flag-submit";
    private const int MaxFlagLength = 100;
    private const int LeaderboardSize = 20;

    public static IEndpointRouteBuilder MapGameEndpoints(this IEndpointRouteBuilder app)
    {
        var objectives = app.MapGroup("/api/objectives");
        objectives.MapGet("/", GetObjectives);
        // VULN-SPOT #11: Brute Force / Missing Rate Limiting (CWE-307) — INTENTIONAL FOR TRAINING
        //   No rate limiter on flag submission, so guesses can be sent as fast as the network allows.
        //   Fix: re-apply SubmitRateLimitPolicy (10 guesses/minute per user) or use exponential backoff.
        objectives.MapPost("/{id:int}/submit", SubmitFlag).RequireAuthorization();
        // The flag vault (VULN-SPOT #16 / #13): admin-only, but the JWT signature is never validated,
        // so a forged alg:none Admin token opens it just like the real seeded admin account does.
        objectives.MapGet("/{id:int}/flag", RevealFlag).RequireAuthorization(Policies.Admin);
        // VULN-SPOT #02: the XSS objective's flag is delivered to an authenticated page as a "notice".
        //   The web app loads it into a JS-only variable (never shown on screen); you read it with the
        //   browser console or an injected inline script. Any logged-in player may call it.
        objectives.MapGet("/{id:int}/notice", GetNotice).RequireAuthorization();

        var scores = app.MapGroup("/api/scores");
        scores.MapGet("/leaderboard", GetLeaderboard);
        scores.MapGet("/me", GetMyScore).RequireAuthorization();

        // VULN-SPOT #06: Server-Side Request Forgery (CWE-918) — INTENTIONAL FOR TRAINING
        app.MapPost("/api/link-preview", PreviewLink);

        // The SSRF "dead drop": an internal vault that returns an objective's flag. It is NOT routed by the
        // gateway, so it is only reachable from inside the Docker network — e.g. via the link-preview SSRF.
        app.MapGet("/internal/vault/{id:int}", RevealVaultFlag);

        return app;
    }

    private static async Task<IResult> PreviewLink(LinkPreviewRequest request, IHttpClientFactory httpFactory, CancellationToken ct)
    {
        var url = request.Url?.Trim();
        if (string.IsNullOrEmpty(url))
        {
            return Results.BadRequest(new ErrorResponse("URL is required."));
        }

        // VULN-SPOT #06: Server-Side Request Forgery (CWE-918) — INTENTIONAL FOR TRAINING
        //   The server fetches any absolute URL supplied by the client: no scheme/host allow-list, no blocking
        //   of private IP ranges, redirects are followed automatically.
        //   Try: POST /api/link-preview {"url":"http://social-service:8080/health"}
        //        POST /api/link-preview {"url":"http://gateway:8080/api/objectives"}
        //   Fix: allow-list schemes/hosts, resolve DNS and reject private/link-local ranges, disable redirects.
        using var client = httpFactory.CreateClient();
        using var response = await client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
        var body = await response.Content.ReadAsStringAsync(ct);
        var preview = body[..Math.Min(body.Length, 500)];
        return Results.Ok(new LinkPreviewDto(url, (int)response.StatusCode, preview));
    }

    private static async Task<IResult> GetObjectives(GameDbContext db, TimeProvider time, CancellationToken ct)
    {
        var now = time.GetUtcNow().UtcDateTime;
        var items = await db.Objectives.AsNoTracking()
            .Where(o => o.IsCompleted || o.ExpiresAt > now)
            .OrderBy(o => o.IsCompleted).ThenBy(o => o.ExpiresAt).ThenByDescending(o => o.CompletedAt)
            .Take(50)
            .Select(o => new ObjectiveDto(
                o.Id, o.Title, o.Description, o.Category, o.TipId, o.Vector.ToString(), o.Difficulty, o.Points, o.TargetPostId,
                o.CreatedAt, o.ExpiresAt, o.IsCompleted, o.CompletedByUsername,
                // VULN-SPOT #15: only the DataLeak objective still exposes its flag here.
                o.Vector == FlagVector.DataLeak ? o.Flag : null))
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

        var objective = await db.Objectives.FirstOrDefaultAsync(o => o.Id == id, ct);
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

        // VULN-SPOT #14: Race Condition, TOCTOU (CWE-362) — INTENTIONAL FOR TRAINING
        //   The "is it already captured?" check and the write are separate operations with no transaction
        //   and no conditional UPDATE. Two parallel correct submissions both see IsCompleted == false,
        //   both set the winner to themselves, and both add the points.
        //   Fix: one atomic `UPDATE ... WHERE NOT IsCompleted` inside a transaction; only one row can be claimed.
        objective.IsCompleted = true;
        objective.CompletedByUserId = userId;
        objective.CompletedByUsername = username;
        objective.CompletedAt = now;
        await db.SaveChangesAsync(ct);

        var score = await db.Scores.FirstOrDefaultAsync(s => s.UserId == userId, ct);
        if (score is null)
        {
            db.Scores.Add(new Score { UserId = userId, Username = username, Points = points, UpdatedAt = now });
        }
        else
        {
            score.Points += points;
            score.Username = username;
            score.UpdatedAt = now;
        }
        await db.SaveChangesAsync(ct);

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

    // SSRF target (#06): returns the flag only for SSRF objectives, and only to callers who can reach this
    // internal route — i.e. the server itself via link-preview. Not exposed through the gateway.
    private static async Task<IResult> RevealVaultFlag(int id, GameDbContext db, CancellationToken ct)
    {
        var objective = await db.Objectives.AsNoTracking()
            .Where(o => o.Id == id && o.Vector == FlagVector.Ssrf)
            .Select(o => new { o.Flag })
            .FirstOrDefaultAsync(ct);

        return objective is null
            ? Results.NotFound(new ErrorResponse("No dead drop at that id."))
            : Results.Ok(new FlagDto(id, objective.Flag));
    }

    // XSS notice (#02): the flag for XSS objectives, for the authenticated page to hold in a JS variable.
    private static async Task<IResult> GetNotice(int id, GameDbContext db, CancellationToken ct)
    {
        var objective = await db.Objectives.AsNoTracking()
            .Where(o => o.Id == id && o.Vector == FlagVector.Xss)
            .Select(o => new { o.Flag })
            .FirstOrDefaultAsync(ct);

        return objective is null
            ? Results.NotFound(new ErrorResponse("No notice for that objective."))
            : Results.Ok(new FlagDto(id, objective.Flag));
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

    // VULN-SPOT #09: Observable Timing Discrepancy (CWE-208) — INTENTIONAL FOR TRAINING
    //   Plain string equality may stop at the first differing character, leaking the flag one byte at a time
    //   through response-time measurements (with no rate limiter on /submit, see #11).
    //   Fix: CryptographicOperations.FixedTimeEquals over UTF-8 bytes of both strings.
    private static bool FlagsMatch(string expected, string provided) => expected == provided;
}
