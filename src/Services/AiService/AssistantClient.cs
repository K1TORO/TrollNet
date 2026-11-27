using System.Net.Http.Json;

namespace AiService;

public sealed record ChatTurn(string Role, string Content);

/// <summary>Thin client for an OpenAI-compatible /chat/completions endpoint (works with Ollama, llama.cpp, OpenAI…).</summary>
public sealed class AssistantClient(HttpClient http, AssistantOptions options)
{
    public bool Enabled =>
        options.Enabled && !string.IsNullOrWhiteSpace(options.BaseUrl) && !string.IsNullOrWhiteSpace(options.Model);

    /// <summary>Sends the conversation to the model and returns the assistant's text. Honours a per-call timeout.</summary>
    public async Task<string> CompleteAsync(IEnumerable<ChatTurn> turns, CancellationToken ct)
    {
        var request = new ChatCompletionRequest(
            options.Model,
            turns.Select(t => new ApiMessage(t.Role, t.Content)).ToArray(),
            options.Temperature,
            false,
            options.MaxTokens);

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(options.TimeoutSeconds));

        using var message = new HttpRequestMessage(HttpMethod.Post, "chat/completions")
        {
            Content = JsonContent.Create(request),
        };
        if (!string.IsNullOrWhiteSpace(options.ApiKey))
        {
            message.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", options.ApiKey);
        }

        using var response = await http.SendAsync(message, cts.Token);
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<ChatCompletionResponse>(cts.Token);
        var text = body?.choices?.FirstOrDefault()?.message?.content?.Trim();
        if (string.IsNullOrEmpty(text))
        {
            throw new InvalidOperationException("The model returned an empty response.");
        }
        return text;
    }

    // OpenAI-compatible wire shapes. Property names are serialized verbatim, matching the API.
    private sealed record ChatCompletionRequest(string model, ApiMessage[] messages, double temperature, bool stream, int max_tokens);

    private sealed record ApiMessage(string role, string content);

    private sealed record ChatCompletionResponse(Choice[]? choices);

    private sealed record Choice(ApiMessage? message);
}
