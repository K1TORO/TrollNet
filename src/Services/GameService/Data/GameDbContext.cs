using Microsoft.EntityFrameworkCore;

namespace GameService.Data;

public sealed class Objective
{
    public int Id { get; set; }
    public required string Title { get; set; }
    public required string Description { get; set; }
    public required string Category { get; set; }
    public int Difficulty { get; set; }
    public int Points { get; set; }

    /// <summary>Id of the browser training tip that matches this objective.</summary>
    public string TipId { get; set; } = "01";

    /// <summary>How this objective's flag is exposed — determines the one vulnerability that reveals it.</summary>
    public GameService.Engine.FlagVector Vector { get; set; }

    /// <summary>Post in the social service this objective is about.</summary>
    public int? TargetPostId { get; set; }

    /// <summary>Optional user the objective is about (reserved for future challenge types).</summary>
    public int? TargetUserId { get; set; }

    /// <summary>Secret value players must submit. Never returned by the public API.</summary>
    public required string Flag { get; set; }

    public DateTime CreatedAt { get; set; }

    /// <summary>When the simulated moderator reviews the target content and the objective closes.</summary>
    public DateTime ExpiresAt { get; set; }

    public bool IsCompleted { get; set; }
    public int? CompletedByUserId { get; set; }
    public string? CompletedByUsername { get; set; }
    public DateTime? CompletedAt { get; set; }
}

public sealed class Score
{
    public int UserId { get; set; }
    public required string Username { get; set; }
    public int Points { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>Educational mode halves awarded points and shows hints; Challenge mode gives full points and no hints.</summary>
public enum GameMode
{
    Educational,
    Challenge,
}

/// <summary>Lifecycle of a Challenge-mode run.</summary>
public enum ChallengeStatus
{
    None,
    Active,
    Ended,
}

/// <summary>Per-player mode and Challenge-run state. One row per user.</summary>
public sealed class PlayerState
{
    public int UserId { get; set; }
    public required string Username { get; set; }
    public GameMode Mode { get; set; } = GameMode.Educational;

    /// <summary>Objectives the player let expire or skipped during the current run.</summary>
    public int Fails { get; set; }
    public ChallengeStatus ChallengeStatus { get; set; } = ChallengeStatus.None;
    public DateTime StartedAt { get; set; }
    public DateTime? EndedAt { get; set; }

    /// <summary>Score snapshot taken when a Challenge run ends.</summary>
    public int ChallengeScore { get; set; }
}

/// <summary>Records that a player engaged with an objective (submitted a flag or skipped it), so expiry can be attributed as a fail.</summary>
public sealed class ObjectiveAttempt
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public int ObjectiveId { get; set; }
    public bool Completed { get; set; }
    public bool Failed { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class GameDbContext(DbContextOptions<GameDbContext> options) : DbContext(options)
{
    public DbSet<Objective> Objectives => Set<Objective>();
    public DbSet<Score> Scores => Set<Score>();
    public DbSet<PlayerState> PlayerStates => Set<PlayerState>();
    public DbSet<ObjectiveAttempt> ObjectiveAttempts => Set<ObjectiveAttempt>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Objective>(objective =>
        {
            objective.Property(o => o.Title).HasMaxLength(100);
            objective.Property(o => o.Description).HasMaxLength(1000);
            objective.Property(o => o.Category).HasMaxLength(50);
            objective.Property(o => o.TipId).HasMaxLength(2);
            objective.Property(o => o.Flag).HasMaxLength(100);
            objective.Property(o => o.CompletedByUsername).HasMaxLength(32);
            objective.HasIndex(o => new { o.IsCompleted, o.ExpiresAt });
        });

        modelBuilder.Entity<Score>(score =>
        {
            score.HasKey(s => s.UserId);
            score.Property(s => s.UserId).ValueGeneratedNever();
            score.Property(s => s.Username).HasMaxLength(32);
            score.HasIndex(s => s.Points);
        });

        modelBuilder.Entity<PlayerState>(player =>
        {
            player.HasKey(p => p.UserId);
            player.Property(p => p.UserId).ValueGeneratedNever();
            player.Property(p => p.Username).HasMaxLength(32);
            player.Property(p => p.Mode).HasConversion<string>().HasMaxLength(16);
            player.Property(p => p.ChallengeStatus).HasConversion<string>().HasMaxLength(16);
        });

        modelBuilder.Entity<ObjectiveAttempt>(attempt =>
        {
            attempt.HasIndex(a => new { a.UserId, a.ObjectiveId }).IsUnique();
            attempt.HasIndex(a => a.ObjectiveId);
        });
    }
}
