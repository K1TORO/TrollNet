using System.Net;
using TrollNet.Shared;

namespace GameService.Engine;

/// <summary>Typed HTTP client for the social service's internal API.</summary>
public sealed class SocialClient(HttpClient http)
{
    public async Task<int> CreatePostAsync(string authorName, string content, bool isTrending, CancellationToken ct, string? systemNote = null, int? authorId = null)
    {
        using var response = await http.PostAsJsonAsync("internal/posts", new SystemPostRequest(authorName, content, isTrending, systemNote, authorId), ct);
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<CreatedIdResponse>(ct);
        return body?.Id ?? throw new InvalidOperationException("Social service returned no post id.");
    }

    public async Task CreateCommentAsync(int postId, string authorName, string content, CancellationToken ct)
    {
        using var response = await http.PostAsJsonAsync($"internal/posts/{postId}/comments", new SystemCommentRequest(authorName, content), ct);
        if (response.StatusCode != HttpStatusCode.NotFound)
        {
            response.EnsureSuccessStatusCode();
        }
    }

    /// <summary>Deletes a post. Already-deleted posts are ignored, so the call is safe to retry.</summary>
    public async Task DeletePostAsync(int postId, CancellationToken ct)
    {
        using var response = await http.DeleteAsync($"internal/posts/{postId}", ct);
        if (response.StatusCode != HttpStatusCode.NotFound)
        {
            response.EnsureSuccessStatusCode();
        }
    }
}
