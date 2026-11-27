namespace GameService.Engine;

/// <summary>
/// Keeps AiPostCache topped up in the background, off the game-engine tick path. When the assistant is
/// disabled or unreachable, GeneratePostAsync returns null and this backs off, so nothing breaks.
/// </summary>
public sealed class AiContentRefiller(AiPostCache cache, IServiceScopeFactory scopeFactory, ILogger<AiContentRefiller> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Let the rest of the stack (and the model) come up first.
        try { await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken); } catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (cache.Count >= AiPostCache.Target)
                {
                    await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken);
                    continue;
                }

                using var scope = scopeFactory.CreateScope();
                var client = scope.ServiceProvider.GetRequiredService<AiContentClient>();
                var post = await client.GeneratePostAsync(stoppingToken);
                if (post is not null)
                {
                    cache.Add(post);
                    // Got one — loop immediately to keep filling toward the target.
                    continue;
                }

                // Assistant disabled/unavailable: back off before trying again.
                await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogDebug(ex, "AI content refiller tick failed.");
                try { await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken); } catch (OperationCanceledException) { break; }
            }
        }
    }
}
