namespace GameService.Engine;

/// <summary>
/// How an objective's flag is exposed. Each objective's flag can ONLY be obtained by exploiting its own
/// vulnerability; the flag is no longer handed out by the public objectives API (except DataLeak, whose
/// whole lesson IS the leak).
/// </summary>
public enum FlagVector
{
    /// <summary>Flag only via the admin-only reveal endpoint (reached by admin login #16 or a forged JWT #13).</summary>
    AdminEndpoint,
    /// <summary>Flag still returned by GET /api/objectives — the sensitive-data-exposure lesson (#15).</summary>
    DataLeak,
    /// <summary>Flag behind an internal game endpoint reachable only via the SSRF link-preview (#06).</summary>
    Ssrf,
    /// <summary>Flag in the target post's hidden SystemNote, dumped by the raw-entity search (#01).</summary>
    Sqli,
    /// <summary>Flag in SystemNote, returned by the unauthenticated internal post read (#08).</summary>
    MissingAuth,
    /// <summary>Flag in SystemNote, returned by the no-ownership-check note endpoint (#03).</summary>
    Idor,
    /// <summary>Flag delivered to a JS-only page variable; read via the browser console / an XSS payload (#02).</summary>
    Xss,
    /// <summary>Flag in the decree's SystemNote, echoed back when privileged fields are forged on create (#04).</summary>
    MassAssign,
}

public sealed record ObjectiveTemplate(
    string Title,
    string Description,
    string Category,
    int Difficulty,
    string TipId,
    FlagVector Vector,
    string PostAuthor,
    string PostContent);

/// <summary>
/// Canned content the game engine uses to keep the feed alive.
/// Replace or extend these lists with your own challenge designs.
/// </summary>
public static class ContentLibrary
{
    public static readonly string[] BotAuthors =
    [
        "meme_lord_42", "grumpy_goblin", "bridge_keeper", "night_owl_99", "cat_overlord",
        "pixel_pirate", "coffee_addict", "lurker_supreme", "hot_take_hank", "quiet_quokka",
    ];

    public static readonly string[] AmbientPosts =
    [
        "Just discovered that pineapple on pizza is a personality test. Fight me.",
        "Who else is still debugging at 3am? Asking for a friend.",
        "Hot take: tabs vs spaces debates are the real reason projects are late.",
        "My cat walked across the keyboard and fixed my build. Promoting her to senior dev.",
        "Remember: strong passwords are like underwear. Change them often, don't share them.",
        "Today I learned that 'it works on my machine' is not a deployment strategy.",
        "The moderators seem extra busy today. Something big trending?",
        "Reminder that bridges need maintenance. Signed, a concerned troll.",
        "Anyone else think the leaderboard is suspiciously competitive this week?",
        "New personal record: 14 browser tabs about one bug.",
    ];

    public static readonly string[] AmbientComments =
    [
        "This is the content I'm here for.",
        "Bold of you to post this publicly.",
        "Mods, are you seeing this?",
        "Ratio.",
        "Saving this for later.",
        "Underrated post right here.",
        "Source: trust me bro.",
        "I have so many questions.",
    ];

    // TipId links each objective to the browser tip that actually helps solve it.
    // Each template points at the tip that matches its own challenge, so the Objectives
    // screen opens a relevant hint instead of sending every player to the same data leak.
    // (The flags themselves are exposed by VULN-SPOT #15 in the anonymous objectives API.)
    public static readonly ObjectiveTemplate[] Objectives =
    [
        new("Operation Meme Storm",
            "A trending meme carries a hidden notice that only runs in your browser. Read it with the dev console (or an XSS payload) and submit the flag.",
            "Recon", 2, "02", FlagVector.Xss, "meme_lord_42",
            "BREAKING: this meme is about to go viral. The notice is written in invisible ink — only your browser can read it."),
        new("The Bridge Toll",
            "The bridge keeper pinned a private note to this post. There is no access check on it — read it by its id and submit the flag.",
            "Recon", 2, "03", FlagVector.Idor, "bridge_keeper",
            "None shall pass without paying the toll. My private note is attached, for moderators only."),
        new("Silent Lurker",
            "A quiet account hid a flag in a column the feed never shows. The search box speaks SQL — make it hand over everything.",
            "Puzzle", 2, "01", FlagVector.Sqli, "lurker_supreme",
            "Some secrets are in plain sight. Some are in another column. Try searching for me."),
        new("Midnight Leak",
            "A careless endpoint returns every objective's secret to anyone who asks. Read this one's flag straight from the objectives API.",
            "Investigation", 1, "15", FlagVector.DataLeak, "night_owl_99",
            "Posting this before I forget... wait, is the flag really visible to everyone?"),
        new("Throne of the Cat Overlord",
            "The flag vault only answers to admins, but the token check is broken. Forge an alg:none admin token and open the vault.",
            "Challenge", 3, "13", FlagVector.AdminEndpoint, "cat_overlord",
            "By royal decree: the throne is guarded by a signature nobody actually checks."),
        new("The Admin's Vault",
            "The admin credentials are committed in plain text. Sign in as admin, then open the flag vault with the reveal endpoint.",
            "Challenge", 2, "16", FlagVector.AdminEndpoint, "admin",
            "The vault door is sealed; only the admin holds the key — and the key is in the repo."),
        new("The Dead Drop",
            "A bot dropped an internal link. Make the server's link-preview fetch it for you: the vault only answers requests from inside the network.",
            "Investigation", 2, "06", FlagVector.Ssrf, "coffee_addict",
            "Dead drop (server-side only): http://game-service:8080/internal/vault/ — add the objective id."),
        new("The Shadow Decree",
            "The post composer trusts every field you send. Forge a privileged decree (isTrending/authorId) and the server leaks the decree's secret back to you.",
            "Challenge", 3, "04", FlagVector.MassAssign, "hot_take_hank",
            "By decree: all humans must provide treats. Only a forged decree unlocks the seal."),
        new("The Open Push",
            "The 'internal' post API is reachable without a login. Read this post through it to see the note the public feed hides.",
            "Recon", 2, "08", FlagVector.MissingAuth, "moderator_bot",
            "Internal push accepted. The package is attached where only internal callers can see it."),
    ];

    public static int PointsFor(int difficulty) => difficulty switch
    {
        <= 1 => 100,
        2 => 250,
        _ => 500,
    };

    public static T Pick<T>(IReadOnlyList<T> items) => items[Random.Shared.Next(items.Count)];
}
