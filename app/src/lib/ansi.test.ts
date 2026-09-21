import { describe, expect, it } from 'vitest';
import { parseAnsi, stripAnsi } from './ansi';

const ESC = '\x1b';

describe('ansi', () => {
  it('passes plain text through as one segment', () => {
    expect(parseAnsi('hello')).toEqual([{ text: 'hello', style: {} }]);
    expect(parseAnsi('')).toEqual([]);
  });

  it('maps basic and bright colours to theme tokens', () => {
    expect(parseAnsi(`${ESC}[31merr${ESC}[0m ok`)).toEqual([
      { text: 'err', style: { fg: 'var(--ansi-1)' } },
      { text: ' ok', style: {} },
    ]);
    expect(parseAnsi(`${ESC}[1;92mup`)[0].style).toEqual({ bold: true, fg: 'var(--ansi-10)' });
  });

  it('handles the tracing-style dim and italic codes seen in agent logs', () => {
    const segs = parseAnsi(`${ESC}[2m2026-09-21T17:58:12Z${ESC}[0m ${ESC}[32m INFO${ESC}[0m ${ESC}[3mnode${ESC}[0m=jupiter`);
    expect(segs.map((s) => s.text).join('')).toBe('2026-09-21T17:58:12Z  INFO node=jupiter');
    expect(segs[0].style).toEqual({ dim: true });
    expect(segs.find((s) => s.text === ' INFO')?.style).toEqual({ fg: 'var(--ansi-2)' });
  });

  it('supports 256-colour and truecolour', () => {
    expect(parseAnsi(`${ESC}[38;5;196mx`)[0].style.fg).toBe('rgb(255 0 0)');
    expect(parseAnsi(`${ESC}[38;5;9mx`)[0].style.fg).toBe('var(--ansi-9)');
    expect(parseAnsi(`${ESC}[38;2;10;20;30mx`)[0].style.fg).toBe('rgb(10 20 30)');
    expect(parseAnsi(`${ESC}[48;5;244mx`)[0].style.bg).toBe('rgb(128 128 128)');
  });

  it('resets individual attributes', () => {
    const segs = parseAnsi(`${ESC}[1;31ma${ESC}[22mb${ESC}[39mc`);
    expect(segs.map((s) => s.style)).toEqual([
      { bold: true, fg: 'var(--ansi-1)' },
      { bold: false, dim: false, fg: 'var(--ansi-1)' },
      { bold: false, dim: false, fg: undefined },
    ]);
  });

  it('drops cursor moves, OSC titles, NULs and other controls', () => {
    const line = `\x00a${ESC}[2K${ESC}[1Gb${ESC}]0;title\x07c\rd\te\x7f`;
    expect(stripAnsi(line)).toBe('abcd\te');
    expect(parseAnsi(line).map((s) => s.text).join('')).toBe('abcd\te');
  });
});
