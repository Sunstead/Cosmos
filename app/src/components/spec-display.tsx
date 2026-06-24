import { LucideIcon } from 'lucide-react';

export function SpecDisplay({
  icon: Icon,
  name,
  model,
  details,
}: {
  icon: LucideIcon;
  name: string;
  model: string;
  details: string;
}) {
  return (
    <div className='flex gap-2 text-muted-foreground w-full overflow-hidden'>
      <Icon className='size-5' />
      <div className='text-xs flex-1 min-w-0 flex flex-col justify-center'>
        <p className='truncate'>{name}</p>
        <p className='truncate'>{model}</p>
        <p className='truncate'>{details}</p>
      </div>
    </div>
  );
}
