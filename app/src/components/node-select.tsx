import { useNodeStore, nodeDisplayName } from '@/stores/nodes';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@sunstead/ui/components/select';
import { ALL_NODES } from '@/lib/node-scope';
import { Dot } from './dot';

/**
 * Picks a node, or all of them with `allowAll`. Offers `candidates` (from
 * `useNodeScope`) when given, else every node; hidden when there's only one
 * choice.
 */
export function NodeSelect({
  value,
  onChange,
  candidates,
  allowAll = false,
}: {
  value: string | null;
  onChange: (id: string) => void;
  candidates?: string[];
  allowAll?: boolean;
}) {
  const allNodes = useNodeStore((s) => s.nodes);
  const meta = useNodeStore((s) => s.meta);
  const nodes = candidates ? allNodes.filter((n) => candidates.includes(n.id)) : allNodes;
  if (nodes.length < 2) return null;

  const label = (id: string, name: string) => (
    <>
      <Dot variant={meta[id]?.status === 'online' ? 'success' : 'disabled'} />
      {name}
    </>
  );
  const items = [
    ...(allowAll ? [{ value: ALL_NODES, label: 'All nodes' }] : []),
    ...nodes.map((n) => ({ value: n.id, label: label(n.id, nodeDisplayName(n)) })),
  ];

  return (
    <Select value={value} onValueChange={(id) => id && onChange(id)} items={items}>
      <SelectTrigger className='w-44' aria-label='Node'>
        <SelectValue placeholder='Select node' />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
