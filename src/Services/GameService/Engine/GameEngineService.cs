using System.Security.Cryptography;
using GameService.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace GameService.Engine;

public sealed class GameEngineOptions
{
    public const string SectionName = "GameEngine";

    /// <summary>How often the engine runs.</summary>
    public int TickSeconds { get; set; } = 60;

    /// <summary>Time players have before the simulated moderator reviews the target post.</summary>
    public int ObjectiveLifetimeMinutes { get; set; } = 10;

    public int MaxActiveObjectives { get; set; } = 3;

    /// <summary>Chance (0..1) per tick that a bot publishes an ordinary post.</summary>
    public double AmbientPostChance { get; set; } = 0.6;

    /// <summary>Chance (0..1) per tick that a bot comments on an active trending post.</summary>
    public double AmbientCommentChance { get; set; } = 0.5;
}

/// <summary>
/// Background game loop: spawns trending posts with objectives, lets the simulated moderator
/// close expired objectives, and keeps the feed alive with bot content.
/// </summary>
public sealed class GameEngineService(
    IServiceScopeFactory scopeFactory,
    IOptions<GameEngineOptions> options,
    TimeProvider time,
    ILogger<GameEngineService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var settings = options.Value;
        logger.LogInformation("Game engine started (tick {Tick}s, objective lifetime {Lifetime} min, max {Max} active).",
            settings.TickSeconds, settings.ObjectiveLifetimeMinutes, settings.MaxActiveObjectives);

        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(settings.TickSeconds), time);
        try
        {
            do
            {
                try
                {
                    await TickAsync(settings, stoppingToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    // A failed tick (e.g. social service still starting) is retried on the next tick.
                    logger.LogError(ex, "Game engine tick failed.");
                }
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Normal shutdown.
        }
    }

    private async Task TickAsync(GameEngineOptions settings, CancellationToken ct)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<GameDbContext>();
        var social = scope.ServiceProvider.GetRequiredService<SocialClient>();
        var now = time.GetUtcNow().UtcDateTime;

        await RunModeratorReviewAsync(db, social, now, ct);
        await SpawnObjectiveAsync(db, social, settings, now, ct);
        await GenerateAmbientContentAsync(db, social, settings, now, ct);
    }

    /// <summary>The moderator reviews targets whose time is up: the post is removed and the objective closes.</summary>
    private async Task RunModeratorReviewAsync(GameDbContext db, SocialClient social, DateTime now, CancellationToken ct)
    {
        var expired = await db.Objectives
            .Where(o => !o.IsCompleted && o.ExpiresAt <= now)
            .ToListAsync(ct);

        foreach (var objective in expired)
        {
            if (objective.TargetPostId is int postId)
            {
                await social.DeletePostAsync(postId, ct);
            }

            db.Objectives.Remove(objective);
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Moderator reviewed post {PostId}; objective {ObjectiveId} expired uncaptured.",
                objective.TargetPostId, objective.Id);
        }
    }

    private async Task SpawnObjectiveAsync(GameDbContext db, SocialClient social, GameEngineOptions settings, DateTime now, CancellationToken ct)
    {
        var active = await db.Objectives.CountAsync(o => !o.IsCompleted && o.ExpiresAt > now, ct);
        if (active >= settings.MaxActiveObjectives)
        {
            return;
        }

        var template = ContentLibrary.Pick(ContentLibrary.Objectives);
        var postId = await social.CreatePostAsync(template.PostAuthor, template.PostContent, isTrending: true, ct);

        var objective = new Objective
        {
            Title = template.Title,
            Description = template.Description,
            Category = template.Category,
            Difficulty = template.Difficulty,
            Points = ContentLibrary.PointsFor(template.Difficulty),
            TargetPostId = postId,
            Flag = GenerateFlag(),
            CreatedAt = now,
            ExpiresAt = now.AddMinutes(settings.ObjectiveLifetimeMinutes),
        };

        try
        {
            db.Objectives.Add(objective);
            await db.SaveChangesAsync(ct);
        }
        catch
        {
            // Don't leave an orphaned trending post behind.
            await social.DeletePostAsync(postId, CancellationToken.None);
            throw;
        }

        logger.LogInformation("Spawned objective {ObjectiveId} '{Title}' targeting post {PostId}.", objective.Id, objective.Title, postId);
    }

    private static async Task GenerateAmbientContentAsync(GameDbContext db, SocialClient social, GameEngineOptions settings, DateTime now, CancellationToken ct)
    {
        if (Random.Shared.NextDouble() < settings.AmbientPostChance)
        {
            await social.CreatePostAsync(
                ContentLibrary.Pick(ContentLibrary.BotAuthors),
                ContentLibrary.Pick(ContentLibrary.AmbientPosts),
                isTrending: false,
                ct);
        }

        if (Random.Shared.NextDouble() < settings.AmbientCommentChance)
        {
            var targetPostIds = await db.Objectives
                .Where(o => !o.IsCompleted && o.ExpiresAt > now && o.TargetPostId != null)
                .Select(o => o.TargetPostId!.Value)
                .ToListAsync(ct);

            if (targetPostIds.Count > 0)
            {
                await social.CreateCommentAsync(
                    ContentLibrary.Pick(targetPostIds),
                    ContentLibrary.Pick(ContentLibrary.BotAuthors),
                    ContentLibrary.Pick(ContentLibrary.AmbientComments),
                    ct);
            }
        }
    }

    private static string GenerateFlag() => $"TROLL{{{RandomNumberGenerator.GetHexString(24, lowercase: true)}}}";
}
