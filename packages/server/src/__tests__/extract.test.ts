import { describe, it, expect } from 'vitest';
import { extractFileRequest } from '../files/extract.js';

const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');

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
});
