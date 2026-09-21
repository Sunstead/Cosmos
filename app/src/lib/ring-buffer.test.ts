import { describe, expect, it } from 'vitest';
import { RingBuffer, createNodeSeries, METRIC_KEYS } from './ring-buffer';

describe('RingBuffer', () => {
  it('fills before wrapping', () => {
    const b = new RingBuffer(4);
    expect(b.length).toBe(0);

    b.push(1, 10);
    b.push(2, 20);
    expect(b.length).toBe(2);
    expect(b.toArray()).toEqual([10, 20]);
  });

  it('keeps the newest values once full, oldest-first', () => {
    const b = new RingBuffer(3);
    for (let i = 1; i <= 5; i += 1) b.push(i, i * 10);

    expect(b.length).toBe(3);
    // 10 and 20 were overwritten by 40 and 50.
    expect(b.toArray()).toEqual([30, 40, 50]);
    expect(b.latest()).toBe(50);
  });

  it('reports timestamps in the same order as values', () => {
    const b = new RingBuffer(3);
    for (let i = 1; i <= 5; i += 1) b.push(i * 1000, i);

    expect([b.timeAt(0), b.timeAt(1), b.timeAt(2)]).toEqual([3000, 4000, 5000]);
    expect([b.valueAt(0), b.valueAt(1), b.valueAt(2)]).toEqual([3, 4, 5]);
  });

  it('tracks the maximum across the window only', () => {
    const b = new RingBuffer(3);
    b.push(1, 99); // will be evicted
    b.push(2, 1);
    b.push(3, 2);
    expect(b.max()).toBe(99);

    b.push(4, 3);
    // The spike has aged out, so the chart should rescale.
    expect(b.max()).toBe(3);
  });

  it('substitutes zero for non-finite values', () => {
    const b = new RingBuffer(3);
    // A divide-by-zero rate upstream would otherwise poison max() and blank
    // the whole chart.
    b.push(1, Number.NaN);
    b.push(2, Number.POSITIVE_INFINITY);
    b.push(3, 5);

    expect(b.toArray()).toEqual([0, 0, 5]);
    expect(b.max()).toBe(5);
  });

  it('bumps a version on every write so consumers can skip redraws', () => {
    const b = new RingBuffer(2);
    const start = b.version;
    b.push(1, 1);
    b.push(2, 2);
    expect(b.version).toBe(start + 2);
  });

  it('empties without reallocating', () => {
    const b = new RingBuffer(2);
    b.push(1, 1);
    b.clear();

    expect(b.length).toBe(0);
    expect(b.latest()).toBe(0);
    expect(b.max()).toBe(0);
    expect(b.toArray()).toEqual([]);
  });

  it('does not allocate per push', () => {
    // The point of the whole class: the previous store rebuilt six arrays per
    // node per second. Capacity is fixed at construction.
    const b = new RingBuffer(60);
    for (let i = 0; i < 10_000; i += 1) b.push(i, i);
    expect(b.length).toBe(60);
    expect(b.latest()).toBe(9_999);
  });
});

describe('createNodeSeries', () => {
  it('creates one independent buffer per metric', () => {
    const series = createNodeSeries(10);
    expect(Object.keys(series).sort()).toEqual([...METRIC_KEYS].sort());

    series.cpu.push(1, 50);
    expect(series.cpu.length).toBe(1);
    expect(series.ram.length).toBe(0);
  });
});
