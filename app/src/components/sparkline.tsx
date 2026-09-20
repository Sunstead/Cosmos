import { memo, useEffect, useRef } from 'react';
import { MetricKey } from '@/lib/ring-buffer';
import { requestDraw, cancelDraw } from '@/lib/frame-scheduler';
import { getNodeSeries, subscribeNodeSeries } from '@/stores/metrics-history';

interface SparklineProps {
  nodeId: string;
  metric: MetricKey;
  /** Any CSS colour, including a `var(--color-cpu)` token. */
  color: string;
  /** `percent` pins the axis to 0–100; `auto` scales to the window's peak. */
  scale?: 'percent' | 'auto';
  className?: string;
}

/**
 * A live sparkline that never re-renders.
 *
 * React mounts the SVG once. After that, samples arrive at 1 Hz and this
 * rewrites two attributes through refs inside a shared animation frame — no
 * component re-render, no reconciliation, no layout measurement.
 *
 * It replaces a recharts `ResponsiveContainer` + `AreaChart` per metric (four
 * per node card), each of which carried a `ResizeObserver`, recomputed scales
 * and rebuilt its path on every tick, and re-injected an inline `<style>`
 * element on every render.
 *
 * The geometry is a fixed 0–100 viewBox with `preserveAspectRatio="none"`, so
 * the SVG stretches to whatever box it is given and nothing here ever needs to
 * know its pixel size. `vector-effect="non-scaling-stroke"` keeps the line an
 * even weight despite the non-uniform scale.
 */
export const Sparkline = memo(function Sparkline({
  nodeId,
  metric,
  color,
  scale = 'auto',
  className,
}: SparklineProps) {
  const lineRef = useRef<SVGPolylineElement>(null);
  const areaRef = useRef<SVGPolygonElement>(null);

  useEffect(() => {
    const buffer = getNodeSeries(nodeId)[metric];
    let lastVersion = -1;

    const draw = () => {
      const line = lineRef.current;
      const area = areaRef.current;
      if (!line || !area) return;
      if (buffer.version === lastVersion) return;
      lastVersion = buffer.version;

      const n = buffer.length;
      if (n === 0) {
        line.setAttribute('points', '');
        area.setAttribute('points', '');
        return;
      }

      // A flat-zero series would otherwise divide by zero; a small floor also
      // stops idle noise being amplified into a dramatic-looking chart.
      const peak = scale === 'percent' ? 100 : Math.max(buffer.max(), 1e-6);

      // Always plot across the full capacity so the line grows in from the
      // right as history accumulates, rather than stretching to fit.
      const span = Math.max(buffer.capacity - 1, 1);
      const offset = buffer.capacity - n;

      let points = '';
      for (let i = 0; i < n; i += 1) {
        const x = ((offset + i) / span) * 100;
        const y = 100 - Math.min(buffer.valueAt(i) / peak, 1) * 100;
        points += `${x.toFixed(2)},${y.toFixed(2)} `;
      }

      line.setAttribute('points', points.trimEnd());
      // Close the shape along the baseline for the fill.
      const firstX = ((offset) / span) * 100;
      area.setAttribute('points', `${firstX.toFixed(2)},100 ${points.trimEnd()} 100,100`);
    };

    const schedule = () => requestDraw(draw);
    schedule();

    const unsubscribe = subscribeNodeSeries(nodeId, schedule);
    return () => {
      unsubscribe();
      cancelDraw(draw);
    };
  }, [nodeId, metric, scale]);

  return (
    <svg
      className={className}
      viewBox='0 0 100 100'
      preserveAspectRatio='none'
      aria-hidden='true'
      focusable='false'
    >
      <polygon
        ref={areaRef}
        points=''
        fill={`color-mix(in srgb, ${color} 14%, transparent)`}
        stroke='none'
      />
      <polyline
        ref={lineRef}
        points=''
        fill='none'
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin='round'
        strokeLinecap='round'
        vectorEffect='non-scaling-stroke'
      />
    </svg>
  );
});
