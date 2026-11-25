using System.Security.Cryptography;
using GameService.Data;
using TrollNet.Shared;

namespace GameService.Engine;

/// <summary>
/// Creates an objective from a template: generates its flag, places the flag where the objective's
/// vulnerability exposes it (hidden post note for the social-side vectors), and publishes the target post.
/// Shared by the background engine and the dev-tools console so both place flags identically.
/// </summary>
public static class ObjectiveSpawner
{
    public static async Task<Objective> SpawnAsync(
        GameDbContext db,
        SocialClient social,
        ObjectiveTemplate template,
        int lifetimeMinutes,
        DateTime now,
        CancellationToken ct)
    {
        var flag = GenerateFlag();

        // Social-side vulnerabilities read the flag back from the target post's hidden SystemNote.
        // The other vectors keep the flag in the game DB (admin endpoint / SSRF vault / objectives leak / XSS notice).
        var noteOnPost = template.Vector is FlagVector.Sqli or FlagVector.MissingAuth or FlagVector.Idor or FlagVector.MassAssign
            ? flag
            : null;

        // Tag the mass-assignment decree post with a distinct AuthorId so the create endpoint can echo THIS
        // objective's secret, not another note-bearing objective's.
        var authorId = template.Vector is FlagVector.MassAssign ? SystemAuthors.Decree : (int?)null;

        var postId = await social.CreatePostAsync(template.PostAuthor, template.PostContent, isTrending: true, ct, systemNote: noteOnPost, authorId: authorId);

        var objective = new Objective
        {
            Title = template.Title,
            Description = template.Description,
            Category = template.Category,
            Difficulty = template.Difficulty,
            Points = ContentLibrary.PointsFor(template.Difficulty),
            TipId = template.TipId,
            Vector = template.Vector,
            TargetPostId = postId,
            Flag = flag,
            CreatedAt = now,
            ExpiresAt = now.AddMinutes(lifetimeMinutes),
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

        return objective;
    }

    public static string GenerateFlag() => $"TROLL{{{RandomNumberGenerator.GetHexString(24, lowercase: true)}}}";
}
