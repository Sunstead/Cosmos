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
 * A live value from the host stream, written through a ref so the parent
 * never re-renders.
 */
export const LiveValue = memo(function LiveValue({
  nodeId,
  format,
  placeholder = '…',
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
      // Skip the DOM write when the text is unchanged.
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
