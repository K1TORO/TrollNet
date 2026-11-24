using Microsoft.EntityFrameworkCore;
using TrollNet.Shared;

namespace AuthService.Data;

public sealed class User
{
    public int Id { get; set; }
    public required string Username { get; set; }
    public required string NormalizedUsername { get; set; }
    public required string PasswordHash { get; set; }
    public string Role { get; set; } = Roles.User;
    public DateTime CreatedAt { get; set; }
}

public sealed class AuthDbContext(DbContextOptions<AuthDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(user =>
        {
            user.Property(u => u.Username).HasMaxLength(32);
            user.Property(u => u.NormalizedUsername).HasMaxLength(32);
            user.Property(u => u.PasswordHash).HasMaxLength(100);
            user.Property(u => u.Role).HasMaxLength(16);
            user.HasIndex(u => u.NormalizedUsername).IsUnique();
        });
    }
}
