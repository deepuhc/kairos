#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod acp;
mod commands;

use commands::agent::AgentState;

fn main() {
    tauri::Builder::default()
        .manage(AgentState::new())
        .invoke_handler(tauri::generate_handler![
            commands::agent::spawn_agent,
            commands::agent::send_prompt,
            commands::agent::cancel_session,
            commands::agent::respond_permission,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
