using GameService.Data;
using GameService.Engine;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TrollNet.Shared;

namespace GameService.Endpoints;

public sealed record DevTemplateDto(int Index, string Title, string Vector, string TipId, int Difficulty, int Points);

public sealed record DevStatusDto(bool Enabled, IReadOnlyList<DevTemplateDto> Templates);

public sealed record DevSpawnRequest(int? Template, string? Vector);

public sealed record DevObjectiveDto(int Id, string Title, string Vector, int? TargetPostId, string Flag, DateTime ExpiresAt);

/// <summary>
/// Testing console (see <see cref="DevToolsOptions"/>). Only mapped when DevTools:Enabled is true, so the
/// routes simply do not exist in a normal deployment.
/// </summary>
public static class DevEndpoints
{
    public static IEndpointRouteBuilder MapDevEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/dev");
        group.MapGet("/status", GetStatus);
        group.MapPost("/spawn", Spawn);
        group.MapPost("/clear", Clear);
        return app;
    }

    private static IResult GetStatus()
    {
        var templates = ContentLibrary.Objectives
            .Select((t, i) => new DevTemplateDto(i, t.Title, t.Vector.ToString(), t.TipId, t.Difficulty, ContentLibrary.PointsFor(t.Difficulty)))
            .ToList();
        return Results.Ok(new DevStatusDto(true, templates));
    }

    private static async Task<IResult> Spawn(DevSpawnRequest request, GameDbContext db, SocialClient social, IOptions<GameEngineOptions> options, TimeProvider time, CancellationToken ct)
    {
        var templates = ContentLibrary.Objectives;

        ObjectiveTemplate template;
        if (request.Template is int index)
        {
            if (index < 0 || index >= templates.Length)
            {
                return Results.BadRequest(new ErrorResponse($"Template index must be 0..{templates.Length - 1}."));
            }
            template = templates[index];
        }
        else if (!string.IsNullOrWhiteSpace(request.Vector))
        {
            var match = templates.FirstOrDefault(t => string.Equals(t.Vector.ToString(), request.Vector, StringComparison.OrdinalIgnoreCase));
            if (match is null)
            {
                return Results.BadRequest(new ErrorResponse($"No template with vector '{request.Vector}'."));
            }
            template = match;
        }
        else
        {
            template = ContentLibrary.Pick(templates);
        }

        var now = time.GetUtcNow().UtcDateTime;
        var objective = await ObjectiveSpawner.SpawnAsync(db, social, template, options.Value.ObjectiveLifetimeMinutes, now, ct);

        return Results.Ok(new DevObjectiveDto(objective.Id, objective.Title, objective.Vector.ToString(), objective.TargetPostId, objective.Flag, objective.ExpiresAt));
    }

    private static async Task<IResult> Clear(GameDbContext db, SocialClient social, TimeProvider time, CancellationToken ct)
    {
        var now = time.GetUtcNow().UtcDateTime;
        var active = await db.Objectives.Where(o => !o.IsCompleted && o.ExpiresAt > now).ToListAsync(ct);

        foreach (var objective in active)
        {
            if (objective.TargetPostId is int postId)
            {
                await social.DeletePostAsync(postId, ct);
            }
            db.Objectives.Remove(objective);
        }
        await db.SaveChangesAsync(ct);

        return Results.Ok(new { cleared = active.Count });
    }
}
