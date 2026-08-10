import type { Extractor, MimeResult } from './types.js';
import { PdfExtractor } from './extractors/pdf.js';
import { SpreadsheetExtractor } from './extractors/spreadsheet.js';
import { ImageExtractor } from './extractors/image.js';
import { CodeExtractor } from './extractors/code.js';
import { PlainTextExtractor } from './extractors/plain-text.js';

const extractors: Extractor[] = [
  new PdfExtractor(),
  new SpreadsheetExtractor(),
  new ImageExtractor(),
  new CodeExtractor(),
  new PlainTextExtractor(), // Fallback — handles any text
];

/**
 * Returns the appropriate extractor for a given MIME result.
 * Returns undefined if no extractor can handle the file type.
 */
export function createExtractor(mimeResult: MimeResult): Extractor | undefined {
  return extractors.find(e => e.canHandle(mimeResult.mime));
}
