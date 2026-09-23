import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compareLogTime, formatLogTime, logLevel, parseLogTime } from './log-line';

const ESC = '\x1b';

describe('logLevel', () => {
  it.each([
    ['2026-09-22 10:00:00 ERROR could not connect', 'error'],
    ['[error] upstream timed out', 'error'],
    ['level=error msg="boom"', 'error'],
    ['{"level":"error","msg":"boom"}', 'error'],
    ['{"severity":"CRITICAL"}', 'error'],
    ['FATAL: role "x" does not exist', 'error'],
    ['panic: runtime error: index out of range', 'error'],
    ['Traceback (most recent call last):', 'error'],
    ['2026/09/22 10:00:00 [emerg] 1#1: bind() failed', 'error'],
    ['WARN disk almost full', 'warn'],
    ['[warning] deprecated option', 'warn'],
    ['level=warn msg=slow', 'warn'],
    ['{"level":"warning"}', 'warn'],
  ])('%s is %s', (text, level) => {
    expect(logLevel(text)).toBe(level);
  });

  it.each([
    // Everyday output, including on stderr, stays uncoloured.
    '2026-09-22 10:00:00 INFO server started on :8080',
    'GET /health 200 1.2ms',
    '[notice] 1#1: using the "epoll" event method',
    'LOG:  database system is ready to accept connections',
    // Words that merely contain or mention the levels.
    'processed 0 errors in 3 files',
    'error_page 404 /404.html configured',
    'renamed TerrorBird to Bird',
    'no warnings',
    'level=info msg="retrying after error"',
  ])('%s has no level', (text) => {
    expect(logLevel(text)).toBeNull();
  });

  it('leaves lines alone that colour themselves', () => {
    expect(logLevel(`${ESC}[31mERROR${ESC}[0m boom`)).toBeNull();
  });
});

describe('log timestamps', () => {
  const saved = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'America/New_York';
  });
  afterEach(() => {
    process.env.TZ = saved;
  });

  it('parses Docker nanosecond timestamps, which Date alone may not', () => {
    expect(parseLogTime('2026-09-22T14:03:07.123456789Z')).toBe(Date.UTC(2026, 8, 22, 14, 3, 7, 123));
    expect(parseLogTime('2026-09-22T14:03:07Z')).toBe(Date.UTC(2026, 8, 22, 14, 3, 7));
    expect(parseLogTime('2026-09-22T14:03:07.5Z')).toBe(Date.UTC(2026, 8, 22, 14, 3, 7, 500));
    expect(parseLogTime('garbage')).toBeNull();
    expect(parseLogTime(null)).toBeNull();
  });

  it('shows local time, not the UTC digits', () => {
    const now = Date.UTC(2026, 8, 22, 18, 0);
    // 14:03 UTC is 10:03 in New York (EDT).
    expect(formatLogTime('2026-09-22T14:03:07.1Z', now, 'en-GB')).toBe('10:03:07');
  });

  it('adds the date when the line is not from today', () => {
    const now = Date.UTC(2026, 8, 22, 18, 0);
    expect(formatLogTime('2026-09-20T14:03:07Z', now, 'en-GB')).toBe('20 Sept 10:03:07');
  });

  it('follows the locale clock', () => {
    const now = Date.UTC(2026, 8, 22, 18, 0);
    expect(formatLogTime('2026-09-22T14:03:07Z', now, 'en-US')).toMatch(/^10:03:07\sAM$/);
  });

  it('orders by value, not text', () => {
    const ts = ['2026-09-22T14:03:07.12Z', '2026-09-22T14:03:07Z', '2026-09-22T14:03:07.1Z'];
    expect([...ts].sort(compareLogTime)).toEqual([
      '2026-09-22T14:03:07Z',
      '2026-09-22T14:03:07.1Z',
      '2026-09-22T14:03:07.12Z',
    ]);
  });
});
