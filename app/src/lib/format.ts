/** Shown where a value is unknown or not applicable. */
export const NO_VALUE = 'n/a';

/** Case-insensitive match of `query` against any of `fields`. */
export function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f?.toLowerCase().includes(q));
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
