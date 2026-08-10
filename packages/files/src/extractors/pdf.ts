import type { Extractor, ExtractorInput, ExtractionResult } from '../types.js';

export class PdfExtractor implements Extractor {
  readonly name = 'pdf';
  readonly supportedMimes = ['application/pdf'];

  canHandle(mime: string): boolean {
    return this.supportedMimes.includes(mime);
  }

  async extract(input: ExtractorInput): Promise<ExtractionResult> {
    // pdf-parse is an optional dependency — lazy-load
    let pdfParse: (buffer: Buffer) => Promise<{ text: string; numpages: number }>;
    try {
      pdfParse = (await import('pdf-parse')).default;
    } catch {
      return {
        content: { type: 'text', text: '[PDF extraction unavailable — install pdf-parse]' },
        metadata: { mime: input.mime, size: input.buffer.length, extractedAt: new Date().toISOString(), filename: input.filename },
      };
    }

    const data = await pdfParse(input.buffer);
    return {
      content: { type: 'text', text: data.text, pages: data.numpages },
      preview: { type: 'text-snippet', data: data.text.slice(0, 500) },
      metadata: {
        mime: input.mime,
        size: input.buffer.length,
        extractedAt: new Date().toISOString(),
        filename: input.filename,
        pageCount: data.numpages,
      },
    };
  }
}
