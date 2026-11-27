using System.Net.Http.Json;

namespace GameService.Engine;

/// <summary>Calls ai-service's internal generation endpoint to produce troll feed content. Returns null on any failure.</summary>
public sealed class AiContentClient(HttpClient http, ILogger<AiContentClient> logger)
{
    private const int MaxPostLength = 400;

    private const string PostSystemPrompt =
        "You are a witty troll on TrollNet, a parody social network for a web-security training lab. " +
        "Write ONE short, funny, harmless social-media post (at most two sentences). It can joke about " +
        "hackers, bugs, passwords, memes or internet life. No hashtags, no quotation marks, no preamble or " +
        "labels — output only the post text. Keep it safe: no slurs, no harassment, no targeting real people, " +
        "no real instructions for attacking real systems.";

    /// <summary>Generates one troll post, or null if the assistant is unavailable/disabled.</summary>
    public async Task<string?> GeneratePostAsync(CancellationToken ct)
    {
        try
        {
            using var response = await http.PostAsJsonAsync("internal/generate", new { system = PostSystemPrompt, prompt = "Write one new troll post." }, ct);
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }
            var body = await response.Content.ReadFromJsonAsync<GenerateResponse>(ct);
            var text = body?.text?.Trim().Trim('"');
            if (string.IsNullOrWhiteSpace(text))
            {
                return null;
            }
            return text.Length <= MaxPostLength ? text : text[..MaxPostLength];
        }
        catch (Exception ex)
        {
            logger.LogDebug(ex, "AI post generation failed; falling back to static content.");
            return null;
        }
    }

    private sealed record GenerateResponse(string? text);
}
