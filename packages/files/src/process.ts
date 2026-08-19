import type { ExtractionResult } from './types.js';
import { detectMime } from './detect.js';
import { createExtractor } from './extractor-factory.js';

/** A file that could not be processed — detection or extraction failed. */
export class FileProcessingError extends Error {
  constructor(
    message: string,
    /** 'unsupported' when no extractor matched; 'extract' when extraction threw. */
    readonly reason: 'unsupported' | 'extract',
    readonly mime?: string,
  ) {
    super(message);
    this.name = 'FileProcessingError';
  }
}

/**
 * The full "upload → detect → extract" pipeline for a single file, kept free of
 * any HTTP/transport concerns so it can be reused by the server, the CLI, and
 * unit tests alike.
 *
 * Detects the MIME type from the buffer's magic bytes (falling back to the
 * filename), picks the matching extractor, and returns its result. Throws a
 * {@link FileProcessingError} when the type is unsupported or extraction fails,
 * so callers can map those to distinct responses.
 */
export async function processFile(
  buffer: Buffer,
  filename?: string,
): Promise<ExtractionResult> {
  const mimeResult = await detectMime(buffer, filename);
  const extractor = createExtractor(mimeResult);

  if (!extractor) {
    throw new FileProcessingError(
      `No extractor available for ${mimeResult.mime} (${mimeResult.category})`,
      'unsupported',
      mimeResult.mime,
    );
  }

  try {
    return await extractor.extract({ buffer, mime: mimeResult.mime, filename });
  } catch (err) {
    throw new FileProcessingError(
      `Failed to extract ${mimeResult.mime}: ${err instanceof Error ? err.message : String(err)}`,
      'extract',
      mimeResult.mime,
    );
  }
}
