import { fetchWithAuth } from './backend-auth.js';

// These mirror @kairos/files' ExtractionResult. They're duplicated here rather
// than imported so the UI package stays decoupled from the files package (the
// server is the only thing that runs extraction; the browser just renders the
// JSON it gets back).
export interface ExtractedText {
  type: 'text';
  text: string;
  pages?: number;
}

export interface ExtractedSheet {
  name: string;
  headers: string[];
  rows: string[][];
  rowCount: number;
  colCount: number;
}

export interface ExtractedStructured {
  type: 'structured';
  sheets: ExtractedSheet[];
}

export interface ExtractedPreview {
  type: 'thumbnail' | 'table' | 'text-snippet' | 'waveform';
  /** Base64-encoded thumbnail, or the first few rows/lines as text. */
  data: string;
  width?: number;
  height?: number;
}

export interface ExtractedMetadata {
  filename?: string;
  mime: string;
  size: number;
  extractedAt: string;
  pageCount?: number;
  sheetCount?: number;
  duration?: number;
}

export interface ExtractionResult {
  content: ExtractedText | ExtractedStructured;
  preview?: ExtractedPreview;
  metadata: ExtractedMetadata;
}

export type ExtractErrorReason = 'invalid' | 'unsupported' | 'extract' | 'network';

/** A failed extraction, carrying the same `reason` the server assigns. */
export class FileExtractError extends Error {
  constructor(
    message: string,
    readonly reason: ExtractErrorReason,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FileExtractError';
  }
}

// 25mb of base64 in the request body ≈ an ~18mb source file, matching the
// server's express.json({ limit: '25mb' }). Reject earlier client-side so the
// user gets a clear message instead of a 413.
export const MAX_FILE_BYTES = 18 * 1024 * 1024;

// Shape the server sends back from POST /api/files/extract.
type ExtractResponseBody =
  | { ok: true; result: ExtractionResult }
  | { ok: false; error: string; reason: 'invalid' | 'unsupported' | 'extract' };

/** Strip a `data:<mime>;base64,` prefix, leaving the bare base64 payload. */
export function stripDataUrl(content: string): string {
  const comma = content.indexOf(',');
  return content.startsWith('data:') && comma !== -1 ? content.slice(comma + 1) : content;
}

/**
 * Map a server response (status + parsed JSON body) to a result or a typed
 * error. Pure, so the status→reason mapping is unit-testable without a network.
 */
export function mapExtractResponse(status: number, body: unknown): ExtractionResult {
  const b = (body ?? {}) as Partial<ExtractResponseBody> & { error?: string; reason?: string };
  if (status === 200 && b.ok === true && b.result) {
    return b.result;
  }
  const message = typeof b.error === 'string' && b.error ? b.error : `Extraction failed (HTTP ${status}).`;
  const reason: ExtractErrorReason =
    b.reason === 'unsupported' || b.reason === 'invalid' || b.reason === 'extract'
      ? b.reason
      : status === 415
        ? 'unsupported'
        : status === 400
          ? 'invalid'
          : 'extract';
  throw new FileExtractError(message, reason, status);
}

/** A short, human-readable label for an error reason (for toasts/inline text). */
export function extractErrorLabel(reason: ExtractErrorReason): string {
  switch (reason) {
    case 'unsupported':
      return "That file type isn't supported yet.";
    case 'invalid':
      return "That file couldn't be read.";
    case 'network':
      return 'Could not reach the server.';
    case 'extract':
    default:
      return 'Something went wrong extracting that file.';
  }
}

/** Format a byte count as a compact human string (e.g. "1.4 MB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Read a browser File into a bare base64 string (no data: prefix). */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new FileExtractError('Could not read the file.', 'invalid'));
        return;
      }
      resolve(stripDataUrl(result));
    };
    reader.onerror = () => reject(new FileExtractError('Could not read the file.', 'invalid'));
    reader.readAsDataURL(file);
  });
}

/**
 * Send already-base64'd content to the extract endpoint and return the result.
 * Throws {@link FileExtractError} on any non-200 (mapped by reason) or a network
 * failure.
 */
export async function extractContent(content: string, filename?: string): Promise<ExtractionResult> {
  let res: Response;
  try {
    res = await fetchWithAuth('/api/files/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, filename }),
    });
  } catch {
    throw new FileExtractError('Could not reach the server.', 'network');
  }
  const body = await res.json().catch(() => ({}));
  return mapExtractResponse(res.status, body);
}

/** Read a File, upload it, and return the extracted result. */
export async function extractFile(file: File): Promise<ExtractionResult> {
  if (file.size === 0) {
    throw new FileExtractError('That file is empty.', 'invalid');
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new FileExtractError(
      `That file is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_FILE_BYTES)}.`,
      'invalid',
    );
  }
  const content = await readFileAsBase64(file);
  return extractContent(content, file.name);
}
