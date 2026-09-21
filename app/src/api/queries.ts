import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
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

const PAST: Record<ContainerAction, string> = {
  start: 'Started',
  stop: 'Stopped',
  restart: 'Restarted',
  remove: 'Removed',
};

export type ContainerAction = 'start' | 'stop' | 'restart' | 'remove';

/**
 * Container lifecycle actions with toast feedback. The agent's event watcher
 * pushes the new container list within milliseconds, so nothing is refetched.
 */
export function useContainerActions(nodeId: string | null) {
  const [pending, setPending] = useState<string | null>(null);

  const run = useCallback(
    async (
      containerId: string,
      action: ContainerAction,
      label = containerId.slice(0, 12),
      opts: { force?: boolean; volumes?: boolean } = {},
    ) => {
      const conn = nodeId ? getConnection(nodeId) : null;
      if (!conn) return false;

      setPending(`${containerId}:${action}`);
      try {
        if (action === 'remove') await conn.client.removeContainer(containerId, opts);
        else await conn.client.containerAction(containerId, action);
        toast.success(`${PAST[action]} ${label}`);
        return true;
      } catch (e) {
        toast.error(`Could not ${action} ${label}`, {
          description: e instanceof Error ? e.message : undefined,
        });
        return false;
      } finally {
        setPending(null);
      }
    },
    [nodeId],
  );

  /** One action across several containers, sequentially, with one toast. */
  const runMany = useCallback(
    async (containerIds: string[], action: Exclude<ContainerAction, 'remove'>, label: string) => {
      const conn = nodeId ? getConnection(nodeId) : null;
      if (!conn || containerIds.length === 0) return false;

      setPending(`many:${action}`);
      let failed = 0;
      // Sequential: restarting a compose project all at once can trip
      // dependency ordering.
      for (const id of containerIds) {
        try {
          await conn.client.containerAction(id, action);
        } catch {
          failed += 1;
        }
      }
      setPending(null);

      if (failed === 0) toast.success(`${PAST[action]} ${label}`);
      else toast.error(`${failed} of ${containerIds.length} failed to ${action}`);
      return failed === 0;
    },
    [nodeId],
  );

  return { run, runMany, pending };
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

/** The current time, updated every `intervalMs`, without reading the clock in render. */
export function useNow(intervalMs = 60_000): number {
  return useTick(intervalMs) * intervalMs;
}
