import { describe, it, expect } from 'vitest';
import {
  stripDataUrl,
  mapExtractResponse,
  extractErrorLabel,
  formatBytes,
  FileExtractError,
  type ExtractionResult,
} from '../services/file-extract.js';

describe('stripDataUrl', () => {
  it('strips a data: URL prefix', () => {
    expect(stripDataUrl('data:text/plain;base64,aGVsbG8=')).toBe('aGVsbG8=');
  });

  it('leaves a bare base64 string untouched', () => {
    expect(stripDataUrl('aGVsbG8=')).toBe('aGVsbG8=');
  });

  it('does not strip a non-data string that happens to contain a comma', () => {
    expect(stripDataUrl('a,b,c')).toBe('a,b,c');
  });
});

describe('mapExtractResponse', () => {
  const okResult: ExtractionResult = {
    content: { type: 'text', text: 'hi' },
    metadata: { mime: 'text/plain', size: 2, extractedAt: '2026-08-19T00:00:00Z' },
  };

  it('returns the result on a 200 ok body', () => {
    expect(mapExtractResponse(200, { ok: true, result: okResult })).toEqual(okResult);
  });

  it('throws with the server reason on a 415', () => {
    try {
      mapExtractResponse(415, { ok: false, error: 'no extractor', reason: 'unsupported' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FileExtractError);
      expect((err as FileExtractError).reason).toBe('unsupported');
      expect((err as FileExtractError).status).toBe(415);
      expect((err as FileExtractError).message).toBe('no extractor');
    }
  });

  it('throws invalid on a 400', () => {
    expect(() => mapExtractResponse(400, { ok: false, error: 'bad', reason: 'invalid' }))
      .toThrowError(/bad/);
    try {
      mapExtractResponse(400, { ok: false, error: 'bad', reason: 'invalid' });
    } catch (err) {
      expect((err as FileExtractError).reason).toBe('invalid');
    }
  });

  it('infers a reason from the status when the body omits one', () => {
    try {
      mapExtractResponse(415, {});
    } catch (err) {
      expect((err as FileExtractError).reason).toBe('unsupported');
    }
    try {
      mapExtractResponse(400, {});
    } catch (err) {
      expect((err as FileExtractError).reason).toBe('invalid');
    }
    try {
      mapExtractResponse(500, {});
    } catch (err) {
      expect((err as FileExtractError).reason).toBe('extract');
    }
  });

  it('treats a 200 without ok:true as an error', () => {
    expect(() => mapExtractResponse(200, { ok: false })).toThrow(FileExtractError);
  });
});

describe('extractErrorLabel', () => {
  it('gives a distinct message per reason', () => {
    const labels = new Set([
      extractErrorLabel('unsupported'),
      extractErrorLabel('invalid'),
      extractErrorLabel('network'),
      extractErrorLabel('extract'),
    ]);
    expect(labels.size).toBe(4);
  });
});

describe('formatBytes', () => {
  it('formats byte scales', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(18 * 1024 * 1024)).toBe('18 MB');
  });

  it('guards against nonsense input', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(NaN)).toBe('—');
  });
});
