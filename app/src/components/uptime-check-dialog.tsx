import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@sunstead/ui/components/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@sunstead/ui/components/field';
import { Input } from '@sunstead/ui/components/input';
import { Button } from '@sunstead/ui/components/button';
import { Checkbox } from '@sunstead/ui/components/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@sunstead/ui/components/select';
import { SegmentedControl } from '@/components/segmented-control';
import { usePeers, useUptimeActions } from '@/api/queries';
import { nodeDisplayName, useNodeStore } from '@/stores/nodes';
import { CheckKind } from '@/generated/CheckKind';
import { UptimeCheck } from '@/generated/UptimeCheck';
import { UptimeEntry } from '@/generated/UptimeEntry';
import { formatLatency, INTERVALS } from '@/lib/uptime';

/** Says how the first run went, since the agent answers with it. */
function reportFirstRun(entry: UptimeEntry, verb: string) {
  const last = entry.recent.at(-1);
  if (!last || !entry.check.enabled) {
    toast.success(`${verb} ${entry.check.name}`);
  } else if (last.ok) {
    toast.success(`${verb} ${entry.check.name}`, {
      description:
        last.latency_ms !== null
          ? `It's up, answering in ${formatLatency(last.latency_ms)}.`
          : "It's up.",
    });
  } else {
    toast.warning(`${verb} ${entry.check.name}, but it failed`, {
      description: last.detail ?? undefined,
    });
  }
}

export function UptimeCheckDialog({
  open,
  onOpenChange,
  nodes,
  nodeId,
  check,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nodes that can run checks; the form offers them when adding. */
  nodes: string[];
  nodeId?: string;
  check?: UptimeCheck;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Mounted only while open so fields start from the check. */}
      {open &&
        (check?.source === 'service' && nodeId ? (
          <ServiceForm nodeId={nodeId} check={check} onDone={() => onOpenChange(false)} />
        ) : (
          <CustomForm
            nodes={nodes}
            nodeId={nodeId}
            check={check}
            onDone={() => onOpenChange(false)}
          />
        ))}
    </Dialog>
  );
}

function CustomForm({
  nodes,
  nodeId: fixedNode,
  check,
  onDone,
}: {
  nodes: string[];
  nodeId?: string;
  check?: UptimeCheck;
  onDone: () => void;
}) {
  const allNodes = useNodeStore((s) => s.nodes);
  const { save } = useUptimeActions();
  // With several nodes the choice is deliberate: where a check runs from
  // decides what it tests (Pluto's checks take the public path).
  const [nodeId, setNodeId] = useState(fixedNode ?? (nodes.length === 1 ? nodes[0] : ''));
  const [name, setName] = useState(check?.name ?? '');
  const [kind, setKind] = useState<CheckKind>(check?.kind ?? 'http');
  const [target, setTarget] = useState(check?.target ?? '');
  const [interval, setInterval] = useState(String(check?.interval_secs ?? 60));
  const [anyStatus, setAnyStatus] = useState(check?.any_status ?? false);
  const [enabled, setEnabled] = useState(check?.enabled ?? true);
  const NO_PEER = 'none';
  const [viaPeer, setViaPeer] = useState(check?.via_peer ?? NO_PEER);
  const peers = usePeers(nodeId || null).data?.peers ?? [];
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Keep a saved interval that isn't one of the presets.
  const intervals = INTERVALS.some((i) => String(i.value) === interval)
    ? INTERVALS
    : [...INTERVALS, { value: Number(interval), label: `${interval} seconds` }];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const entry = await save(
        nodeId,
        {
          name,
          kind,
          target,
          interval_secs: Number(interval),
          enabled,
          any_status: kind === 'http' && anyStatus,
          via_peer: viaPeer === NO_PEER ? null : viaPeer,
        },
        check?.id,
      );
      reportFirstRun(entry, check ? 'Saved' : 'Added');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{check ? `Edit ${check.name}` : 'Add an uptime check'}</DialogTitle>
        <DialogDescription>
          The node runs it from where it is, so pick one that can reach the target. Three
          failures in a row open a problem.
        </DialogDescription>
      </DialogHeader>

      <form id='uptime-check' onSubmit={(e) => void submit(e)}>
        <FieldGroup>
          {!fixedNode && nodes.length > 1 && (
            <Field>
              <FieldLabel htmlFor='uptime-node'>Checked from</FieldLabel>
              <Select
                value={nodeId}
                onValueChange={(v) => v && setNodeId(v)}
                items={nodes.map((id) => {
                  const node = allNodes.find((n) => n.id === id);
                  return { value: id, label: node ? nodeDisplayName(node) : id };
                })}
              >
                <SelectTrigger id='uptime-node'>
                  <SelectValue placeholder='Pick a node' />
                </SelectTrigger>
                <SelectContent>
                  {nodes.map((id) => {
                    const node = allNodes.find((n) => n.id === id);
                    return (
                      <SelectItem key={id} value={id}>
                        {node ? nodeDisplayName(node) : id}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </Field>
          )}

          <Field>
            <FieldLabel htmlFor='uptime-name'>Name</FieldLabel>
            <Input
              id='uptime-name'
              value={name}
              placeholder='router'
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </Field>

          <Field>
            <FieldLabel>Check</FieldLabel>
            <SegmentedControl<CheckKind>
              label='Check type'
              value={kind}
              onChange={setKind}
              options={[
                { value: 'http', label: 'HTTP' },
                { value: 'tcp', label: 'TCP port' },
              ]}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor='uptime-target'>
              {kind === 'http' ? 'URL' : 'Address'}
            </FieldLabel>
            <Input
              id='uptime-target'
              value={target}
              placeholder={
                kind === 'http' ? 'https://example.com/health' : '192.168.1.1:443'
              }
              onChange={(e) => setTarget(e.target.value)}
              className='font-mono'
              required
            />
            <FieldDescription>
              {kind === 'http'
                ? 'Up when it answers below 400. Redirects count as up and are not followed.'
                : 'Up when something accepts a connection on this port.'}
            </FieldDescription>
            {kind === 'http' && (
              <label className='flex items-center gap-2 text-sm'>
                <Checkbox
                  checked={anyStatus}
                  onCheckedChange={(v) => setAnyStatus(v === true)}
                />
                Any HTTP response counts as up
              </label>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor='uptime-interval'>Every</FieldLabel>
            <Select
              value={interval}
              onValueChange={(v) => v && setInterval(v)}
              items={intervals.map((i) => ({ value: String(i.value), label: i.label }))}
            >
              <SelectTrigger id='uptime-interval'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {intervals.map((i) => (
                  <SelectItem key={i.value} value={String(i.value)}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {peers.length > 0 && (
            <Field>
              <FieldLabel htmlFor='uptime-via'>Goes through</FieldLabel>
              <Select
                value={viaPeer}
                onValueChange={(v) => v && setViaPeer(v)}
                items={[
                  { value: NO_PEER, label: 'Nothing else' },
                  ...peers.map((p) => ({ value: p.name, label: p.name })),
                ]}
              >
                <SelectTrigger id='uptime-via'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PEER}>Nothing else</SelectItem>
                  {peers.map((p) => (
                    <SelectItem key={p.name} value={p.name}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                A peer the target is reached through. While it's unreachable, this check's failures
                don't notify on their own: the peer's alert covers them.
              </FieldDescription>
            </Field>
          )}

          {check && (
            <label className='flex items-center gap-2 text-sm'>
              <Checkbox
                checked={enabled}
                onCheckedChange={(v) => setEnabled(v === true)}
              />
              On
            </label>
          )}

          {error && (
            <p role='alert' className='text-sm text-error'>
              {error}
            </p>
          )}
        </FieldGroup>
      </form>

      <DialogFooter>
        <DialogClose render={<Button variant='outline' />}>Cancel</DialogClose>
        <Button form='uptime-check' type='submit' disabled={busy || !nodeId}>
          {busy ? 'Checking' : check ? 'Save' : 'Add'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/** The part of the URL after the host, for editing a service's path. */
function pathOf(target: string): string {
  try {
    const url = new URL(target);
    return `${url.pathname}${url.search}`;
  } catch {
    return '/';
  }
}

function ServiceForm({
  nodeId,
  check,
  onDone,
}: {
  nodeId: string;
  check: UptimeCheck;
  onDone: () => void;
}) {
  const { saveService } = useUptimeActions();
  const service = check.service ?? check.name;
  const [enabled, setEnabled] = useState(check.enabled);
  const [path, setPath] = useState(pathOf(check.target));
  const [anyStatus, setAnyStatus] = useState(check.any_status);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const entry = await saveService(nodeId, service, {
        enabled,
        path,
        any_status: anyStatus,
      });
      reportFirstRun(entry, 'Saved');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Check for {check.name}</DialogTitle>
        <DialogDescription>
          Made from the service's cosmos.service.url label. It runs while one of its
          containers is running.
        </DialogDescription>
      </DialogHeader>

      <form id='uptime-service' onSubmit={(e) => void submit(e)}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor='uptime-path'>Path</FieldLabel>
            <Input
              id='uptime-path'
              value={path}
              placeholder='/'
              onChange={(e) => setPath(e.target.value)}
              className='font-mono'
            />
            <FieldDescription>
              A health endpoint if the app has one, such as /api/server/ping for Immich.
            </FieldDescription>
            <label className='flex items-center gap-2 text-sm'>
              <Checkbox
                checked={anyStatus}
                onCheckedChange={(v) => setAnyStatus(v === true)}
              />
              Any HTTP response counts as up
            </label>
          </Field>

          <label className='flex items-center gap-2 text-sm'>
            <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
            Check this service
          </label>

          {error && (
            <p role='alert' className='text-sm text-error'>
              {error}
            </p>
          )}
        </FieldGroup>
      </form>

      <DialogFooter>
        <DialogClose render={<Button variant='outline' />}>Cancel</DialogClose>
        <Button form='uptime-service' type='submit' disabled={busy}>
          {busy ? 'Checking' : 'Save'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
