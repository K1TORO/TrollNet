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
    string? Flag,
    /// <summary>True when the CURRENT player skipped or let this objective fail (per-player, from ObjectiveAttempt).</summary>
    bool AttemptFailed);

public sealed record SubmitFlagRequest(string? Flag);

public sealed record SubmitFlagResponse(bool Correct, int PointsAwarded, string Message);

public sealed record ScoreDto(int UserId, string Username, int Points);

public sealed record FlagDto(int ObjectiveId, string Flag);

public sealed record LinkPreviewRequest(string? Url);

public sealed record LinkPreviewDto(string Url, int StatusCode, string BodyPreview);

public sealed record ModeDto(string Mode, int Fails, int MaxFails, string ChallengeStatus, int ChallengeScore);

public sealed record SetModeRequest(string? Mode);

public static class GameEndpoints
{
    public const string SubmitRateLimitPolicy = "flag-submit";
    private const int MaxFlagLength = 100;
    private const int LeaderboardSize = 20;

    /// <summary>Failed objectives (expired or skipped) that end a Challenge run.</summary>
    public const int ChallengeMaxFails = 4;

    public static IEndpointRouteBuilder MapGameEndpoints(this IEndpointRouteBuilder app)
    {
        var objectives = app.MapGroup("/api/objectives");
        objectives.MapGet("/", GetObjectives);
        // VULN-SPOT #11: Brute Force / Missing Rate Limiting (CWE-307) — INTENTIONAL FOR TRAINING
        //   No rate limiter on flag submission, so guesses can be sent as fast as the network allows.
        //   Fix: re-apply SubmitRateLimitPolicy (10 guesses/minute per user) or use exponential backoff.
        objectives.MapPost("/{id:int}/submit", SubmitFlag).RequireAuthorization();
        // VULN-SPOT #02: the beacon a stored XSS payload hits to capture an XSS objective.
        objectives.MapPost("/{id:int}/xss-proof", XssProof).RequireAuthorization();
        // Give up on an objective in the current run: counts as a fail (Challenge ends after ChallengeMaxFails).
        objectives.MapPost("/{id:int}/skip", SkipObjective).RequireAuthorization();
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

        // Educational / Challenge mode state for the current player.
        app.MapGet("/api/mode", GetMode).RequireAuthorization();
        app.MapPost("/api/mode", SetMode).RequireAuthorization();

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

    private static async Task<IResult> GetObjectives(ClaimsPrincipal user, GameDbContext db, TimeProvider time, CancellationToken ct)
    {
        var now = time.GetUtcNow().UtcDateTime;
        var objectives = await db.Objectives.AsNoTracking()
            .Where(o => o.IsCompleted || o.ExpiresAt > now)
            .OrderBy(o => o.IsCompleted).ThenBy(o => o.ExpiresAt).ThenByDescending(o => o.CompletedAt)
            .Take(50)
            .ToListAsync(ct);

        // Per-player skip/fail state (so a skipped objective stays skipped across tab switches and reloads).
        // GetObjectives stays anonymous (VULN #15); when a token is present we also attach the caller's attempts.
        var failed = new HashSet<int>();
        if (int.TryParse(user.FindFirstValue(TrollNetClaims.Subject), out var userId))
        {
            var ids = objectives.Select(o => o.Id).ToList();
            var failedIds = await db.ObjectiveAttempts.AsNoTracking()
                .Where(a => a.UserId == userId && a.Failed && ids.Contains(a.ObjectiveId))
                .Select(a => a.ObjectiveId)
                .ToListAsync(ct);
            failed = failedIds.ToHashSet();
        }

        var items = objectives.Select(o => new ObjectiveDto(
            o.Id, o.Title, o.Description, o.Category, o.TipId, o.Vector.ToString(), o.Difficulty, o.Points, o.TargetPostId,
            o.CreatedAt, o.ExpiresAt, o.IsCompleted, o.CompletedByUsername,
            // VULN-SPOT #15: only the DataLeak objective still exposes its flag here.
            o.Vector == FlagVector.DataLeak ? o.Flag : null,
            failed.Contains(o.Id))).ToList();

        return Results.Ok(items);
    }

    private static async Task<IResult> SubmitFlag(int id, SubmitFlagRequest request, ClaimsPrincipal user, GameDbContext db, SocialClient social, TimeProvider time, CancellationToken ct)
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

        // VULN-SPOT #02 (XSS): this objective cannot be captured by pasting the flag here — you must land a
        // stored XSS payload that runs in the feed and beacons it (POST .../xss-proof). Reading the flag in
        // the console is not enough.
        if (objective.Vector == FlagVector.Xss)
        {
            return Results.Json(new ErrorResponse("This flag must be captured with a stored XSS payload (it beacons itself), not pasted here."),
                statusCode: StatusCodes.Status400BadRequest);
        }

        var userId = user.GetUserId();
        var username = user.GetUserName();
        var player = await GetOrCreatePlayerAsync(db, userId, username, now, ct);

        // A finished Challenge run is locked: no more submissions until the player restarts or switches mode.
        if (player.Mode == GameMode.Challenge && player.ChallengeStatus == ChallengeStatus.Ended)
        {
            await db.SaveChangesAsync(ct);
            return Results.Json(new ErrorResponse("Challenge over. Restart the challenge (or switch to Educational) to play again."),
                statusCode: StatusCodes.Status403Forbidden);
        }

        // Record engagement so that, if this objective later expires uncaptured, it can be counted as a fail.
        var attempt = await GetOrCreateAttemptAsync(db, userId, id, now, ct);

        if (!FlagsMatch(objective.Flag, flag))
        {
            await db.SaveChangesAsync(ct);
            return Results.Ok(new SubmitFlagResponse(false, 0, "Incorrect flag. Keep digging."));
        }

        var points = await CompleteCaptureAsync(db, social, objective, attempt, player, userId, username, now, ct);
        return Results.Ok(new SubmitFlagResponse(true, points, $"Flag captured! +{points} points."));
    }

    // VULN-SPOT #02 (XSS): the real capture path. A stored XSS payload runs in the feed, reads the hidden
    // notice (window.__trollnetNotices) and beacons the flag here. We require BOTH the correct flag AND
    // evidence that the player actually stored a payload, so simply reading the flag in the console fails.
    private static async Task<IResult> XssProof(int id, SubmitFlagRequest request, ClaimsPrincipal user, GameDbContext db, SocialClient social, TimeProvider time, CancellationToken ct)
    {
        var flag = request.Flag?.Trim();
        if (string.IsNullOrEmpty(flag) || flag.Length > MaxFlagLength)
        {
            return Results.BadRequest(new ErrorResponse("Flag is required."));
        }

        var objective = await db.Objectives.FirstOrDefaultAsync(o => o.Id == id && o.Vector == FlagVector.Xss, ct);
        if (objective is null)
        {
            return Results.NotFound(new ErrorResponse("No XSS objective with that id."));
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

        var userId = user.GetUserId();
        var username = user.GetUserName();
        var player = await GetOrCreatePlayerAsync(db, userId, username, now, ct);
        if (player.Mode == GameMode.Challenge && player.ChallengeStatus == ChallengeStatus.Ended)
        {
            await db.SaveChangesAsync(ct);
            return Results.Json(new ErrorResponse("Challenge over. Restart the challenge (or switch to Educational) to play again."),
                statusCode: StatusCodes.Status403Forbidden);
        }

        var attempt = await GetOrCreateAttemptAsync(db, userId, id, now, ct);

        if (!FlagsMatch(objective.Flag, flag))
        {
            await db.SaveChangesAsync(ct);
            return Results.Ok(new SubmitFlagResponse(false, 0, "The beacon carried the wrong flag."));
        }

        // Enforce the XSS act: the player must have stored a payload-looking post/comment.
        if (!await social.HasXssPayloadAsync(userId, ct))
        {
            await db.SaveChangesAsync(ct);
            return Results.Ok(new SubmitFlagResponse(false, 0, "No stored payload found. Post an XSS payload that beacons the flag, don't just read it."));
        }

        var points = await CompleteCaptureAsync(db, social, objective, attempt, player, userId, username, now, ct);
        return Results.Ok(new SubmitFlagResponse(true, points, $"XSS landed — flag captured! +{points} points."));
    }

    /// <summary>Shared capture: mark the objective done, award mode-aware points, and deface the target post.</summary>
    private static async Task<int> CompleteCaptureAsync(
        GameDbContext db, SocialClient social, Objective objective, ObjectiveAttempt attempt, PlayerState player,
        int userId, string username, DateTime now, CancellationToken ct)
    {
        // Educational mode awards half points; Challenge mode awards the full value.
        var points = player.Mode == GameMode.Educational ? objective.Points / 2 : objective.Points;

        // VULN-SPOT #14: Race Condition, TOCTOU (CWE-362) — INTENTIONAL FOR TRAINING
        //   The "is it already captured?" check and the write are separate operations with no transaction.
        //   Fix: one atomic `UPDATE ... WHERE NOT IsCompleted` inside a transaction.
        objective.IsCompleted = true;
        objective.CompletedByUserId = userId;
        objective.CompletedByUsername = username;
        objective.CompletedAt = now;
        attempt.Completed = true;
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

        // Trolling flavour: deface the captured post with absurd text (best-effort — never fail the capture).
        if (objective.TargetPostId is int postId)
        {
            try
            {
                await social.DefacePostAsync(postId, ContentLibrary.Pick(ContentLibrary.TrollDefacements), ct);
            }
            catch
            {
                /* social unavailable — the capture still counts */
            }
        }

        return points;
    }

    // ---- Educational / Challenge mode ----

    private static async Task<IResult> GetMode(ClaimsPrincipal user, GameDbContext db, TimeProvider time, CancellationToken ct)
    {
        var now = time.GetUtcNow().UtcDateTime;
        var player = await GetOrCreatePlayerAsync(db, user.GetUserId(), user.GetUserName(), now, ct);
        await db.SaveChangesAsync(ct);
        return Results.Ok(ToDto(player));
    }

    private static async Task<IResult> SetMode(SetModeRequest request, ClaimsPrincipal user, GameDbContext db, TimeProvider time, CancellationToken ct)
    {
        if (!Enum.TryParse<GameMode>(request.Mode, ignoreCase: true, out var mode))
        {
            return Results.BadRequest(new ErrorResponse("Mode must be 'Educational' or 'Challenge'."));
        }

        var now = time.GetUtcNow().UtcDateTime;
        var userId = user.GetUserId();
        var player = await GetOrCreatePlayerAsync(db, userId, user.GetUserName(), now, ct);

        // Switching modes starts a fresh run: reset the fail counter and clear this player's engagement
        // history, so hints seen in Educational do not carry over into a Challenge run.
        player.Mode = mode;
        player.Fails = 0;
        player.ChallengeScore = 0;
        player.StartedAt = now;
        player.EndedAt = null;
        player.ChallengeStatus = mode == GameMode.Challenge ? ChallengeStatus.Active : ChallengeStatus.None;

        var attempts = await db.ObjectiveAttempts.Where(a => a.UserId == userId).ToListAsync(ct);
        db.ObjectiveAttempts.RemoveRange(attempts);

        await db.SaveChangesAsync(ct);
        return Results.Ok(ToDto(player));
    }

    private static async Task<IResult> SkipObjective(int id, ClaimsPrincipal user, GameDbContext db, TimeProvider time, CancellationToken ct)
    {
        var now = time.GetUtcNow().UtcDateTime;
        var userId = user.GetUserId();
        var player = await GetOrCreatePlayerAsync(db, userId, user.GetUserName(), now, ct);

        var objective = await db.Objectives.FirstOrDefaultAsync(o => o.Id == id, ct);
        if (objective is null)
        {
            return Results.NotFound(new ErrorResponse("Objective not found."));
        }

        var attempt = await GetOrCreateAttemptAsync(db, userId, id, now, ct);
        if (!attempt.Completed && !attempt.Failed)
        {
            attempt.Failed = true;
            await RegisterFailAsync(db, player, now, ct);
        }

        await db.SaveChangesAsync(ct);
        return Results.Ok(ToDto(player));
    }

    /// <summary>
    /// Count one failed objective (expired or skipped). When it ends a Challenge run, snapshot the player's
    /// current score so the summary can show the saved result. Shared by the skip endpoint and the engine.
    /// </summary>
    internal static async Task RegisterFailAsync(GameDbContext db, PlayerState player, DateTime now, CancellationToken ct)
    {
        player.Fails++;
        if (player.Mode == GameMode.Challenge && player.ChallengeStatus == ChallengeStatus.Active && player.Fails >= ChallengeMaxFails)
        {
            player.ChallengeStatus = ChallengeStatus.Ended;
            player.EndedAt = now;
            var score = await db.Scores.AsNoTracking().FirstOrDefaultAsync(s => s.UserId == player.UserId, ct);
            player.ChallengeScore = score?.Points ?? 0;
        }
    }

    internal static async Task<PlayerState> GetOrCreatePlayerAsync(GameDbContext db, int userId, string username, DateTime now, CancellationToken ct)
    {
        var player = await db.PlayerStates.FirstOrDefaultAsync(p => p.UserId == userId, ct);
        if (player is null)
        {
            player = new PlayerState { UserId = userId, Username = username, Mode = GameMode.Educational, StartedAt = now };
            db.PlayerStates.Add(player);
        }
        else
        {
            player.Username = username;
        }
        return player;
    }

    private static async Task<ObjectiveAttempt> GetOrCreateAttemptAsync(GameDbContext db, int userId, int objectiveId, DateTime now, CancellationToken ct)
    {
        var attempt = await db.ObjectiveAttempts.FirstOrDefaultAsync(a => a.UserId == userId && a.ObjectiveId == objectiveId, ct);
        if (attempt is null)
        {
            attempt = new ObjectiveAttempt { UserId = userId, ObjectiveId = objectiveId, CreatedAt = now };
            db.ObjectiveAttempts.Add(attempt);
        }
        return attempt;
    }

    private static ModeDto ToDto(PlayerState p) =>
        new(p.Mode.ToString(), p.Fails, ChallengeMaxFails, p.ChallengeStatus.ToString(), p.ChallengeScore);

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
