# semi-desktop/host — merged backend (feasibility spike)

Phase 3, §7. One ASP.NET process that **reuses** `src/Services/*` by project reference and composes
them into a single host on **SQLite** — no Docker, no gateway, no Postgres. The Docker/browser build
(`src/*` + `docker-compose.yml`) is untouched and still runs exactly as before.

This is a spike: its job is to prove the three risky assumptions before any Tauri/model work.

## What it proves (or disproves)

1. **R1 — the merge compiles.** Can an Sdk.Web host project reference the three Sdk.Web service
   projects and call their public extension methods (`MapAuthEndpoints`, `MapPostEndpoints`,
   `MapInternalEndpoints`, `MapGameEndpoints`, `MapDevEndpoints`) without their `Main` running?
   If the build rejects referencing the Exe projects, the fallback is to extract each service's
   endpoints into a `*.Endpoints` class library (cleaner anyway) — see Phase 3 §7.
2. **R2 — SQLite works.** Three `DbContext`s create their schemas via `EnsureCreated` on SQLite, and
   the game engine runs. DB files land in `~/.local/share/TrollNet/` (`trollnet_auth/social/game.db`).
3. **R3 — gateway routing is reproducible.** Path-based routing is reproduced by mapping endpoints
   directly. The one rule a single port would break — the SSRF vault (#06) must stay off the public
   surface — is reproduced with **two loopback listeners**: the UI uses the public port; the vault is
   served only on the internal port, which the link-preview SSRF target points at.

## Run

Use the dev runner (reliable stop/start by port + one-file results), or raw `dotnet`:

```bash
cd semi-desktop/host
./dev.sh restart             # free ports 5080/5081, launch in background, wait for health
./dev.sh verify              # spawn SQLi+SSRF objectives, exercise the vulns -> debug-results.txt
./dev.sh logs 40             # tail the host log (/tmp/trollnet-host.log)
./dev.sh stop                # free the ports

# or raw:
dotnet build                 # R1
dotnet run                   # R2 + R3; watch for "desktop host ready" (foreground, blocks)
```

Then, in another shell:

```bash
curl -s http://127.0.0.1:5080/health                 # -> Healthy
curl -s http://127.0.0.1:5080/api/objectives | jq .  # objectives appear within GameEngine:TickSeconds
curl -s http://127.0.0.1:5081/health                 # -> 404 (internal port serves only the vault)
curl -s http://127.0.0.1:5080/internal/vault/1       # -> 404 (vault hidden from the public port)
```

Ports and secrets live in `appsettings.json` (secrets baked, mirroring the Docker build — VULN #16).

## Known gaps (expected at this stage — not blockers for the spike)

- **SQLi #01** — `PostEndpoints.Search` now picks the case-insensitive LIKE operator by provider
  (`ILIKE` on Postgres, `LIKE` on SQLite). The raw-concatenation vuln is identical on both; `' OR 1=1 --`
  works on the desktop host.
- **`/api/assistant/*`** (ai-service) is not mapped here — ai-service stays a sidecar (§2). With
  `Services:Ai` empty, the engine falls back to the static `ContentLibrary`.
- **Frontend** still targets the Docker gateway (`:8080`) and the `game-service` hostname for the SSRF
  hint. Pointing it at this host (and `127.0.0.1:5081` for the vault hint) is a later step.
- Vault isolation here is **port-based**, softer than Docker's network namespace: a local user could
  hit `127.0.0.1:5081` directly. The UI/terminal only use the public port, so the taught SSRF path
  holds; UDS/named-pipe hardening is a later option.
