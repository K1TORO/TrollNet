# TrollNet — Faza 3: architektura wersji binarnej (desktop, bez Dockera) + pakiet na finał

Status: **architektura / projekt (do zatwierdzenia).** Nic jeszcze nie implementujemy — ten dokument tylko projektuje.
Data: 2026-11-27.

## 0. Decyzje użytkownika (ustalone)
- **Postać:** aplikacja w **wersji binarnej**, self-contained, **bez Dockera** — sędzia niczego nie instaluje ręcznie, wszystko w pakiecie, offline.
- **Platformy:** **Linux (ogólnie, nie tylko Kali)** → `.deb` (Debian/Ubuntu/Kali) **+ `.AppImage`** (dystrybucyjno-niezależny); **Windows** → `.exe` (instalator NSIS).
- **Backend:** **scalony w jeden proces** (potwierdzone) — jeden self-contained host zamiast 4 serwisów + gateway.
- **Model: tylko `qwen2.5:3b`**, **zapieczony w instalatorze** (potwierdzone) — bez Ollamy, bez pobierania, bez wyboru modelu. Runtime: wbudowany `llama.cpp`.
- **Izolacja:** cała wersja desktop ląduje w **osobnym folderze `semi-desktop/`** (warstwa pakująca), który **reużywa** istniejący `src/` i `frontend/`. **Wersja przeglądarkowa/dockerowa zostaje nietknięta.**

To wariant **„self-contained"** (dawny wariant B) — mocniejszy wizerunkowo („prawdziwy desktop"), kosztem realnego refaktoru (DB + scalenie) wyliczonego w §6.

---

## 1. Cel i co znaczy tu „binarka desktopowa"
Dziś TrollNet to wielousługowy stack Dockera (Postgres + 4 serwisy .NET + gateway + frontend + ai-service + model). Wersja binarna musi to opakować w **jeden instalowalny program**, który po instalacji:
- uruchamia lokalnie cały backend **bez Dockera** (procesy natywne),
- otwiera natywne okno z UI,
- zawiera **wbudowany model qwen** (działa offline, bez pobierania),
- sprząta przy zamknięciu.

Powłoką okna jest **Tauri** (lekki, systemowy webview, binarka rzędu MB; produkuje natywnie `.deb` i `.exe`). Electron = plan awaryjny (ten sam frontend), jeśli systemowy webview sprawi problem.

---

## 2. Architektura docelowa (self-contained)

```
┌──────────────────────────────────────────────────────────────┐
│  TrollNet.app  (Tauri — natywne okno; instalator .deb/.exe)   │
│   • ładuje wbudowany frontend (statyczne pliki w pakiecie)     │
│   • spawnuje „sidecary" (lokalne procesy) i czeka na health    │
│   • /api/* → backend na localhost:<port>                       │
└───────────────┬──────────────────────────────────────────────┘
                │ uruchamia jako procesy potomne (sidecars)
   ┌────────────┼───────────────────────────────┬───────────────┐
   ▼            ▼                                ▼               ▼
┌────────┐ ┌──────────────────────────┐ ┌──────────────┐ ┌──────────────┐
│backend │ │ ai-service (.NET,         │ │ llama-server │ │ (SQLite —    │
│.NET    │ │ self-contained exe)       │ │ (llama.cpp,  │ │ plik .db,    │
│(1 proc)│ │  → http://127.0.0.1:P/v1  │─│  qwen GGUF)  │ │ bez serwera) │
└────────┘ └──────────────────────────┘ └──────────────┘ └──────────────┘
```

Trzy filary zmiany względem dziś:

1. **Backend bez Dockera = natywne procesy (sidecary Tauri).**
   - Rekomendacja: **scalić** 4 serwisy + gateway w **jeden proces ASP.NET** (jeden host mapujący wszystkie grupy endpointów). Mniej procesów, prostszy start, jeden plik. Alternatywa (mniej kodu, więcej procesów): zostawić 5 osobnych self-contained exe i spawnować każdy. Na desktop rekomendujemy scalenie.
   - Publikacja: `dotnet publish -r <rid> --self-contained -p:PublishSingleFile=true` → jedna binarka per platforma (linux-x64, win-x64). Zero .NET SDK u sędziego.

2. **Baza bez Dockera = SQLite (wbudowana).**
   - Zamiana `UseNpgsql` → `UseSqlite` (EF Core), 3 pliki `.db` w katalogu danych użytkownika. `EnsureCreated` działa tak samo.
   - **Koszt refaktoru:** kilka miejsc jest Postgres-specyficznych (typy `timestamptz`/`varchar(n)`, komunikat `Npgsql.PostgresException` w VULN #18, składnia w SQLi #01 — `' OR 1=1 --` działa też w SQLite, ale raw-SQL trzeba sprawdzić). Do przejścia, ale to realna praca — wyliczone w §6.

3. **Model bez Ollamy/Dockera = wbudowany `llama.cpp` (`llama-server`) + qwen GGUF.**
   - `llama-server` jest **OpenAI-compatible**, więc **`ai-service` zostaje bez zmian** — tylko `AI_BASE_URL` → `http://127.0.0.1:<port>/v1`. Dzięki abstrakcji z Fazy 1 to jedna linijka configu.
   - Plik modelu `qwen2.5-3b-instruct-q4_k_m.gguf` (~2 GB) zapieczony w pakiecie (albo dociągany raz przy pierwszym starcie — do decyzji; na finał lepiej w pakiecie = offline).

> **Efekt:** jeden instalator → po instalacji działa wszystko (UI + backend + baza + model), offline, bez Dockera. Jedyny koszt: refaktor backendu (DB + scalenie procesów) i vendoring `llama.cpp`.

---

## 3. Dlaczego nie prościej
- **Tauri + Docker (dawny A)** — odrzucony: wymaga Dockera u sędziego.
- **WebLLM w webview (C)** — odrzucony: WebKitGTK (Tauri/Linux) ma słabe wsparcie WebGPU; ryzykowne. Zostaje jako ewentualność pod Electron.
- Dlatego **self-contained + `llama.cpp`** jest jedyną drogą spełniającą „binarka, bez Dockera, tylko qwen".

---

## 4. Jak powstaje każdy z 4 artefaktów na finał
Spięte skryptem `scripts/build-release.sh` → katalog `dist-release/` (powtarzalnie).

### 4.1 Kod źródłowy + instrukcja kompilacji
- Źródło: całe repo bez `bin/ obj/ node_modules/ dist/ *.db` (`scripts/package-source.sh` → `trollnet-source.zip`).
- **`BUILD.md`:** wymagania (.NET 10 SDK, Node 20+, Rust + Tauri CLI, toolchain llama.cpp lub gotowe binarki). Kroki:
  - frontend: `cd frontend && npm ci && npm run build`,
  - backend: `dotnet publish -c Release -r <rid> --self-contained` (merged host),
  - model/runtime: pobranie GGUF qwen + binarki `llama-server` (skrypt `scripts/fetch-model.sh`),
  - desktop: `cd desktop && npm ci && npm run tauri build` → `.deb`/`.exe`.

### 4.2 Wersja binarna + instrukcja uruchomienia
- Artefakty: **`trollnet_x.y.z_amd64.deb`** (Linux) oraz **`trollnet_x.y.z_x64-setup.exe`** (Windows) — produkuje Tauri.
- **`RUN.md`:** „Zainstaluj paczkę (`sudo dpkg -i …deb` / dwuklik `…exe`) → uruchom TrollNet z menu. Działa offline, model w pakiecie, dane trzymane lokalnie (`~/.local/share/TrollNet`)." Nic więcej — zero Dockera, zero konfiguracji.

### 4.3 Instrukcja korzystania
- **`USAGE.md`:** logowanie gościem, zakładki (Feed / Zadania / Wskazówki / API&DB / Ranking), tryby **Edukacja vs Wyzwanie**, przechwytywanie flag (szablony, terminal), **🔮 Wyrocznia** (czat + podpowiedzi, lokalny model), przełącznik **PL/EN**, zrzuty ekranu.

### 4.4 Krótki opis funkcjonalności (max 1 strona) — na prezentację
- **`OVERVIEW.md`:** czym jest TrollNet (gamifikowana nauka bezpieczeństwa webowego), element AI (Wyrocznia — lokalny model, tutor + generowanie treści, prywatność — dane nie wychodzą z maszyny), 2–3 zdania o architekturze self-contained, i jak spełnia kryterium (aplikacja edukacyjna + AI). Pod slajd.

---

## 5. Układ repo — izolacja w `semi-desktop/` (bez duplikacji kodu)
Cała wersja desktop żyje w jednym folderze i **reużywa** wspólny kod. Wersji przeglądarkowej nie dotykamy.

```
TrollNet/
├─ src/                 # serwisy .NET — WSPÓLNE (bez zmian)
├─ frontend/            # React/Vite — WSPÓLNE (bez zmian)
├─ docker-compose.yml   # wersja przeglądarkowa/dockerowa — bez zmian
└─ semi-desktop/        # ← CAŁA wersja desktop (nowa)
   ├─ host/             # scalony host ASP.NET: referuje projekty z src/, mapuje
   │                    #   wszystkie grupy endpointów, UseSqlite, serwuje /api
   │                    #   (zastępuje gateway); background services jak dziś
   ├─ app/ (src-tauri/) # powłoka Tauri: spawnuje host + llama-server, okno na UI,
   │                    #   bundluje zbudowany frontend i model GGUF; config .deb/.AppImage/.exe
   ├─ runtime/          # vendorowane binarki llama-server (linux-x64, win-x64)
   ├─ model/            # qwen2.5-3b *.gguf (pobierany skryptem, pakowany do instalatora)
   ├─ scripts/          # build-release / package-source / fetch-model
   └─ docs/             # BUILD.md, RUN.md, USAGE.md, OVERVIEW.md
```

Kluczowe zasady:
- **`semi-desktop/host/`** to osobny projekt, który przez *project reference* sięga do `src/*` i wywołuje ich publiczne `AddXxx()` / `MapXxxEndpoints()`. Dzięki temu logika nie jest kopiowana — zmiany w serwisach propagują się do obu wersji. Jedyna różnica desktopowa: rejestracja `UseSqlite` + jeden port (klienci `SocialClient`/`AiContentClient` wskazują na własny URL hosta).
- **Wersja dockerowa** (`src/*` jako osobne serwisy + `docker-compose.yml`) **działa dalej bez zmian** — to po prostu drugi sposób uruchomienia tego samego kodu.
- Ryzyko techniczne: projekty w `src/*` są `Sdk.Web` (mają własny `Program`); przy referencji ich `Main` się nie uruchamia, używamy tylko ich metod rozszerzających — do zweryfikowania na starcie implementacji (ewentualnie wydzielić wspólne endpointy do bibliotek).

---

## 6. Ryzyka i koszt (uczciwie)
- **Refaktor Postgres → SQLite** — główny koszt: przegląd raw-SQL i typów, inne komunikaty błędów (VULN #18 pokazuje `Npgsql.PostgresException` → pod SQLite będzie inny). Część „smaczków" podatności może brzmieć inaczej.
- **Scalenie serwisów w jeden host** — trzeba pogodzić 4× `Program.cs`, DI, 3 konteksty EF. Alternatywa: zostawić sidecary (mniej kodu, więcej procesów).
- **Vendoring `llama.cpp`** — binarki per platforma (linux-x64, win-x64), rozmiar + pierwszy start modelu (~kilkanaście s na CPU). Pakiet z modelem ~2 GB.
- **Cross-platform** — `.deb` i `.exe` to dwa różne buildy/RID; testować oba. Na Twojej maszynie (Kali) najpierw `.deb`.
- **Webview/Tauri na Linux** — testujemy wcześnie; plan B Electron.

---

## 7. Status decyzji
Ustalone: ✅ binarka bez Dockera · ✅ Linux (`.deb` + `.AppImage`) + Windows (`.exe`) · ✅ scalony backend (jeden proces) · ✅ model qwen2.5:3b zapieczony (llama.cpp) · ✅ izolacja w `semi-desktop/`, wersja przeglądarkowa bez zmian.

Otwarte:
1. **Deliverable-docs** (`BUILD/RUN/USAGE/OVERVIEW.md`): generować teraz (przydadzą się niezależnie od pakowania, szczególnie `OVERVIEW.md` na prezentację) czy przy implementacji?

Pierwsze zadanie przy implementacji (weryfikacja ryzyka): sprawdzić, czy `semi-desktop/host/` może zreferować projekty `Sdk.Web` z `src/*` i złożyć je w jeden host; jeśli nie — wydzielić endpointy serwisów do bibliotek (`*.Endpoints`), co i tak jest czystsze.

> Kod pozostaje nietknięty do czasu decyzji o starcie implementacji; wersja dockerowa działa jak dziś.
