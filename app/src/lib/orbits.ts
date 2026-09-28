/** Radius from total memory, compressed so large hosts don't dwarf small ones. */
export function bodyRadius(memBytes: number): number {
  const gb = memBytes / 1024 ** 3;
  return Math.round(14 + Math.min(Math.sqrt(gb) * 2.4, 22));
}

/** Orbit radius as a fraction of the available span, innermost first. */
export function orbitFraction(index: number, count: number): number {
  if (count === 1) return 0;
  return 0.38 + (index / Math.max(count - 1, 1)) * 0.52;
}
