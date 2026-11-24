using Microsoft.EntityFrameworkCore;
using SocialService.Data;
using TrollNet.Shared;

namespace SocialService.Endpoints;

/// <summary>
/// Endpoints used by the game engine to publish generated content.
/// Protected by the internal API key and not routed by the gateway.
/// </summary>
public static class InternalEndpoints
{
    public static IEndpointRouteBuilder MapInternalEndpoints(this IEndpointRouteBuilder app)
    {
        // VULN-SPOT #08: Missing Authentication for Critical Function (CWE-306)
        //   Typical mistake: "internal" endpoints left unauthenticated on the assumption nobody can reach them.
        //   Here: two layers. The gateway never routes /internal/*, and every call must carry the internal API key.
        var group = app.MapGroup("/internal/posts").RequireInternalApiKey();
        group.MapPost("/", CreatePost);
        group.MapDelete("/{id:int}", DeletePost);
        group.MapPost("/{id:int}/comments", CreateComment);
        return app;
    }

    private static async Task<IResult> CreatePost(SystemPostRequest request, SocialDbContext db, TimeProvider time, CancellationToken ct)
    {
        if (!IsValid(request.AuthorName, request.Content, ContentRules.MaxPostLength))
        {
            return Results.BadRequest(new ErrorResponse("Invalid system post."));
        }

        var post = new Post
        {
            AuthorId = ContentRules.SystemAuthorId,
            AuthorName = request.AuthorName!,
            Content = request.Content!,
            IsTrending = request.IsTrending,
            CreatedAt = time.GetUtcNow().UtcDateTime,
        };
        db.Posts.Add(post);
        await db.SaveChangesAsync(ct);
        return Results.Ok(new CreatedIdResponse(post.Id));
    }

    private static async Task<IResult> DeletePost(int id, SocialDbContext db, CancellationToken ct)
    {
        var deleted = await db.Posts.Where(p => p.Id == id).ExecuteDeleteAsync(ct);
        return deleted == 0 ? Results.NotFound() : Results.NoContent();
    }

    private static async Task<IResult> CreateComment(int id, SystemCommentRequest request, SocialDbContext db, TimeProvider time, CancellationToken ct)
    {
        if (!IsValid(request.AuthorName, request.Content, ContentRules.MaxCommentLength))
        {
            return Results.BadRequest(new ErrorResponse("Invalid system comment."));
        }

        if (!await db.Posts.AnyAsync(p => p.Id == id, ct))
        {
            return Results.NotFound();
        }

        var comment = new Comment
        {
            PostId = id,
            AuthorId = ContentRules.SystemAuthorId,
            AuthorName = request.AuthorName!,
            Content = request.Content!,
            CreatedAt = time.GetUtcNow().UtcDateTime,
        };
        db.Comments.Add(comment);
        await db.SaveChangesAsync(ct);
        return Results.Ok(new CreatedIdResponse(comment.Id));
    }

    private static bool IsValid(string? authorName, string? content, int maxContentLength) =>
        !string.IsNullOrWhiteSpace(authorName) && authorName.Length <= ContentRules.MaxAuthorNameLength
        && !string.IsNullOrWhiteSpace(content) && content.Length <= maxContentLength;
}
