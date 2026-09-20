/**
 * Fixed-capacity time series backed by preallocated typed arrays.
 *
 * The previous store rebuilt six arrays per node per second with
 * `[...points, next].slice(-60)` — roughly 720 element copies and 19
 * allocations every second, forever, for a window that never grows. This
 * pushes in O(1) with zero allocation after construction.
 *
 * Values are `Float32Array`: a percentage or a byte rate has nowhere near 24
 * bits of meaningful precision, and halving the footprint helps when a
 * sparkline reads the whole buffer every frame. Timestamps need the full
 * double, since epoch milliseconds exceed what a float32 can represent
 * exactly.
 */
export class RingBuffer {
  private readonly values: Float32Array;
  private readonly times: Float64Array;
  private writeIndex = 0;
  private filled = 0;
  /** Bumped on every write so consumers can cheaply detect change. */
  version = 0;

  constructor(readonly capacity: number) {
    this.values = new Float32Array(capacity);
    this.times = new Float64Array(capacity);
  }

  get length() {
    return this.filled;
  }

  push(time: number, value: number) {
    // NaN would poison min/max and silently blank a chart.
    this.values[this.writeIndex] = Number.isFinite(value) ? value : 0;
    this.times[this.writeIndex] = time;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled += 1;
    this.version += 1;
  }

  /** Oldest-first index into the backing array. */
  private indexAt(i: number): number {
    const start =
      this.filled < this.capacity ? 0 : this.writeIndex;
    return (start + i) % this.capacity;
  }

  valueAt(i: number): number {
    return this.values[this.indexAt(i)];
  }

  timeAt(i: number): number {
    return this.times[this.indexAt(i)];
  }

  /** Most recent value, or 0 when empty. */
  latest(): number {
    return this.filled === 0 ? 0 : this.values[(this.writeIndex - 1 + this.capacity) % this.capacity];
  }

  /** Largest value currently held. Used to scale a sparkline. */
  max(): number {
    let max = 0;
    for (let i = 0; i < this.filled; i += 1) {
      const v = this.values[this.indexAt(i)];
      if (v > max) max = v;
    }
    return max;
  }

  /** Oldest-first copy. For tests and one-off reads, not the render path. */
  toArray(): number[] {
    const out = new Array<number>(this.filled);
    for (let i = 0; i < this.filled; i += 1) out[i] = this.values[this.indexAt(i)];
    return out;
  }

  clear() {
    this.writeIndex = 0;
    this.filled = 0;
    this.version += 1;
  }
}

/** The six series tracked per node. */
export const METRIC_KEYS = [
  'cpu',
  'ram',
  'netRx',
  'netTx',
  'diskRead',
  'diskWrite',
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export type NodeSeries = Record<MetricKey, RingBuffer>;

export function createNodeSeries(capacity: number): NodeSeries {
  return Object.fromEntries(
    METRIC_KEYS.map((k) => [k, new RingBuffer(capacity)]),
  ) as NodeSeries;
}
