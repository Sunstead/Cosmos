import { useState } from 'react';
import {
  Archive,
  CircleCheck,
  CircleX,
  Clock,
  Database,
  HeartPulse,
  TriangleAlert,
} from 'lucide-react';
import { useNodeStore } from '@/stores/nodes';
import { useBackups, useNodeMeta, useTick } from '@/api/queries';
import { BackupsStatus } from '@/generated/BackupsStatus';
import { StepStatus } from '@/generated/StepStatus';
import { PageHeader } from '@/components/page-header';
import { FeatureDisabled, NoNodes } from '@/components/feature-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatBytes } from '@/lib/node-metrics';
import { msToDuration, secondsToDuration } from '@/lib/time';
import { cn } from '@/lib/utils';

function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const delta = Date.now() - t;
  return delta >= 0 ? `${msToDuration(delta)} ago` : `in ${msToDuration(-delta)}`;
}

function StepRow({ label, step, icon: Icon }: { label: string; step: StepStatus | null; icon: typeof Database }) {
  if (!step) return null;
  return (
    <div className='flex items-center gap-2 text-sm'>
      <Icon className='size-4 text-muted-foreground' />
      <span className='flex-1'>{label}</span>
      {step.ok ? (
        <span className='flex items-center gap-1 text-success text-xs'>
          <CircleCheck className='size-3.5' /> OK
        </span>
      ) : (
        <span className='flex items-center gap-1 text-error text-xs'>
          <CircleX className='size-3.5' /> {step.message ?? 'Failed'}
        </span>
      )}
    </div>
  );
}

/**
 * The headline. A backup system that quietly stopped running looks identical
 * to a healthy one if all you render is a list of snapshots — they just stop
 * getting newer. `stale` and the timer cross-check are what surface that.
 */
function HealthBanner({ status }: { status: BackupsStatus }) {
  const timerAhead =
    status.timer_last_fired &&
    status.generated_at &&
    Date.parse(status.timer_last_fired) > Date.parse(status.generated_at);

  if (timerAhead) {
    return (
      <Card className='border-error/40'>
        <CardContent className='flex items-start gap-3 py-4'>
          <TriangleAlert className='size-5 text-error shrink-0 mt-0.5' />
          <div>
            <p className='font-medium text-error'>The last backup did not finish</p>
            <p className='text-sm text-muted-foreground'>
              The timer fired {when(status.timer_last_fired)}, but the job never
              wrote a status. Check{' '}
              <code className='font-mono'>journalctl -u jupiter-backup</code>.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (status.stale) {
    return (
      <Card className='border-warning/40'>
        <CardContent className='flex items-start gap-3 py-4'>
          <TriangleAlert className='size-5 text-warning shrink-0 mt-0.5' />
          <div>
            <p className='font-medium text-warning'>Backups are stale</p>
            <p className='text-sm text-muted-foreground'>
              The most recent status is from {when(status.generated_at)}. The timer
              may have stopped.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className='border-success/30'>
      <CardContent className='flex items-start gap-3 py-4'>
        <CircleCheck className='size-5 text-success shrink-0 mt-0.5' />
        <div>
          <p className='font-medium text-success'>Backups are healthy</p>
          <p className='text-sm text-muted-foreground'>
            Last run {when(status.last_run)}
            {status.duration_secs != null && ` in ${secondsToDuration(status.duration_secs)}`}
            {status.next_run && ` · next ${when(status.next_run)}`}.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function BackupsPage() {
  const nodes = useNodeStore((s) => s.nodes);
  const [nodeId, setNodeId] = useState<string | null>(nodes[0]?.id ?? null);
  const effectiveNodeId = nodeId ?? nodes[0]?.id ?? null;

  const meta = useNodeMeta(effectiveNodeId);
  const { data: status, error } = useBackups(effectiveNodeId);

  // Relative times ("3 hours ago") go stale without a clock.
  useTick(60_000);

  if (nodes.length === 0) return <NoNodes what='backup status' />;

  if (meta && !meta.capabilities.backups) {
    return (
      <>
        <PageHeader title='BACKUPS' />
        <FeatureDisabled
          icon={Archive}
          title='Backups are not configured on this agent'
          description={
            <>
              Enable <code>[backups]</code> in the agent&rsquo;s <code>agent.toml</code>{' '}
              and have your backup job call{' '}
              <code className='font-mono'>cosmos-backup-status.sh</code> when it
              finishes. The agent only reads the status file it writes — it never
              runs restic or holds your repository password.
            </>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title='BACKUPS'
        description={status ? `restic · ${status.repo_label}` : undefined}
        actions={
          nodes.length > 1 && (
            <Select value={effectiveNodeId ?? ''} onValueChange={setNodeId}>
              <SelectTrigger className='w-40'>
                <SelectValue placeholder='Node' />
              </SelectTrigger>
              <SelectContent>
                {nodes.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        }
      />

      {error && <p className='text-sm text-error'>Could not load backup status.</p>}
      {status && <HealthBanner status={status} />}

      {status && (
        <>
          <div className='grid gap-4 @3xl:grid-cols-3'>
            <Card>
              <CardContent className='py-4'>
                <p className='label-hud text-xs text-muted-foreground'>REPOSITORY</p>
                <p className='text-xl tabular-nums'>
                  {status.repo_size_bytes != null
                    ? formatBytes(status.repo_size_bytes)
                    : '—'}
                </p>
                <p className='text-xs text-muted-foreground'>
                  {status.snapshot_count} snapshot
                  {status.snapshot_count === 1 ? '' : 's'}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className='py-4'>
                <p className='label-hud text-xs text-muted-foreground'>RETENTION</p>
                {status.retention ? (
                  <p className='text-xl tabular-nums'>
                    {status.retention.daily}d / {status.retention.weekly}w /{' '}
                    {status.retention.monthly}m
                  </p>
                ) : (
                  <p className='text-xl'>—</p>
                )}
                <p className='text-xs text-muted-foreground'>daily / weekly / monthly</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className='py-4 space-y-2'>
                <p className='label-hud text-xs text-muted-foreground'>JOB STEPS</p>
                <StepRow label='Database dumps' step={status.postgres_dump} icon={Database} />
                <StepRow label='Heartbeat' step={status.heartbeat} icon={HeartPulse} />
                <div className='flex items-center gap-2 text-sm'>
                  <Clock className='size-4 text-muted-foreground' />
                  <span className='flex-1'>Exit code</span>
                  <Badge
                    variant='outline'
                    className={cn(
                      'font-mono text-[10px]',
                      status.last_exit_code === 0 ? 'text-success' : 'text-error',
                    )}
                  >
                    {status.last_exit_code ?? '—'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Snapshots</CardTitle>
            </CardHeader>
            <CardContent>
              {status.snapshots.length === 0 ? (
                <p className='text-sm text-muted-foreground'>No snapshots recorded.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Taken</TableHead>
                      <TableHead>Host</TableHead>
                      <TableHead>Tags</TableHead>
                      <TableHead>Paths</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {status.snapshots.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className='font-mono text-xs'>{s.short_id}</TableCell>
                        <TableCell className='whitespace-nowrap'>{when(s.time)}</TableCell>
                        <TableCell className='text-muted-foreground'>{s.hostname}</TableCell>
                        <TableCell>
                          <div className='flex gap-1 flex-wrap'>
                            {s.tags.map((t) => (
                              <Badge key={t} variant='secondary' className='text-[10px]'>
                                {t}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className='font-mono text-xs text-muted-foreground truncate max-w-64'>
                          {s.paths.join(', ')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}

export default BackupsPage;
