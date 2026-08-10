import type { Extractor, ExtractorInput, ExtractionResult, Sheet } from '../types.js';

export class SpreadsheetExtractor implements Extractor {
  readonly name = 'spreadsheet';
  readonly supportedMimes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
  ];

  canHandle(mime: string): boolean {
    return this.supportedMimes.includes(mime) || mime === 'text/csv';
  }

  async extract(input: ExtractorInput): Promise<ExtractionResult> {
    if (input.mime === 'text/csv') {
      return this.extractCsv(input);
    }
    return this.extractXlsx(input);
  }

  private async extractCsv(input: ExtractorInput): Promise<ExtractionResult> {
    const text = input.buffer.toString('utf-8');
    const lines = text.split('\n').filter(l => l.trim());
    const headers = lines[0]?.split(',').map(h => h.trim().replace(/^"|"$/g, '')) ?? [];
    const rows = lines.slice(1).map(line =>
      line.split(',').map(cell => cell.trim().replace(/^"|"$/g, ''))
    );

    const sheet: Sheet = { name: 'Sheet1', headers, rows, rowCount: rows.length, colCount: headers.length };
    return {
      content: { type: 'structured', sheets: [sheet] },
      preview: { type: 'table', data: JSON.stringify({ headers, rows: rows.slice(0, 5) }) },
      metadata: {
        mime: input.mime,
        size: input.buffer.length,
        extractedAt: new Date().toISOString(),
        filename: input.filename,
        sheetCount: 1,
      },
    };
  }

  private async extractXlsx(input: ExtractorInput): Promise<ExtractionResult> {
    let XLSX: any;
    try {
      XLSX = await import('xlsx');
    } catch {
      return {
        content: { type: 'text', text: '[Excel extraction unavailable — install xlsx]' },
        metadata: { mime: input.mime, size: input.buffer.length, extractedAt: new Date().toISOString(), filename: input.filename },
      };
    }

    const workbook = XLSX.read(input.buffer, { type: 'buffer' });
    const sheets: Sheet[] = workbook.SheetNames.map((name: string) => {
      const ws = workbook.Sheets[name];
      const jsonData: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
      const headers = jsonData[0]?.map(String) ?? [];
      const rows = jsonData.slice(1).map((row: any[]) => row.map(String));
      return { name, headers, rows, rowCount: rows.length, colCount: headers.length };
    });

    return {
      content: { type: 'structured', sheets },
      preview: { type: 'table', data: JSON.stringify({ headers: sheets[0]?.headers ?? [], rows: sheets[0]?.rows.slice(0, 5) ?? [] }) },
      metadata: {
        mime: input.mime,
        size: input.buffer.length,
        extractedAt: new Date().toISOString(),
        filename: input.filename,
        sheetCount: sheets.length,
      },
    };
  }
}
