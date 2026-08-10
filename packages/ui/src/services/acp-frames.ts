// A captured ACP frame for the Behind the Scenes live inspector.
//
// The frontend only ever receives the agent→client side of the protocol (the
// backend builds the request envelopes over stdio), so every captured frame is
// inbound. agents-view records these from its existing socket handlers into a
// capped ring buffer and hands them to the inspector.

export type FrameChannel =
  | 'update'
  | 'initialized'
  | 'session'
  | 'permission-request'
  | 'elicitation-request'
  | 'config-options'
  | 'stop';

export interface CapturedFrame {
  // Monotonic id for stable list keys (Date-free; agents-view increments it).
  id: number;
  ts: number;
  channel: FrameChannel;
  sessionId?: string;
  // Short human label, e.g. the update's `sessionUpdate` discriminator.
  label: string;
  // The raw object the browser received (an `update` body, `initialized` info, …).
  payload: unknown;
}

// Guard a frame against unbounded base64 (an image/audio chunk) before it goes
// into the ring buffer: replace any long `data` string with a placeholder so
// the inspector stays readable and the buffer stays small.
export function elideLargeData(payload: unknown): unknown {
  const MAX = 256;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (k === 'data' && typeof val === 'string' && val.length > MAX) {
          out[k] = `«${val.length} bytes of base64 elided»`;
        } else {
          out[k] = walk(val);
        }
      }
      return out;
    }
    return v;
  };
  return walk(payload);
}
