function formatDuration(totalSeconds: bigint): string {
  const days = totalSeconds / 86400n;
  let remainder = totalSeconds % 86400n;
  const hours = remainder / 3600n;
  remainder %= 3600n;
  const minutes = remainder / 60n;
  // const seconds = remainder % 60n;

  const parts: string[] = [];
  if (days > 0n) parts.push(`${days}d`);
  if (parts.length > 0 || hours > 0n) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);

  return parts.join(' ');
}

export function secondsToDuration(totalSeconds: number | bigint): string {
  return formatDuration(BigInt(totalSeconds));
}

export function msToDuration(ms: number): string {
  return formatDuration(BigInt(Math.floor(ms / 1000)));
}
