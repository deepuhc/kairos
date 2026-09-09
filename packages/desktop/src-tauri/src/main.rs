#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::path::BaseDirectory;
use tauri::Manager;

/// Find a free TCP port on localhost by binding to :0 and reading the assigned
/// port back. There is a tiny race between closing this listener and the child
/// binding it, but it is the standard, good-enough approach for a local shell.
fn pick_free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(3333)
}

/// Block until the server accepts a TCP connection on `port`, or `timeout`
/// elapses. Returns true if the port became reachable.
fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

/// Resolve the bundled server entry + UI dist from Tauri's resource dir, with a
/// fallback to the source-tree layout so a non-bundled `cargo run` still works.
/// Returns (server_js, ui_dist).
fn resolve_resources(app: &tauri::App) -> (PathBuf, PathBuf) {
    // Bundled layout: resources/server/kairos-server.js + resources/ui.
    if let Ok(server) = app
        .path()
        .resolve("server/kairos-server.js", BaseDirectory::Resource)
    {
        if server.exists() {
            let ui = app
                .path()
                .resolve("ui", BaseDirectory::Resource)
                .unwrap_or_else(|_| PathBuf::from("ui"));
            return (server, ui);
        }
    }

    // Source-tree fallback (developer running the crate directly): walk up to
    // the repo root from the current dir.
    let root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    (
        root.join("packages/desktop/src-tauri/resources/server/kairos-server.js"),
        root.join("packages/ui/dist"),
    )
}

/// Resolve the Node binary to run the server with. Prefer the runtime we bundle
/// inside the app (`resources/runtime/node[.exe]`) so users install nothing and
/// a Finder-launched app — which gets a stripped PATH that misses Homebrew/nvm
/// Node — still works. Falls back to a bare `node` on PATH (dev / source runs,
/// or if the embedded binary is somehow absent).
fn resolve_node(app: &tauri::App) -> PathBuf {
    let name = if cfg!(windows) { "runtime/node.exe" } else { "runtime/node" };
    if let Ok(node) = app.path().resolve(name, BaseDirectory::Resource) {
        if node.exists() {
            return node;
        }
    }
    PathBuf::from(if cfg!(windows) { "node.exe" } else { "node" })
}

fn main() {
    let child_handle: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
    let child_for_cleanup = Arc::clone(&child_handle);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            // In `tauri dev`, beforeDevCommand already runs `npm run dev`, which
            // starts the server (:3333) and Vite (:5173); devUrl points the
            // window at Vite. So we only manage our own server for a real
            // (bundled/release) launch.
            if tauri::is_dev() {
                return Ok(());
            }

            let (server_js, ui_dist) = resolve_resources(app);
            let node = resolve_node(app);
            let port = pick_free_port();

            let spawn_result = Command::new(&node)
                .arg(&server_js)
                .env("PORT", port.to_string())
                .env("KAIROS_UI_DIST", &ui_dist)
                .spawn();

            let error_message = match spawn_result {
                Ok(child) => {
                    *child_handle.lock().unwrap() = Some(child);
                    if wait_for_port(port, Duration::from_secs(20)) {
                        None
                    } else {
                        Some(format!(
                            "The Kairos server did not become reachable on port {port} within 20s."
                        ))
                    }
                }
                Err(err) => Some(format!(
                    "Could not start the Kairos server.\n\nKairos ships its own Node.js runtime and launches \
                     it to run the backend; this launch failed. If the bundled runtime is missing, Kairos \
                     falls back to a `node` on your PATH (install Node 20+ from https://nodejs.org).\n\n\
                     Underlying error: {err}\n\nNode: {}\nServer path: {}",
                    node.display(),
                    server_js.display()
                )),
            };

            // The `main` window is declared in tauri.conf.json and loads the
            // bundled frontendDist (via tauri://) at startup. We navigate it to
            // the right place once we know the server's fate.
            let window = app
                .get_webview_window("main")
                .expect("main window declared in tauri.conf.json");

            if let Some(message) = error_message {
                // Show the bundled error page instead of panicking on a missing
                // or unreachable server. startup-error.html ships in the UI dist
                // and reads window.__KAIROS_STARTUP_ERROR__.
                let _ = window.navigate(
                    "tauri://localhost/startup-error.html"
                        .parse()
                        .expect("valid startup-error url"),
                );
                let escaped = message.replace('\\', "\\\\").replace('`', "\\`");
                let _ = window.eval(&format!(
                    "window.__KAIROS_STARTUP_ERROR__ = `{escaped}`; \
                     if (document.getElementById('detail')) \
                     document.getElementById('detail').textContent = window.__KAIROS_STARTUP_ERROR__;"
                ));
            } else {
                // Point the window at the server's own origin so the UI's
                // same-origin /api and /ws requests reach the backend.
                let _ = window.navigate(
                    format!("http://localhost:{port}")
                        .parse()
                        .expect("valid localhost url"),
                );
            }

            Ok(())
        })
        .on_window_event(move |_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Ok(mut guard) = child_for_cleanup.lock() {
                    if let Some(mut child) = guard.take() {
                        let _ = child.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Kairos");
}
