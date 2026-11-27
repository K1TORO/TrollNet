using System.Collections.Concurrent;

namespace GameService.Engine;

/// <summary>
/// A small in-memory buffer of AI-generated troll posts, filled in the background by AiContentRefiller
/// and consumed by the game engine. Decouples the (slow) model generation from the engine tick.
/// </summary>
public sealed class AiPostCache
{
    public const int Target = 5;

    private readonly ConcurrentQueue<string> _posts = new();

    public int Count => _posts.Count;

    public void Add(string post) => _posts.Enqueue(post);

    /// <summary>Takes the next AI post, or null when the cache is empty (caller falls back to static content).</summary>
    public string? TryTake() => _posts.TryDequeue(out var post) ? post : null;
}
