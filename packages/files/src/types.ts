/** Result of MIME type detection */
export interface MimeResult {
  mime: string;
  ext: string;
  category: FileCategory;
}

export type FileCategory =
  | 'document'    // PDF, DOCX, etc.
  | 'spreadsheet' // XLSX, CSV, etc.
  | 'image'       // PNG, JPG, SVG, etc.
  | 'audio'       // MP3, WAV, etc.
  | 'video'       // MP4, MOV, etc.
  | 'code'        // .ts, .py, .rs, etc.
  | 'text'        // .txt, .md, .json, etc.
  | 'archive'     // .zip, .tar.gz, etc.
  | 'unknown';

/** Base interface for all file extractors */
export interface Extractor {
  readonly name: string;
  readonly supportedMimes: string[];

  canHandle(mime: string): boolean;
  extract(input: ExtractorInput): Promise<ExtractionResult>;
}

export interface ExtractorInput {
  buffer: Buffer;
  mime: string;
  filename?: string;
}

/** Result of file extraction */
export interface ExtractionResult {
  content: TextContent | StructuredData;
  preview?: Preview;
  metadata: FileMetadata;
}

/** Plain extracted text */
export interface TextContent {
  type: 'text';
  text: string;
  pages?: number; // For multi-page documents
}

/** Structured tabular data */
export interface StructuredData {
  type: 'structured';
  sheets: Sheet[];
}

export interface Sheet {
  name: string;
  headers: string[];
  rows: string[][];
  rowCount: number;
  colCount: number;
}

/** Preview information */
export interface Preview {
  type: 'thumbnail' | 'table' | 'text-snippet' | 'waveform';
  /** Base64-encoded thumbnail or first few rows/lines */
  data: string;
  width?: number;
  height?: number;
}

export interface FileMetadata {
  filename?: string;
  mime: string;
  size: number;
  extractedAt: string;
  pageCount?: number;
  sheetCount?: number;
  duration?: number; // For audio/video
}
