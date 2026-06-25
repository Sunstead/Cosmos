/**
 * Minimal structural type matching the fields used in metric calculations.
 * Compatible with the full HostInfo type returned by cosmos-agent.
 */
interface HostMetrics {
  cpu_pct: number;
  mem_used_gb: number;
  mem_total_gb: number;
  disk: Array<{ total_gb: number }>;
  net_tx_mbps: number;
  net_rx_mbps: number;
}

/** CPU usage as a rounded integer percentage (0–100) */
export function getCpuPct(host: HostMetrics | undefined): number {
  return Math.round(host?.cpu_pct ?? 0);
}

/** RAM usage as a rounded integer percentage (0–100) */
export function getMemUsagePct(host: HostMetrics | undefined): number {
  const used = host?.mem_used_gb ?? 0;
  const total = host?.mem_total_gb ?? 1;
  return Math.round((used / total) * 100);
}

/** Total disk capacity across all disks, rounded to the nearest GB */
export function getTotalDiskGb(host: HostMetrics | undefined): number {
  if (!host?.disk?.length) return 0;
  return Math.round(host.disk.reduce((acc, d) => acc + d.total_gb, 0));
}

/** Network TX rate in Mbps, rounded to 1 decimal place */
export function getNetTxMbps(host: HostMetrics | undefined): number {
  return Math.round((host?.net_tx_mbps ?? 0) * 10) / 10;
}

/** Network RX rate in Mbps, rounded to 1 decimal place */
export function getNetRxMbps(host: HostMetrics | undefined): number {
  return Math.round((host?.net_rx_mbps ?? 0) * 10) / 10;
}
