import { describe, it, expect } from 'vitest';
import { processFile, FileProcessingError } from '../process.js';

describe('processFile', () => {
  it('detects and extracts plain text', async () => {
    const result = await processFile(Buffer.from('hello world', 'utf-8'), 'note.txt');
    expect(result.content.type).toBe('text');
    if (result.content.type === 'text') {
      expect(result.content.text).toBe('hello world');
    }
    expect(result.metadata.filename).toBe('note.txt');
    expect(result.metadata.size).toBe(11);
  });

  it('routes JSON through the text extractor with a snippet preview', async () => {
    const json = JSON.stringify({ a: 1, b: [2, 3] });
    const result = await processFile(Buffer.from(json, 'utf-8'), 'data.json');
    expect(result.content.type).toBe('text');
    expect(result.preview?.type).toBe('text-snippet');
    expect(result.preview?.data).toContain('"a"');
  });

  it('parses CSV as structured spreadsheet data', async () => {
    const csv = 'name,age\nAda,36\nGrace,44';
    const result = await processFile(Buffer.from(csv, 'utf-8'), 'people.csv');
    expect(result.content.type).toBe('structured');
    if (result.content.type === 'structured') {
      const sheet = result.content.sheets[0];
      expect(sheet.headers).toEqual(['name', 'age']);
      expect(sheet.rowCount).toBe(2);
    }
  });

  it('classifies code by extension', async () => {
    const src = 'export const answer = 42;\n';
    const result = await processFile(Buffer.from(src, 'utf-8'), 'answer.ts');
    expect(result.content.type).toBe('text');
    if (result.content.type === 'text') {
      expect(result.content.text).toContain('answer = 42');
    }
  });

  it('throws an unsupported FileProcessingError for binary octet-stream', async () => {
    // A NULL byte forces detection to application/octet-stream, which no
    // extractor handles.
    const bytes = Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff]);
    await expect(processFile(bytes, 'mystery.bin')).rejects.toBeInstanceOf(FileProcessingError);
    await expect(processFile(bytes, 'mystery.bin')).rejects.toMatchObject({ reason: 'unsupported' });
  });
});
