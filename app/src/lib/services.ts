import { ContainerInfo } from '@/generated/ContainerInfo';

export type ContainerSummary = {
  name: string;
  state: string;
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
  uptime_ms: number | null;
  containers: ContainerSummary[];
  running: number;
  total: number;
  status: ServiceStatus;
};

function formatServiceName(key: string): string {
  return key
    .replace(/[-_]/g, ' ')
    .replace(/(^|\s)\S/g, (char) => char.toUpperCase());
}

export function deriveServices(
  nodeContainers: Record<string, ContainerInfo[]>,
): ServiceInfo[] {
  const services: ServiceInfo[] = [];

  for (const [nodeId, containers] of Object.entries(nodeContainers)) {
    const groups = new Map<string, ContainerInfo[]>();

    for (const c of containers) {
      const key = c.cosmos_service ?? c.name;
      const group = groups.get(key) ?? [];
      group.push(c);
      groups.set(key, group);
    }

    for (const [key, group] of groups) {
      const runningContainers = group.filter((c) => c.state === 'running');
      const total = group.length;

      const earliestStart =
        runningContainers
          .map((c) => (c.started_at ? Date.parse(c.started_at) : null))
          .filter((t): t is number => t !== null)
          .sort((a, b) => a - b)[0] ?? null;

      const status: ServiceStatus =
        runningContainers.length === 0
          ? 'stopped'
          : runningContainers.length < total
            ? 'partial'
            : 'running';

      services.push({
        key,
        nodeId,
        name: formatServiceName(key),
        description:
          group
            .map((c) => c.cosmos_service_description)
            .find((d) => d != null) ?? null,
        url:
          group.map((c) => c.cosmos_service_url).find((u) => u != null) ?? null,
        cpu_pct: group.reduce((sum, c) => sum + c.cpu_pct, 0),
        mem_used_bytes: group.reduce((sum, c) => sum + c.mem_used_bytes, 0),
        uptime_ms: earliestStart !== null ? Date.now() - earliestStart : null,
        containers: group.map((c) => ({ name: c.name, state: c.state })),
        running: runningContainers.length,
        total,
        status,
      });
    }
  }

  return services;
}
