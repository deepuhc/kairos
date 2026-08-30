# Connecting Kairos to a homelab / remote Ollama

Kairos talks to Ollama over its REST API, so it can use an Ollama running on
another machine — a homelab box, a LAN server, or a host on your Tailscale
tailnet — exactly as if it were local. Nothing about the endpoint is hardcoded
in the repo; you point Kairos at it with one env var or a small config file.

## Option A — `OLLAMA_HOST` (quickest)

Set the env var before starting the server. A full URL or a bare `host:port`
both work (a missing scheme defaults to `http://`, trailing slashes are trimmed):

```bash
export OLLAMA_HOST="http://100.80.191.11:11434"   # tailnet IP, LAN IP, or hostname
npm start
```

## Option B — `~/.kairos/providers.json` (persistent, multi-endpoint)

Create the file below. Override the directory with `KAIROS_CONFIG_DIR` if you
keep config elsewhere. It is optional and best-effort: if it is missing or
malformed the server logs a warning and falls back to the defaults rather than
failing to start.

Point the built-in Ollama provider at the remote host:

```json
{
  "ollama": { "baseUrl": "http://100.80.191.11:11434" }
}
```

Or register the homelab as an additional named endpoint under `custom` (useful
when you also run a local Ollama, or want an explicit `isLocal` privacy hint and
a default model):

```json
{
  "custom": [
    {
      "name": "homelab",
      "baseUrl": "http://100.80.191.11:11434",
      "type": "ollama",
      "isLocal": true,
      "defaultModel": "qwen2.5:14b"
    }
  ]
}
```

### `custom` entry fields

Validated by `packages/server/src/config/providers-config.ts`:

| Field | Required | Notes |
|-------|----------|-------|
| `name` | yes | Display name; a missing name drops the entry. |
| `baseUrl` | yes | Full URL; trailing slashes are trimmed. |
| `type` | yes | One of `ollama`, `openai-compatible`, `open-webui`. |
| `isLocal` | no | Defaults to `true`. Marks the endpoint private so privacy-sensitive routing prefers it and never falls back to cloud. |
| `defaultModel` | no | Preferred model id for this endpoint. |
| `auth` | no | `{ "type": "bearer" \| "basic" \| "api-key", "token": "…" }`. Incomplete auth is ignored (no credentials sent). |

An OpenAI-compatible server (vLLM, LM Studio, LiteLLM) looks like:

```json
{
  "custom": [
    {
      "name": "vllm",
      "baseUrl": "http://100.80.191.11:8000/v1",
      "type": "openai-compatible",
      "isLocal": true,
      "auth": { "type": "bearer", "token": "…" }
    }
  ]
}
```

## Verify the connection

With the server running:

```bash
curl -s http://localhost:3333/api/providers/diagnostics
```

This reports, for each provider: its resolved `endpoint`, whether it is
`reachable`, the `modelCount`, the model list, and which models are
vision-capable. It also echoes the `configPath`, whether the config `loaded`,
any `warnings`, and the effective `OLLAMA_HOST`. If `reachable` is `false`,
check the URL, that Ollama is bound to `0.0.0.0` (not just `127.0.0.1`) on the
remote host, and that the tailnet/LAN route is up.

## Vision (image description)

Image uploads are described by a vision-capable model. If the homelab has **no**
vision model, Kairos falls back to a cloud vision provider when one is
configured (e.g. `GEMINI_API_KEY`) — the analyzing provider/model is shown with
each result, so an image is never silently sent to the cloud.

To keep images on-device, pull a vision model on the homelab and it will be
detected automatically:

```bash
ollama pull moondream     # ~1.7 GB, small + fast
# or
ollama pull llava         # larger, higher quality
```

`/api/providers/diagnostics` lists each endpoint's `visionModels` so you can
confirm a local one is available.
