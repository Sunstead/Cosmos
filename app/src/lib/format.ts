/** Shown where a value is unknown or not applicable. */
export const NO_VALUE = 'n/a';

/** Case-insensitive match of `query` against any of `fields`. */
export function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f?.toLowerCase().includes(q));
}

/** Clauses joined with commas, the first capitalised: "Last run 2h ago, took 14m". */
export function sentence(parts: (string | false | null | undefined)[]): string {
  const text = parts.filter(Boolean).join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
