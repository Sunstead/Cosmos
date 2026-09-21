import { SetupHint, SETUP } from './setup-hint';

/** Footer for action menus on a read-only agent. */
export function ReadOnlyNote() {
  return (
    <div className='flex items-center justify-between gap-2 px-2 py-1 text-xs text-muted-foreground'>
      Read-only agent
      <SetupHint info={SETUP.actions} />
    </div>
  );
}
