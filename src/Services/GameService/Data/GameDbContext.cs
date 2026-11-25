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

public sealed class GameDbContext(DbContextOptions<GameDbContext> options) : DbContext(options)
{
    public DbSet<Objective> Objectives => Set<Objective>();
    public DbSet<Score> Scores => Set<Score>();

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
    }
}
