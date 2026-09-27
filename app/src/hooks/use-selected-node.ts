import { useNodeStore } from '@/stores/nodes';
import { usePersistentState } from '@/hooks/use-persistent-state';

const STORAGE_KEY = 'cosmos-selected-node';

/**
 * The node a single-node page is looking at. Remembered across pages and
 * restarts, and falls back to the first node when the saved one is gone.
 */
export function useSelectedNode(): [string | null, (id: string) => void] {
  const nodes = useNodeStore((s) => s.nodes);
  const [stored, setStored] = usePersistentState<string | null>(STORAGE_KEY, null);
  const valid = stored && nodes.some((n) => n.id === stored) ? stored : null;
  return [valid ?? nodes[0]?.id ?? null, setStored];
}
