use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

pub struct StdioTransport {
    child: Child,
    tx: mpsc::Sender<String>,
}

impl StdioTransport {
    pub async fn spawn(
        command: &str,
        args: &[String],
        working_dir: Option<&str>,
    ) -> Result<(Self, mpsc::Receiver<String>), String> {
        let mut cmd = Command::new(command);
        cmd.args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(dir) = working_dir {
            cmd.current_dir(dir);
        }

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn agent: {e}"))?;

        let stdout = child.stdout.take().ok_or("No stdout")?;
        let (outgoing_tx, outgoing_rx) = mpsc::channel::<String>(64);
        let (incoming_tx, incoming_rx) = mpsc::channel::<String>(256);

        // Read stdout lines → incoming channel
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if incoming_tx.send(line).await.is_err() {
                    break;
                }
            }
        });

        // Write outgoing channel → stdin
        let mut stdin = child.stdin.take().ok_or("No stdin")?;
        tokio::spawn(async move {
            let mut rx = outgoing_rx;
            while let Some(msg) = rx.recv().await {
                if stdin.write_all(msg.as_bytes()).await.is_err() {
                    break;
                }
                if stdin.write_all(b"\n").await.is_err() {
                    break;
                }
                let _ = stdin.flush().await;
            }
        });

        Ok((
            Self {
                child,
                tx: outgoing_tx,
            },
            incoming_rx,
        ))
    }

    pub async fn send(&self, message: &str) -> Result<(), String> {
        self.tx
            .send(message.to_string())
            .await
            .map_err(|e| format!("Send failed: {e}"))
    }

    pub fn kill(&mut self) {
        let _ = self.child.start_kill();
    }
}
