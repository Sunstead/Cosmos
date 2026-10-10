import { describe, expect, it } from 'vitest';
import { mergeByTime, prepareLine } from './log-view';

const at = (ts: string | null, text = ts ?? '') => prepareLine({ stream: 'stdout', ts, text });

describe('prepareLine', () => {
  it('works out what a row and the filter need, once', () => {
    const l = prepareLine({ stream: 'stdout', ts: '2026-10-10T20:08:18.123456789Z', text: '\x1b[31mERROR\x1b[0m Disk' }, 'n1');
    expect(l.node).toBe('n1');
    expect(l.search).toBe('error disk');
    expect(l.ms).toBe(Date.parse('2026-10-10T20:08:18.123Z'));
    expect(l.ns).toBe(456789);
    expect(l.structured).toBeNull();
  });

  it('gives every line its own ID', () => {
    expect(at('a').id).not.toBe(at('a').id);
  });

  it('takes a JSON line\'s level from its own field', () => {
    expect(at(null, '{"level":"info","msg":"retrying after error"}').level).toBeNull();
    expect(at(null, '{"level":"error","msg":"x"}').level).toBe('error');
  });
});

describe('mergeByTime', () => {
  it('appends lines that come in order', () => {
    const older = [at('2026-10-10T00:00:01Z'), at('2026-10-10T00:00:02Z')];
    const newer = [at('2026-10-10T00:00:03Z')];
    expect(mergeByTime(older, newer).map((l) => l.ts)).toEqual([
      '2026-10-10T00:00:01Z',
      '2026-10-10T00:00:02Z',
      '2026-10-10T00:00:03Z',
    ]);
  });

  it('slots in a late batch from a slower node', () => {
    const older = [at('2026-10-10T00:00:01Z'), at('2026-10-10T00:00:03Z'), at('2026-10-10T00:00:05Z')];
    const newer = [at('2026-10-10T00:00:02Z'), at('2026-10-10T00:00:04Z')];
    expect(mergeByTime(older, newer).map((l) => l.ts!.slice(17, 19))).toEqual(['01', '02', '03', '04', '05']);
  });

  it('orders within a second by the fraction, past the millisecond', () => {
    const older = [at('2026-10-10T00:00:01.0001Z', 'a'), at('2026-10-10T00:00:01.12Z', 'c')];
    const newer = [at('2026-10-10T00:00:01.00015Z', 'b')];
    expect(mergeByTime(older, newer).map((l) => l.text)).toEqual(['a', 'b', 'c']);
  });

  it('keeps a line already shown ahead of a new one at the same time', () => {
    const older = [at('2026-10-10T00:00:01Z', 'shown'), at('2026-10-10T00:00:02Z', 'later')];
    const newer = [at('2026-10-10T00:00:01Z', 'new')];
    expect(mergeByTime(older, newer).map((l) => l.text)).toEqual(['shown', 'new', 'later']);
  });
});
