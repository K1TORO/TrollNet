namespace GameService.Engine;

/// <summary>
/// Testing-only switch. When enabled (via DevTools__Enabled in compose), the game service exposes
/// /api/dev/* so a teacher can spawn a specific objective on demand instead of waiting for the random
/// engine. OFF by default — these endpoints hand out flags and must never be enabled in a real deployment.
/// </summary>
public sealed class DevToolsOptions
{
    public const string SectionName = "DevTools";

    public bool Enabled { get; set; }
}
