/**
 * Reading a container log line: how severe it is and when it was written.
 *
 * Severity comes from the text, never the stream. Plenty of software writes
 * everything to stderr (nginx, Postgres, Python's `logging`, Go's `log`), so
 * colouring stderr red turned whole, healthy logs red.
 */

export type LogLevel = 'error' | 'warn';

const ERROR_WORDS = 'error|err|fatal|panic|crit|critical|alert|emerg|emergency|severe';
const WARN_WORDS = 'warn|warning';

const IS_ERROR = new RegExp(`^(?:${ERROR_WORDS})$`, 'i');
const IS_WARN = new RegExp(`^(?:${WARN_WORDS})$`, 'i');

const classify = (word: string): LogLevel | null =>
  IS_ERROR.test(word) ? 'error' : IS_WARN.test(word) ? 'warn' : null;

/** `level=error`, `"level":"warn"`, `severity: CRITICAL`, `lvl=err`. */
const STRUCTURED = /\b(?:level|lvl|severity)"?\s*[=:]\s*"?([a-z]+)/i;
/** `[error]`, `[warn]`: nginx, Apache and many others. */
const BRACKETED = new RegExp(`\\[(${ERROR_WORDS}|${WARN_WORDS})\\]`, 'i');
/**
 * A bare level word, upper case only, standing alone: `ERROR could not`,
 * `FATAL:`. Lower case is left out so prose like "0 errors" stays plain.
 */
const BARE = /(?:^|[\s|:[(])(ERROR|ERR|FATAL|PANIC|CRITICAL|CRIT|EMERG|ALERT|SEVERE|WARN|WARNING)(?=[\s|:\])]|$)/;
/** Crash output with no level word at all. */
const CRASH = /^(?:panic:|fatal error:|Traceback \(most recent call last\)|Exception in thread )/;

/**
 * The line's severity when it states one, else null. Lines that carry their
 * own ANSI colours are left to them.
 */
export function logLevel(text: string): LogLevel | null {
  if (text.includes('\x1b')) return null;

  // A structured level is authoritative: `level=info msg="retrying after
  // error"` is info.
  const structured = STRUCTURED.exec(text);
  if (structured) return classify(structured[1]);

  const bracketed = BRACKETED.exec(text);
  if (bracketed) return classify(bracketed[1]);

  const bare = BARE.exec(text);
  if (bare) return classify(bare[1]);

  return CRASH.test(text) ? 'error' : null;
}

// --- timestamps --------------------------------------------------------------

/**
 * Docker writes RFC3339 in UTC with up to nine fraction digits, trailing
 * zeros trimmed. `Date.parse` only promises three digits (WebKit has rejected
 * more), so the fraction is cut to milliseconds first.
 */
const RFC3339 = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

/** Epoch milliseconds, or null for anything that isn't a Docker timestamp. */
export function parseLogTime(ts: string | null | undefined): number | null {
  const m = ts ? RFC3339.exec(ts) : null;
  if (!m) return null;
  const ms = (m[2] ?? '').slice(0, 3).padEnd(3, '0');
  const t = Date.parse(`${m[1]}.${ms}${m[3]}`);
  return Number.isFinite(t) ? t : null;
}

/** Nanoseconds within the second, for ordering lines closer than a millisecond apart. */
function fractionNanos(ts: string): number {
  const m = RFC3339.exec(ts);
  return m ? Number((m[2] ?? '').slice(0, 9).padEnd(9, '0')) : 0;
}

/**
 * Orders Docker timestamps by value. As text they misorder (`.1Z` sorts after
 * `.12Z`). Missing timestamps sort first, keeping arrival order under a
 * stable sort.
 */
export function compareLogTime(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return (a ? 1 : 0) - (b ? 1 : 0);
  const secs = a.slice(0, 19).localeCompare(b.slice(0, 19));
  return secs !== 0 ? secs : fractionNanos(a) - fractionNanos(b);
}

// Built once per locale: a log view formats thousands of these.
const formatters = new Map<string, { time: Intl.DateTimeFormat; date: Intl.DateTimeFormat; full: Intl.DateTimeFormat }>();

function formattersFor(locale?: string) {
  const key = locale ?? '';
  let f = formatters.get(key);
  if (!f) {
    f = {
      time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      date: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }),
      full: new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'long',
      }),
    };
    formatters.set(key, f);
  }
  return f;
}

const sameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * The viewer's local clock time, in their locale's 12 or 24 hour style, with
 * the date in front when the line isn't from today. Null when unparseable.
 */
export function formatLogTime(ts: string | null | undefined, now = Date.now(), locale?: string): string | null {
  const t = parseLogTime(ts);
  if (t === null) return null;
  const f = formattersFor(locale);
  const d = new Date(t);
  const time = f.time.format(d);
  return sameLocalDay(d, new Date(now)) ? time : `${f.date.format(d)} ${time}`;
}

/** Full local date and time with the zone, for a tooltip. */
export function formatLogTimeFull(ts: string | null | undefined, locale?: string): string | undefined {
  const t = parseLogTime(ts);
  return t === null ? undefined : formattersFor(locale).full.format(new Date(t));
}

// --- container tags ----------------------------------------------------------

/**
 * Tag colours for the all-containers view, from the themed ANSI palette.
 * Red and its bright twin are left out so a tag never reads as an error.
 */
const TAG_COLORS = [2, 3, 4, 5, 6, 10, 11, 12, 13, 14].map((n) => `var(--ansi-${n})`);

/** Stable per name, so a container keeps its colour across sessions. */
export function containerColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) | 0;
  return TAG_COLORS[Math.abs(h) % TAG_COLORS.length];
}
