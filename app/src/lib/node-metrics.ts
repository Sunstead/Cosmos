import { DiskKind } from '@/generated/DiskKind';
import { HostInfo } from '@/generated/HostInfo';

/**
 * Adapts a raw `HostInfo` sample into display values.
 *
 * The agent ships raw units — bytes and bytes-per-second — and all formatting
 * happens here. That split is deliberate: the previous wire format mixed MB/s
 * for disk with megabits/s for network inside the same struct, which is the
 * kind of thing that silently produces charts that are wrong by a factor of 8.
 */

const BYTES_PER_GIB = 1024 ** 3;
const BYTES_PER_MIB = 1024 ** 2;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** CPU usage as a rounded integer percentage (0–100). */
export function getCpuPct(host: HostInfo | undefined): number {
  return Math.round(host?.cpu_pct ?? 0);
}

/** RAM usage as a rounded integer percentage (0–100). */
export function getMemUsagePct(host: HostInfo | undefined): number {
  const used = host?.mem_used_bytes ?? 0;
  const total = host?.mem_total_bytes ?? 0;
  return total > 0 ? Math.round((used / total) * 100) : 0;
}

/** Swap usage as a rounded integer percentage; 0 when there is no swap. */
export function getSwapUsagePct(host: HostInfo | undefined): number {
  const total = host?.swap_total_bytes ?? 0;
  return total > 0 ? Math.round(((host?.swap_used_bytes ?? 0) / total) * 100) : 0;
}

/** Total disk capacity across every reported filesystem, in whole GB. */
export function getTotalDiskGb(host: HostInfo | undefined): number {
  if (!host?.disk?.length) return 0;
  return Math.round(
    host.disk.reduce((acc, d) => acc + d.total_bytes, 0) / BYTES_PER_GIB,
  );
}

/** Disk type across all drives, or `Mixed` when they differ. */
export function getDiskType(host: HostInfo | undefined): string {
  const disks = host?.disk ?? [];
  if (disks.length === 0) return 'Unknown';

  const first = disks[0].kind;
  const allSame = disks.every((d) => d.kind === first);
  return allSame ? formatDiskKind(first) : 'Mixed';
}

function formatDiskKind(kind: DiskKind): string {
  // The wire format is lowercase (`ssd` | `hdd` | `unknown`); these are
  // initialisms, so they read as shouted acronyms rather than words.
  if (kind === 'unknown') return 'Unknown';
  return kind.toUpperCase();
}

/**
 * Network rates, displayed in megabits per second — the convention for
 * network throughput, and what the UI showed before. The wire value is
 * bytes/sec, hence the factor of 8.
 */
export function getNetRxMbps(host: HostInfo | undefined): number {
  return round1(((host?.net_rx_bps ?? 0) * 8) / 1_000_000);
}

export function getNetTxMbps(host: HostInfo | undefined): number {
  return round1(((host?.net_tx_bps ?? 0) * 8) / 1_000_000);
}

/**
 * Disk throughput, displayed in MiB/s.
 *
 * Summed across every reported filesystem. The previous version read only
 * `disk[0]` while the history collector summed all of them, so on a
 * multi-disk host the card's number and its own sparkline disagreed.
 */
export function getDiskReadMbps(host: HostInfo | undefined): number {
  return round1(sumDisk(host, 'read_bps') / BYTES_PER_MIB);
}

export function getDiskWriteMbps(host: HostInfo | undefined): number {
  return round1(sumDisk(host, 'write_bps') / BYTES_PER_MIB);
}

export function sumDisk(
  host: HostInfo | undefined,
  field: 'read_bps' | 'write_bps',
): number {
  return (host?.disk ?? []).reduce((sum, d) => sum + d[field], 0);
}

/** Human-readable byte size, e.g. `1.4 GB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;

  // One decimal below 10 keeps "1.4 GB" readable without "1.44 GB" noise.
  const decimals = exponent === 0 ? 0 : value < 10 ? 1 : 0;
  return `${value.toFixed(decimals)} ${units[exponent]}`;
}
