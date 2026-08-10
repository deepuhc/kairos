declare module 'file-type' {
  export function fileTypeFromBuffer(buffer: Uint8Array | ArrayBuffer): Promise<{ ext: string; mime: string } | undefined>;
}

declare module 'pdf-parse' {
  interface PdfData {
    numpages: number;
    text: string;
    info: Record<string, unknown>;
  }
  export default function parse(buffer: Buffer): Promise<PdfData>;
}

declare module 'xlsx' {
  export function read(data: Buffer, opts?: { type?: string }): Workbook;
  export interface Workbook {
    SheetNames: string[];
    Sheets: Record<string, Worksheet>;
  }
  export interface Worksheet {
    [cell: string]: { v?: unknown; t?: string } | unknown;
    '!ref'?: string;
  }
  export const utils: {
    sheet_to_json<T = unknown>(sheet: Worksheet, opts?: { header?: number | string }): T[];
  };
}
