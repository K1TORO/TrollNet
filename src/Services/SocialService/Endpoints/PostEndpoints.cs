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
        posts.MapGet("/attachment", GetAttachment);
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

        // VULN-SPOT #01: SQL Injection (CWE-89) — INTENTIONAL FOR TRAINING
        //   The search term is interpolated directly into the SQL text instead of being bound as a parameter.
        //   Try: /api/posts/search?query=' OR 1=1 --        (returns every post)
        //        /api/posts/search?query=' UNION SELECT 0,'admin','x','pwned',true,now(),0 --  (injects a row)
        //   Fix: EF.Functions.ILike(p.Content, $"%{escaped}%", @"\") with a bound parameter, escaping LIKE wildcards.
        var sql = $"SELECT * FROM \"Posts\" WHERE \"Content\" ILIKE '%{term}%' ORDER BY \"CreatedAt\" DESC";
        var items = await db.Posts.FromSqlRaw(sql).AsNoTracking().ToListAsync(ct);

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

    // VULN-SPOT #07: Path Traversal / Local File Inclusion (CWE-22) — INTENTIONAL FOR TRAINING
    //   A "download attachment" feature joins the user-supplied name onto the app directory and reads it
    //   without checking that the resolved path is still inside that directory.
    //   Try: /api/posts/attachment?name=../../../../etc/passwd
    //        /api/posts/attachment?name=../appsettings.json
    //   Fix: serve files by generated id, or resolve the full path and require it to start with the root directory.
    private static async Task<IResult> GetAttachment(string? name, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return Results.BadRequest(new ErrorResponse("Attachment name is required."));
        }

        var path = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, name));
        var contents = await File.ReadAllTextAsync(path, ct);
        return Results.Text(contents, "text/plain");
    }

    private static async Task<IResult> CreatePost(CreatePostRequest request, ClaimsPrincipal user, SocialDbContext db, TimeProvider time, CancellationToken ct)
    {
        var content = request.Content?.Trim();
        if (string.IsNullOrEmpty(content) || content.Length > ContentRules.MaxPostLength)
        {
            return Results.BadRequest(new ErrorResponse($"Post must be 1-{ContentRules.MaxPostLength} characters."));
        }

        // VULN-SPOT #04: Mass Assignment (CWE-915) — INTENTIONAL FOR TRAINING
        //   Every field present in the JSON body is copied onto the entity, including fields that must not be
        //   client-controlled (AuthorId, AuthorName, IsTrending, CreatedAt).
        //   Try: POST /api/posts  {"content":"hi","authorId":999,"authorName":"admin","isTrending":true}
        //   Fix: bind only a DTO with Content, and take author/timestamp/trending state from the token and server.
        var post = new Post
        {
            AuthorId = request.AuthorId ?? user.GetUserId(),
            AuthorName = request.AuthorName ?? user.GetUserName(),
            Content = content,
            IsTrending = request.IsTrending ?? false,
            CreatedAt = request.CreatedAt ?? time.GetUtcNow().UtcDateTime,
        };

        db.Posts.Add(post);
        await db.SaveChangesAsync(ct);

        return Results.Created($"/api/posts/{post.Id}",
            new PostDto(post.Id, post.AuthorId, post.AuthorName, post.Content, post.IsTrending, post.CreatedAt, 0));
    }

    private static async Task<IResult> DeletePost(int id, SocialDbContext db, CancellationToken ct)
    {
        var post = await db.Posts.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (post is null)
        {
            return NotFound("Post not found.");
        }

        // VULN-SPOT #03: IDOR / Broken Access Control (CWE-639) — INTENTIONAL FOR TRAINING
        //   The endpoint requires a valid token, but never checks that this user owns the post (or is a moderator).
        //   Any logged-in player can delete any post by changing the id: DELETE /api/posts/1
        //   Fix: compare post.AuthorId with user.GetUserId() (or allow only moderator/admin) before deleting.
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

    private static async Task<IResult> DeleteComment(int id, SocialDbContext db, CancellationToken ct)
    {
        var comment = await db.Comments.FirstOrDefaultAsync(c => c.Id == id, ct);
        if (comment is null)
        {
            return NotFound("Comment not found.");
        }

        // VULN-SPOT #03: IDOR / Broken Access Control (CWE-639) — INTENTIONAL FOR TRAINING
        //   Same missing ownership check as for posts: DELETE /api/comments/1 works for any authenticated user.
        //   Fix: verify comment.AuthorId == user.GetUserId() or that the caller is a moderator/admin.
        db.Comments.Remove(comment);
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    private static IResult NotFound(string message) => Results.NotFound(new ErrorResponse(message));
}
