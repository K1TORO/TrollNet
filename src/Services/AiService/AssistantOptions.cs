namespace AiService;

/// <summary>
/// Provider-agnostic LLM settings. The service talks to any OpenAI-compatible endpoint
/// (local Ollama/llama.cpp, or a cloud API), so the runtime is chosen purely by config.
/// </summary>
public sealed class AssistantOptions
{
    public const string SectionName = "Assistant";

    /// <summary>When false (or BaseUrl/Model empty) the service reports disabled and the UI falls back to the heuristic bot.</summary>
    public bool Enabled { get; set; }

    /// <summary>Base URL of the OpenAI-compatible API, e.g. http://host.docker.internal:11434/v1 (Ollama) or https://api.openai.com/v1.</summary>
    public string BaseUrl { get; set; } = string.Empty;

    /// <summary>Model name, e.g. "llama3.2:3b" (Ollama) or "gpt-4o-mini" (cloud).</summary>
    public string Model { get; set; } = string.Empty;

    /// <summary>Bearer API key. Empty for local runtimes (Ollama/llama.cpp).</summary>
    public string? ApiKey { get; set; }

    public int TimeoutSeconds { get; set; } = 30;
    public double Temperature { get; set; } = 0.4;
    public int MaxTokens { get; set; } = 500;
}
