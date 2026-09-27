import { useNodeStore, nodeDisplayName } from '@/stores/nodes';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Dot } from './dot';

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
