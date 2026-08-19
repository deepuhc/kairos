import { processFile, FileProcessingError, type ExtractionResult } from '@kairos/files';

/** Shape the client POSTs to /api/files/extract. */
export interface ExtractRequestBody {
  /** Base64-encoded file contents (a bare base64 string or a data: URL). */
  content?: unknown;
  /** Original filename — improves MIME detection for extensionless magic bytes. */
  filename?: unknown;
}

export interface ExtractResponse {
  status: number;
  body: ExtractOk | ExtractErr;
}

interface ExtractOk {
  ok: true;
  result: ExtractionResult;
}

interface ExtractErr {
  ok: false;
  error: string;
  /** 'invalid' (bad request), 'unsupported' (no extractor), or 'extract' (failed). */
  reason: 'invalid' | 'unsupported' | 'extract';
}

// A data URL looks like `data:<mime>;base64,<payload>`; we only need the payload
// since @kairos/files re-detects the MIME from the bytes themselves.
function stripDataUrl(content: string): string {
  const comma = content.indexOf(',');
  return content.startsWith('data:') && comma !== -1 ? content.slice(comma + 1) : content;
}

/**
 * Validate an extract request, run the local file pipeline, and map the outcome
 * to an HTTP status + JSON body. Pure (no Express types) so it is unit-testable
 * and reusable; the route handler is a thin wrapper over it.
 */
export async function extractFileRequest(body: ExtractRequestBody): Promise<ExtractResponse> {
  const { content, filename } = body ?? {};

  if (typeof content !== 'string' || content.length === 0) {
    return {
      status: 400,
      body: { ok: false, error: 'Missing "content": expected a base64 string.', reason: 'invalid' },
    };
  }
  if (filename !== undefined && typeof filename !== 'string') {
    return {
      status: 400,
      body: { ok: false, error: '"filename" must be a string when provided.', reason: 'invalid' },
    };
  }

  const buffer = Buffer.from(stripDataUrl(content), 'base64');
  if (buffer.length === 0) {
    return {
      status: 400,
      body: { ok: false, error: '"content" did not decode to any bytes.', reason: 'invalid' },
    };
  }

  try {
    const result = await processFile(buffer, filename);
    return { status: 200, body: { ok: true, result } };
  } catch (err) {
    if (err instanceof FileProcessingError) {
      // Unsupported type is a client problem (415); a failed extraction of a
      // supported type is a server-side processing failure (422).
      const status = err.reason === 'unsupported' ? 415 : 422;
      return { status, body: { ok: false, error: err.message, reason: err.reason } };
    }
    return {
      status: 500,
      body: { ok: false, error: err instanceof Error ? err.message : String(err), reason: 'extract' },
    };
  }
}
