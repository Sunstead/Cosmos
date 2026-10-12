import { CircleArrowDown } from 'lucide-react';
import { Button } from '@sunstead/ui/components/button';
import { useAppUpdate, useWaitingVersion } from '@/stores/app-update';
import { Hint } from './hint';

/** The title bar's sign of a new version of Cosmos; opens the update dialog. Hidden otherwise. */
export function AppUpdateIndicator() {
  const version = useWaitingVersion();
  if (!version) return null;

  const label = `Cosmos ${version} is available`;
  return (
    <Hint label={label}>
      <Button
        variant='ghost'
        size='icon'
        aria-label={label}
        className='text-primary'
        onClick={() => useAppUpdate.getState().openDialog()}
      >
        <CircleArrowDown />
      </Button>
    </Hint>
  );
}
