import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { icon } from './icons.js';
import {
  extractFile,
  extractErrorLabel,
  formatBytes,
  FileExtractError,
  type ExtractionResult,
  type ImageAnalysis,
} from '../services/file-extract.js';

// Drag-drop (or click-to-browse) file upload that runs the file through the
// server's extraction pipeline (POST /api/files/extract) and renders a preview
// — a text snippet, a table for spreadsheets/CSV, or a metadata card. Text
// extraction runs on the server, locally. Images are additionally described by
// a vision model, which may be a CLOUD provider when no local one is configured
// — so we surface the analyzing model with the result rather than implying the
// image stayed on-device.
//
// Emits a `file-extracted` CustomEvent (bubbling, composed) with the
// ExtractionResult so a host view can consume it (e.g. attach to a prompt).

type Status = 'idle' | 'extracting' | 'done' | 'error';

@customElement('kairos-file-drop')
export class KairosFileDrop extends LitElement {
  @state() private status: Status = 'idle';
  @state() private dragging = false;
  @state() private result: ExtractionResult | null = null;
  @state() private analysis: ImageAnalysis | null = null;
  @state() private error = '';
  @state() private currentName = '';

  static styles = css`
    :host { display: block; }

    .zone {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 40px 24px;
      border: 2px dashed var(--glass-border);
      border-radius: var(--radius-lg);
      background: var(--w5);
      color: var(--gray);
      text-align: center;
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .zone:hover {
      border-color: var(--accent-a35);
      background: var(--accent-a08, var(--accent-a15));
      color: var(--bright-white);
    }
    .zone.dragging {
      border-color: var(--accent);
      background: var(--accent-a15);
      color: var(--bright-white);
    }
    .zone:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    .zone-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--w6);
      color: var(--accent);
    }
    .zone-title { font-size: var(--font-size-md); font-weight: 600; color: var(--bright-white); }
    .zone-hint { font-size: var(--font-size-sm); color: var(--gray); }

    .hidden-input { display: none; }

    .status-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      border-radius: var(--radius);
      font-size: var(--font-size-sm);
    }
    .status-row.busy { background: var(--w5); color: var(--gray); }
    .status-row.err { background: var(--danger-a15, rgba(239,68,68,0.12)); color: var(--danger, #ef4444); }

    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid var(--accent-a35);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      flex-shrink: 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .result {
      margin-top: 4px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      overflow: hidden;
      background: var(--surface-raised);
    }
    .result-head {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--glass-border);
    }
    .result-head .fi { color: var(--accent); flex-shrink: 0; }
    .result-head .meta { flex: 1; min-width: 0; }
    .result-name {
      font-size: var(--font-size-md);
      font-weight: 600;
      color: var(--bright-white);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .result-sub { font-size: var(--font-size-xs); color: var(--gray); margin-top: 2px; }
    .clear-btn {
      border: none;
      background: none;
      color: var(--gray);
      cursor: pointer;
      padding: 4px;
      border-radius: var(--radius);
      display: inline-flex;
      transition: all var(--transition-fast);
    }
    .clear-btn:hover { color: var(--bright-white); background: var(--w6); }

    .thumb {
      display: flex;
      justify-content: center;
      padding: 14px;
      background: var(--w6);
      border-bottom: 1px solid var(--glass-border);
    }
    .thumb img {
      max-width: 100%;
      max-height: 320px;
      object-fit: contain;
      border-radius: var(--radius);
      /* Checkerboard so transparent PNGs read as transparent, not invisible. */
      background-image:
        linear-gradient(45deg, var(--w5) 25%, transparent 25%),
        linear-gradient(-45deg, var(--w5) 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, var(--w5) 75%),
        linear-gradient(-45deg, transparent 75%, var(--w5) 75%);
      background-size: 16px 16px;
      background-position: 0 0, 0 8px, 8px -8px, -8px 0;
    }

    /* Vision attribution — tells the user which model described the image and,
       critically, whether it ran locally or was sent to a cloud provider. */
    .attribution {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      font-size: var(--font-size-xs);
      border-bottom: 1px solid var(--glass-border);
      background: var(--w6);
      color: var(--gray);
    }
    .attribution .badge {
      font-weight: 600;
      padding: 1px 8px;
      border-radius: 999px;
      letter-spacing: 0.02em;
    }
    .attribution .badge.local { background: var(--success-a15, rgba(34,197,94,0.15)); color: var(--success, #22c55e); }
    .attribution .badge.cloud { background: var(--warning-a15, rgba(234,179,8,0.15)); color: var(--warning, #eab308); }
    .attribution .model { color: var(--bright-white); font-family: var(--font-mono, monospace); }

    .snippet {
      margin: 0;
      padding: 12px 14px;
      max-height: 260px;
      overflow: auto;
      font-family: var(--font-mono, monospace);
      font-size: var(--font-size-xs);
      line-height: 1.5;
      color: var(--bright-white);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .table-wrap { max-height: 300px; overflow: auto; }
    table { border-collapse: collapse; width: 100%; font-size: var(--font-size-xs); }
    th, td {
      padding: 6px 10px;
      text-align: left;
      border-bottom: 1px solid var(--glass-border);
      white-space: nowrap;
      color: var(--bright-white);
    }
    thead th {
      position: sticky;
      top: 0;
      background: var(--w6);
      color: var(--neutral-gray);
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    tbody tr:hover td { background: var(--w6); }
    .more-rows {
      padding: 8px 14px;
      font-size: var(--font-size-xs);
      color: var(--gray);
    }
  `;

  // How many spreadsheet rows to render before collapsing to a "+N more" note.
  private static readonly MAX_TABLE_ROWS = 50;

  private onZoneKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.openPicker();
    }
  }

  private openPicker() {
    const input = this.renderRoot.querySelector<HTMLInputElement>('.hidden-input');
    input?.click();
  }

  private onInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void this.handleFile(file);
    input.value = '';
  }

  private onDragOver(e: DragEvent) {
    e.preventDefault();
    if (!this.dragging) this.dragging = true;
  }

  private onDragLeave(e: DragEvent) {
    e.preventDefault();
    this.dragging = false;
  }

  private onDrop(e: DragEvent) {
    e.preventDefault();
    this.dragging = false;
    const dt = e.dataTransfer;
    if (!dt) return;
    let file: File | null = dt.files?.[0] ?? null;
    if (!file && dt.items?.length) {
      const item = Array.from(dt.items).find((it) => it.kind === 'file');
      file = item?.getAsFile() ?? null;
    }
    if (file) void this.handleFile(file);
  }

  private async handleFile(file: File) {
    this.currentName = file.name;
    this.status = 'extracting';
    this.error = '';
    this.result = null;
    this.analysis = null;
    try {
      const { result, analysis } = await extractFile(file);
      this.result = result;
      this.analysis = analysis ?? null;
      this.status = 'done';
      this.dispatchEvent(
        new CustomEvent('file-extracted', { detail: result, bubbles: true, composed: true }),
      );
    } catch (err) {
      const reason = err instanceof FileExtractError ? err.reason : 'extract';
      // Prefer the server's specific message; fall back to the reason label.
      this.error = err instanceof Error && err.message ? err.message : extractErrorLabel(reason);
      this.status = 'error';
    }
  }

  private clear() {
    this.status = 'idle';
    this.result = null;
    this.analysis = null;
    this.error = '';
    this.currentName = '';
  }

  private renderResult(result: ExtractionResult) {
    const { content, metadata } = result;
    const sub = `${metadata.mime} · ${formatBytes(metadata.size)}`;
    return html`
      <div class="result">
        <div class="result-head">
          <span class="fi">${icon.fileText(20)}</span>
          <div class="meta">
            <div class="result-name">${metadata.filename ?? this.currentName ?? 'file'}</div>
            <div class="result-sub">${sub}</div>
          </div>
          <button class="clear-btn" @click=${this.clear} aria-label="Clear">${icon.close(16)}</button>
        </div>
        ${this.renderThumbnail(result)}
        ${this.renderAttribution()}
        ${content.type === 'structured'
          ? this.renderTable(result)
          : html`<pre class="snippet">${this.snippetText(result)}</pre>`}
      </div>
    `;
  }

  // When an image was described by a vision model, show which one and whether it
  // ran locally or in the cloud — so "extracted" never quietly means "uploaded
  // to a third party".
  private renderAttribution() {
    const a = this.analysis;
    if (!a) return nothing;
    return html`
      <div class="attribution">
        <span class="badge ${a.isLocal ? 'local' : 'cloud'}">${a.isLocal ? 'Local' : 'Cloud'}</span>
        <span>Image described by <span class="model">${a.provider} · ${a.model}</span></span>
      </div>
    `;
  }

  // Images come back with a `thumbnail` preview carrying the raster base64. Show
  // it above the extracted text (which, for images, is the vision-model
  // description when a vision provider is configured, else a placeholder).
  private renderThumbnail(result: ExtractionResult) {
    const preview = result.preview;
    if (preview?.type !== 'thumbnail' || !preview.data) return nothing;
    const src = `data:${result.metadata.mime};base64,${preview.data}`;
    return html`<div class="thumb"><img src=${src} alt=${result.metadata.filename ?? 'uploaded image'} /></div>`;
  }

  // Show the extracted text, but cap it so a huge document doesn't blow out the
  // DOM — the preview snippet (if any) is a better-bounded summary.
  private snippetText(result: ExtractionResult): string {
    if (result.preview?.type === 'text-snippet' && result.preview.data) {
      return result.preview.data;
    }
    const text = result.content.type === 'text' ? result.content.text : '';
    return text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text;
  }

  private renderTable(result: ExtractionResult) {
    if (result.content.type !== 'structured') return nothing;
    const sheet = result.content.sheets[0];
    if (!sheet) return html`<div class="more-rows">No table data.</div>`;
    const max = KairosFileDrop.MAX_TABLE_ROWS;
    const rows = sheet.rows.slice(0, max);
    const hidden = sheet.rowCount - rows.length;
    return html`
      <div class="table-wrap">
        <table>
          <thead>
            <tr>${sheet.headers.map((h) => html`<th>${h}</th>`)}</tr>
          </thead>
          <tbody>
            ${rows.map((row) => html`<tr>${row.map((cell) => html`<td>${cell}</td>`)}</tr>`)}
          </tbody>
        </table>
      </div>
      ${hidden > 0 ? html`<div class="more-rows">+${hidden} more row${hidden === 1 ? '' : 's'}</div>` : nothing}
    `;
  }

  render() {
    return html`
      <input class="hidden-input" type="file" @change=${this.onInput} />

      ${this.status === 'done' && this.result
        ? this.renderResult(this.result)
        : html`
            <div
              class="zone ${this.dragging ? 'dragging' : ''}"
              role="button"
              tabindex="0"
              aria-label="Upload a file — drag and drop, or press Enter to browse"
              @click=${this.openPicker}
              @keydown=${this.onZoneKeydown}
              @dragover=${this.onDragOver}
              @dragleave=${this.onDragLeave}
              @drop=${this.onDrop}
            >
              <span class="zone-icon">${icon.upload(24)}</span>
              <div class="zone-title">
                ${this.dragging ? 'Drop to upload' : 'Drag a file here, or click to browse'}
              </div>
              <div class="zone-hint">Text, code, JSON, CSV and spreadsheets — up to 18 MB</div>
            </div>
          `}

      ${this.status === 'extracting'
        ? html`<div class="status-row busy"><span class="spinner"></span>Extracting ${this.currentName}…</div>`
        : nothing}
      ${this.status === 'error'
        ? html`<div class="status-row err">${icon.close(16)} ${this.error}</div>`
        : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'kairos-file-drop': KairosFileDrop;
  }
}
