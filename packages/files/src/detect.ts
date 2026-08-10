import type { MimeResult, FileCategory } from './types.js';

const CATEGORY_MAP: Record<string, FileCategory> = {
  'application/pdf': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'spreadsheet',
  'text/csv': 'spreadsheet',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/svg+xml': 'image',
  'audio/mpeg': 'audio',
  'audio/wav': 'audio',
  'audio/ogg': 'audio',
  'video/mp4': 'video',
  'video/webm': 'video',
  'application/zip': 'archive',
  'application/gzip': 'archive',
  'application/x-tar': 'archive',
};

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h',
  'rb', 'php', 'swift', 'kt', 'scala', 'sh', 'bash', 'zsh', 'sql',
  'html', 'css', 'scss', 'less', 'vue', 'svelte',
]);

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'cfg',
  'env', 'log', 'csv',
]);

function categoryFromExtension(ext: string): FileCategory {
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  return 'unknown';
}

/**
 * Detect MIME type from a file buffer and optional filename.
 * Uses magic bytes first, falls back to extension-based detection.
 */
export async function detectMime(buffer: Buffer, filename?: string): Promise<MimeResult> {
  // Try magic bytes detection
  const { fileTypeFromBuffer } = await import('file-type');
  const result = await fileTypeFromBuffer(buffer);

  if (result) {
    const category = CATEGORY_MAP[result.mime] ?? categoryFromExtension(result.ext);
    return { mime: result.mime, ext: result.ext, category };
  }

  // Fallback to extension
  const ext = filename?.split('.').pop()?.toLowerCase() ?? '';

  if (ext === 'csv') return { mime: 'text/csv', ext: 'csv', category: 'spreadsheet' };
  if (ext === 'md') return { mime: 'text/markdown', ext: 'md', category: 'text' };
  if (ext === 'json') return { mime: 'application/json', ext: 'json', category: 'text' };
  if (ext === 'svg') return { mime: 'image/svg+xml', ext: 'svg', category: 'image' };

  const category = categoryFromExtension(ext);
  if (category === 'code') return { mime: 'text/x-code', ext, category };
  if (category === 'text') return { mime: 'text/plain', ext, category };

  // Default: try reading as UTF-8 text
  const isText = isLikelyText(buffer);
  if (isText) return { mime: 'text/plain', ext: ext || 'txt', category: 'text' };

  return { mime: 'application/octet-stream', ext: ext || 'bin', category: 'unknown' };
}

function isLikelyText(buffer: Buffer): boolean {
  // Check first 512 bytes for binary content
  const sample = buffer.subarray(0, Math.min(512, buffer.length));
  for (const byte of sample) {
    if (byte === 0) return false; // NULL byte = binary
    if (byte < 8 || (byte > 13 && byte < 32 && byte !== 27)) return false;
  }
  return true;
}
