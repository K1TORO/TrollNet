using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using SocialService.Data;
using TrollNet.Shared;

namespace SocialService.Endpoints;

public static class PostEndpoints
{
    public const string WriteRateLimitPolicy = "social-write";

    public static IEndpointRouteBuilder MapPostEndpoints(this IEndpointRouteBuilder app)
    {
        var posts = app.MapGroup("/api/posts");
        posts.MapGet("/", GetFeed);
        posts.MapGet("/trending", GetTrending);
        posts.MapGet("/search", Search);
        posts.MapGet("/{id:int}", GetPost);
        posts.MapPost("/", CreatePost).RequireAuthorization().RequireRateLimiting(WriteRateLimitPolicy);
        posts.MapDelete("/{id:int}", DeletePost).RequireAuthorization();
        posts.MapPost("/{id:int}/comments", AddComment).RequireAuthorization().RequireRateLimiting(WriteRateLimitPolicy);

        app.MapDelete("/api/comments/{id:int}", DeleteComment).RequireAuthorization();
        return app;
    }

    private static async Task<IResult> GetFeed(int? page, int? pageSize, SocialDbContext db, CancellationToken ct)
    {
        var size = Math.Clamp(pageSize ?? ContentRules.DefaultPageSize, 1, ContentRules.MaxPageSize);
        var pageNumber = Math.Max(page ?? 1, 1);

        var items = await db.Posts.AsNoTracking()
            .OrderByDescending(p => p.CreatedAt).ThenByDescending(p => p.Id)
            .Skip((pageNumber - 1) * size)
            .Take(size)
            .Select(PostDto.Projection)
            .ToListAsync(ct);

        return Results.Ok(items);
    }

    private static async Task<IResult> GetTrending(SocialDbContext db, CancellationToken ct)
    {
        var items = await db.Posts.AsNoTracking()
            .Where(p => p.IsTrending)
            .OrderByDescending(p => p.CreatedAt)
            .Take(10)
            .Select(PostDto.Projection)
            .ToListAsync(ct);

        return Results.Ok(items);
    }

    private static async Task<IResult> Search(string? query, SocialDbContext db, CancellationToken ct)
    {
        var term = query?.Trim();
        if (string.IsNullOrEmpty(term) || term.Length > ContentRules.MaxSearchLength)
        {
            return Results.BadRequest(new ErrorResponse($"Search query must be 1-{ContentRules.MaxSearchLength} characters."));
        }

        // VULN-SPOT #01: SQL Injection (CWE-89)
        //   Typical mistake: building the SQL text from user input (string concatenation / interpolation).
        //   Here: EF Core sends the pattern as a bound parameter, never as SQL text.
        //   LIKE wildcards typed by the user are escaped so they match literally.
        var pattern = $"%{EscapeLikePattern(term)}%";
        var items = await db.Posts.AsNoTracking()
            .Where(p => EF.Functions.ILike(p.Content, pattern, @"\"))
            .OrderByDescending(p => p.CreatedAt)
            .Take(ContentRules.MaxPageSize)
            .Select(PostDto.Projection)
            .ToListAsync(ct);

        return Results.Ok(items);
    }

    private static async Task<IResult> GetPost(int id, SocialDbContext db, CancellationToken ct)
    {
        var post = await db.Posts.AsNoTracking()
            .Where(p => p.Id == id)
            .Select(p => new PostDetailDto(
                p.Id, p.AuthorId, p.AuthorName, p.Content, p.IsTrending, p.CreatedAt,
                p.Comments
                    .OrderBy(c => c.CreatedAt)
                    .Select(c => new CommentDto(c.Id, c.PostId, c.AuthorId, c.AuthorName, c.Content, c.CreatedAt))
                    .ToList()))
            .FirstOrDefaultAsync(ct);

        return post is null ? NotFound("Post not found.") : Results.Ok(post);
    }

    private static async Task<IResult> CreatePost(CreatePostRequest request, ClaimsPrincipal user, SocialDbContext db, TimeProvider time, CancellationToken ct)
    {
        var content = request.Content?.Trim();
        if (string.IsNullOrEmpty(content) || content.Length > ContentRules.MaxPostLength)
        {
            return Results.BadRequest(new ErrorResponse($"Post must be 1-{ContentRules.MaxPostLength} characters."));
        }

        // VULN-SPOT #04: Mass Assignment (CWE-915)
        //   Typical mistake: binding the request body straight onto the entity, letting the client set
        //   fields like AuthorId or IsTrending.
        //   Here: the request DTO only carries Content. Author comes from the validated token.
        var post = new Post
        {
            AuthorId = user.GetUserId(),
            AuthorName = user.GetUserName(),
            Content = content,
            CreatedAt = time.GetUtcNow().UtcDateTime,
        };
        db.Posts.Add(post);
        await db.SaveChangesAsync(ct);

        return Results.Created($"/api/posts/{post.Id}",
            new PostDto(post.Id, post.AuthorId, post.AuthorName, post.Content, post.IsTrending, post.CreatedAt, 0));
    }

    private static async Task<IResult> DeletePost(int id, ClaimsPrincipal user, SocialDbContext db, CancellationToken ct)
    {
        var post = await db.Posts.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (post is null)
        {
            return NotFound("Post not found.");
        }

        // VULN-SPOT #03: IDOR / Broken Access Control (CWE-639)
        //   Typical mistake: checking only that the caller is logged in ([Authorize]) and then acting on
        //   whatever id is in the URL.
        //   Here: ownership (or moderator role) is verified before deleting.
        if (!CanModify(user, post.AuthorId))
        {
            return Forbidden("You can only delete your own posts.");
        }

        db.Posts.Remove(post);
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    private static async Task<IResult> AddComment(int id, CreateCommentRequest request, ClaimsPrincipal user, SocialDbContext db, TimeProvider time, CancellationToken ct)
    {
        var content = request.Content?.Trim();
        if (string.IsNullOrEmpty(content) || content.Length > ContentRules.MaxCommentLength)
        {
            return Results.BadRequest(new ErrorResponse($"Comment must be 1-{ContentRules.MaxCommentLength} characters."));
        }

        if (!await db.Posts.AnyAsync(p => p.Id == id, ct))
        {
            return NotFound("Post not found.");
        }

        var comment = new Comment
        {
            PostId = id,
            AuthorId = user.GetUserId(),
            AuthorName = user.GetUserName(),
            Content = content,
            CreatedAt = time.GetUtcNow().UtcDateTime,
        };
        db.Comments.Add(comment);
        await db.SaveChangesAsync(ct);

        return Results.Created($"/api/posts/{id}", CommentDto.From(comment));
    }

    private static async Task<IResult> DeleteComment(int id, ClaimsPrincipal user, SocialDbContext db, CancellationToken ct)
    {
        var comment = await db.Comments.FirstOrDefaultAsync(c => c.Id == id, ct);
        if (comment is null)
        {
            return NotFound("Comment not found.");
        }

        // VULN-SPOT #03: IDOR / Broken Access Control (CWE-639). Same ownership check as for posts.
        if (!CanModify(user, comment.AuthorId))
        {
            return Forbidden("You can only delete your own comments.");
        }

        db.Comments.Remove(comment);
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    /// <summary>Owners can modify their own content; moderators and admins can modify anything.</summary>
    private static bool CanModify(ClaimsPrincipal user, int authorId) =>
        user.IsModerator() || (authorId != ContentRules.SystemAuthorId && authorId == user.GetUserId());

    private static string EscapeLikePattern(string value) =>
        value.Replace(@"\", @"\\").Replace("%", @"\%").Replace("_", @"\_");

    private static IResult NotFound(string message) => Results.NotFound(new ErrorResponse(message));

    private static IResult Forbidden(string message) =>
        Results.Json(new ErrorResponse(message), statusCode: StatusCodes.Status403Forbidden);
}
