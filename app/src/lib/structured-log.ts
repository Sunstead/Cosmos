/**
 * JSON log lines, read for people: a one-line summary (the message, or
 * `GET /path 200 9ms` for an access log, then the other fields as
 * `key=value`) and every field for when the line is opened.
 *
 * Pure: the log view parses each line once, when it arrives.
 */

import type { LogLevel } from './log-line';

export interface StructuredLog {
  level: LogLevel | null;
  /** What happened, in a few words. */
  message: string;
  /** The rest, as `key=value` text, in the line's own order. */
  fields: [key: string, value: string][];
  /** Every field, for the expanded view. */
  object: Record<string, unknown>;
}

const LEVEL_KEYS = ['level', 'lvl', 'severity', 'levelname'];
const MESSAGE_KEYS = ['msg', 'message', 'event', 'error', 'err'];
/** Left out of the summary; still there when the line is opened. */
const NOISE = new Set([
  'time',
  'timestamp',
  'ts',
  '@timestamp',
  'datetime',
  'filename',
  'line_number',
  'line',
  'caller',
  'source',
  'pid',
  'thread_id',
  'thread_name',
  'target',
  'spans',
  'logger',
  'hostname',
  'v',
]);

const ERROR_LEVEL = /^(?:error|err|fatal|panic|crit|critical|alert|emerg|emergency|severe)$/i;
const WARN_LEVEL = /^(?:warn|warning)$/i;

function levelOf(value: unknown): LogLevel | null {
  // pino and bunyan: 40 warn, 50 error, 60 fatal.
  if (typeof value === 'number') return value >= 50 ? 'error' : value >= 40 ? 'warn' : null;
  if (typeof value !== 'string') return null;
  return ERROR_LEVEL.test(value) ? 'error' : WARN_LEVEL.test(value) ? 'warn' : null;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const scalar = (v: unknown): string | null =>
  typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null;

// --- access logs -------------------------------------------------------------

const DURATION_KEYS = ['duration', 'latency', 'elapsed', 'took', 'runtime', 'response_time'];

/** A duration as people read it: `0.4ms`, `9ms`, `1.2s`. */
export function formatDuration(ms: number): string {
  if (ms < 1) return `${Number(ms.toFixed(1))}ms`;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${Number((ms / 1000).toFixed(1))}s`;
}

/**
 * Milliseconds from a duration field. The unit comes from the key's suffix;
 * a bare number is milliseconds (OpenCloud, Authentik) unless it's a huge
 * integer (Go's nanoseconds), or the line is Caddy's (seconds).
 */
function durationMs(key: string, value: unknown, seconds: boolean): number | null {
  if (typeof value === 'string' && /\d(?:ns|µs|us|ms|s)$/.test(value)) return null; // already readable
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  const k = key.toLowerCase();
  if (/(?:_|^)ns$|nanos/.test(k)) return n / 1e6;
  if (/(?:_|^)(?:us|micros)$/.test(k)) return n / 1e3;
  if (/(?:_|^)ms$|millis/.test(k)) return n;
  if (/(?:_|^)(?:s|sec|secs|seconds)$/.test(k) || seconds) return n * 1000;
  if (Number.isInteger(n) && n >= 1e6) return n / 1e6;
  return n;
}

interface Http {
  text: string;
  used: string[];
}

/** `GET /path 200 9ms` when the line is an HTTP request. */
function httpSummary(o: Record<string, unknown>): Http | null {
  // Caddy nests the request; its duration is in seconds.
  const request = isObject(o.request) ? o.request : null;
  const method = scalar(o.method) ?? (request && scalar(request.method));
  const path =
    scalar(o.path) ?? scalar(o.uri) ?? scalar(o.url) ?? (request && (scalar(request.uri) ?? scalar(request.path)));
  const status = scalar(o.status) ?? scalar(o.status_code) ?? scalar(o.statusCode);
  if (!method || !path || !status) return null;

  const used = ['method', 'path', 'uri', 'url', 'status', 'status_code', 'statusCode'];
  if (request) used.push('request');
  const parts = [method, path, status];
  const key = Object.keys(o).find((k) => DURATION_KEYS.some((d) => k.toLowerCase().startsWith(d)));
  if (key) {
    const raw = o[key];
    const ms = durationMs(key, raw, !!request);
    const text = ms !== null ? formatDuration(ms) : scalar(raw);
    if (text) {
      parts.push(text);
      used.push(key);
    }
  }
  return { text: parts.join(' '), used };
}

// --- the line ----------------------------------------------------------------

function fieldText(value: unknown): string | null {
  const s = scalar(value);
  if (s !== null) return s === '' ? null : /\s/.test(s) ? JSON.stringify(s) : s;
  // Nested values are for the expanded view; the summary says they're there.
  if (Array.isArray(value)) return value.length ? '[…]' : null;
  if (isObject(value)) return Object.keys(value).length ? '{…}' : null;
  return null;
}

/**
 * A JSON object log line, read; null for anything else (plain text, arrays,
 * broken JSON). `text` is the line without its ANSI escapes.
 */
export function parseStructured(text: string): StructuredLog | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  let object: unknown;
  try {
    object = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isObject(object)) return null;

  const levelKey = LEVEL_KEYS.find((k) => k in object);
  const level = levelKey ? levelOf(object[levelKey]) : null;
  const used = new Set<string>(levelKey ? [levelKey] : []);

  const http = httpSummary(object);
  let message: string;
  if (http) {
    message = http.text;
    for (const k of http.used) used.add(k);
  } else {
    const key = MESSAGE_KEYS.find((k) => typeof object[k] === 'string' && object[k] !== '');
    message = key ? (object[key] as string) : '';
    if (key) used.add(key);
  }

  const fields: [string, string][] = [];
  for (const [key, value] of Object.entries(object)) {
    if (used.has(key) || NOISE.has(key)) continue;
    // Authentik repeats its path as the event.
    if (http && value === scalar(object.path)) continue;
    const text = fieldText(value);
    if (text !== null) fields.push([key, text]);
  }
  return { level, message, fields, object };
}
