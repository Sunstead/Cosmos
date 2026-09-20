import { ContainerSummary, ServiceStatus } from '@/lib/services';

export function formatCpuPercent(cpuPct: number): string {
  return `${Math.round(cpuPct * 100) / 100}%`;
}

// Running containers first, stable otherwise. Returns a new array —
// never mutates the input (it may be coming straight from a store).
export function sortContainersByState(
  containers: ContainerSummary[],
): ContainerSummary[] {
  return [...containers].sort((a, b) => {
    const aRunning = a.state === 'running' ? 0 : 1;
    const bRunning = b.state === 'running' ? 0 : 1;
    return aRunning - bRunning;
  });
}

type StatusDisplay = {
  label: string;
  dotVariant: 'success' | 'warning' | 'disabled';
  textClassName: string;
};

const STATUS_DISPLAY: Record<ServiceStatus, StatusDisplay> = {
  running: {
    label: 'Running',
    dotVariant: 'success',
    textClassName: 'text-success',
  },
  partial: {
    label: 'Degraded',
    dotVariant: 'warning',
    textClassName: 'text-warning',
  },
  stopped: {
    label: 'Stopped',
    dotVariant: 'disabled',
    textClassName: 'text-muted-foreground',
  },
};

export function getServiceStatusDisplay(status: ServiceStatus): StatusDisplay {
  return STATUS_DISPLAY[status];
}
