import { useCallback, useEffect, useRef, useState } from 'react';
import { LogFrame } from '@/generated/LogFrame';
import { LogLine } from '@/generated/LogLine';
import { getConnection } from '@/stores/nodes';

export type LogConnectionState = 'idle' | 'connecting' | 'streaming' | 'closed' | 'error';

/** Lines kept in memory. A busy container would otherwise grow unbounded. */
const MAX_LINES = 5_000;

interface Options {
  nodeId: string | null;
  containerId: string | null;
  follow: boolean;
  tail?: number;
}

/** State tagged with the stream it belongs to. */
interface Session {
  target: string;
  lines: LogLine[];
  status: LogConnectionState;
  dropped: number;
}

const EMPTY: Session = { target: '', lines: [], status: 'idle', dropped: 0 };

/**
 * Streams a container's logs over the agent's WebSocket.
 *
 * Two things shape the implementation:
 *
 * - Lines are buffered in a ref and flushed on a timer, not per message. A
 *   container emitting hundreds of lines a second would otherwise trigger
 *   hundreds of React renders a second.
 * - State is tagged with the stream it came from, so switching container
 *   *derives* an empty view rather than clearing it from inside an effect.
 *   Writing state synchronously in an effect costs an extra render pass and
 *   briefly shows the previous container's output under the new one's name.
 */
export function useContainerLogs({ nodeId, containerId, follow, tail = 500 }: Options) {
  const [session, setSession] = useState<Session>(EMPTY);
  const buffer = useRef<LogLine[]>([]);

  const active = !!nodeId && !!containerId;
  const target = active ? `${nodeId}|${containerId}|${follow}|${tail}` : '';
  const current = session.target === target ? session : EMPTY;

  const clear = useCallback(() => {
    buffer.current = [];
    setSession((s) => ({ ...s, lines: [], dropped: 0 }));
  }, []);

  useEffect(() => {
    if (!nodeId || !containerId) return;
    const conn = getConnection(nodeId);
    if (!conn) return;

    buffer.current = [];
    let cancelled = false;

    const patch = (update: Partial<Session>) =>
      setSession((prev) => ({
        ...(prev.target === target ? prev : { ...EMPTY, target }),
        target,
        ...update,
      }));

    // Non-follow mode is a plain request; no socket needed.
    if (!follow) {
      conn.client
        .getLogs(containerId, { tail })
        .then((res) => !cancelled && patch({ lines: res.lines, status: 'closed' }))
        .catch(() => !cancelled && patch({ status: 'error' }));
      return () => {
        cancelled = true;
      };
    }

    const ws = new WebSocket(conn.client.logsSocketUrl(containerId, { tail }));

    ws.onopen = () => patch({ status: 'streaming' });

    ws.onmessage = (event) => {
      let frame: LogFrame;
      try {
        frame = JSON.parse(event.data) as LogFrame;
      } catch {
        return;
      }

      switch (frame.type) {
        case 'line':
          buffer.current.push(frame);
          // Trim as we go so a firehose can't grow the buffer without bound
          // between flushes.
          if (buffer.current.length > MAX_LINES) {
            buffer.current = buffer.current.slice(-MAX_LINES);
          }
          break;
        case 'truncated':
          setSession((prev) =>
            prev.target === target
              ? { ...prev, dropped: prev.dropped + frame.dropped }
              : prev,
          );
          break;
        case 'closed':
          patch({ status: 'closed' });
          break;
      }
    };

    ws.onerror = () => patch({ status: 'error' });
    ws.onclose = () =>
      setSession((prev) =>
        prev.target === target && prev.status !== 'error'
          ? { ...prev, status: 'closed' }
          : prev,
      );

    // Coalesced flush: at most ~7 renders a second no matter the log rate.
    const flush = setInterval(() => {
      if (buffer.current.length === 0) return;
      const pending = buffer.current;
      buffer.current = [];
      setSession((prev) => {
        if (prev.target !== target) return prev;
        const next = prev.lines.concat(pending);
        return {
          ...prev,
          lines: next.length > MAX_LINES ? next.slice(-MAX_LINES) : next,
        };
      });
    }, 150);

    return () => {
      cancelled = true;
      clearInterval(flush);
      ws.close();
    };
  }, [nodeId, containerId, follow, tail, target]);

  return {
    lines: current.lines,
    // `connecting` until the socket reports otherwise; `idle` with no selection.
    state: active ? (current.target === target ? current.status : 'connecting') : 'idle',
    dropped: current.dropped,
    clear,
  };
}
