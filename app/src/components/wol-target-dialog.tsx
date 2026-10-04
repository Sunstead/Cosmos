import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@sunstead/ui/components/select';
import { useTailnet, useWol, useWolActionNodes, useWolActions } from '@/api/queries';
import { getConnection, nodeDisplayName, useNodeStore } from '@/stores/nodes';
import { WolTarget } from '@/generated/WolTarget';
import { WolTargetInput } from '@/generated/WolTargetInput';
import { osLabel } from '@/lib/tailnet';

/** Radix Select can't use an empty value, so "none" gets a sentinel. */
const NONE = '__none';

export function WolTargetDialog({
  open,
  onOpenChange,
  nodeId,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fixed when editing; otherwise the form offers the nodes that can wake. */
  nodeId?: string;
  target?: WolTarget;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Mounted only while open so fields start from the target. */}
      {open && <TargetForm nodeId={nodeId} target={target} onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function parseProbe(raw: string): WolTargetInput['probe'] | 'invalid' {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const at = trimmed.lastIndexOf(':');
  const port = Number(trimmed.slice(at + 1));
  if (at <= 0 || !Number.isInteger(port) || port < 1 || port > 65535) return 'invalid';
  return { host: trimmed.slice(0, at), port };
}

function TargetForm({
  nodeId: fixedNode,
  target,
  onDone,
}: {
  nodeId?: string;
  target?: WolTarget;
  onDone: () => void;
}) {
  const wol = useWol();
  const tailnet = useTailnet();
  const nodes = useNodeStore((s) => s.nodes);
  const actionNodes = useWolActionNodes();
  const { save } = useWolActions();

  const [nodeId, setNodeId] = useState(fixedNode ?? actionNodes[0] ?? '');
  const [name, setName] = useState(target?.name ?? '');
  const [mac, setMac] = useState(target?.mac ?? '');
  const [broadcast, setBroadcast] = useState(target?.broadcast ?? NONE);
  const [port, setPort] = useState(String(target?.port ?? 9));
  const [device, setDevice] = useState(target?.tailnet_device ?? NONE);
  const [probe, setProbe] = useState(target?.probe ? `${target.probe.host}:${target.probe.port}` : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const neighbors = useQuery({
    queryKey: ['wol-neighbors', nodeId],
    queryFn: () => getConnection(nodeId)!.client.getWolNeighbors(),
    enabled: !!nodeId && !!getConnection(nodeId),
    staleTime: 30_000,
    retry: false,
  });

  const networks = wol.networks[nodeId] ?? [];
  // Offer the saved broadcast even if the interface has since gone.
  const broadcastOptions =
    target?.broadcast && !networks.some((n) => n.broadcast === target.broadcast)
      ? [...networks, { interface: 'saved', cidr: target.broadcast, broadcast: target.broadcast }]
      : networks;
  const devices = tailnet.devices.filter((d) => d.nodeId === null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedProbe = parseProbe(probe);
    if (parsedProbe === 'invalid') {
      setError('Check address should look like 192.168.1.20:3389.');
      return;
    }
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      setError('Port must be between 1 and 65535.');
      return;
    }
    const input: WolTargetInput = {
      name,
      mac,
      broadcast: broadcast === NONE ? null : broadcast,
      port: portNum,
      tailnet_device: device === NONE ? null : device,
      probe: parsedProbe,
    };

    setBusy(true);
    setError(null);
    try {
      await save(nodeId, input, target?.id);
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
        <DialogTitle>
          {target ? `Edit ${target.name}` : 'Add a machine to wake'}
        </DialogTitle>
        <DialogDescription>
          The node sends the magic packet on its own network, so pick the one on the same
          LAN.
        </DialogDescription>
      </DialogHeader>

      <form id='wol-target' onSubmit={(e) => void submit(e)}>
        <FieldGroup>
          {!fixedNode && actionNodes.length > 1 && (
            <Field>
              <FieldLabel htmlFor='wol-node'>Node</FieldLabel>
              <Select
                value={nodeId}
                onValueChange={(v) => v && setNodeId(v)}
                items={actionNodes.map((id) => {
                  const node = nodes.find((n) => n.id === id);
                  return { value: id, label: node ? nodeDisplayName(node) : id };
                })}
              >
                <SelectTrigger id='wol-node'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {actionNodes.map((id) => {
                    const node = nodes.find((n) => n.id === id);
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
            <FieldLabel htmlFor='wol-name'>Name</FieldLabel>
            <Input
              id='wol-name'
              value={name}
              placeholder='desktop'
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </Field>

          <Field>
            <FieldLabel htmlFor='wol-mac'>MAC address</FieldLabel>
            <Input
              id='wol-mac'
              value={mac}
              placeholder='aa:bb:cc:dd:ee:ff'
              onChange={(e) => setMac(e.target.value)}
              className='font-mono'
              required
            />
            {(neighbors.data?.neighbors.length ?? 0) > 0 && (
              <Select value={null} onValueChange={(v) => v && setMac(v)}>
                <SelectTrigger
                  aria-label='Pick a recently seen machine'
                  className='w-full'
                >
                  <SelectValue placeholder='Or pick a machine the node has seen' />
                </SelectTrigger>
                <SelectContent>
                  {neighbors.data!.neighbors.map((n) => (
                    <SelectItem key={`${n.interface}:${n.mac}`} value={n.mac}>
                      <span className='font-mono text-xs'>{n.ip}</span>
                      <span className='font-mono text-xs text-muted-foreground'>
                        {n.mac}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor='wol-device'>Tailnet device</FieldLabel>
            <Select
              value={device}
              onValueChange={(v) => v && setDevice(v)}
              items={[
                { value: NONE, label: 'Not on the tailnet' },
                ...devices.map((d) => ({ value: d.id, label: d.name })),
              ]}
            >
              <SelectTrigger id='wol-device'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not on the tailnet</SelectItem>
                {devices.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                    <span className='text-xs text-muted-foreground'>{osLabel(d.os)}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>How Cosmos tells it woke up.</FieldDescription>
          </Field>

          <div className='grid grid-cols-[minmax(0,1fr)_6rem] gap-3'>
            <Field>
              <FieldLabel htmlFor='wol-broadcast'>Send to</FieldLabel>
              <Select
                value={broadcast}
                onValueChange={(v) => v && setBroadcast(v)}
                items={[
                  { value: NONE, label: 'Every network (255.255.255.255)' },
                  ...broadcastOptions.map((n) => ({
                    value: n.broadcast,
                    label: n.broadcast,
                  })),
                ]}
              >
                <SelectTrigger id='wol-broadcast'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Every network (255.255.255.255)</SelectItem>
                  {broadcastOptions.map((n) => (
                    <SelectItem key={`${n.interface}:${n.broadcast}`} value={n.broadcast}>
                      {n.broadcast}
                      <span className='text-xs text-muted-foreground'>
                        {n.interface} {n.cidr}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor='wol-port'>Port</FieldLabel>
              <Input
                id='wol-port'
                inputMode='numeric'
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className='font-mono'
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor='wol-probe'>Check address (optional)</FieldLabel>
            <Input
              id='wol-probe'
              value={probe}
              placeholder='192.168.1.20:3389'
              onChange={(e) => setProbe(e.target.value)}
              className='font-mono'
            />
            <FieldDescription>
              For machines not on the tailnet. Any answer on this port counts as awake.
            </FieldDescription>
          </Field>

          {error && (
            <p role='alert' className='text-sm text-error'>
              {error}
            </p>
          )}
        </FieldGroup>
      </form>

      <DialogFooter>
        <DialogClose render={<Button variant='outline' />}>Cancel</DialogClose>
        <Button form='wol-target' type='submit' disabled={busy || !nodeId}>
          {target ? 'Save' : 'Add'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
