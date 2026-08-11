import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { EventBus } from '../bus.js';

// Boots a real http.Server with the same central upgrade router main.ts uses
// (dispatch by pathname), then drives a real WebSocket client through the
// `/events` fan-out contract the shipped UI's EventSocket consumes.

let server: Server;

afterEach(() => new Promise<void>((r) => server?.close(() => r())));

function boot(): Promise<{ port: number; bus: EventBus }> {
  server = createServer();
  const bus = new EventBus();
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '', 'http://localhost');
    if (pathname === '/events') bus.handleUpgrade(req, socket, head);
    else socket.destroy();
  });
  return new Promise((resolve) => {
    server.listen(0, () => resolve({ port: (server.address() as AddressInfo).port, bus }));
  });
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

describe('EventBus over a real WebSocket', () => {
  it('delivers published {event,data} frames to a connected client', async () => {
    const { port, bus } = await boot();
    const ws = await connect(`ws://localhost:${port}/events`);

    const frame = await new Promise<{ event: string; data: unknown }>((resolve, reject) => {
      ws.on('message', (d) => resolve(JSON.parse(d.toString())));
      ws.on('error', reject);
      // Give the connection handler a tick to register the client, then publish.
      setTimeout(() => bus.publish('done:op-1', { code: 0 }), 20);
      setTimeout(() => reject(new Error('no frame received')), 2000);
    });

    expect(frame.event).toBe('done:op-1');
    expect(frame.data).toEqual({ code: 0 });
    ws.close();
  });

  it('fans a single publish out to every connected client', async () => {
    const { port, bus } = await boot();
    const [a, b] = await Promise.all([
      connect(`ws://localhost:${port}/events`),
      connect(`ws://localhost:${port}/events`),
    ]);

    const both = Promise.all(
      [a, b].map(
        (ws) =>
          new Promise<string>((resolve) => ws.on('message', (d) => resolve(JSON.parse(d.toString()).event))),
      ),
    );
    setTimeout(() => bus.publish('auth:changed'), 20);

    expect(await both).toEqual(['auth:changed', 'auth:changed']);
    a.close();
    b.close();
  });

  it('publishes with an undefined payload (data omitted)', async () => {
    const { port, bus } = await boot();
    const ws = await connect(`ws://localhost:${port}/events`);
    const frame = await new Promise<{ event: string; data?: unknown }>((resolve) => {
      ws.on('message', (d) => resolve(JSON.parse(d.toString())));
      setTimeout(() => bus.publish('auth:changed'), 20);
    });
    expect(frame.event).toBe('auth:changed');
    expect(frame.data).toBeUndefined();
    ws.close();
  });

  it('drops a disconnected client from the fan-out set', async () => {
    const { port, bus } = await boot();
    const ws = await connect(`ws://localhost:${port}/events`);
    expect(bus.connectionCount).toBe(1);
    await new Promise<void>((resolve) => {
      ws.on('close', () => resolve());
      ws.close();
    });
    // Give the server's 'close' handler a tick to run.
    await new Promise((r) => setTimeout(r, 20));
    expect(bus.connectionCount).toBe(0);
    // Publishing to nobody must not throw.
    expect(() => bus.publish('auth:changed')).not.toThrow();
  });

  it('destroys an upgrade on a non-/events path', async () => {
    const { port } = await boot();
    const failed = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}/nope`);
      ws.on('open', () => resolve(false));
      ws.on('error', () => resolve(true));
      setTimeout(() => resolve(false), 1500);
    });
    expect(failed).toBe(true);
  });
});
