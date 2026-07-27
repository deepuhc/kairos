use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, Mutex};

use crate::acp::client::AcpClient;
use crate::acp::types::{PermissionResponse, SessionUpdate};

pub struct AgentState {
    pub clients: Arc<Mutex<HashMap<String, AcpClient>>>,
}

impl AgentState {
    pub fn new() -> Self {
        Self {
            clients: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[tauri::command]
pub async fn spawn_agent(
    app: AppHandle,
    state: State<'_, AgentState>,
    command: String,
    args: Vec<String>,
    working_dir: Option<String>,
) -> Result<String, String> {
    let session_id = format!("session_{}_{}", chrono_millis(), random_suffix());

    let (update_tx, mut update_rx) = mpsc::channel::<SessionUpdate>(256);
    let (permission_tx, mut permission_rx) = mpsc::channel(32);

    let client = AcpClient::spawn(
        &command,
        &args,
        working_dir.as_deref(),
        update_tx,
        permission_tx,
    )
    .await?;

    client.initialize().await?;

    // Forward session updates to frontend
    let app_handle = app.clone();
    let sid = session_id.clone();
    tokio::spawn(async move {
        while let Some(update) = update_rx.recv().await {
            let _ = app_handle.emit("acp://session-update", &update);
        }
        let _ = app_handle.emit(
            "acp://session-complete",
            serde_json::json!({ "session_id": sid }),
        );
    });

    // Forward permission requests to frontend
    let app_handle2 = app.clone();
    tokio::spawn(async move {
        while let Some(req) = permission_rx.recv().await {
            let _ = app_handle2.emit("acp://permission-request", &req);
        }
    });

    state.clients.lock().await.insert(session_id.clone(), client);
    Ok(session_id)
}

#[tauri::command]
pub async fn send_prompt(
    state: State<'_, AgentState>,
    session_id: String,
    text: String,
) -> Result<(), String> {
    let clients = state.clients.lock().await;
    let client = clients
        .get(&session_id)
        .ok_or_else(|| format!("Unknown session: {session_id}"))?;
    client.prompt(&session_id, &text).await
}

#[tauri::command]
pub async fn cancel_session(
    state: State<'_, AgentState>,
    session_id: String,
) -> Result<(), String> {
    let clients = state.clients.lock().await;
    if let Some(client) = clients.get(&session_id) {
        client.cancel(&session_id).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn respond_permission(
    state: State<'_, AgentState>,
    id: String,
    decision: String,
    session_id: String,
) -> Result<(), String> {
    let clients = state.clients.lock().await;
    let client = clients
        .get(&session_id)
        .ok_or_else(|| format!("Unknown session: {session_id}"))?;
    client
        .respond_permission(PermissionResponse { id, decision })
        .await
}

fn chrono_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn random_suffix() -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    std::time::Instant::now().hash(&mut hasher);
    format!("{:x}", hasher.finish())[..6].to_string()
}
