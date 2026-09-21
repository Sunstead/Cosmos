import { useNodeStore, nodeDisplayName } from '@/stores/nodes';
import { usePersistentState } from '@/hooks/use-persistent-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Dot } from './dot';

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

/** Hidden when there's only one node to choose from. */
export function NodeSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string) => void;
}) {
  const nodes = useNodeStore((s) => s.nodes);
  const meta = useNodeStore((s) => s.meta);
  if (nodes.length < 2) return null;

  return (
    <Select value={value ?? ''} onValueChange={onChange}>
      <SelectTrigger className='w-44' aria-label='Node'>
        <SelectValue placeholder='Select node' />
      </SelectTrigger>
      <SelectContent>
        {nodes.map((n) => (
          <SelectItem key={n.id} value={n.id}>
            <Dot variant={meta[n.id]?.status === 'online' ? 'success' : 'disabled'} />
            {nodeDisplayName(n)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
