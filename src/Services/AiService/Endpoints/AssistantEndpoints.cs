using Microsoft.AspNetCore.Http;
using TrollNet.Shared;

namespace AiService.Endpoints;

// Request/response shapes. The flag is NEVER part of any request — the client only sends the vulnerability
// class and the student's own attempt, so a secret can never reach the model.
public sealed record HintRequest(string? Title, string? Vector, string? Description, string? TipId, string? Mode, string? LastCommand, string? LastError, string? Lang);

public sealed record ChatMessageDto(string? Role, string? Content);

public sealed record ChatRequest(ChatMessageDto[]? Messages, string? Lang);

public sealed record AssistantResponse(string Text);

public sealed record AssistantStatusDto(bool Enabled);

// Service-to-service content generation (e.g. troll feed posts). Not routed by the gateway.
public sealed record GenerateRequest(string? System, string? Prompt);

public static class AssistantEndpoints
{
    public const string RateLimitPolicy = "assistant";
    private const int MaxFieldLength = 2000;
    private const int MaxMessages = 20;

    public static IEndpointRouteBuilder MapAssistantEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/assistant").RequireAuthorization();
        // Lets the UI know whether to offer AI features or fall back to the local heuristic bot.
        group.MapGet("/status", (AssistantClient client) => Results.Ok(new AssistantStatusDto(client.Enabled)));
        group.MapPost("/hint", Hint).RequireRateLimiting(RateLimitPolicy);
        group.MapPost("/chat", Chat).RequireRateLimiting(RateLimitPolicy);

        // Internal, service-to-service (NOT under /api, so the gateway never exposes it): the game engine
        // uses this to generate troll feed content. Falls back to static content if it returns an error.
        app.MapPost("/internal/generate", GenerateInternal);
        return app;
    }

    private static async Task<IResult> GenerateInternal(GenerateRequest request, AssistantClient client, ILoggerFactory loggers, CancellationToken ct)
    {
        if (!client.Enabled)
        {
            return Results.Json(new ErrorResponse("Assistant is not configured."), statusCode: StatusCodes.Status503ServiceUnavailable);
        }
        if (string.IsNullOrWhiteSpace(request.Prompt))
        {
            return Results.BadRequest(new ErrorResponse("Prompt is required."));
        }

        var turns = new List<ChatTurn>();
        if (!string.IsNullOrWhiteSpace(request.System))
        {
            turns.Add(new ChatTurn("system", Clip(request.System)!));
        }
        turns.Add(new ChatTurn("user", Clip(request.Prompt)!));

        return await CompleteOrError(client, turns, loggers, ct);
    }

    private static async Task<IResult> Hint(HintRequest request, AssistantClient client, ILoggerFactory loggers, CancellationToken ct)
    {
        if (!client.Enabled)
        {
            return Results.Json(new ErrorResponse("Assistant is not configured."), statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        var language = LanguageName(request.Lang);
        var system =
            "You are a Socratic cybersecurity tutor inside TrollNet, a safe local training lab for learning web " +
            "vulnerabilities. A student is working on a capture-the-flag objective. Give ONE short guiding hint " +
            "(1-3 sentences) that nudges them toward the right TECHNIQUE for this vulnerability class. Rules: never " +
            "reveal or guess a flag; never hand over the full exact command or payload; prefer a guiding question or " +
            "a pointer to the concept; be encouraging and concise. This is a sandboxed lab, so discussing the exploit " +
            "technique at a high level is fine. If the student is in Challenge mode, give an even lighter nudge. " +
            $"Respond in {language}.";

        var user =
            $"Vulnerability class: {Clip(request.Vector)}.\n" +
            $"Objective: {Clip(request.Title)} — {Clip(request.Description)}\n" +
            $"Mode: {Clip(request.Mode)}\n" +
            $"The student just tried: command=`{Clip(request.LastCommand)}` and the result was: `{Clip(request.LastError)}`.\n" +
            "Give one guiding hint.";

        return await CompleteOrError(client, new[] { new ChatTurn("system", system), new ChatTurn("user", user) }, loggers, ct);
    }

    private static async Task<IResult> Chat(ChatRequest request, AssistantClient client, ILoggerFactory loggers, CancellationToken ct)
    {
        if (!client.Enabled)
        {
            return Results.Json(new ErrorResponse("Assistant is not configured."), statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        var incoming = (request.Messages ?? [])
            .Where(m => !string.IsNullOrWhiteSpace(m.Content))
            .TakeLast(MaxMessages)
            .ToList();
        if (incoming.Count == 0)
        {
            return Results.BadRequest(new ErrorResponse("No message provided."));
        }

        var language = LanguageName(request.Lang);
        var system =
            "You are a friendly web-security education assistant for TrollNet, a safe local training lab. Help students " +
            "understand web vulnerabilities and their defenses (XSS, SQL injection, IDOR, SSRF, JWT/alg:none, CSP, CWE, " +
            "and similar) at a learner level. Stay strictly on security-education topics; politely decline unrelated, " +
            "personal, or harmful requests, and never provide working attacks against real third-party systems. Be " +
            $"concise, clear and encouraging. Respond in {language}.";

        var turns = new List<ChatTurn> { new("system", system) };
        turns.AddRange(incoming.Select(m => new ChatTurn(m.Role == "assistant" ? "assistant" : "user", Clip(m.Content)!)));

        return await CompleteOrError(client, turns, loggers, ct);
    }

    private static async Task<IResult> CompleteOrError(AssistantClient client, IReadOnlyList<ChatTurn> turns, ILoggerFactory loggers, CancellationToken ct)
    {
        try
        {
            var text = await client.CompleteAsync(turns, ct);
            return Results.Ok(new AssistantResponse(text));
        }
        catch (Exception ex)
        {
            loggers.CreateLogger("Assistant").LogWarning(ex, "Assistant completion failed.");
            return Results.Json(new ErrorResponse("The assistant is unavailable right now."), statusCode: StatusCodes.Status502BadGateway);
        }
    }

    private static string LanguageName(string? lang) => lang == "pl" ? "Polish" : "English";

    private static string? Clip(string? value) =>
        value is null ? null : value.Length <= MaxFieldLength ? value : value[..MaxFieldLength];
}
