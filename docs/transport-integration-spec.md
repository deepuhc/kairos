# Kairos UI ↔ Server Transport Integration Spec

Status: IN PROGRESS · Owner: software-architect · Date: 2026-08-10

> **Progress (2026-08-11):** Phases A–D implemented and verified.
> - **A** — `@kairos/protocol` rewritten to the camelCase ACP contract + `acp-contract.test.ts`. ✅
> - **B/D** — `/acp` transport stood up (`packages/server/src/acp/`) backed by `FakeAcpAgent`, including the bidirectional `session/request_permission` path; unit + real-socket integration tests. ✅
> - **C** — REST triage stubs (`packages/server/src/rest/stub-routes.ts`): boot-critical GET defaults + `501 { unsupported: true }` catch-all. ✅
> - **E** — real-agent adapters (shape B), `/events`, `/terminal/ws` — still open (per-tool, not headless-verifiable).

## Purpose

The shipped UI and the shipped Express server cannot talk end-to-end. This spec
defines the concrete, phased path to make them interoperate by unifying on **ACP
JSON-RPC 2.0** over a `/acp` WebSocket, backed by `@kairos/protocol`, while
keeping `/events` and `/terminal/ws` as-is.

It is grounded in the current code (file:line citations throughout). Where the
prose says "does not exist" it means: verified absent in the tree as of this date.

## TL;DR of the current gap

| Concern | UI expects | Server provides | Match? |
|---|---|---|---|
| Agent transport | JSON-RPC 2.0 over `/acp?agent=&cwd=` (`acp.ts:123-127`, `acp-ws.ts`) | Bespoke tagged-union over `/ws` (`ws/protocol.ts`, `ws/hub.ts:11`) | NO |
| Shared contract | camelCase ACP methods incl. `session/load`, `session/set_config_option`, `authenticate`, inbound `session/request_permission` + `elicitation/create` (`acp.ts`) | `@kairos/protocol` uses snake_case + only 7 methods, imported by nobody (`protocol/src/types.ts:30-96`) | PARTIAL |
| REST surface | ~94 `request<>()`/`fetchWithAuth` call sites across 20+ resource groups (`api.ts`) | 4 GET routes only (`main.ts:34-61`) | NO |
| Agent backend | A real ACP agent (JSON-RPC peer, session model, streaming `session/update`) | `AgentProcess` pipes raw text to a CLI's stdin/stdout (`process.ts:57-63`) | NO |
| Event bus | `/events` `{event,data}` (`events.ts:46,63-70`) | not opened server-side | NO |
| Terminal | `/terminal/ws` PTY (`agents-terminal.ts:351`) | not opened server-side | NO |

The single load-bearing insight: **only `/acp` is JSON-RPC.** `/events` is a
plain `{event,data}` fan-out bus and `/terminal/ws` is a PTY byte stream. Do not
"unify" those two onto JSON-RPC — they are correct as-is and out of scope.

---

## 1. ACP method map

The UI's `AcpClient` (`acp.ts`) is the authoritative contract — it is a working
JSON-RPC 2.0 peer today. The server must implement the agent side of exactly
these frames. Direction is from the **server's** point of view.

### 1a. Client → Server requests (server must answer)

| Method | Params (camelCase) | Result | UI call site |
|---|---|---|---|
| `initialize` | `{ protocolVersion, clientCapabilities, clientInfo }` | `{ protocolVersion, agentCapabilities?, agentInfo?, authMethods? }` | `acp.ts:377-391` |
| `authenticate` | `{ methodId }` | `{}` | `acp.ts:172` |
| `session/new` | `{ cwd, mcpServers }` | `{ sessionId, modes?, configOptions? }` | `acp.ts:200-203` |
| `session/load` | `{ sessionId, cwd, mcpServers }` | `{ modes?, configOptions? } \| null` | `acp.ts:227-231` |
| `session/prompt` | `{ sessionId, prompt: ContentBlock[] }` | `{ stopReason, usage? }` | `acp.ts:256` |
| `session/set_config_option` | `{ sessionId, configId, value }` | `{ configOptions? }` | `acp.ts:274` |

### 1b. Client → Server notifications (no response)

| Method | Params | UI call site |
|---|---|---|
| `session/cancel` | `{ sessionId }` | `acp.ts:287` |

### 1c. Server → Client requests (UI answers — bidirectional!)

These are the reason a naive request/response server is insufficient: the agent
side must be able to *originate* JSON-RPC requests back to the UI and await the
answer.

| Method | Params | UI response | UI handler |
|---|---|---|---|
| `session/request_permission` | `{ sessionId, toolCall, options }` | `{ outcome }` | `acp.ts:356,446-464` |
| `elicitation/create` | `{ sessionId, message, requestedSchema, toolCallId? }` | elicitation response | `acp.ts:357,466-484` |

### 1d. Server → Client notifications

| Method | Params | UI handler |
|---|---|---|
| `session/update` | `{ sessionId, update: SessionUpdate }` | `acp.ts:352-355` |
| `_ext/log` | `{ stream, text }` | `acp.ts:360-363` |
| `_ext/stalled` | `{ sessionId, secondsIdle }` | `acp.ts:364-367` |
| `_ext/terminal_output` | `{ sessionId, terminalId, output }` | `acp.ts:368-371` |

> `_ext/*` are Kairos extension notifications, namespaced so external vanilla-ACP
> clients ignore them cleanly.

### 1e. `@kairos/protocol` gap analysis

`@kairos/protocol` (`types.ts`) is the *intended* shared contract but drifted
from what the UI actually speaks. To become the source of truth it must:

1. **Switch to camelCase.** `SessionNewParams.working_directory` → the UI never
   sends that; `session/new` params are `{ cwd, mcpServers }` (`acp.ts:201-202`).
   `SessionUpdate.session_id` → `sessionId`. Every field the UI reads/writes is
   camelCase.
2. **Add the missing methods.** `Methods` (`types.ts:88-96`) lists 7; the UI uses
   `session/load`, `session/set_config_option`, `authenticate`,
   `session/request_permission`, `elicitation/create`, plus the `_ext/*`
   notifications — none present.
3. **Model bidirectionality.** Current `PermissionRequest`/`PermissionResponse`
   (`types.ts:73-85`) assume a `permission/request`↔`permission/response`
   request/response pair. The UI instead answers an inbound
   `session/request_permission` JSON-RPC *request* with `{ outcome }`
   (`acp.ts:456`). The type layer must express server-originated requests.
4. **Adopt `JsonRpcCodec`.** The codec (`protocol/src/codec.ts`, now unit-tested
   — 12 tests in `codec.test.ts`) already does newline framing, pending-request
   correlation, and partial-line buffering. It is the right wire engine for the
   new `/acp` handler; the UI's `WsJsonRpc` (`acp-ws.ts`) is its mirror.

---

## 2. REST endpoint inventory

The UI (`api.ts`) makes ~94 REST calls across the resource groups below. The
server implements **4 GET routes** (`main.ts:34-61`: `/api/health`,
`/api/providers`, `/api/agents`, `/api/pipelines`). Everything else 404s.

| Group | ~calls | Representative paths | Server status |
|---|---|---|---|
| agents | 16 | `/api/agents`, `/api/agents/:id/force-restart`, `/api/agents/terminal-auth` | 1 of 16 (GET list only) |
| auth | 11 | backend cookie / login flows (`backend-auth.ts`) | none |
| workspaces | 9 | `/workspaces`, `/workspaces/{pin,hide,rename,sort,config,record-open,…}` | none |
| sessions | 6 | `/sessions/{resume,rename,delete,pin,unpin,pinned-order}` | none |
| usage | 5 | `/usage`, `/usage/{presence,access,testimonials}` | none |
| system | 4 | `/system/{version,user,ui-update,self-update}` | none |
| checkpoints | 4 | `/checkpoints/restore`, … | none |
| worktrees | 3 | `/worktrees`, `/worktrees/inspect` | none |
| config | 3 | `/config/{status,set,unset}` | none |
| features | 2 | `/features/{set,unset}` | none |
| apps | 2 | app launch/list | none |
| singletons | ~8 | `/terminal`, `/skills/list`, `/rules/file`, `/reveal`, `/plugins/list`, `/launch`, `/execute`, `/execute-batch`, `/doctor/status` | none |

**Implication:** the REST surface is not a transport problem — it is a
**product-scope** problem. The UI was built against a much larger backend (the
historical Rust `src-tauri` bridge). Unifying the *transport* (§1) does not make
these endpoints exist. They must be triaged (§5, Phase C) into: (a) implement,
(b) stub with honest 501, (c) feature-flag off in the UI.

---

## 3. Agent-backend boundary

This is the deepest gap and the one most likely to be underestimated.

**What the UI assumes** (`acp.ts`): each agent is a full ACP *peer* — it owns
sessions, streams `session/update` frames, and can originate
`session/request_permission` / `elicitation/create` requests back to the client
and block on the answer.

**What the server has** (`process.ts:57-63`): `AgentProcess.send(text)` writes
`text + '\n'` to a child process's stdin and flips status to `working`. Output
is raw stdout/stderr bytes forwarded verbatim (`process.ts:31-41`). There is no
session model, no JSON-RPC, no permission channel, no structured update.

So the `/acp` handler needs an **adapter layer** that turns a line-oriented CLI
into an ACP peer. Two viable shapes:

- **A. Native-ACP passthrough.** If the spawned agent already speaks ACP on its
  stdio (e.g. a real ACP agent binary), the handler is a byte pump between the
  WebSocket and the child stdio, plus connection bookkeeping. Cheapest, but only
  works for agents that are already ACP servers.
- **B. Translating adapter.** For plain CLIs (the `AgentProcess` case), the
  handler must synthesize sessions, wrap prompts into the CLI's input format,
  and parse stdout into `session/update` frames. This is a real per-tool
  integration and cannot be done generically for "any CLI."

**Recommendation:** ship **A** first (it makes the ACP contract real and testable
with an actual ACP agent) and treat **B** as per-adapter work under the existing
`@kairos/agents` adapter pattern (`CliAdapter`, `OllamaHttpAgent`). Do not block
the transport unification on B.

The stdio must also be **line-buffered** before JSON-RPC parsing: `process.ts:31`
forwards arbitrary `data` chunks, which can split a JSON-RPC frame across two
`data` events or coalesce two frames into one. `JsonRpcCodec.decode`
(`codec.ts`) already handles partial-line buffering on the *receiving* side, so
the adapter should feed raw chunks straight into a codec instance rather than
hand-rolling `split('\n')`.

---

## 4. Verifiability matrix

What can actually be proven in this headless environment vs. what needs a real
agent / browser.

| Layer | Verifiable headless? | How |
|---|---|---|
| `JsonRpcCodec` framing & correlation | ✅ Yes | Unit tests — done (`codec.test.ts`, 12 tests) |
| `/acp` handshake (`initialize` → result) | ✅ Yes | Node WS client test against the server; assert JSON-RPC frames |
| `session/new` → `session/prompt` → `session/update`* stream | ⚠️ Partial | Only with a **fake ACP agent** stub; a real CLI needs shape B |
| Bidirectional `session/request_permission` | ⚠️ Partial | Fake agent that originates the request; assert UI-side resolver contract via `AcpClient` unit test |
| REST endpoints | ✅ Per-route | supertest against Express once each route exists |
| `/events` bus, `/terminal/ws` PTY | ⚠️ Partial | Server-side open + echo test; full UX needs a browser |
| Full E2E (UI ↔ server ↔ real agent) | ❌ No | Needs a browser + a real ACP agent binary; out of headless scope |

**Testing assets to build:** (1) a `FakeAcpAgent` — a Node ACP peer over stdio
that the `/acp` handler can drive, enabling deterministic tests of the whole
session lifecycle including server-originated permission requests; (2) a thin
`AcpClient` node harness reusing `acp-ws.ts` to assert the client contract
without a browser.

---

## 5. Phased sequence

Ordered so each phase is independently mergeable and leaves the tree green.

**Phase A — make the contract real (protocol package).** *No behavior change.*
- Rewrite `@kairos/protocol/types.ts` to camelCase and add the missing methods
  from §1 (`session/load`, `session/set_config_option`, `authenticate`,
  `session/request_permission`, `elicitation/create`, `_ext/*`).
- Model server-originated requests (bidirectional) in the type layer.
- Keep `JsonRpcCodec` as the wire engine (already tested).
- Exit criteria: `@kairos/protocol` types match `acp.ts` field-for-field; `tsc -b`
  green; codec tests green.

**Phase B — stand up `/acp` on the server.** *Additive; `/ws` stays.*
- Add a `WebSocketServer({ server, path: '/acp' })` alongside the existing
  `path: '/ws'` (`hub.ts:11`). Parse `?agent=&cwd=` (`acp.ts:123-127`).
- Implement the server as a `JsonRpcCodec`-backed peer: answer `initialize`,
  `session/new`, `session/prompt`; emit `session/update`.
- Back it with a **`FakeAcpAgent`** first (shape A) so the lifecycle is testable.
- Exit criteria: Node WS client completes `initialize` → `session/new` →
  `session/prompt` → receives `session/update` → `stopReason`; all under a new
  server integration test.

**Phase C — REST triage.** *Unblocks the UI shell.*
- Categorize the ~94 calls (§2) into implement / 501-stub / feature-flag-off.
- Implement the small load-bearing set first: `/api/agents/*` lifecycle,
  `/system/version`, `/config/*`. Honest 501 for the rest so the UI degrades
  visibly rather than hanging.
- Exit criteria: UI boots against the server with no unhandled request rejections;
  every unimplemented route returns 501 with a documented reason.

**Phase D — bidirectional + extensions.** *Completes the ACP surface.*
- Server-originated `session/request_permission` and `elicitation/create`, awaited
  against the UI's resolver contract (`acp.ts:446-484`).
- `_ext/log`, `_ext/stalled`, `_ext/terminal_output` notifications.
- Exit criteria: `FakeAcpAgent` can request a permission and receive the UI's
  `{ outcome }`; asserted in integration test.

**Phase E — real-agent adapters (shape B) + `/events` + `/terminal/ws`.**
*Out of the transport-unification critical path; per-tool work.*
- Translating adapters per CLI under `@kairos/agents`.
- Open `/events` fan-out and `/terminal/ws` PTY server-side.
- Full E2E is browser + real-agent only (§4) — not headless-verifiable.

### Sequencing rationale
Phases A→B→D make the **agent transport** correct and testable end-to-end
against a fake agent without touching the UI. Phase C is parallelizable with B/D
(different files) and is what makes the UI *shell* usable. Phase E is genuinely
open-ended product work and must not gate A–D.

### Non-goals
- Migrating `/events` or `/terminal/ws` to JSON-RPC (they are correct as-is).
- Deleting the legacy `/ws` tagged-union transport in this effort — leave it until
  `/acp` is proven, then remove `ws/protocol.ts` + `ws/hub.ts` callers in a
  dedicated cleanup.
- Implementing shape-B adapters for every CLI (per-tool, incremental).
