import { describe, it, expect, vi } from 'vitest';
import { extractFileRequest } from '../files/extract.js';
import type { SmartRouter } from '@kairos/providers';

const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');

// A minimal valid 1x1 PNG, base64 — detected as image/png by @kairos/files.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMEAYH8pC0AAAAASUVORK5CYII=';

// A stand-in SmartRouter whose vision model returns a fixed description.
function visionRouter(description: string, capture?: (args: unknown[]) => void): SmartRouter {
  const complete = vi.fn(async (...args: unknown[]) => {
    capture?.(args);
    return { content: description, model: 'mock-vision' };
  });
  return {
    selectModel: vi.fn(async () => ({
      provider: { complete } as never,
      model: { id: 'mock-vision', capabilities: ['vision'] } as never,
    })),
  } as unknown as SmartRouter;
}

describe('extractFileRequest', () => {
  it('extracts a valid base64 text file (200)', async () => {
    const res = await extractFileRequest({ content: b64('hello'), filename: 'a.txt' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    if (res.body.ok && res.body.result.content.type === 'text') {
      expect(res.body.result.content.text).toBe('hello');
    }
  });

  it('accepts a data: URL and strips the prefix', async () => {
    const res = await extractFileRequest({
      content: `data:text/plain;base64,${b64('via data url')}`,
      filename: 'a.txt',
    });
    expect(res.status).toBe(200);
    if (res.body.ok && res.body.result.content.type === 'text') {
      expect(res.body.result.content.text).toBe('via data url');
    }
  });

  it('rejects a missing content field (400 invalid)', async () => {
    const res = await extractFileRequest({ filename: 'a.txt' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('rejects a non-string content field (400 invalid)', async () => {
    const res = await extractFileRequest({ content: 123 as unknown });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('rejects a non-string filename (400 invalid)', async () => {
    const res = await extractFileRequest({ content: b64('x'), filename: 42 as unknown });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('rejects content that decodes to zero bytes (400 invalid)', async () => {
    // Base64 of an empty string is an empty string; use a non-empty but
    // whitespace-only base64 that decodes to nothing.
    const res = await extractFileRequest({ content: '=' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('maps an unsupported binary type to 415', async () => {
    const bin = Buffer.from([0x00, 0x01, 0x00, 0xff]).toString('base64');
    const res = await extractFileRequest({ content: bin, filename: 'x.bin' });
    expect(res.status).toBe(415);
    expect(res.body).toMatchObject({ ok: false, reason: 'unsupported' });
  });

  it('is defensive against a null body', async () => {
    const res = await extractFileRequest(null as unknown as Record<string, never>);
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  describe('image vision enrichment', () => {
    it('replaces the image placeholder with the vision description when a router is given', async () => {
      const captured: unknown[][] = [];
      const router = visionRouter('A single white pixel on a transparent background.', (a) => captured.push(a));
      const res = await extractFileRequest(
        { content: PNG_B64, filename: 'dot.png' },
        { router },
      );
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      if (res.body.ok && res.body.result.content.type === 'text') {
        expect(res.body.result.content.text).toBe('A single white pixel on a transparent background.');
      }
      // The base64 image was sent to the model as an image content block.
      const messages = captured[0]?.[0] as Array<{ content: Array<{ type: string; data?: string }> }>;
      const imagePart = messages[0].content.find((p) => p.type === 'image');
      expect(imagePart?.data).toBe(PNG_B64);
      // The thumbnail preview is preserved for <img> display.
      expect(res.body.ok && res.body.result.preview?.type).toBe('thumbnail');
    });

    it('leaves the placeholder untouched when no router is provided', async () => {
      const res = await extractFileRequest({ content: PNG_B64, filename: 'dot.png' });
      expect(res.status).toBe(200);
      if (res.body.ok && res.body.result.content.type === 'text') {
        expect(res.body.result.content.text).toContain('[Image:');
      }
    });

    it('leaves the placeholder untouched when no vision model is available', async () => {
      const router = { selectModel: vi.fn(async () => null) } as unknown as SmartRouter;
      const res = await extractFileRequest({ content: PNG_B64, filename: 'dot.png' }, { router });
      expect(res.status).toBe(200);
      if (res.body.ok && res.body.result.content.type === 'text') {
        expect(res.body.result.content.text).toContain('[Image:');
      }
    });

    it('still succeeds (200) when the vision call throws', async () => {
      const router = {
        selectModel: vi.fn(async () => ({
          provider: { complete: vi.fn(async () => { throw new Error('provider down'); }) } as never,
          model: { id: 'mock-vision', capabilities: ['vision'] } as never,
        })),
      } as unknown as SmartRouter;
      const res = await extractFileRequest({ content: PNG_B64, filename: 'dot.png' }, { router });
      expect(res.status).toBe(200);
      if (res.body.ok && res.body.result.content.type === 'text') {
        expect(res.body.result.content.text).toContain('[Image:');
      }
    });

    it('does not call vision for a non-image file', async () => {
      const router = visionRouter('should not be used');
      const res = await extractFileRequest({ content: b64('plain text'), filename: 'a.txt' }, { router });
      expect(res.status).toBe(200);
      expect(router.selectModel).not.toHaveBeenCalled();
      if (res.body.ok && res.body.result.content.type === 'text') {
        expect(res.body.result.content.text).toBe('plain text');
      }
    });
  });
});
