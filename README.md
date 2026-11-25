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
docker compose up --build   # secrets are intentionally hard-coded; see VULN-SPOT #16
```

Open http://localhost:8080. There's no sign-in: each browser automatically gets a guest player with a random name such as `troll_48213`. The token is stored in the browser for 30 days (`Jwt__GuestExpiryMinutes`), so each player keeps their name and score between visits. Clearing site data gives you a new player. The first objective appears within a minute (see `GAME_TICK_SECONDS`).

An admin (teacher) account is seeded as `admin` / `admin1234` (VULN-SPOT #16). The UI has no login for it, so use the API: `POST /api/auth/login` returns a token. Admins can call `GET /api/objectives/{id}/flag` to test the scoring flow — although the public objectives list now leaks every flag (VULN-SPOT #15).

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

## Intentionally vulnerable code (`VULN-SPOT` markers)

> **Training build only.** Every spot below is now a real, exploitable vulnerability. The code is meant to run
> locally on `127.0.0.1` (or in a disposable VM). Do not deploy it, expose it to a network you care about,
> or reuse its patterns in real software.

Each marker names the vulnerability, gives its CWE ID, describes the mistake, shows a way to try it, and explains the fix. Find all of them with:

```bash
grep -rn "VULN-SPOT" src frontend/src frontend/nginx.conf docker-compose.yml
```

| # | Vulnerability | CWE | Where | Try it |
|---|---|---|---|---|
| 01 | SQL Injection | [CWE-89](https://cwe.mitre.org/data/definitions/89.html) | [PostEndpoints.cs](src/Services/SocialService/Endpoints/PostEndpoints.cs) – `Search` | `GET /api/posts/search?query=' OR 1=1 --` |
| 02 | Stored XSS | [CWE-79](https://cwe.mitre.org/data/definitions/79.html) | [PostCard.tsx](frontend/src/components/PostCard.tsx), [nginx.conf](frontend/nginx.conf) | Post `<img src=x onerror="alert(document.domain)">` |
| 03 | IDOR / Broken Access Control | [CWE-639](https://cwe.mitre.org/data/definitions/639.html) | [PostEndpoints.cs](src/Services/SocialService/Endpoints/PostEndpoints.cs) – `DeletePost`, `DeleteComment` | `DELETE /api/posts/1` as any player |
| 04 | Mass Assignment | [CWE-915](https://cwe.mitre.org/data/definitions/915.html) | [PostEndpoints.cs](src/Services/SocialService/Endpoints/PostEndpoints.cs), [Contracts.cs](src/Services/SocialService/Endpoints/Contracts.cs) | `POST /api/posts` with `{"content":"hi","authorId":999,"isTrending":true}` |
| 05 | Cross-Site Request Forgery | [CWE-352](https://cwe.mitre.org/data/definitions/352.html) | [api.ts](frontend/src/api.ts), [Auth.cs](src/Shared/TrollNet.Shared/Auth.cs), [Gateway](src/Gateway/Program.cs) | Credentialed cross-origin `fetch` with no anti-forgery token |
| 06 | Server-Side Request Forgery | [CWE-918](https://cwe.mitre.org/data/definitions/918.html) | [GameEndpoints.cs](src/Services/GameService/Endpoints/GameEndpoints.cs) – `PreviewLink` | `POST /api/link-preview {"url":"http://social-service:8080/health"}` |
| 07 | Path Traversal / LFI | [CWE-22](https://cwe.mitre.org/data/definitions/22.html) | [PostEndpoints.cs](src/Services/SocialService/Endpoints/PostEndpoints.cs) – `GetAttachment` | `GET /api/posts/attachment?name=../../../../etc/passwd` |
| 08 | Missing Authentication for Critical Function | [CWE-306](https://cwe.mitre.org/data/definitions/306.html) | [InternalEndpoints.cs](src/Services/SocialService/Endpoints/InternalEndpoints.cs), [Gateway appsettings](src/Gateway/appsettings.json) | `POST /internal/posts` without `X-Internal-Key` |
| 09 | Timing side channel | [CWE-208](https://cwe.mitre.org/data/definitions/208.html) | [InternalApi.cs](src/Shared/TrollNet.Shared/InternalApi.cs), [GameEndpoints.cs](src/Services/GameService/Endpoints/GameEndpoints.cs) | Measure response times while guessing key/flag prefixes |
| 10 | User Enumeration | [CWE-204](https://cwe.mitre.org/data/definitions/204.html) | [AuthEndpoints.cs](src/Services/AuthService/Endpoints/AuthEndpoints.cs) – `Login` | Compare 404 "no account" with 401 "wrong password" |
| 11 | Brute Force / Missing Rate Limiting | [CWE-307](https://cwe.mitre.org/data/definitions/307.html) | [AuthEndpoints.cs](src/Services/AuthService/Endpoints/AuthEndpoints.cs), [GameEndpoints.cs](src/Services/GameService/Endpoints/GameEndpoints.cs) | Unlimited login and flag guesses |
| 12 | Weak Password Hashing | [CWE-916](https://cwe.mitre.org/data/definitions/916.html) | [AuthEndpoints.cs](src/Services/AuthService/Endpoints/AuthEndpoints.cs) – `PasswordRules.Hash` | Unsalted SHA-256, identical passwords hash identically |
| 13 | Improper JWT Signature Verification | [CWE-347](https://cwe.mitre.org/data/definitions/347.html) | [Auth.cs](src/Shared/TrollNet.Shared/Auth.cs) | Forge an `alg:none` token with `"role":"Admin"` |
| 14 | Race Condition (TOCTOU) | [CWE-362](https://cwe.mitre.org/data/definitions/362.html) | [GameEndpoints.cs](src/Services/GameService/Endpoints/GameEndpoints.cs) – `SubmitFlag` | Send parallel correct submissions for one objective |
| 15 | Sensitive Data Exposure | [CWE-200](https://cwe.mitre.org/data/definitions/200.html) | [GameEndpoints.cs](src/Services/GameService/Endpoints/GameEndpoints.cs) – `ObjectiveDto` | `GET /api/objectives` returns every `flag` anonymously |
| 16 | Hard-coded Credentials | [CWE-798](https://cwe.mitre.org/data/definitions/798.html) | [docker-compose.yml](docker-compose.yml) | Admin password `admin1234`; JWT/DB/internal secrets in git |
| 17 | Spoofable Client IP | [CWE-348](https://cwe.mitre.org/data/definitions/348.html) | [Hosting.cs](src/Shared/TrollNet.Shared/Hosting.cs), [nginx.conf](frontend/nginx.conf) | Send `X-Forwarded-For: 1.2.3.4` to change rate-limit bucket |
| 18 | Error Message Information Leak | [CWE-209](https://cwe.mitre.org/data/definitions/209.html) | All three `Program.cs` files | `GET /api/posts/search?query='` returns a stack trace |
| 19 | Token in Browser Storage | [CWE-922](https://cwe.mitre.org/data/definitions/922.html) | [api.ts](frontend/src/api.ts) – `tokenStore` | `localStorage.getItem('trollnet.token')` after XSS |
| 20 | Clickjacking | [CWE-1021](https://cwe.mitre.org/data/definitions/1021.html) | [nginx.conf](frontend/nginx.conf) | Embed `http://localhost:8080` in an iframe |

## Training notes

- The frontend is still bound to `127.0.0.1` and the backend network is `internal`, but **every API check listed above is intentionally broken**; the network boundary is the only remaining safety net.
- Passwords use unsalted SHA-256, login/flag submission have no rate limits, and login tells you which usernames exist.
- Search concatenates SQL, attachments accept arbitrary paths, and the link-preview endpoint fetches arbitrary URLs.
- Any authenticated player can delete any post/comment, and system posts can be created through `/internal/posts`.
- React renders post and comment bodies as raw HTML and the CSP permits inline scripts; frame protections are gone.
- JWT signature/issuer/audience/lifetime validation is disabled, so tokens can be forged.
- The objectives API leaks flags, flag comparison is not constant-time, and parallel submissions can score twice.
- Secrets, including the admin password, are committed in `docker-compose.yml`. Reset the game database after changing hashing: `docker compose down -v`.

### Presentation helper

The same explanations are available **in the browser**: open the **Tips** tab, or click **Stuck? Open the training tips** / **Need a hint?** on the Objectives screen. Each tip can be expanded and searched by number, name, CWE or keyword.

Each objective now carries a `tipId`, so **Need a hint? (#NN)** opens that objective's matching tip automatically. All current templates point to **#15 Sensitive Data Exposure**, because that is the vulnerability that actually exposes every objective flag in this lab. The leaked flag on the objectives screen is blurred by default; use **Reveal** to unblur it. This is cosmetic only — the flag is still present in the DOM and API response, which is the point of vulnerability #15.

Because objectives now have a `TipId` database column, reset an existing lab with `docker compose down -v` after updating.

`scripts/demo_vulnerabilities.py` automates discovery, demonstration and explanations:

```bash
python3 scripts/demo_vulnerabilities.py --scan              # find/verify all markers, no server needed
python3 scripts/demo_vulnerabilities.py --tips              # plain-language tips for all 20
python3 scripts/demo_vulnerabilities.py --tip 7             # one tip (#07), also accepts 07
python3 scripts/demo_vulnerabilities.py --demo --explain    # tip, then evidence, for each class
python3 scripts/demo_vulnerabilities.py --all --locations   # scan + demo with file:line locations
```

It prints a PASS/FAIL line with evidence for each class and a summary; a clean run shows `20/20`. See `vulnerabilities.txt` for the full walkthrough and `vulnerability_tips.txt` for a printable handout.

The same flags can be run from a container, using the `demo` compose profile. The helper reaches the app as `http://frontend:8080` automatically:

```bash
docker compose --profile demo run --rm --no-deps demo --scan
docker compose --profile demo run --rm --no-deps demo --tips
docker compose up -d                                   # needed for --demo / --all
docker compose --profile demo run --rm demo --demo --explain
docker compose --profile demo run --rm demo --all --locations
```
