import { MetricSeries } from '@/generated/MetricSeries';

export interface ChartRow {
  ts: number;
  value: number;
  peak: number;
}

type NumericKey = {
  [K in keyof MetricSeries]: MetricSeries[K] extends number[] ? K : never;
}[keyof MetricSeries];

/** Zips the agent's columnar response into recharts rows. */
export function toRows(series: MetricSeries | undefined, key: NumericKey, peakKey: NumericKey): ChartRow[] {
  if (!series) return [];
  const values = series[key];
  const peaks = series[peakKey];
  return series.ts.map((ts, i) => ({
    ts: ts * 1000,
    value: values[i] ?? 0,
    peak: peaks[i] ?? values[i] ?? 0,
  }));
}
