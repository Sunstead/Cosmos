import { Button } from '@sunstead/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@sunstead/ui/components/dialog';
import { Progress } from '@sunstead/ui/components/progress';
import { servedUpdate } from '@/lib/app-update';
import { isDesktop } from '@/lib/platform';
import { useAppUpdate } from '@/stores/app-update';
import { useNodeStore } from '@/stores/nodes';

/** Shows a new version of Helion and installs it, or a manual check's answer. One app-wide instance. */
export function AppUpdateDialog() {
  return isDesktop() ? <DesktopUpdateDialog /> : <ServedUpdateDialog />;
}

function DesktopUpdateDialog() {
  const open = useAppUpdate((s) => s.dialogOpen);
  const status = useAppUpdate((s) => s.status);
  const update = useAppUpdate((s) => s.update);
  const { install, later, check, closeDialog } = useAppUpdate.getState();

  const installing = status.state === 'installing';

  let title: string;
  let description = '';
  if (installing) {
    title = `Installing Helion ${update?.version}`;
    description = 'Helion restarts when it is done.';
  } else if (status.state === 'checking') {
    title = 'Checking for updates';
  } else if (status.state === 'error') {
    title = update ? 'The update did not install' : 'Could not check for updates';
    description = status.message;
  } else if (update) {
    title = `Helion ${update.version} is available`;
    description = `You have ${__APP_VERSION__}.`;
  } else {
    title = 'Helion is up to date';
    description = `You have the latest version, ${__APP_VERSION__}.`;
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !installing && closeDialog()}>
      <DialogContent className='sm:max-w-lg' showCloseButton={!installing}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription className='break-words'>{description}</DialogDescription>}
        </DialogHeader>

        {update && status.state === 'available' && update.notes.trim() && (
          <div className='selectable max-h-64 overflow-y-auto rounded-md border p-3 text-sm whitespace-pre-wrap text-muted-foreground'>
            {update.notes.trim()}
          </div>
        )}

        {installing && (
          <Progress
            aria-label='Download'
            value={status.progress === null ? null : Math.round(status.progress * 100)}
          />
        )}

        <DialogFooter>
          {update && !installing ? (
            <>
              <Button variant='ghost' onClick={() => later(update.version)}>
                Later
              </Button>
              <Button onClick={() => void install()}>Install and restart</Button>
            </>
          ) : status.state === 'error' ? (
            <>
              <Button variant='ghost' onClick={closeDialog}>
                Close
              </Button>
              <Button onClick={() => void check({ manual: true })}>Try again</Button>
            </>
          ) : (
            !installing && (
              <Button onClick={closeDialog} disabled={status.state === 'checking'}>
                OK
              </Button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** In a browser: the agent serving this page was updated while it was open. */
function ServedUpdateDialog() {
  const open = useAppUpdate((s) => s.dialogOpen);
  const { later, closeDialog } = useAppUpdate.getState();
  const version = useNodeStore((s) =>
    servedUpdate(s.nodes, s.meta, window.location.origin, __APP_VERSION__),
  );

  return (
    <Dialog open={open && version !== null} onOpenChange={(next) => !next && closeDialog()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Helion {version} is available</DialogTitle>
          <DialogDescription>
            This server was updated while the page was open; the page is still {__APP_VERSION__}. Reload to
            use the new version.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant='ghost' onClick={() => version && later(version)}>
            Later
          </Button>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
