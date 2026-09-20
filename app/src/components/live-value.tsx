import { memo, useEffect, useRef } from 'react';
import { HostInfo } from '@/generated/HostInfo';
import { getConnection } from '@/stores/nodes';
import { requestDraw, cancelDraw } from '@/lib/frame-scheduler';

interface LiveValueProps {
  nodeId: string;
  /** Pulls the display string out of a sample. Must be pure and cheap. */
  format: (host: HostInfo) => string;
  /** Shown before the first sample arrives. */
  placeholder?: string;
  className?: string;
}

/**
 * A number from the host stream that updates without re-rendering.
 *
 * Subscribes straight to the node's connection and writes `textContent`
 * through a ref inside the shared animation frame. The alternative —
 * threading the sample through React state — re-rendered the entire card
 * subtree every second, including a full Radix dropdown menu, four charts and
 * a set of specs that never change.
 */
export const LiveValue = memo(function LiveValue({
  nodeId,
  format,
  placeholder = '—',
  className,
}: LiveValueProps) {
  const ref = useRef<HTMLSpanElement>(null);
  // Held in a ref so a caller passing an inline arrow doesn't resubscribe.
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    const conn = getConnection(nodeId);
    if (!conn) return;

    let next: string | null = null;
    const paint = () => {
      if (ref.current && next !== null) ref.current.textContent = next;
    };

    const unsubscribe = conn.onHost((host) => {
      let value: string;
      try {
        value = formatRef.current(host);
      } catch {
        return;
      }
      // Skip the DOM write entirely when the text hasn't changed — true for
      // uptime and most byte counts most of the time.
      if (value === next) return;
      next = value;
      requestDraw(paint);
    });

    return () => {
      unsubscribe();
      cancelDraw(paint);
    };
  }, [nodeId]);

  return (
    <span ref={ref} className={className}>
      {placeholder}
    </span>
  );
});
