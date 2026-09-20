/**
 * Duration formatting.
 *
 * Plain numbers rather than BigInt: these are called once per node per render
 * for values that fit comfortably in a double, and BigInt division is
 * needlessly expensive for a string that only ever shows whole units.
 */
function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '—';

  const seconds = Math.floor(totalSeconds);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const secs = seconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (parts.length > 0 || hours > 0) parts.push(`${hours}h`);
  if (parts.length > 0 || minutes > 0) parts.push(`${minutes}m`);

  // Seconds were commented out before, so anything under a minute rendered as
  // "0m" — a container that had just restarted looked frozen.
  if (parts.length === 0) return `${secs}s`;
  return parts.join(' ');
}

export function secondsToDuration(totalSeconds: number): string {
  return formatDuration(totalSeconds);
}

export function msToDuration(ms: number): string {
  return formatDuration(ms / 1000);
}
