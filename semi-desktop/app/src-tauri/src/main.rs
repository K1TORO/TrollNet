// TrollNet desktop shell (Tauri v2).
//
// Thin native window around the merged, self-contained .NET host plus a bundled local model. On startup it
// spawns llama.cpp's `llama-server` (OpenAI-compatible, serving the bundled qwen GGUF) and the .NET host
// sidecar (its assistant pointed at that local server). The bundled loading page waits for the host's
// /health, then loads the real UI the host serves. Both child processes are stopped on exit. No system
// dotnet, and no Ollama — the whole thing runs offline.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::process::Child;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const MODEL_FILE: &str = "qwen2.5-3b-instruct-q4_k_m.gguf";

/// Child processes to stop when the app exits.
struct Children {
    host: Mutex<Option<CommandChild>>,
    llama: Mutex<Option<Child>>,
}

/// Resolve a bundled directory: try the bundle layout (Tauri rewrites `..` segments to `_up_`), then dev
/// paths relative to the crate. `marker` is a file that must exist inside the directory.
fn find_dir(app: &tauri::App, candidates: &[&str], marker: &str, dev_fallback: &str) -> PathBuf {
    if let Ok(res) = app.path().resource_dir() {
        for c in candidates {
            let p = res.join(c);
            if p.join(marker).exists() {
                return p;
            }
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(dev_fallback)
}

fn web_root(app: &tauri::App) -> PathBuf {
    find_dir(
        app,
        &["_up_/_up_/_up_/frontend/dist", "dist", "frontend/dist", "../../../frontend/dist"],
        "index.html",
        "../../../frontend/dist",
    )
}

fn spawn_llama(app: &tauri::App) -> std::io::Result<Child> {
    let server_name = if cfg!(windows) { "llama-server.exe" } else { "llama-server" };
    let rt = find_dir(
        app,
        &["_up_/_up_/runtime/llama-b12819", "runtime/llama-b12819", "../../runtime/llama-b12819"],
        server_name,
        "../../runtime/llama-b12819",
    );
    let model_dir = find_dir(
        app,
        &["_up_/_up_/model", "model", "../../model"],
        MODEL_FILE,
        "../../model",
    );
    let server = rt.join(server_name);

    // Bundled resources can lose the executable bit on Unix; restore it before spawning.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&server) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(&server, perms);
        }
    }

    let mut cmd = std::process::Command::new(&server);
    cmd.arg("-m")
        .arg(model_dir.join(MODEL_FILE))
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg("8090")
        .arg("-c")
        .arg("4096")
        .arg("--jinja")
        .current_dir(&rt); // the server finds its own libraries next to it
    // Linux loads the .so libs via LD_LIBRARY_PATH; Windows finds the DLLs via the server's dir (add to PATH too).
    #[cfg(unix)]
    cmd.env("LD_LIBRARY_PATH", &rt);
    #[cfg(windows)]
    {
        let path = std::env::var("PATH").unwrap_or_default();
        cmd.env("PATH", format!("{};{}", rt.display(), path));
    }
    cmd.spawn()
}

pub fn run() {
    // XWayland fixes window-show + scroll on wlroots compositors (Hyprland); only set when unchosen.
    #[cfg(target_os = "linux")]
    if std::env::var_os("GDK_BACKEND").is_none() {
        std::env::set_var("GDK_BACKEND", "x11");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // 1) local model server (bundled llama.cpp + qwen GGUF)
            let llama = match spawn_llama(app) {
                Ok(child) => {
                    println!("llama-server started");
                    Some(child)
                }
                Err(e) => {
                    eprintln!("failed to start llama-server (AI will fall back to the heuristic bot): {e}");
                    None
                }
            };

            // 2) merged .NET host sidecar, assistant pointed at the local llama-server
            let webroot = web_root(app);
            let command = app
                .shell()
                .sidecar("trollnet-host")
                .expect("host sidecar 'trollnet-host' not found")
                .env("Desktop__PublicPort", "8080")
                .env("Desktop__InternalPort", "8081")
                .env("Desktop__WebRoot", webroot.to_string_lossy().to_string())
                .env("DevTools__Enabled", "false")
                .env("Jwt__Secret", "trollnet-training-jwt-secret-do-not-use-outside-the-lab")
                .env("Jwt__Issuer", "trollnet-auth")
                .env("Jwt__Audience", "trollnet")
                .env("Seed__AdminUsername", "admin")
                .env("Seed__AdminPassword", "admin1234")
                .env("InternalApi__Key", "internal-api-key-for-training-only")
                .env("Assistant__Enabled", "true")
                .env("Assistant__BaseUrl", "http://127.0.0.1:8090/v1")
                .env("Assistant__Model", "qwen2.5-3b-instruct")
                .env("Assistant__TimeoutSeconds", "120");

            let host = match command.spawn() {
                Ok((mut rx, child)) => {
                    tauri::async_runtime::spawn(async move {
                        while let Some(event) = rx.recv().await {
                            if let CommandEvent::Error(err) = event {
                                eprintln!("host sidecar error: {err}");
                            }
                        }
                    });
                    println!("host sidecar started (web root: {})", webroot.display());
                    Some(child)
                }
                Err(e) => {
                    eprintln!("failed to start host sidecar: {e}");
                    None
                }
            };

            app.manage(Children {
                host: Mutex::new(host),
                llama: Mutex::new(llama),
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the TrollNet desktop app")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<Children>() {
                    if let Ok(mut g) = state.host.lock() {
                        if let Some(child) = g.take() {
                            let _ = child.kill();
                        }
                    }
                    if let Ok(mut g) = state.llama.lock() {
                        if let Some(mut child) = g.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        });
}

fn main() {
    run();
}
