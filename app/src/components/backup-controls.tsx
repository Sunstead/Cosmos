import { useState } from 'react';
import {
  CircleAlert,
  CircleCheck,
  CircleX,
  FlaskConical,
  LoaderCircle,
  Play,
} from 'lucide-react';
import { useBackupActions, useNodeMeta } from '@/api/queries';
import { BackupRequest } from '@/generated/BackupRequest';
import { BackupRequestKind } from '@/generated/BackupRequestKind';
import { BackupsStatus } from '@/generated/BackupsStatus';
import { CheckResult } from '@/generated/CheckResult';
import { relativeTime, secondsToDuration } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Section } from '@/components/section';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';

const KIND: Record<BackupRequestKind, string> = {
  backup: 'Backup',
  backup_state: 'State backup',
  restore_test: 'Restore test',
};

function inFlight(
  status: BackupsStatus | undefined,
  kind?: BackupRequestKind,
): boolean {
  return (status?.requests ?? []).some(
    (r) => (r.state === 'queued' || r.state === 'running') && (!kind || r.kind === kind),
  );
}

/** "Back up now", for admins on a node that takes requests. */
export function BackUpNowButton({
  nodeId,
  status,
}: {
  nodeId: string | null;
  status: BackupsStatus | undefined;
}) {
  const meta = useNodeMeta(nodeId);
  const run = useBackupActions(nodeId);
  const [confirming, setConfirming] = useState(false);
  if (!meta?.capabilities.backup_actions || !status) return null;

  const busy = inFlight(status, 'backup');
  const took =
    status.duration_secs != null ? secondsToDuration(status.duration_secs) : null;
  return (
    <>
      <Button
        size='sm'
        className='h-8'
        disabled={busy}
        onClick={() => setConfirming(true)}
      >
        {busy ? <LoaderCircle className='animate-spin' /> : <Play />}
        {busy ? 'Backing up' : 'Back up now'}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        destructive={false}
        title='Back up now?'
        description={`Runs the nightly backup now: the databases, then both repositories.${took ? ` The last one took ${took}.` : ''} It waits for a backup or restore test that's already running.`}
        confirmLabel='Back up'
        onConfirm={() => run('backup')}
      />
    </>
  );
}

function RequestState({ r }: { r: BackupRequest }) {
  switch (r.state) {
    case 'queued':
      return (
        <span className='flex items-center gap-1 text-muted-foreground'>
          <LoaderCircle className='size-3.5 animate-spin' /> Waiting for the server
        </span>
      );
    case 'running':
      return (
        <span className='flex items-center gap-1 text-warning'>
          <LoaderCircle className='size-3.5 animate-spin' /> Running
          {r.started_at && `, started ${relativeTime(r.started_at)}`}
        </span>
      );
    case 'succeeded':
      return (
        <span className='flex items-center gap-1 text-success'>
          <CircleCheck className='size-3.5' /> Done {relativeTime(r.finished_at)}
        </span>
      );
    case 'failed':
      return (
        <span
          className='flex items-center gap-1 text-error'
          title={r.message ?? undefined}
        >
          <CircleX className='size-3.5' /> Failed {relativeTime(r.finished_at)}
        </span>
      );
  }
}

/** Backups and restore tests started from Cosmos, newest first. */
export function RequestsSection({ requests }: { requests: BackupRequest[] }) {
  if (requests.length === 0) return null;
  return (
    <Section
      title='Started from Cosmos'
      count={requests.length}
      contentClassName='divide-y'
    >
      {requests.map((r) => (
        <div
          key={r.id}
          className='flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm'
        >
          <span>
            {KIND[r.kind]}
            {r.requested_by && (
              <span className='text-muted-foreground'> by {r.requested_by}</span>
            )}
          </span>
          <span className='text-xs'>
            <RequestState r={r} />
          </span>
          {r.state === 'failed' && r.message && (
            <p className='w-full text-xs text-muted-foreground'>{r.message}</p>
          )}
        </div>
      ))}
    </Section>
  );
}

const RESULT_ICON: Record<CheckResult, { icon: typeof CircleCheck; className: string }> =
  {
    pass: { icon: CircleCheck, className: 'text-success' },
    warn: { icon: CircleAlert, className: 'text-warning' },
    fail: { icon: CircleX, className: 'text-error' },
  };

/** The latest restore test, and "Run test now". */
export function RestoreTestSection({
  nodeId,
  status,
}: {
  nodeId: string | null;
  status: BackupsStatus;
}) {
  const meta = useNodeMeta(nodeId);
  const run = useBackupActions(nodeId);
  const canRun = meta?.capabilities.backup_actions ?? false;
  const test = status.restore_test ?? null;
  if (!test && !canRun) return null;

  const busy = inFlight(status, 'restore_test');
  const summary = test
    ? [
        `${test.passed} passed`,
        test.warned > 0 && `${test.warned} with a warning`,
        test.failed > 0 && `${test.failed} failed`,
      ]
        .filter(Boolean)
        .join(', ')
    : null;

  return (
    <Section
      title='Restore test'
      contentClassName='divide-y'
      actions={
        canRun && (
          <Button
            variant='ghost'
            size='sm'
            disabled={busy}
            onClick={() => void run('restore_test').catch(() => {})}
          >
            {busy ? <LoaderCircle className='animate-spin' /> : <FlaskConical />}
            {busy ? 'Testing' : 'Run test now'}
          </Button>
        )
      }
    >
      {!test ? (
        <EmptyState
          size='inline'
          icon={FlaskConical}
          title='No restore test yet'
          description='It restores the latest dumps into throwaway databases and compares sampled files with the live ones.'
        />
      ) : (
        <>
          <div className='flex flex-wrap items-center justify-between gap-x-4 px-4 py-2.5 text-sm'>
            <span className={cn(test.failed > 0 ? 'text-error' : 'text-foreground')}>
              {summary}
            </span>
            <span className='text-xs text-muted-foreground'>
              {relativeTime(test.finished_at)}
              {test.duration_secs != null &&
                `, took ${secondsToDuration(test.duration_secs)}`}
            </span>
          </div>
          {test.checks.map((c, i) => {
            const { icon: Icon, className } = RESULT_ICON[c.result];
            return (
              <div key={i} className='flex items-start gap-2 px-4 py-2 text-xs'>
                <Icon className={cn('mt-px size-3.5 shrink-0', className)} />
                <span className='text-muted-foreground'>{c.message}</span>
              </div>
            );
          })}
        </>
      )}
    </Section>
  );
}
