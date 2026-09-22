import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HostInfo } from '@/generated/HostInfo';
import { MetricStep } from '@/generated/MetricStep';
import { getConnection, useNodeStore } from '@/stores/nodes';
import { Device, mergeTailnets } from '@/lib/tailnet';
import { NodeMeta } from './connection';

/**
 * Connection status, capabilities and agent version. Changes only on transitions.
 */
export function useNodeMeta(nodeId: string | null): NodeMeta | null {
  return useNodeStore((s) => (nodeId ? (s.meta[nodeId] ?? null) : null));
}

/**
 * The latest host sample, as React state.
 *
 * Re-renders once per second. For values inside otherwise static cards, use
 * `<LiveValue>` or `<Sparkline>`, which write through refs instead.
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
 * The callback lives in a ref, so inline closures don't resubscribe.
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
 * Disabled when the agent lacks the `metrics_history` capability.
 */
export function useMetricHistory(
  nodeId: string | null,
  opts: { rangeSeconds: number; step?: MetricStep; maxPoints?: number },
) {
  const meta = useNodeMeta(nodeId);
  const supported = meta?.capabilities.metrics_history ?? false;

  return useQuery({
    // Keyed by range length; the window is resolved at fetch time.
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

const TAILNET_POLL_MS = 15_000;

export interface TailnetView {
  devices: Device[];
  /** Nodes whose agents have `[tailscale]` enabled. */
  reporting: string[];
  loading: boolean;
  /** Set when every reporting agent failed, e.g. tailscaled is unreachable. */
  error: string | null;
}

/**
 * The tailnet, merged from every agent that can see it. Polled rather than
 * streamed: it changes slowly, and each node already holds two of the ~6
 * connections a browser allows per origin.
 */
export function useTailnet(): TailnetView {
  // A joined string, so the query list only changes when the set does.
  const reportingKey = useNodeStore((s) =>
    s.nodes
      .filter((n) => s.meta[n.id]?.status === 'online' && s.meta[n.id]?.capabilities.tailnet)
      .map((n) => n.id)
      .join('|'),
  );
  const reporting = reportingKey ? reportingKey.split('|') : [];

  return useQueries({
    queries: reporting.map((nodeId) => ({
      queryKey: ['tailnet', nodeId],
      queryFn: () => {
        const conn = getConnection(nodeId);
        if (!conn) throw new Error('node is not connected');
        return conn.client.getTailnet();
      },
      refetchInterval: TAILNET_POLL_MS,
      retry: 1,
    })),
    combine: (results) => {
      const reports = results.flatMap((r, i) => (r.data ? [{ nodeId: reporting[i], status: r.data }] : []));
      const failed = results.find((r) => r.error);
      return {
        devices: mergeTailnets(reports),
        reporting,
        loading: results.some((r) => r.isLoading),
        error: reports.length === 0 && failed?.error ? failed.error.message : null,
      };
    },
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
