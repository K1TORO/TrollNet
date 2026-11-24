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

public sealed record CreatePostRequest(string? Content);

public sealed record CreateCommentRequest(string? Content);
