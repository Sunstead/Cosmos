export function secondsToDuration(totalSeconds: number | bigint): string {
  const total = BigInt(totalSeconds);
  const days = total / 86400n;
  let remainder = total % 86400n;
  const hours = remainder / 3600n;
  remainder %= 3600n;
  const minutes = remainder / 60n;
  // const seconds = remainder % 60n;

  return `${days}d ${hours}h ${minutes}m`;
}
