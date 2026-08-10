import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// Guards against the class of bug where a Lit `html`/`svg` template contains a
// malformed opening tag — e.g. `<` where `<a` was intended (see git 3d8f747).
// Neither `tsc` nor `vite build` catches it: the stray `<` is valid TypeScript
// inside a template literal, and Vite never parses the HTML, so it only crashes
// when the browser parses the markup and Lit binds a directive into the wrong
// part (`part.element` undefined → `hasAttribute` throws at render time).
//
// We reproduce what the browser sees by extracting the *static* text spans of
// every html/svg tagged template (the literal chunks between `${}` bindings)
// and scanning them for the fingerprint. Working off the parsed AST means TS
// code like generics or `a < b` comparisons can never be mistaken for markup.

const SRC_DIR = path.join(__dirname, '..');

// A `<` followed by whitespace and then an attribute (`name=`) — a tag that lost
// its name, like the `<\n class="feedback-link"` regression.
const NAMELESS_TAG_WITH_ATTR = /<[ \t\r\n]+[a-zA-Z][a-zA-Z0-9-]*\s*=/;
// A `<` followed by whitespace and then `>` — a tag that lost its name entirely.
const NAMELESS_EMPTY_TAG = /<[ \t\r\n]+>/;

interface Finding {
  file: string;
  line: number;
  snippet: string;
}

/** The literal spans of an html/svg tagged template, with source positions. */
function htmlTemplateSpans(source: string, fileName: string): Array<{ text: string; start: number }> {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const spans: Array<{ text: string; start: number }> = [];

  const visit = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag)) {
      const tag = node.tag.text;
      if (tag === 'html' || tag === 'svg') {
        const tpl = node.template;
        if (ts.isNoSubstitutionTemplateLiteral(tpl)) {
          spans.push({ text: tpl.text, start: tpl.getStart(sf) });
        } else {
          spans.push({ text: tpl.head.text, start: tpl.head.getStart(sf) });
          for (const span of tpl.templateSpans) {
            spans.push({ text: span.literal.text, start: span.literal.getStart(sf) });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return spans;
}

function findMalformedTags(source: string, fileName: string): Finding[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const findings: Finding[] = [];

  for (const span of htmlTemplateSpans(source, fileName)) {
    for (const re of [NAMELESS_TAG_WITH_ATTR, NAMELESS_EMPTY_TAG]) {
      const m = re.exec(span.text);
      if (!m) continue;
      const pos = span.start + m.index;
      const { line } = sf.getLineAndCharacterOfPosition(pos);
      findings.push({
        file: fileName,
        line: line + 1,
        snippet: span.text.slice(m.index, m.index + 40).replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return findings;
}

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...collectTsFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('html template markup', () => {
  it('has no malformed opening tags in any src html/svg template', () => {
    const findings = collectTsFiles(SRC_DIR).flatMap((file) =>
      findMalformedTags(readFileSync(file, 'utf8'), file),
    );
    const report = findings
      .map((f) => `  ${path.relative(SRC_DIR, f.file)}:${f.line} — "${f.snippet}"`)
      .join('\n');
    expect(findings, `Malformed tag(s) found:\n${report}`).toEqual([]);
  });

  it('flags a nameless tag that kept its attributes', () => {
    const bad = 'const t = html`<button>x</button><\n  class="foo"\n  ${d()}\n>y</a>`;';
    expect(findMalformedTags(bad, 'bad.ts')).toHaveLength(1);
  });

  it('flags a nameless empty tag', () => {
    expect(findMalformedTags('html`<  >`;', 'bad.ts')).toHaveLength(1);
  });

  it('passes the corrected markup', () => {
    const good = 'const t = html`<button>x</button><a\n  class="foo"\n  ${d()}\n>y</a>`;';
    expect(findMalformedTags(good, 'good.ts')).toEqual([]);
  });

  it('does not flag TS comparisons or generics outside templates', () => {
    const code = 'const a = x < y; const b: Map<string, number> = new Map(); if (a < b) {}';
    expect(findMalformedTags(code, 'code.ts')).toEqual([]);
  });

  it('does not flag a literal `<` comparison rendered as template text', () => {
    const code = 'html`<span>${a} < ${b} is ${a < b}</span>`;';
    expect(findMalformedTags(code, 'text.ts')).toEqual([]);
  });
});
