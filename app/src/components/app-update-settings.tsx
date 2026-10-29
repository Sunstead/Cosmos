import { Button } from '@sunstead/ui/components/button';
import { Label } from '@sunstead/ui/components/label';
import { Switch } from '@sunstead/ui/components/switch';
import { cn } from '@/lib/utils';
import { useAppUpdate, type AppUpdateStatus } from '@/stores/app-update';

function statusLine(status: AppUpdateStatus, version: string | undefined, lastChecked: Date | null) {
  switch (status.state) {
    case 'checking':
      return 'Checking for updates';
    case 'installing':
      return `Installing ${version}`;
    case 'available':
      return `Helion ${version} is available.`;
    case 'error':
      return status.message;
    default:
      return lastChecked
        ? `Up to date, checked ${lastChecked.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
        : null;
  }
}

/** Settings > About in the desktop app: the version, its updates, and whether to look for them. */
export function AppUpdateSettings({ platform }: { platform: string }) {
  const status = useAppUpdate((s) => s.status);
  const update = useAppUpdate((s) => s.update);
  const lastChecked = useAppUpdate((s) => s.lastChecked);
  const autoCheck = useAppUpdate((s) => s.autoCheck);
  const { check, openDialog, setAutoCheck } = useAppUpdate.getState();
  const line = statusLine(status, update?.version, lastChecked);
  const busy = status.state === 'checking' || status.state === 'installing';

  return (
    <>
      <div className='flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4'>
        <div className='min-w-0'>
          <p className='text-sm'>
            Helion <span className='font-mono tabular-nums'>{__APP_VERSION__}</span>
            <span className='text-muted-foreground'> on {platform}</span>
          </p>
          {line && (
            <p
              className={cn(
                'text-xs break-words',
                status.state === 'error' ? 'text-warning' : 'text-muted-foreground',
              )}
            >
              {line}
            </p>
          )}
        </div>
        {update ? (
          <Button onClick={openDialog} disabled={busy}>
            Update
          </Button>
        ) : (
          <Button variant='outline' onClick={() => void check({ manual: true })} disabled={busy}>
            Check for updates
          </Button>
        )}
      </div>
      <div className='flex items-center justify-between gap-4 p-4'>
        <div className='flex min-w-0 flex-col gap-0.5'>
          <Label htmlFor='app-update-auto'>Check for updates automatically</Label>
          <span className='text-xs text-muted-foreground'>
            At launch and every 6 hours. Nothing installs until you say so.
          </span>
        </div>
        <Switch id='app-update-auto' checked={autoCheck} onCheckedChange={setAutoCheck} />
      </div>
    </>
  );
}
