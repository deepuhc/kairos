import type { Extractor, ExtractorInput, ExtractionResult } from '../types.js';

export class CodeExtractor implements Extractor {
  readonly name = 'code';
  readonly supportedMimes = ['text/x-code'];

  canHandle(mime: string): boolean {
    return mime === 'text/x-code';
  }

  async extract(input: ExtractorInput): Promise<ExtractionResult> {
    const text = input.buffer.toString('utf-8');
    const lines = text.split('\n');

    return {
      content: { type: 'text', text },
      preview: { type: 'text-snippet', data: lines.slice(0, 30).join('\n') },
      metadata: {
        mime: input.mime,
        size: input.buffer.length,
        extractedAt: new Date().toISOString(),
        filename: input.filename,
      },
    };
  }
}
