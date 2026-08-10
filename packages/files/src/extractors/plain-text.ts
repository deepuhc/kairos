import type { Extractor, ExtractorInput, ExtractionResult } from '../types.js';

export class PlainTextExtractor implements Extractor {
  readonly name = 'plain-text';
  readonly supportedMimes = ['text/plain', 'text/markdown', 'application/json', 'text/xml'];

  canHandle(mime: string): boolean {
    return mime.startsWith('text/') || mime === 'application/json';
  }

  async extract(input: ExtractorInput): Promise<ExtractionResult> {
    const text = input.buffer.toString('utf-8');

    return {
      content: { type: 'text', text },
      preview: { type: 'text-snippet', data: text.slice(0, 500) },
      metadata: {
        mime: input.mime,
        size: input.buffer.length,
        extractedAt: new Date().toISOString(),
        filename: input.filename,
      },
    };
  }
}
