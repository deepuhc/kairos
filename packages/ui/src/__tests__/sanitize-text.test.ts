import { describe, it, expect } from 'vitest';
import { stripControlChars, stripAnsi, cleanTerminalText } from '../services/sanitize-text.js';

describe('stripControlChars', () => {
  it('removes glyphless C0 controls that render as tofu boxes', () => {
    expect(stripControlChars('a\x00b\x07c\x08d\x1be\x0bf\x0cg')).toBe('abcdefg');
  });

  it('keeps tab, newline, and carriage return for layout', () => {
    expect(stripControlChars('a\tb\nc\rd')).toBe('a\tb\nc\rd');
  });

  it('removes DEL and a C1 control', () => {
    expect(stripControlChars('x\x7fy\x9bz')).toBe('xyz');
  });

  it('removes bidirectional overrides and the BOM', () => {
    expect(stripControlChars('a‮b⁦c﻿d')).toBe('abcd');
  });

  it('keeps zero-width joiners so emoji ligatures and ZWNJ scripts survive', () => {
    const family = '👨‍👩‍👧';
    expect(stripControlChars(family)).toBe(family);
    expect(stripControlChars('a‌b')).toBe('a‌b');
  });

  it('leaves CJK and accented text untouched', () => {
    expect(stripControlChars('café — 日本語')).toBe('café — 日本語');
  });

  it('reproduces the reported bug: control chars in a bash command', () => {
    expect(stripControlChars('echo\x00 "highest z-index"\x01; rg -rn')).toBe('echo "highest z-index"; rg -rn');
  });

  it('is idempotent', () => {
    const dirty = 'a\x00b\x1bc‮d';
    expect(stripControlChars(stripControlChars(dirty))).toBe(stripControlChars(dirty));
  });
});

describe('stripAnsi', () => {
  it('removes SGR color sequences', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red');
  });

  it('removes cursor / other CSI sequences', () => {
    expect(stripAnsi('\x1b[2J\x1b[1;1Hhi')).toBe('hi');
  });

  it('removes OSC sequences', () => {
    expect(stripAnsi('\x1b]0;my title\x07text')).toBe('text');
  });

  it('leaves a plain bracket expression untouched', () => {
    expect(stripAnsi('arr[0]')).toBe('arr[0]');
  });
});

describe('cleanTerminalText', () => {
  it('strips ANSI before residual controls (order matters)', () => {
    expect(cleanTerminalText('\x1b[31mred\x1b[0m')).toBe('red');
  });

  it('removes controls while keeping newlines', () => {
    expect(cleanTerminalText('ls\x1b[0m\ndir\x08\x08')).toBe('ls\ndir');
  });
});
