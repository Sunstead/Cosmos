import { HostInfo } from '@/generated/HostInfo';

/** CPU usage as a rounded integer percentage (0–100) */
export function getCpuPct(host: HostInfo | undefined): number {
  return Math.round(host?.cpu_pct ?? 0);
}

/** RAM usage as a rounded integer percentage (0–100) */
export function getMemUsagePct(host: HostInfo | undefined): number {
  const used = host?.mem_used_gb ?? 0;
  const total = host?.mem_total_gb ?? 1;
  return Math.round((used / total) * 100);
}

/** Total disk capacity across all disks, rounded to the nearest GB */
export function getTotalDiskGb(host: HostInfo | undefined): number {
  if (!host?.disk?.length) return 0;
  return Math.round(host.disk.reduce((acc, d) => acc + d.total_gb, 0));
}

/** Network TX rate in Mbps, rounded to 1 decimal place */
export function getNetTxMbps(host: HostInfo | undefined): number {
  return Math.round((host?.net_tx_mbps ?? 0) * 10) / 10;
}

/** Network RX rate in Mbps, rounded to 1 decimal place */
export function getNetRxMbps(host: HostInfo | undefined): number {
  return Math.round((host?.net_rx_mbps ?? 0) * 10) / 10;
}
