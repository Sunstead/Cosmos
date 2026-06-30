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

/** Memory used in GB, rounded to the nearest GB */
export function getMemUsedGb(host: HostInfo | undefined): number {
  return Math.round((host?.mem_used_gb ?? 0) * 10) / 10;
}

/** Total disk capacity across all disks, rounded to the nearest GB */
export function getTotalDiskGb(host: HostInfo | undefined): number {
  if (!host?.disk?.length) return 0;
  return Math.round(host.disk.reduce((acc, d) => acc + d.total_gb, 0));
}

/** Disk type across all drives (SSD, HDD, or Mixed) */
export function getDiskType(host: HostInfo | undefined): string {
  let same: boolean = true;

  for (let i = 1; i < (host?.disk.length ?? 1); i++) {
    if (host?.disk[i].kind !== host?.disk[0].kind) same = false;
  }

  return same ? (host?.disk[0].kind ?? 'Unknown') : 'Mixed';
}

/** Network TX rate in Mbps, rounded to 1 decimal place */
export function getNetTxMbps(host: HostInfo | undefined): number {
  return Math.round((host?.net_tx_mbps ?? 0) * 10) / 10;
}

/** Network RX rate in Mbps, rounded to 1 decimal place */
export function getNetRxMbps(host: HostInfo | undefined): number {
  return Math.round((host?.net_rx_mbps ?? 0) * 10) / 10;
}

/** Primary disk read rate in MB/s, rounded to 1 decimal place */
export function getDiskReadMbps(host: HostInfo | undefined): number {
  return Math.round((host?.disk?.[0]?.read_mbps ?? 0) * 10) / 10;
}

/** Primary disk write rate in MB/s, rounded to 1 decimal place */
export function getDiskWriteMbps(host: HostInfo | undefined): number {
  return Math.round((host?.disk?.[0]?.write_mbps ?? 0) * 10) / 10;
}
