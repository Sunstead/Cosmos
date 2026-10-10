import { useMemo } from 'react';
import { useNodeStore } from '@/stores/nodes';
import { usePersistentState } from '@/hooks/use-persistent-state';
import { scopeCandidates, resolveScope, ALL_NODES, NodeCapability } from '@/lib/node-scope';

/** Before 0.11 every single-node page shared this one choice. */
const LEGACY_KEY = 'cosmos-selected-node';

function legacyChoice(): string | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    return raw === null ? null : (JSON.parse(raw) as string | null);
  } catch {
    return null;
  }
}

/**
 * The node a page is looking at, or `ALL_NODES`. Each page remembers its own
 * choice, and only nodes that have the page's feature are offered, so picking
 * Pluto on Logs never lands Backups on a node without backups.
 *
 * Returns the scope, its setter, and the nodes on offer.
 */
export function useNodeScope(
  page: string,
  {
    capability,
    allowAll = false,
    initial,
  }: {
    capability?: NodeCapability;
    allowAll?: boolean;
    /** Before anything is chosen. Single-node pages take the old shared choice. */
    initial?: string;
  } = {},
): [string | null, (scope: string) => void, string[]] {
  const nodes = useNodeStore((s) => s.nodes);
  const meta = useNodeStore((s) => s.meta);
  const [stored, setStored] = usePersistentState<string | null>(
    `cosmos-scope-${page}`,
    initial ?? legacyChoice(),
  );

  const candidates = useMemo(() => scopeCandidates(nodes, meta, capability), [nodes, meta, capability]);
  const scope = resolveScope(stored, candidates, allowAll);
  return [scope, setStored, candidates];
}

export { ALL_NODES };
