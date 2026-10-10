import { useCallback, useEffect, useRef, useState } from 'react';
import { LogFrame } from '@/generated/LogFrame';
import { LogLine } from '@/generated/LogLine';
import { getConnection } from '@/stores/nodes';
import { compareView, mergeByTime, prepareLine, ViewLine } from '@/lib/log-view';

export type { ViewLine };

/** Pseudo container ID: every running container on the node at once. */
export const ALL_CONTAINERS = 'all';

export type LogConnectionState = 'idle' | 'connecting' | 'streaming' | 'closed' | 'error';

/**
 * Lines kept in memory. A busy container would otherwise grow unbounded.
 * The view only renders the rows on screen, so this is about memory.
 */
const MAX_LINES = 10_000;

interface Options {
  nodeId: string | null;
  /**
   * Several nodes at once, merged by time and tagged with `node`. Overrides
   * `nodeId`; only with `ALL_CONTAINERS`.
   */
  nodeIds?: string[];
  containerId: string | null;
  follow: boolean;
  tail?: number;
}

/** State tagged with the stream it belongs to. */
interface Session {
  target: string;
  lines: ViewLine[];
  status: LogConnectionState;
  dropped: number;
  /** Why the agent closed the stream, when it said. */
  reason: string | null;
}

const EMPTY: Session = { target: '', lines: [], status: 'idle', dropped: 0, reason: null };

/**
 * Streams a container's logs over the agent's WebSocket.
 *
 * Two things shape the implementation:
 *
 * - Lines are buffered in a ref and flushed on a timer, not per message. A
 *   container emitting hundreds of lines a second would otherwise trigger
 *   hundreds of React renders a second. Each is prepared (`prepareLine`)
 *   once on arrival, with an ID that keys its row.
 * - State is tagged with the stream it came from, so switching container
 *   *derives* an empty view rather than clearing it from inside an effect.
 *   Writing state synchronously in an effect costs an extra render pass and
 *   briefly shows the previous container's output under the new one's name.
 */
export function useContainerLogs({ nodeId, nodeIds, containerId, follow, tail = 500 }: Options) {
  const [session, setSession] = useState<Session>(EMPTY);
  const [attempt, setAttempt] = useState(0);
  const buffer = useRef<ViewLine[]>([]);

  const multi = !!nodeIds && containerId === ALL_CONTAINERS;
  const nodesKey = multi ? nodeIds.join(',') : (nodeId ?? '');
  const active = !!nodesKey && !!containerId;
  // A reconnect is a new stream: its backlog replaces the old lines.
  const target = active ? `${nodesKey}|${containerId}|${follow}|${tail}|${attempt}` : '';
  const current = session.target === target ? session : EMPTY;

  const clear = useCallback(() => {
    buffer.current = [];
    setSession((s) => ({ ...s, lines: [], dropped: 0 }));
  }, []);

  useEffect(() => {
    if (!nodesKey || !containerId) return;
    const sources = nodesKey
      .split(',')
      .flatMap((id) => {
        const conn = getConnection(id);
        return conn ? [{ id, conn }] : [];
      });
    if (sources.length === 0) return;
    const tagged = multi;

    buffer.current = [];
    // Set by cleanup. Every callback below checks it: a socket replaced
    // mid-handshake reports its failure (`error`, then `close`) after the
    // next socket may already be up, and a patch from it would re-stamp the
    // session with the old target. The new selection's lines would then be
    // ignored and the page would sit on its skeleton until a refresh.
    let cancelled = false;

    const patch = (update: Partial<Session>) =>
      !cancelled &&
      setSession((prev) => ({
        ...(prev.target === target ? prev : { ...EMPTY, target }),
        target,
        ...update,
      }));

    const all = containerId === ALL_CONTAINERS;
    // Prepared once on arrival, so rows (memoised on the line object) stay put.
    const tag = (line: LogLine, node: string): ViewLine => prepareLine(line, tagged ? node : undefined);

    // Non-follow mode is a plain request; no socket needed.
    if (!follow) {
      Promise.allSettled(
        sources.map(({ id, conn }) =>
          (all ? conn.client.getAllLogs({ tail }) : conn.client.getLogs(containerId, { tail })).then((res) =>
            res.lines.map((l) => tag(l, id)),
          ),
        ),
      ).then((results) => {
        if (cancelled) return;
        const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
        if (ok.length === 0) return patch({ status: 'error' });
        const lines = ok.flat();
        patch({ lines: sources.length > 1 ? lines.sort(compareView) : lines, status: 'closed' });
      });
      return () => {
        cancelled = true;
      };
    }

    // One socket per node. The view is live while any is; it has failed only
    // when every one has.
    const states = new Map<string, LogConnectionState>(sources.map(({ id }) => [id, 'connecting']));
    const report = (id: string, state: LogConnectionState, reason?: string | null) => {
      states.set(id, state);
      const all = [...states.values()];
      const status: LogConnectionState = all.includes('streaming')
        ? 'streaming'
        : all.includes('connecting')
          ? 'connecting'
          : all.every((s) => s === 'error')
            ? 'error'
            : 'closed';
      patch(reason === undefined ? { status } : { status, reason });
    };

    const sockets = sources.map(({ id, conn }) => {
      const ws = new WebSocket(
        all ? conn.client.allLogsSocketUrl({ tail }) : conn.client.logsSocketUrl(containerId, { tail }),
      );
      ws.onopen = () => !cancelled && report(id, 'streaming');
      ws.onmessage = (event) => receive(id, event);
      ws.onerror = () => !cancelled && report(id, 'error');
      ws.onclose = () => !cancelled && states.get(id) !== 'error' && report(id, 'closed');
      return ws;
    });

    const receive = (node: string, event: MessageEvent) => {
      if (cancelled) return;
      let frame: LogFrame;
      try {
        frame = JSON.parse(event.data) as LogFrame;
      } catch {
        return;
      }

      switch (frame.type) {
        case 'line':
          buffer.current.push(tag(frame, node));
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
          report(node, 'closed', frame.reason);
          break;
      }
    };

    // Coalesced flush: at most ~7 renders a second no matter the log rate.
    const flush = setInterval(() => {
      if (buffer.current.length === 0) return;
      const pending = buffer.current;
      buffer.current = [];
      setSession((prev) => {
        if (prev.target !== target) return prev;
        // Merged containers' backlogs arrive one after another; order them.
        // Only the new batch is sorted, then merged into lines already in
        // order, which is an append when they come in order.
        const next =
          all || sources.length > 1
            ? mergeByTime(prev.lines, pending.sort(compareView))
            : prev.lines.concat(pending);
        return {
          ...prev,
          lines: next.length > MAX_LINES ? next.slice(-MAX_LINES) : next,
        };
      });
    }, 150);

    return () => {
      cancelled = true;
      clearInterval(flush);
      for (const ws of sockets) {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        ws.close();
      }
    };
  }, [nodesKey, multi, containerId, follow, tail, target]);

  const reconnect = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    lines: current.lines,
    // `connecting` until the socket reports otherwise; `idle` with no selection.
    state: active ? (current.target === target ? current.status : 'connecting') : 'idle',
    dropped: current.dropped,
    reason: current.reason,
    clear,
    reconnect,
  };
}
