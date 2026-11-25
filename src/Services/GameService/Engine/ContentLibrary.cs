namespace GameService.Engine;

public sealed record ObjectiveTemplate(
    string Title,
    string Description,
    string Category,
    int Difficulty,
    string TipId,
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
    // Objective flags are currently exposed by vulnerability #15, so every objective
    // points there. The field stays per-template so future challenge types can change it.
    public static readonly ObjectiveTemplate[] Objectives =
    [
        new("Operation Meme Storm",
            "A suspicious meme is trending. Find the flag hidden behind it before the moderator reviews the post.",
            "Recon", 1, "15", "meme_lord_42",
            "BREAKING: this meme is about to go viral. Nothing to see here... or is there?"),
        new("The Bridge Toll",
            "The bridge keeper is guarding a secret. Capture the flag before the post is taken down.",
            "Recon", 1, "15", "bridge_keeper",
            "None shall pass without paying the toll. Only the clever will find what I hide."),
        new("Silent Lurker",
            "A quiet account dropped a cryptic post. Work out what it is hiding and submit the flag.",
            "Puzzle", 2, "15", "lurker_supreme",
            "Some secrets are in plain sight. Some are not. Moderators arriving soon."),
        new("Midnight Leak",
            "Rumour says a moderator left something behind in a late-night post. Retrieve the flag in time.",
            "Investigation", 2, "15", "night_owl_99",
            "Posting this before I forget... wait, should I have posted this?"),
        new("Throne of the Cat Overlord",
            "The cat overlord announced a new decree. Prove you can take the throne by capturing its flag.",
            "Challenge", 3, "15", "cat_overlord",
            "By royal decree: all humans must provide treats. The throne is guarded."),
    ];

    public static int PointsFor(int difficulty) => difficulty switch
    {
        <= 1 => 100,
        2 => 250,
        _ => 500,
    };

    public static T Pick<T>(IReadOnlyList<T> items) => items[Random.Shared.Next(items.Count)];
}
