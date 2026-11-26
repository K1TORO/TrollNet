using System.Linq.Expressions;
using SocialService.Data;

namespace SocialService.Endpoints;

public sealed record PostDto(int Id, int AuthorId, string AuthorName, string Content, bool IsTrending, bool IsDefaced, DateTime CreatedAt, int CommentCount)
{
    public static readonly Expression<Func<Post, PostDto>> Projection =
        p => new PostDto(p.Id, p.AuthorId, p.AuthorName, p.Content, p.IsTrending, p.IsDefaced, p.CreatedAt, p.Comments.Count);
}

public sealed record CommentDto(int Id, int PostId, int AuthorId, string AuthorName, string Content, DateTime CreatedAt)
{
    public static CommentDto From(Comment c) => new(c.Id, c.PostId, c.AuthorId, c.AuthorName, c.Content, c.CreatedAt);
}

public sealed record PostDetailDto(
    int Id,
    int AuthorId,
    string AuthorName,
    string Content,
    bool IsTrending,
    bool IsDefaced,
    DateTime CreatedAt,
    IReadOnlyList<CommentDto> Comments);

// VULN-SPOT #04: Mass Assignment (CWE-915) — INTENTIONAL FOR TRAINING
// These extra fields are accepted from the client so they can be copied onto the Post entity.
// A safe request DTO would contain Content only.
public sealed record CreatePostRequest(
    string? Content,
    int? AuthorId,
    string? AuthorName,
    bool? IsTrending,
    DateTime? CreatedAt);

public sealed record CreateCommentRequest(string? Content);

// Returned by the IDOR note endpoint (#03) and the unauthenticated internal GET (#08): both expose the
// post's private SystemNote, which the public feed/GetPost DTOs never include.
public sealed record PostNoteDto(int PostId, string? SystemNote);

public sealed record InternalPostDto(int Id, int AuthorId, string AuthorName, string Content, bool IsTrending, DateTime CreatedAt, string? SystemNote);

// Response to a post creation. SystemNote is normally null, but a forged privileged write (mass assignment,
// #04) echoes the active decree's hidden note here.
public sealed record CreatePostResponse(int Id, int AuthorId, string AuthorName, string Content, bool IsTrending, DateTime CreatedAt, int CommentCount, string? SystemNote);
