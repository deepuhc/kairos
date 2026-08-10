#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command};
use std::sync::{Arc, Mutex};

fn main() {
    let child_handle: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
    let child_for_cleanup = Arc::clone(&child_handle);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            // Resolve the monorepo root (two levels up from src-tauri)
            let app_dir = app
                .handle()
                .path()
                .app_local_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));

            // Attempt to locate the server entry point relative to the executable.
            // In dev the working directory is the project root; in release the
            // server bundle is expected next to the binary.
            let server_script = std::env::current_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
                .join("packages/server/dist/main.js");

            let child = Command::new("node")
                .arg(&server_script)
                .spawn()
                .expect("Failed to spawn Node.js server");

            *child_handle.lock().unwrap() = Some(child);
            let _ = app_dir; // suppress unused warning
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
