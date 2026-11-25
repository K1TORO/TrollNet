using System.Linq.Expressions;
using SocialService.Data;

namespace SocialService.Endpoints;

public sealed record PostDto(int Id, int AuthorId, string AuthorName, string Content, bool IsTrending, DateTime CreatedAt, int CommentCount)
{
    public static readonly Expression<Func<Post, PostDto>> Projection =
        p => new PostDto(p.Id, p.AuthorId, p.AuthorName, p.Content, p.IsTrending, p.CreatedAt, p.Comments.Count);
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
