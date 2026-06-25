import { MoreVertical, Trash } from 'lucide-react';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { useNodeStore } from '@/stores/nodes';

export default function NodeOptionsDropdown({ nodeId }: { nodeId: string }) {
  const { removeNode } = useNodeStore();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' size='icon-lg'>
          <MoreVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className='w-max'>
        <DropdownMenuItem
          variant='destructive'
          onClick={() => removeNode(nodeId)}
        >
          <Trash />
          Remove Node
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
