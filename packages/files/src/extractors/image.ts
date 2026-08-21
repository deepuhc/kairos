import type { Extractor, ExtractorInput, ExtractionResult } from '../types.js';

export class ImageExtractor implements Extractor {
  readonly name = 'image';
  readonly supportedMimes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];

  canHandle(mime: string): boolean {
    return mime.startsWith('image/');
  }

  async extract(input: ExtractorInput): Promise<ExtractionResult> {
    // The files package is standalone (no LLM dependency), so it does not run
    // vision itself. It emits the raw base64 as a `thumbnail` preview and a
    // placeholder `content`; a provider-aware consumer (the server) can then
    // pass the base64 to a vision model and replace `content` with a real
    // description. See packages/server/src/files/vision.ts.
    const base64 = input.buffer.toString('base64');

    return {
      content: { type: 'text', text: `[Image: ${input.filename ?? 'unnamed'} (${input.mime}, ${formatSize(input.buffer.length)})]` },
      preview: { type: 'thumbnail', data: base64 },
      metadata: {
        mime: input.mime,
        size: input.buffer.length,
        extractedAt: new Date().toISOString(),
        filename: input.filename,
      },
    };
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
