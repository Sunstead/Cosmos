import { ContainerHealth } from '@/generated/ContainerHealth';
import { ContainerInfo } from '@/generated/ContainerInfo';

export type ContainerSummary = {
  id: string;
  name: string;
  state: string;
  /** Docker's health check, when the container has one. */
  health?: ContainerHealth | null;
};

export type ServiceStatus = 'running' | 'partial' | 'stopped';

export type ServiceInfo = {
  key: string;
  nodeId: string;
  name: string;
  description: string | null;
  url: string | null;
  cpu_pct: number;
  mem_used_bytes: number;
  /**
   * Epoch ms of the earliest running container, or null.
   *
   * Deliberately an absolute instant rather than a precomputed duration: a
   * duration would change on every derivation, so the object identity would
   * differ every tick even when nothing about the service had, and every
   * subscriber would re-render. Format it at the point of display.
   */
  startedAt: number | null;
  containers: ContainerSummary[];
  running: number;
  total: number;
  status: ServiceStatus;
};

/**
 * Label value marking infrastructure (proxy, database) hidden from services.
 */
export const SYSTEM_SERVICE_KEY = 'system';

function formatServiceName(key: string): string {
  return key
    .replace(/[-_]/g, ' ')
    .replace(/(^|\s)\S/g, (char) => char.toUpperCase());
}

/**
 * Groups one node's containers into services.
 *
 * Services are declared by the `cosmos.service` Docker label; a container
 * without one becomes a single-container service under its own name.
 * Derivation is per-node so a poll from one node doesn't recompute every
 * other node's services.
 */
export function deriveNodeServices(
  nodeId: string,
  containers: ContainerInfo[],
): ServiceInfo[] {
  const groups = new Map<string, ContainerInfo[]>();

  for (const c of containers) {
    const key = c.cosmos_service ?? c.name;
    const group = groups.get(key) ?? [];
    group.push(c);
    groups.set(key, group);
  }

  const services: ServiceInfo[] = [];

  for (const [key, group] of groups) {
    const runningContainers = group.filter((c) => c.state === 'running');
    const total = group.length;

    const startedAt =
      runningContainers
        .map((c) => (c.started_at ? Date.parse(c.started_at) : NaN))
        .filter((t) => Number.isFinite(t))
        .sort((a, b) => a - b)[0] ?? null;

    const unhealthy = runningContainers.some((c) => c.health === 'unhealthy');
    const status: ServiceStatus =
      runningContainers.length === 0
        ? 'stopped'
        : runningContainers.length < total || unhealthy
          ? 'partial'
          : 'running';

    services.push({
      key,
      nodeId,
      name: formatServiceName(key),
      description:
        group.map((c) => c.cosmos_service_description).find((d) => d != null) ?? null,
      url: group.map((c) => c.cosmos_service_url).find((u) => u != null) ?? null,
      cpu_pct: group.reduce((sum, c) => sum + c.cpu_pct, 0),
      mem_used_bytes: group.reduce((sum, c) => sum + c.mem_used_bytes, 0),
      startedAt,
      containers: group.map((c) => ({ id: c.id, name: c.name, state: c.state, health: c.health ?? null })),
      running: runningContainers.length,
      total,
      status,
    });
  }

  services.sort((a, b) => a.name.localeCompare(b.name));
  return services;
}

/** Services worth clicking on, with infrastructure filtered out. */
export function userFacingServices(services: ServiceInfo[]): ServiceInfo[] {
  return services.filter((s) => s.key !== SYSTEM_SERVICE_KEY);
}
