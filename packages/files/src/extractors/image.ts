import type { Extractor, ExtractorInput, ExtractionResult } from '../types.js';

export class ImageExtractor implements Extractor {
  readonly name = 'image';
  readonly supportedMimes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];

  canHandle(mime: string): boolean {
    return mime.startsWith('image/');
  }

  async extract(input: ExtractorInput): Promise<ExtractionResult> {
    // Images are passed directly to vision-capable models as base64.
    // No text extraction — the AI model interprets the image.
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
