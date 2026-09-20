import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HostInfo } from '@/generated/HostInfo';
import { MetricStep } from '@/generated/MetricStep';
import { getConnection, useNodeStore } from '@/stores/nodes';
import { NodeMeta } from './connection';

/**
 * Live connection state for a node — status, capabilities, agent version.
 *
 * Cheap to subscribe to: it only changes on an actual transition, not on
 * every sample.
 */
export function useNodeMeta(nodeId: string | null): NodeMeta | null {
  return useNodeStore((s) => (nodeId ? (s.meta[nodeId] ?? null) : null));
}

/**
 * The latest host sample, as React state.
 *
 * **This re-renders its component once per second.** Use it for things that
 * genuinely change — a detail panel, a page-level readout. For a number or a
 * chart inside a card that is otherwise static, prefer `<LiveValue>` or
 * `<Sparkline>`, which subscribe to the same stream and write through a ref
 * without re-rendering anything.
 */
export function useHostInfo(nodeId: string | null): {
  data: HostInfo | null;
  status: NodeMeta['status'];
} {
  const meta = useNodeMeta(nodeId);

  const subscribe = useCallback(
    (onChange: () => void) => {
      const conn = nodeId ? getConnection(nodeId) : null;
      return conn ? conn.onHost(onChange) : () => {};
    },
    [nodeId],
  );

  // `getHost()` returns the same object until a new sample replaces it, so
  // this is a stable snapshot and won't loop.
  const getSnapshot = useCallback(
    () => (nodeId ? (getConnection(nodeId)?.getHost() ?? null) : null),
    [nodeId],
  );

  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { data, status: meta?.status ?? 'connecting' };
}

/**
 * Subscribes to a node's host stream without causing a re-render.
 *
 * The callback is stored in a ref so changing it doesn't tear down the
 * subscription — components pass inline closures freely.
 */
export function useHostSubscription(
  nodeId: string | null,
  onSample: (host: HostInfo) => void,
) {
  const handler = useRef(onSample);

  // Assigned in an effect, not during render.
  useEffect(() => {
    handler.current = onSample;
  }, [onSample]);

  useEffect(() => {
    if (!nodeId) return;
    const conn = getConnection(nodeId);
    if (!conn) return;
    return conn.onHost((host) => handler.current(host));
  }, [nodeId]);
}

/**
 * Historical metrics from the agent's SQLite store.
 *
 * Unlike the live sparkline buffers, this is a genuine request/response, so
 * react-query is the right tool. `enabled` keys off the capability flag —
 * agents with history disabled return 501 and we shouldn't ask again.
 */
export function useMetricHistory(
  nodeId: string | null,
  opts: { rangeSeconds: number; step?: MetricStep; maxPoints?: number },
) {
  const meta = useNodeMeta(nodeId);
  const supported = meta?.capabilities.metrics_history ?? false;

  return useQuery({
    // Keyed by the range *length*, not by absolute bounds — the window is
    // resolved at fetch time, so the key stays stable across renders.
    queryKey: ['metrics', nodeId, opts.rangeSeconds, opts.step, opts.maxPoints],
    queryFn: () => {
      const conn = getConnection(nodeId!);
      if (!conn) throw new Error('node is not connected');
      const to = Math.floor(Date.now() / 1000);
      return conn.client.getMetrics({
        from: to - opts.rangeSeconds,
        to,
        step: opts.step,
        maxPoints: opts.maxPoints,
      });
    },
    enabled: !!nodeId && supported && meta?.status === 'online',
    staleTime: 15_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}

export function useBackups(nodeId: string | null) {
  const meta = useNodeMeta(nodeId);
  const supported = meta?.capabilities.backups ?? false;

  return useQuery({
    queryKey: ['backups', nodeId],
    queryFn: () => {
      const conn = getConnection(nodeId!);
      if (!conn) throw new Error('node is not connected');
      return conn.client.getBackups();
    },
    enabled: !!nodeId && supported && meta?.status === 'online',
    refetchInterval: 60_000,
    retry: 1,
  });
}

/**
 * Container lifecycle actions.
 *
 * The agent pushes a fresh container list within ~50ms of an action via its
 * Docker event watcher, so there's nothing to invalidate here — the stream
 * delivers the new state on its own.
 */
export function useContainerActions(nodeId: string | null) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (
      containerId: string,
      action: 'start' | 'stop' | 'restart' | 'remove',
      opts: { force?: boolean; volumes?: boolean } = {},
    ) => {
      const conn = nodeId ? getConnection(nodeId) : null;
      if (!conn) return false;

      setPending(`${containerId}:${action}`);
      setError(null);
      try {
        if (action === 'remove') {
          await conn.client.removeContainer(containerId, opts);
        } else {
          await conn.client.containerAction(containerId, action);
        }
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : `could not ${action} container`);
        return false;
      } finally {
        setPending(null);
      }
    },
    [nodeId],
  );

  return { run, pending, error, clearError: () => setError(null) };
}

/**
 * Re-renders on a timer, for durations that would otherwise go stale.
 *
 * Uptime strings only change once a minute, so there is no reason to recompute
 * them on every host sample.
 */
export function useTick(intervalMs = 60_000): number {
  return useSyncExternalStore(
    useCallback(
      (onChange) => {
        const id = setInterval(onChange, intervalMs);
        return () => clearInterval(id);
      },
      [intervalMs],
    ),
    () => Math.floor(Date.now() / intervalMs),
  );
}
