import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const toolCallSource = readFileSync(path.join(__dirname, '..', 'components', 'agents-tool-call.ts'), 'utf8');
const reviewSource = readFileSync(path.join(__dirname, '..', 'components', 'agents-review.ts'), 'utf8');

describe('diff resize rendering', () => {
  it('keeps tool-call resize observation reactive only at the split breakpoint', () => {
    expect(toolCallSource).toContain('@state() private fitsSplit = true;');
    expect(toolCallSource).not.toContain('@state() private cardWidth');
    expect(toolCallSource).toContain('const nextFits = w >= SIDE_BY_SIDE_MIN_WIDTH;');
    expect(toolCallSource).toContain('if (nextFits !== this.fitsSplit) this.fitsSplit = nextFits;');
    expect(toolCallSource).toContain('const split = wantSplit && this.fitsSplit && !!d.oldText;');
  });

  it('keeps collapsed inline diff cards cheap', () => {
    const collapsedSummaryStart = toolCallSource.indexOf('private collapsedSummary');
    const collapsedSummaryEnd = toolCallSource.indexOf('  // Compact status', collapsedSummaryStart);
    const collapsedSummary = toolCallSource.slice(collapsedSummaryStart, collapsedSummaryEnd);

    expect(toolCallSource).toContain('Diff bodies default collapsed.');
    expect(collapsedSummary).toContain("return 'diff hidden';");
    expect(collapsedSummary).not.toContain('this.computeDiff');
    expect(collapsedSummary).not.toContain('diffStats');
  });

  it('starts the review diff unified and uses cached line highlighting', () => {
    expect(reviewSource).toContain('@state() private fitsSplit = false;');
    expect(reviewSource).not.toContain('@state() private cardWidth');
    expect(reviewSource).toContain('const nextFits = w >= SIDE_BY_SIDE_MIN_WIDTH;');
    expect(reviewSource).toContain('if (nextFits !== this.fitsSplit) this.fitsSplit = nextFits;');
    expect(reviewSource).toContain('highlightLine(text, lang)');
    expect(reviewSource).toContain('reviewGitDiffCache');
    expect(reviewSource).toContain('private computeDiff(oldText: string, newText: string, collapse: boolean)');
  });

  it('does not render a review diff until a file is selected and caps large previews', () => {
    expect(reviewSource).toContain('const REVIEW_DIFF_ROW_PREVIEW_LIMIT = 800;');
    expect(reviewSource).toContain('Opening the Review panel should be cheap even');
    expect(reviewSource).toContain('this.selectedPath = null;');
    expect(reviewSource).toContain('Select a file to render its diff.');
    expect(reviewSource).toContain('const previewingLargeDiff = !fullDiff && shownRows.length > REVIEW_DIFF_ROW_PREVIEW_LIMIT;');
    expect(reviewSource).toContain('shownRows.slice(0, REVIEW_DIFF_ROW_PREVIEW_LIMIT)');
    expect(reviewSource).toContain('Show full diff');
  });
});
