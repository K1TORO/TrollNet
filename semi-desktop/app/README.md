# semi-desktop/app — Tauri desktop shell

A thin native window (Tauri v2) around the merged `semi-desktop/host`. It spawns the host, shows a loading
page that waits for `http://127.0.0.1:8080/health`, then loads the full TrollNet UI that the host serves.
The host plays nginx + gateway + all services + SQLite in one process, so the window is just a chrome.

```
app/
├─ src/index.html        # loading page: polls host health, then location.replace("http://127.0.0.1:8080")
└─ src-tauri/
   ├─ Cargo.toml
   ├─ build.rs
   ├─ tauri.conf.json    # window "main" loads index.html; bundles .deb + .appimage
   ├─ capabilities/default.json
   └─ src/main.rs        # spawns the host, stops it on exit
```

## Prerequisites (Arch)

```bash
sudo pacman -S --needed rustup webkit2gtk-4.1 gtk3 libayatana-appindicator librsvg base-devel curl wget file openssl
rustup default stable          # REQUIRED — rustup ships no default toolchain; cargo errors without this
cargo install tauri-cli --version '^2.0'
```

Icons are pre-generated PNGs in `src-tauri/icons/` (Linux `.deb`/`.appimage` need only PNGs, so no
`cargo tauri icon` / `.icns` / `.ico` step).

## Build order (dev)

The dev shell runs the **already-built** host DLL via `dotnet`, so build the host and the frontend first:

```bash
# 1) frontend -> frontend/dist (the host serves this)
( cd ../../frontend && npm ci && npm run build )

# 2) host (the DLL the shell launches)
( cd ../host && dotnet build )

# 3) run the shell (spawns the host, opens the window). Icons are already in src-tauri/icons/.
cargo tauri dev
```

On exit the shell kills the host. Override the host command without editing Rust:
`TROLLNET_HOST_CMD="dotnet /abs/path/TrollNet.DesktopHost.dll" cargo tauri dev`.

## Release (self-contained, no dotnet on the target) — TODO next

For the judge package the host must not depend on a system `dotnet`. The plan:
1. `dotnet publish ../host -c Release -r linux-x64 --self-contained -p:PublishSingleFile=true` → one binary.
2. Place it as a Tauri **sidecar**: `src-tauri/binaries/trollnet-host-x86_64-unknown-linux-gnu`, add
   `"externalBin": ["binaries/trollnet-host"]` to `tauri.conf.json` bundle, and spawn it via the sidecar
   API instead of `dotnet` in `main.rs`.
3. Bundle `frontend/dist` as a Tauri resource and pass its path to the host via `Desktop__WebRoot`.
4. `cargo tauri build` → `.deb` + `.AppImage` under `src-tauri/target/release/bundle/`.

See `../../PHASE3-DESKTOP-ARCHITECTURE.md` §4.
