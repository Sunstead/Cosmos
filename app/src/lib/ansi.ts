/**
 * ANSI escape handling for container logs. Colours map to the themed
 * `--ansi-N` tokens; every other escape and control character is dropped.
 */

export interface AnsiStyle {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface AnsiSegment {
  text: string;
  style: AnsiStyle;
}

// CSI (ESC [ ... final), OSC (ESC ] ... BEL/ST), and other two-byte escapes.
// eslint-disable-next-line no-control-regex -- matching escapes is the point
const ESCAPE = /\x1b(?:\[([0-9;:?]*)([@-~])|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[@-Z\\-_])/g;
// C0 controls and DEL, except tab. Includes the NULs some apps emit.
// eslint-disable-next-line no-control-regex -- matching controls is the point
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g;

const palette = (n: number) => `var(--ansi-${n})`;

/** xterm 256-colour cube and greyscale ramp; 0-15 use the theme. */
function color256(n: number): string | undefined {
  if (!Number.isInteger(n) || n < 0 || n > 255) return undefined;
  if (n < 16) return palette(n);
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `rgb(${v} ${v} ${v})`;
  }
  const i = n - 16;
  const level = (c: number) => (c === 0 ? 0 : 55 + c * 40);
  return `rgb(${level(Math.floor(i / 36))} ${level(Math.floor(i / 6) % 6)} ${level(i % 6)})`;
}

/** Applies one SGR parameter list to `style`, returning the new style. */
function applySgr(style: AnsiStyle, params: string): AnsiStyle {
  const codes = params === '' ? [0] : params.split(/[;:]/).map((p) => (p === '' ? 0 : Number(p)));
  let next = { ...style };
  for (let i = 0; i < codes.length; i += 1) {
    const c = codes[i];
    if (c === 0) next = {};
    else if (c === 1) next.bold = true;
    else if (c === 2) next.dim = true;
    else if (c === 3) next.italic = true;
    else if (c === 4) next.underline = true;
    else if (c === 22) next.bold = next.dim = false;
    else if (c === 23) next.italic = false;
    else if (c === 24) next.underline = false;
    else if (c >= 30 && c <= 37) next.fg = palette(c - 30);
    else if (c >= 90 && c <= 97) next.fg = palette(c - 90 + 8);
    else if (c === 39) next.fg = undefined;
    else if (c >= 40 && c <= 47) next.bg = palette(c - 40);
    else if (c >= 100 && c <= 107) next.bg = palette(c - 100 + 8);
    else if (c === 49) next.bg = undefined;
    else if (c === 38 || c === 48) {
      const key = c === 38 ? 'fg' : 'bg';
      if (codes[i + 1] === 5) {
        next[key] = color256(codes[i + 2]);
        i += 2;
      } else if (codes[i + 1] === 2) {
        const [r, g, b] = codes.slice(i + 2, i + 5);
        if ([r, g, b].every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) {
          next[key] = `rgb(${r} ${g} ${b})`;
        }
        i += 4;
      }
    }
  }
  return next;
}

/** Splits a line into styled segments. Plain text returns one segment. */
export function parseAnsi(line: string): AnsiSegment[] {
  if (!line.includes('\x1b')) {
    const text = line.replace(CONTROL, '');
    return text ? [{ text, style: {} }] : [];
  }

  const out: AnsiSegment[] = [];
  let style: AnsiStyle = {};
  let last = 0;
  const push = (raw: string) => {
    const text = raw.replace(CONTROL, '');
    if (!text) return;
    const prev = out[out.length - 1];
    if (prev && prev.style === style) prev.text += text;
    else out.push({ text, style });
  };

  for (const m of line.matchAll(ESCAPE)) {
    push(line.slice(last, m.index));
    last = m.index! + m[0].length;
    if (m[2] === 'm') style = applySgr(style, m[1] ?? '');
  }
  push(line.slice(last));
  return out;
}

/** Plain text, for search, copy and download. */
export function stripAnsi(line: string): string {
  return line.replace(ESCAPE, '').replace(CONTROL, '');
}
