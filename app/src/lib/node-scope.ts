import { Capabilities } from '@/generated/Capabilities';
import { LEGACY_CAPABILITIES } from '@/api/client';
import type { NodeMeta } from '@/api/connection';

/** The scope value meaning every node at once. */
export const ALL_NODES = 'all';

export type NodeCapability = keyof Capabilities;

/**
 * Nodes a page can show, in node order. A node still connecting hasn't said
 * what it can do yet (its capabilities are the legacy placeholder), so it's
 * kept rather than dropped and re-added a second later.
 */
export function scopeCandidates(
  nodes: { id: string }[],
  meta: Record<string, Pick<NodeMeta, 'capabilities'> | undefined>,
  capability?: NodeCapability,
): string[] {
  return nodes
    .filter((n) => {
      if (!capability) return true;
      const caps = meta[n.id]?.capabilities;
      return !caps || caps === LEGACY_CAPABILITIES || caps[capability];
    })
    .map((n) => n.id);
}

/**
 * The stored choice if it's still on offer, else all nodes (where allowed and
 * there's more than one), else the first candidate.
 */
export function resolveScope(stored: string | null, candidates: string[], allowAll: boolean): string | null {
  if (stored === ALL_NODES && allowAll && candidates.length > 1) return ALL_NODES;
  if (stored && stored !== ALL_NODES && candidates.includes(stored)) return stored;
  return candidates[0] ?? null;
}
