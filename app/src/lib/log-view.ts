/**
 * Log lines prepared for the viewer, once, when they arrive: everything a
 * row or a filter needs is worked out here, so neither repeats regexes,
 * date parsing or JSON parsing on every render.
 */

import { LogLine } from '@/generated/LogLine';
import { stripAnsi } from './ansi';
import { formatLogTime, formatLogTimeFull, LogLevel, logLevel, parseLogTime } from './log-line';
import { parseStructured, StructuredLog } from './structured-log';

export interface ViewLine extends LogLine {
  /** Unique for the life of the page: the row's key. */
  id: number;
  /** The node it came from, when several nodes stream at once. */
  node?: string;
  level: LogLevel | null;
  /** Local clock time, and the full stamp for its tooltip. */
  time: string | null;
  timeFull: string | undefined;
  /** Lower-case text without ANSI escapes, for the filter. */
  search: string;
  /** Set when the line is a JSON object. */
  structured: StructuredLog | null;
  /** Epoch ms and the nanoseconds past it; lines without a time sort first. */
  ms: number;
  ns: number;
}

let nextId = 1;

const RFC3339_FRACTION = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/;

export function prepareLine(line: LogLine, node?: string, now = Date.now()): ViewLine {
  const plain = stripAnsi(line.text);
  const structured = parseStructured(plain);
  const t = parseLogTime(line.ts);
  const fraction = line.ts ? RFC3339_FRACTION.exec(line.ts)?.[1] : undefined;
  return {
    ...line,
    id: nextId++,
    ...(node === undefined ? {} : { node }),
    // A JSON line's own level wins; text coloured by its own ANSI escapes is left to them.
    level: structured ? structured.level : logLevel(line.text),
    time: formatLogTime(line.ts, now),
    timeFull: formatLogTimeFull(line.ts),
    search: plain.toLowerCase(),
    structured,
    ms: t ?? -Infinity,
    ns: fraction ? Number(fraction.slice(3, 9).padEnd(6, '0')) : 0,
  };
}

/** Oldest first; equal times keep their order. */
export function compareView(a: ViewLine, b: ViewLine): number {
  return a.ms !== b.ms ? (a.ms < b.ms ? -1 : 1) : a.ns - b.ns;
}

/**
 * `older` and `newer` each in order, merged into one. Lines mostly arrive
 * in order, so this is a copy plus a short walk: the common case, every new
 * line at or after the last, is a plain append.
 */
export function mergeByTime(older: ViewLine[], newer: ViewLine[]): ViewLine[] {
  if (newer.length === 0) return older;
  if (older.length === 0 || compareView(older[older.length - 1], newer[0]) <= 0) return older.concat(newer);
  const out = new Array<ViewLine>(older.length + newer.length);
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < older.length && j < newer.length) {
    // `<=` keeps a line already shown ahead of a new one at the same time.
    out[k++] = compareView(older[i], newer[j]) <= 0 ? older[i++] : newer[j++];
  }
  while (i < older.length) out[k++] = older[i++];
  while (j < newer.length) out[k++] = newer[j++];
  return out;
}
