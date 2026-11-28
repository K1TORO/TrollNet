# BUILD — kompilacja TrollNet Desktop

Jak zbudować samodzielną aplikację desktopową (`.deb` + `.AppImage`) ze źródeł. Bez Dockera; gotowa aplikacja
**uruchamia się** bez systemowego .NET, bez Ollamy i bez dostępu do internetu.

Wersja desktopowa znajduje się w katalogu `semi-desktop/` i **reużywa** bez zmian istniejące serwisy z `src/`
oraz frontend z `frontend/`.

## Wymagania

| Narzędzie | Wersja | Uwagi |
|---|---|---|
| .NET SDK | 10.x | plus pakiet docelowy ASP.NET (patrz uwaga dla Arch) |
| Node.js | 20+ | budowanie frontendu React |
| Rust | stable | `rustup default stable` |
| Tauri CLI | 2.x | `cargo install tauri-cli --version '^2.0'` |
| Biblioteki systemowe | — | WebKitGTK 4.1, GTK3, libayatana-appindicator, librsvg, narzędzia budowania |
| curl, tar | — | pobieranie modelu i runtime |

**Arch Linux:**
```bash
sudo pacman -S --needed dotnet-sdk aspnet-runtime aspnet-targeting-pack dotnet-targeting-pack \
  nodejs npm rustup webkit2gtk-4.1 gtk3 libayatana-appindicator librsvg base-devel curl wget file openssl
rustup default stable
cargo install tauri-cli --version '^2.0'
```
> Jeśli `dotnet build` zgłosi `NETSDK1226: Prune Package data not found`, zainstaluj `aspnet-targeting-pack`
> (powyżej) lub zbuduj z flagą `-p:AllowMissingPrunePackageData=true`.

**Debian/Ubuntu/Kali:**
```bash
# .NET 10 SDK (oficjalny skrypt Microsoftu — instalacja lokalna w ~/.dotnet, zawiera pakiet docelowy ASP.NET)
curl -fsSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 10.0
export PATH="$HOME/.dotnet:$PATH"          # dodaj też na stałe do ~/.bashrc

# Node.js 20+ (NodeSource) oraz biblioteki systemowe
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
  build-essential curl wget file libssl-dev pkg-config

# Rust + Tauri CLI
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
. "$HOME/.cargo/env"
cargo install tauri-cli --version '^2.0'
```
> Uwaga `NETSDK1226` dotyczy tylko Arch — skrypt Microsoftu instaluje SDK wraz z pakietem docelowym ASP.NET,
> więc na Debianie/Ubuntu/Kali ten błąd nie występuje. Na starszych wydaniach pakiet WebKitGTK może nazywać
> się `libwebkit2gtk-4.0-dev` (Tauri 2 wymaga wersji **4.1**, obecnej w Kali rolling i Ubuntu 24.04+).

## Kroki budowania (z katalogu głównego repozytorium)

```bash
# 1. Frontend  ->  frontend/dist  (serwowany przez host)
( cd frontend && npm ci && npm run build )

# 2. Samodzielny host .NET  ->  semi-desktop/app/src-tauri/binaries/trollnet-host-<triple>
./semi-desktop/scripts/build-host-sidecar.sh

# 3. Lokalne AI: serwer llama.cpp (CPU) + model qwen GGUF  ->  semi-desktop/runtime, semi-desktop/model
./semi-desktop/scripts/fetch-model.sh           # pobiera ~1,9 GB, jednorazowo

# 4. Aplikacja desktopowa  ->  .deb + .AppImage
( cd semi-desktop/app && cargo tauri build )
```

Artefakty powstają w `semi-desktop/app/src-tauri/target/release/bundle/`:
- `deb/TrollNet_0.1.0_amd64.deb`
- `appimage/TrollNet_0.1.0_amd64.AppImage`

## Co wchodzi do pakietu

- `trollnet-host` — cztery serwisy + gateway scalone w jeden samodzielny proces ASP.NET na bazie SQLite,
  serwujący zarówno API, jak i zbudowany frontend (sidecar).
- `llama-server` + `qwen2.5-3b-instruct-q4_k_m.gguf` — lokalne AI (zasoby pakietu).
- `frontend/dist` — interfejs użytkownika (zasób pakietu).

## Windows (`.exe`)

Instalator Windows (NSIS) należy zbudować **na Windowsie** — Tauri używa tam natywnych narzędzi
(NSIS/WebView2), więc budowanie krzyżowe z Linuksa jest zawodne.

**Wymagania (Windows 10/11, x64):**
- .NET 10 SDK, Node.js 20+
- Rust (`rustup`, domyślny toolchain **msvc**) + **Visual Studio Build Tools** z obciążeniem „Desktop
  development with C++" (linker MSVC)
- `cargo install tauri-cli --version '^2.0'`
- WebView2 Runtime (zwykle już obecny w Windows 10/11)

**Kroki (PowerShell, z katalogu głównego repozytorium):**
```powershell
# 1. Frontend
cd frontend; npm ci; npm run build; cd ..

# 2. Samodzielny host (.exe) -> sidecar
$triple = ((rustc -Vv | Select-String '^host: ') -split ' ')[1]   # np. x86_64-pc-windows-msvc
dotnet publish semi-desktop\host -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o $env:TEMP\trollnet-host
New-Item -Force -ItemType Directory semi-desktop\app\src-tauri\binaries | Out-Null
Copy-Item $env:TEMP\trollnet-host\TrollNet.DesktopHost.exe `
  "semi-desktop\app\src-tauri\binaries\trollnet-host-$triple.exe"

# 3. llama.cpp (Windows CPU) + model  — pobierz i rozpakuj tak, aby powstały:
#    semi-desktop\runtime\llama-b12819\llama-server.exe  (wraz z plikami .dll)
#    semi-desktop\model\qwen2.5-3b-instruct-q4_k_m.gguf
#    llama.cpp:  https://github.com/ggml-org/llama.cpp/releases/download/b12819/llama-b12819-bin-win-cpu-x64.zip
#    model:      https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf

# 4. Instalator
cd semi-desktop\app; cargo tauri build
```

Wynik: `semi-desktop\app\src-tauri\target\release\bundle\nsis\TrollNet_0.1.0_x64-setup.exe`.

> Nazwa katalogu runtime (`llama-b12819`) i nazwa modelu muszą być **identyczne** jak w konfiguracji
> (`tauri.conf.json`, `main.rs`) — po rozpakowaniu upewnij się, że `llama-server.exe` i pliki `.dll` leżą
> bezpośrednio w `semi-desktop\runtime\llama-b12819\`.

## Powiązania, o których trzeba pamiętać

`fetch-model.sh` pobiera katalog `llama-<tag>` oraz plik modelu o konkretnej nazwie; pliki
`src-tauri/src/main.rs` i `tauri.conf.json` odwołują się do dokładnie tej nazwy katalogu (`llama-b12819`)
i nazwy modelu. Zmiana jednego miejsca wymaga zmiany pozostałych. Wartości `LLAMA_TAG` / `MODEL_URL` można
nadpisać zmiennymi środowiskowymi dla `fetch-model.sh`.

## Praca deweloperska (bez instalatora)

- `semi-desktop/app/run.sh` — ponowne uruchomienie aplikacji w trybie dev (`cargo tauri dev`), ze
  spawnowaniem sidecara hosta i lokalnego modelu.
- Po zmianach w `src/` przebuduj host: `./semi-desktop/scripts/build-host-sidecar.sh`.
- Po zmianach w `frontend/` przebuduj frontend: `( cd frontend && npm run build )`.

Wersja dockerowa/przeglądarkowa (`docker compose up --build`) pozostaje nienaruszona.
