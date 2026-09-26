import { describe, expect, it } from 'vitest';
import { autoNote, compareUnits, isRunning } from './updates';
import { UpdateUnit } from '@/generated/UpdateUnit';

function unit(name: string, partial: Partial<UpdateUnit> = {}): UpdateUnit {
  return {
    id: name,
    name,
    services: [name],
    images: [name],
    current: '1.0.0',
    available: null,
    patch: null,
    held: null,
    notes_url: null,
    policy: 'manual',
    paused: null,
    backup: false,
    blocked: null,
    run: null,
    previous: null,
    ...partial,
  };
}

const DAY = 86_400;

describe('updates', () => {
  it('puts what needs attention first', () => {
    const sorted = [
      unit('a'),
      unit('b', { available: { tag: '1.0.1', change: 'patch', first_seen: 0 } }),
      unit('c', { available: { tag: '2.0.0', change: 'major', first_seen: 0 } }),
      unit('d', {
        run: {
          id: 'r',
          unit: 'd',
          kind: 'update',
          from: '1',
          to: '2',
          by: 'pwb',
          state: 'watching',
          requested_at: 0,
          finished_at: null,
          run_url: null,
          detail: null,
        },
      }),
    ].sort(compareUnits);
    expect(sorted.map((u) => u.name)).toEqual(['d', 'c', 'b', 'a']);
    expect(isRunning(sorted[0].run)).toBe(true);
  });

  it('says when an automatic update will apply', () => {
    const patch = { tag: '1.0.1', change: 'patch' as const, first_seen: 0 };
    expect(autoNote(unit('a', { policy: 'patch', patch }), 3, 1 * DAY)).toBe(
      '1.0.1 applies automatically in 2 days, after a nightly backup',
    );
    expect(autoNote(unit('a', { policy: 'patch', patch }), 3, 4 * DAY)).toBe(
      '1.0.1 applies after the next nightly backup',
    );
    expect(autoNote(unit('a', { policy: 'manual', patch }), 3, 4 * DAY)).toBeNull();
    expect(
      autoNote(unit('a', { policy: 'auto', patch, paused: 'broke' }), 3, 4 * DAY),
    ).toBeNull();
    const minor = { tag: '1.1.0', change: 'minor' as const, first_seen: 0 };
    expect(
      autoNote(unit('a', { policy: 'patch', available: minor }), 3, 4 * DAY),
    ).toBeNull();
  });
});
