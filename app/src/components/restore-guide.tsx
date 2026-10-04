import { useState } from 'react';
import { Check, Copy, TriangleAlert } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@sunstead/ui/components/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@sunstead/ui/components/field';
import { Input } from '@sunstead/ui/components/input';
import { Button } from '@sunstead/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@sunstead/ui/components/select';
import { SegmentedControl } from '@/components/segmented-control';
import { BackupDatabase } from '@/generated/BackupDatabase';
import { BackupSnapshotInfo } from '@/generated/BackupSnapshotInfo';
import { restoreSteps, RestoreRepo, RestoreStep, RestoreTarget } from '@/lib/restore';
import { cn } from '@/lib/utils';

type What = 'files' | 'database' | 'env';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant='ghost'
      size='icon-sm'
      className='shrink-0'
      aria-label='Copy command'
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1_500);
        });
      }}
    >
      {copied ? <Check className='text-success' /> : <Copy />}
    </Button>
  );
}

function StepList({ steps }: { steps: RestoreStep[] }) {
  return (
    <ol className='space-y-3'>
      {steps.map((step, i) => (
        <li key={step.title} className='space-y-1.5'>
          <div className='flex items-center gap-2 text-sm font-medium'>
            <span className='flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-2xs tabular-nums'>
              {i + 1}
            </span>
            {step.title}
            {step.warning && (
              <span className='flex items-center gap-1 text-xs font-normal text-warning'>
                <TriangleAlert className='size-3.5' /> {step.warning}
              </span>
            )}
          </div>
          {step.command && (
            <div
              className={cn(
                'flex items-start gap-1 rounded-md border bg-muted/40 py-1 pr-1 pl-3',
                step.warning && 'border-warning/40',
              )}
            >
              <code className='selectable min-w-0 flex-1 py-1 font-mono text-xs wrap-anywhere'>
                {step.command}
              </code>
              <CopyButton text={step.command} />
            </div>
          )}
          {step.note && <p className='text-xs text-muted-foreground'>{step.note}</p>}
        </li>
      ))}
    </ol>
  );
}

export function RestoreGuide({
  open,
  onOpenChange,
  snapshot,
  databases,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: BackupSnapshotInfo;
  databases: BackupDatabase[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <GuideBody snapshot={snapshot} databases={databases} />}
    </Dialog>
  );
}

function GuideBody({
  snapshot,
  databases,
}: {
  snapshot: BackupSnapshotInfo;
  databases: BackupDatabase[];
}) {
  const [what, setWhat] = useState<What>('files');
  const [repo, setRepo] = useState<RestoreRepo>('primary');
  const [path, setPath] = useState('');
  const [dbName, setDbName] = useState(databases[0]?.name ?? '');

  const database = databases.find((d) => d.name === dbName);
  let target: RestoreTarget | null = null;
  if (what === 'files' && path.trim().startsWith('/')) target = { kind: 'files', path };
  if (what === 'database' && database) target = { kind: 'database', database };
  if (what === 'env') target = { kind: 'env' };
  const steps = target ? restoreSteps(snapshot.short_id, repo, target) : [];

  const options: { value: What; label: string }[] = [
    { value: 'files', label: 'Files' },
    ...(databases.length > 0
      ? [{ value: 'database' as const, label: 'A database' }]
      : []),
    { value: 'env', label: '.env' },
  ];

  return (
    <DialogContent className='sm:max-w-xl'>
      <DialogHeader>
        <DialogTitle>Restore from {snapshot.short_id}</DialogTitle>
        <DialogDescription>
          Run these on the server, from the checkout with docker-compose.yml. Cosmos never
          restores anything itself.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup>
        <Field>
          <FieldLabel>Restore</FieldLabel>
          <SegmentedControl<What>
            label='What to restore'
            value={what}
            onChange={setWhat}
            options={options}
          />
        </Field>

        {what === 'files' && (
          <Field>
            <FieldLabel htmlFor='restore-path'>Path</FieldLabel>
            <Input
              id='restore-path'
              value={path}
              placeholder={`${snapshot.paths[0] ?? '/srv/storage'}/...`}
              onChange={(e) => setPath(e.target.value)}
              className='font-mono'
              autoFocus
            />
            <FieldDescription>
              A file or folder, as it was on the server.
            </FieldDescription>
          </Field>
        )}

        {what === 'database' && (
          <Field>
            <FieldLabel htmlFor='restore-db'>Database</FieldLabel>
            <Select value={dbName} onValueChange={(v) => v && setDbName(v)}>
              <SelectTrigger id='restore-db'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {databases.map((d) => (
                  <SelectItem key={d.name} value={d.name}>
                    {d.name}
                    <span className='text-xs text-muted-foreground'>
                      {d.used_by.join(', ')}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        <Field>
          <FieldLabel>From</FieldLabel>
          <SegmentedControl<RestoreRepo>
            label='Repository'
            value={repo}
            onChange={setRepo}
            options={[
              { value: 'primary', label: 'This snapshot' },
              { value: 'state', label: 'State copy' },
            ]}
          />
          <FieldDescription>
            {repo === 'primary'
              ? 'The primary repository, which has everything.'
              : 'The copy on the other disk, for when the primary is gone. It has the databases, volumes and .env, and uses its newest snapshot.'}
          </FieldDescription>
        </Field>

        {steps.length > 0 ? (
          <StepList steps={steps} />
        ) : (
          <p className='text-sm text-muted-foreground'>
            Enter a path that starts with /.
          </p>
        )}
      </FieldGroup>
    </DialogContent>
  );
}
