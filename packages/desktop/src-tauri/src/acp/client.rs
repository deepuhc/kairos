use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, Mutex};

use super::transport::StdioTransport;
use super::types::*;

pub struct AcpClient {
    transport: Arc<Mutex<StdioTransport>>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>>,
    next_id: AtomicU64,
    update_tx: mpsc::Sender<SessionUpdate>,
    permission_tx: mpsc::Sender<PermissionRequest>,
}

impl AcpClient {
    pub async fn spawn(
        command: &str,
        args: &[String],
        working_dir: Option<&str>,
        update_tx: mpsc::Sender<SessionUpdate>,
        permission_tx: mpsc::Sender<PermissionRequest>,
    ) -> Result<Self, String> {
        let (transport, mut incoming_rx) = StdioTransport::spawn(command, args, working_dir).await?;

        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let pending_clone = pending.clone();
        let update_tx_clone = update_tx.clone();
        let permission_tx_clone = permission_tx.clone();

        // Message router
        tokio::spawn(async move {
            while let Some(line) = incoming_rx.recv().await {
                if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&line) {
                    // Check if it's a response (has id, no method)
                    let is_response = msg.get("id").and_then(|v| v.as_u64()).is_some()
                        && msg.get("method").is_none();
                    if is_response {
                        if let Some(id) = msg.get("id").and_then(|v| v.as_u64()) {
                            let mut map = pending_clone.lock().await;
                            if let Some(sender) = map.remove(&id) {
                                let _ = sender.send(msg);
                            }
                        }
                        continue;
                    }
                    // Check if it's a notification
                    if let Some(method) = msg.get("method").and_then(|v| v.as_str()) {
                        match method {
                            "session/update" => {
                                if let Some(params) = msg.get("params") {
                                    if let Ok(update) =
                                        serde_json::from_value::<SessionUpdate>(params.clone())
                                    {
                                        let _ = update_tx_clone.send(update).await;
                                    }
                                }
                            }
                            "session/request_permission" => {
                                if let Some(params) = msg.get("params") {
                                    if let Ok(req) =
                                        serde_json::from_value::<PermissionRequest>(params.clone())
                                    {
                                        let _ = permission_tx_clone.send(req).await;
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
        });

        Ok(Self {
            transport: Arc::new(Mutex::new(transport)),
            pending,
            next_id: AtomicU64::new(1),
            update_tx,
            permission_tx,
        })
    }

    pub async fn initialize(&self) -> Result<InitializeResult, String> {
        let params = serde_json::json!({
            "client_info": { "name": "kairos-desktop", "version": "0.1.0" },
            "capabilities": { "streaming": true, "permissions": true }
        });
        let result = self.request("initialize", Some(params)).await?;
        serde_json::from_value(result).map_err(|e| format!("Parse error: {e}"))
    }

    pub async fn new_session(
        &self,
        system_prompt: Option<&str>,
        working_dir: Option<&str>,
    ) -> Result<SessionNewResult, String> {
        let params = serde_json::json!({
            "system_prompt": system_prompt,
            "working_directory": working_dir,
        });
        let result = self.request("session/new", Some(params)).await?;
        serde_json::from_value(result).map_err(|e| format!("Parse error: {e}"))
    }

    pub async fn prompt(&self, session_id: &str, text: &str) -> Result<(), String> {
        let params = serde_json::json!({
            "session_id": session_id,
            "messages": [{ "role": "user", "content": [{ "type": "text", "text": text }] }]
        });
        self.request("session/prompt", Some(params)).await?;
        Ok(())
    }

    pub async fn respond_permission(&self, response: PermissionResponse) -> Result<(), String> {
        let notification = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "session/permission_response",
            "params": response
        });
        let transport = self.transport.lock().await;
        transport
            .send(&serde_json::to_string(&notification).unwrap())
            .await
    }

    pub async fn cancel(&self, session_id: &str) -> Result<(), String> {
        let params = serde_json::json!({ "session_id": session_id });
        self.request("session/cancel", Some(params)).await?;
        Ok(())
    }

    pub fn kill(&self) {
        let transport = self.transport.clone();
        tokio::spawn(async move {
            transport.lock().await.kill();
        });
    }

    async fn request(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });

        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);

        let transport = self.transport.lock().await;
        transport
            .send(&serde_json::to_string(&request).unwrap())
            .await?;
        drop(transport);

        let response = rx
            .await
            .map_err(|_| "Response channel closed".to_string())?;

        if let Some(error) = response.get("error") {
            return Err(format!(
                "RPC error: {}",
                error.get("message").and_then(|m| m.as_str()).unwrap_or("unknown")
            ));
        }

        Ok(response.get("result").cloned().unwrap_or(serde_json::Value::Null))
    }
}
