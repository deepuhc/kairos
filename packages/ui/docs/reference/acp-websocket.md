# ACP over WebSocket

Kairos exposes the [Agent Client Protocol](https://agentclientprotocol.com) directly on a WebSocket. Any ACP-compliant local client that has the current launch token can connect to a running Kairos server and drive an agent with plain JSON-RPC 2.0.

There is no custom framing and no Socket.io wrapper. One JSON-RPC 2.0 message is sent per WebSocket text frame.

## Endpoint

```text
ws://<host>:<port>/acp?agent=<id>&cwd=<absolute-path>&kairos_token=<auth-token>
```

Parameters:

- `agent` is one of the built-ins, such as `claude`, `codex`, or `gemini`, or a custom agent id registered in `~/.kairos/config.json`.
- `cwd` is the absolute working directory for the session.
- `kairos_token` is the per-launch token written to `~/.config/kairos/server.json` as `authToken`. Browser clients opened by Kairos normally use the HttpOnly `kairos_auth` cookie instead. Non-browser clients may also send `Authorization: Bearer <auth-token>` or `X-Kairos-Token: <auth-token>`.
- One WebSocket equals one agent connection. Open multiple sockets to drive multiple agents concurrently.

The agent's filesystem and terminal callbacks are answered by the Kairos server, scoped to `cwd`. External clients do not receive those callbacks and do not need to implement `fs/*` or `terminal/*`.

## Canonical Flow

### Initialize

```jsonc
// client -> server
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{},"clientInfo":{"name":"my-client","version":"0.1.0"}}}

// server -> client
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentCapabilities":{},"agentInfo":{},"authMethods":[]}}
```

### Create a session

```jsonc
// client -> server
{"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"/absolute/path/to/workspace","mcpServers":[]}}

// server -> client
{"jsonrpc":"2.0","id":2,"result":{"sessionId":"sess_abc","modes":{},"configOptions":[]}}
```

### Send a prompt

```jsonc
// client -> server
{"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"sessionId":"sess_abc","prompt":[{"type":"text","text":"Say hello in one sentence."}]}}

// server -> client, repeated while the agent works
{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_abc","update":{}}}

// server -> client, final response
{"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn"}}
```

### Answer a permission request

```jsonc
// server -> client
{"jsonrpc":"2.0","id":100,"method":"session/request_permission","params":{"sessionId":"sess_abc","toolCall":{},"options":[{"optionId":"allow_once","name":"Allow"}]}}

// client -> server
{"jsonrpc":"2.0","id":100,"result":{"outcome":{"outcome":"selected","optionId":"allow_once"}}}
```

Other supported ACP methods include `authenticate`, `session/load`, `session/set_config_option`, `session/cancel`, and `elicitation/create`.

## Server-Scoped Filesystem And Terminal

The spawned agent can call ACP client-role methods such as:

- `fs/read_text_file`
- `fs/write_text_file`
- `terminal/*`

Kairos answers these methods server-side after resolving the path inside the session `cwd`. Path traversal outside the working directory is rejected. These messages do not cross the external WebSocket.

## Kairos Extension Notifications

Kairos-specific signals are JSON-RPC 2.0 notifications. Spec-only ACP clients can ignore unknown methods.

```jsonc
{"jsonrpc":"2.0","method":"_ext/log","params":{"stream":"stderr","text":"..."}}
{"jsonrpc":"2.0","method":"_ext/stalled","params":{"sessionId":"sess_abc","secondsIdle":121}}
{"jsonrpc":"2.0","method":"_ext/terminal_output","params":{"sessionId":"sess_abc","terminalId":"term_1","output":"..."}}
```

## Out-Of-Band REST Actions

These are not ACP messages. They address the Kairos server:

- `POST /api/agents/:agentId/force-restart` kills a wedged agent process group. The WebSocket closes as a side effect; reconnect to resume.
- `POST /api/agents/terminal-auth` with `{command, args}` opens an interactive login command in a system terminal window.

## Browser Smoke Test

With Kairos running on its local backend, open DevTools on the Kairos page and paste this snippet. Browsers block plain `ws://` from `https://` pages. The packaged/default backend port is `3333`; source dev scripts (`npm run dev` / `npm run desktop:dev`) use `3334`, and `npm run desktop` uses `3335`, unless `KAIROS_PORT` is set.

```js
(async () => {
  const HOST = 'localhost:3334';
  const AGENT = 'claude';
  const CWD = '/absolute/path/to/your/workspace';
  const PROMPT = 'Say hello in one sentence and stop.';

  // The Kairos page already has the HttpOnly auth cookie. Non-browser clients
  // should read ~/.config/kairos/server.json and pass authToken as kairos_token.
  const url = `ws://${HOST}/acp?agent=${encodeURIComponent(AGENT)}&cwd=${encodeURIComponent(CWD)}`;
  const ws = new WebSocket(url);
  window.__acp = ws;

  let nextId = 1;
  const pending = new Map();

  const send = (message) => {
    console.log('->', message);
    ws.send(JSON.stringify(message));
  };

  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    send({ jsonrpc: '2.0', id, method, params });
  });

  const respond = (id, result) => {
    send({ jsonrpc: '2.0', id, result });
  };

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    console.log('<-', message);

    if (message.id !== undefined && !message.method) {
      const pendingRequest = pending.get(message.id);
      pending.delete(message.id);
      if (!pendingRequest) return;
      message.error ? pendingRequest.reject(message.error) : pendingRequest.resolve(message.result);
      return;
    }

    if (message.method === 'session/request_permission') {
      const first = message.params?.options?.[0];
      respond(message.id, {
        outcome: {
          outcome: 'selected',
          optionId: first?.optionId ?? 'allow_once',
        },
      });
      return;
    }

    if (message.method === 'elicitation/create') {
      respond(message.id, { action: 'cancel' });
    }
  });

  ws.addEventListener('close', (event) => {
    console.log(`closed code=${event.code} reason=${event.reason || '(none)'}`);
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('close', (event) => reject(new Error(`close ${event.code}: ${event.reason}`)), { once: true });
  });

  await request('initialize', {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
      terminal: true,
    },
    clientInfo: {
      name: 'devtools-smoke',
      title: 'DevTools smoke test',
      version: '0.1.0',
    },
  });

  const session = await request('session/new', {
    cwd: CWD,
    mcpServers: [],
  });

  const result = await request('session/prompt', {
    sessionId: session.sessionId,
    prompt: [{ type: 'text', text: PROMPT }],
  });

  console.log(`done stopReason=${result.stopReason}`);
})();
```

Call `__acp.close()` to disconnect.

## WebSocket Close Codes

| Code | Meaning |
|---|---|
| `4400` | Bad upgrade, such as unknown `agent` or missing `cwd`. |
| `4001` | Agent process exited. The close reason carries `agent-exit code=N`. |
