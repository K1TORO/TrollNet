# TrollNet

A gamified social network for learning web security. Trending posts appear in the feed, and each one comes with a timed objective. Players race to capture the objective's flag before the simulated moderator reviews the post. Points go to the first player who submits the correct flag.

## Architecture

```
 Browser
    │  http://localhost:8080
    ▼
┌──────────────┐   /api/*   ┌──────────────┐
│ frontend     │──────────▶ │ gateway      │  (YARP reverse proxy)
│ React + nginx│            └──────┬───────┘
└──────────────┘    ┌──────────────┼───────────────┐
   network:         ▼              ▼               ▼
   frontend   ┌───────────┐ ┌──────────────┐ ┌──────────────┐
              │ auth      │ │ social       │◀│ game         │  internal API
              │ service   │ │ service      │ │ service      │  (X-Internal-Key)
              └─────┬─────┘ └──────┬───────┘ └──────┬───────┘
                    ▼              ▼                ▼
              ┌──────────────────────────────────────────┐
              │ PostgreSQL: trollnet_auth / _social / _game │
              └──────────────────────────────────────────┘
                    network: backend (internal, no internet)
```

| Service | Responsibility | Routes (via gateway) |
|---|---|---|
| **auth-service** | Automatic guest players, JWT issuing (register/login kept for API use) | `/api/auth/*` |
| **social-service** | Posts, comments, search | `/api/posts/*`, `/api/comments/*` |
| **game-service** | Game engine (BackgroundService), objectives, flag submission, scores | `/api/objectives/*`, `/api/scores/*` |
| **gateway** | Single entry point; routes `/api/*` to services | — |
| **frontend** | React SPA served by nginx, proxies `/api` to the gateway | — |

Each service owns its own database. Services validate the same JWT (shared secret), so no service needs to call another one to check who a user is. The game engine publishes trending posts through the social service's `/internal/*` API, which requires an internal key and is never routed by the gateway.

## Quick start (Docker)

Prerequisite: Docker Desktop running.

```bash
cp .env.example .env      # then edit the secrets in .env
docker compose up --build
```

Open http://localhost:8080. There's no sign-in: each browser automatically gets a guest player with a random name such as `troll_48213`. The token is stored in the browser for 30 days (`Jwt__GuestExpiryMinutes`), so each player keeps their name and score between visits. Clearing site data gives you a new player. The first objective appears within a minute (see `GAME_TICK_SECONDS`).

Set `ADMIN_PASSWORD` in `.env` to create an admin (teacher) account. The UI has no login for it, so use the API: `POST /api/auth/login` returns a token. Admins can delete any content and call `GET /api/objectives/{id}/flag` to test the scoring flow.

Stop and remove everything, including the database volume:

```bash
docker compose down -v
```

## Local development (without Docker for the apps)

Requires the .NET 10 SDK, Node.js 22 and a local PostgreSQL. The `appsettings.Development.json` files expect user `trollnet` with password `trollnet_dev_password` on `localhost:5432`:

```bash
docker run -d --name trollnet-pg -p 127.0.0.1:5432:5432 \
  -e POSTGRES_USER=trollnet -e POSTGRES_PASSWORD=trollnet_dev_password postgres:17-alpine
```

Then, in separate terminals:

```bash
dotnet run --project src/Services/AuthService     # http://localhost:5101
dotnet run --project src/Services/SocialService   # http://localhost:5102
dotnet run --project src/Services/GameService     # http://localhost:5103
dotnet run --project src/Gateway                  # http://localhost:5000
cd frontend && npm install && npm run dev         # http://localhost:5173
```

Each service creates its own database on startup with `EnsureCreated`. Switch to EF Core migrations once the schema stabilises.

## API overview

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/guest` | — | Creates a guest player → `{token, expiresAt, user}` (used by the web app) |
| POST | `/api/auth/register` | — | `{username, password}` → same response (API only) |
| POST | `/api/auth/login` | — | Same response (API only, e.g. for the admin account) |
| GET | `/api/auth/me` | user | Current user |
| GET | `/api/posts?page=&pageSize=` | — | Feed, newest first |
| GET | `/api/posts/trending` | — | Trending posts |
| GET | `/api/posts/search?query=` | — | Case-insensitive text search |
| GET | `/api/posts/{id}` | — | Post with comments |
| POST | `/api/posts` | user | `{content}` |
| DELETE | `/api/posts/{id}` | owner / moderator | |
| POST | `/api/posts/{id}/comments` | user | `{content}` |
| DELETE | `/api/comments/{id}` | owner / moderator | |
| GET | `/api/objectives` | — | Active and captured objectives |
| POST | `/api/objectives/{id}/submit` | user | `{flag}` → `{correct, pointsAwarded, message}` |
| GET | `/api/objectives/{id}/flag` | admin | Reveal a flag (testing) |
| GET | `/api/scores/leaderboard` | — | Top 20 |
| GET | `/api/scores/me` | user | Your points |

Errors use the body `{"error": "..."}`. Validation errors use the standard `errors` dictionary.

## Game engine

`GameEngineService` in [src/Services/GameService/Engine](src/Services/GameService/Engine) runs every `TickSeconds` and does three things:

1. **Moderator review:** closes uncaptured objectives that have expired and deletes their trending posts.
2. **Spawn:** if fewer than `MaxActiveObjectives` are open, publishes a trending post and creates an objective with a random flag `TROLL{...}`.
3. **Ambient content:** bots publish posts and comment on trending posts.

The objective templates, bot names and texts live in [ContentLibrary.cs](src/Services/GameService/Engine/ContentLibrary.cs). This is where you design your challenges, including how players can discover each flag.

## Configuration

All settings can be overridden with environment variables using `__` as the separator, e.g. `GameEngine__TickSeconds=30`. See [.env.example](.env.example) for the values Docker Compose reads.

## Vulnerability map (`VULN-SPOT` markers)

The code is marked wherever a common web vulnerability usually appears. Each marker names the vulnerability, gives its CWE ID, describes the typical mistake, and explains how this code prevents it. Find all of them with:

```bash
grep -rn "VULN-SPOT" src frontend/src frontend/nginx.conf docker-compose.yml
```

| # | Vulnerability | CWE | Where |
|---|---|---|---|
| 01 | SQL Injection | [CWE-89](https://cwe.mitre.org/data/definitions/89.html) | [PostEndpoints.cs](src/Services/SocialService/Endpoints/PostEndpoints.cs) – `Search` |
| 02 | Cross-Site Scripting (stored) | [CWE-79](https://cwe.mitre.org/data/definitions/79.html) | [PostCard.tsx](frontend/src/components/PostCard.tsx), [nginx.conf](frontend/nginx.conf) (CSP) |
| 03 | IDOR / Broken Access Control | [CWE-639](https://cwe.mitre.org/data/definitions/639.html) | [PostEndpoints.cs](src/Services/SocialService/Endpoints/PostEndpoints.cs) – `DeletePost`, `DeleteComment` |
| 04 | Mass Assignment | [CWE-915](https://cwe.mitre.org/data/definitions/915.html) | [PostEndpoints.cs](src/Services/SocialService/Endpoints/PostEndpoints.cs) – `CreatePost` |
| 05 | Cross-Site Request Forgery | [CWE-352](https://cwe.mitre.org/data/definitions/352.html) | [api.ts](frontend/src/api.ts) – `request` |
| 06 | Server-Side Request Forgery | [CWE-918](https://cwe.mitre.org/data/definitions/918.html) | [GameService/Program.cs](src/Services/GameService/Program.cs) – HTTP client |
| 07 | Path Traversal / LFI | [CWE-22](https://cwe.mitre.org/data/definitions/22.html) | *No spot yet:* TrollNet has no feature that reads files by name. If you add one (e.g. avatars or attachments), serve files by generated id, never by a user-supplied path. |
| 08 | Missing Authentication for Critical Function | [CWE-306](https://cwe.mitre.org/data/definitions/306.html) | [InternalEndpoints.cs](src/Services/SocialService/Endpoints/InternalEndpoints.cs) |
| 09 | Timing side channel | [CWE-208](https://cwe.mitre.org/data/definitions/208.html) | [InternalApi.cs](src/Shared/TrollNet.Shared/InternalApi.cs), [GameEndpoints.cs](src/Services/GameService/Endpoints/GameEndpoints.cs) |
| 10 | User Enumeration | [CWE-204](https://cwe.mitre.org/data/definitions/204.html) | [AuthEndpoints.cs](src/Services/AuthService/Endpoints/AuthEndpoints.cs) – `Login` |
| 11 | Brute Force / Missing Rate Limiting | [CWE-307](https://cwe.mitre.org/data/definitions/307.html) | [AuthEndpoints.cs](src/Services/AuthService/Endpoints/AuthEndpoints.cs), [GameEndpoints.cs](src/Services/GameService/Endpoints/GameEndpoints.cs) |
| 12 | Weak Password Hashing | [CWE-916](https://cwe.mitre.org/data/definitions/916.html) | [AuthEndpoints.cs](src/Services/AuthService/Endpoints/AuthEndpoints.cs) – `Register` |
| 13 | Improper JWT Signature Verification | [CWE-347](https://cwe.mitre.org/data/definitions/347.html) | [Auth.cs](src/Shared/TrollNet.Shared/Auth.cs) |
| 14 | Race Condition (TOCTOU) | [CWE-362](https://cwe.mitre.org/data/definitions/362.html) | [GameEndpoints.cs](src/Services/GameService/Endpoints/GameEndpoints.cs) – `SubmitFlag` |
| 15 | Sensitive Data Exposure | [CWE-200](https://cwe.mitre.org/data/definitions/200.html) | [GameEndpoints.cs](src/Services/GameService/Endpoints/GameEndpoints.cs) – `ObjectiveDto` |
| 16 | Hard-coded Credentials | [CWE-798](https://cwe.mitre.org/data/definitions/798.html) | [docker-compose.yml](docker-compose.yml) |
| 17 | Spoofable Client IP | [CWE-348](https://cwe.mitre.org/data/definitions/348.html) | [Hosting.cs](src/Shared/TrollNet.Shared/Hosting.cs), [nginx.conf](frontend/nginx.conf) |
| 18 | Error Message Information Leak | [CWE-209](https://cwe.mitre.org/data/definitions/209.html) | [SocialService/Program.cs](src/Services/SocialService/Program.cs) |
| 19 | Token in Browser Storage | [CWE-922](https://cwe.mitre.org/data/definitions/922.html) | [api.ts](frontend/src/api.ts) – `tokenStore` |
| 20 | Clickjacking | [CWE-1021](https://cwe.mitre.org/data/definitions/1021.html) | [nginx.conf](frontend/nginx.conf) |

## Security notes

- Only the frontend is published, and only on `127.0.0.1`. The backend network is `internal`, so services and the database can't reach the internet.
- Passwords are hashed with BCrypt. Login is rate-limited and doesn't reveal which usernames exist.
- Search uses parameterized queries, with LIKE wildcards escaped.
- Users can only delete their own posts and comments. Moderators and admins can delete anything.
- React escapes all user content. nginx sends a strict Content Security Policy and other security headers.
- Flags are compared in constant time, and only the first correct submission scores.
