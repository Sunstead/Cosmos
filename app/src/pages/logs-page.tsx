import { useEffect, useMemo, useRef, useState } from 'react';
import { Logs, Pause, Play, Trash2 } from 'lucide-react';
import { useNodeStore } from '@/stores/nodes';
import { useContainersStore } from '@/stores/containers';
import { useNodeMeta } from '@/api/queries';
import { useContainerLogs } from '@/hooks/use-container-logs';
import { PageHeader } from '@/components/page-header';
import { FeatureDisabled, NoNodes } from '@/components/feature-state';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export function LogsPage() {
  const nodes = useNodeStore((s) => s.nodes);
  const nodeContainers = useContainersStore((s) => s.nodeContainers);

  const [nodeId, setNodeId] = useState<string | null>(nodes[0]?.id ?? null);
  const [containerId, setContainerId] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [filter, setFilter] = useState('');

  // Derived, not synced: the selection falls back to the first available
  // option whenever the stored one is gone, without an effect writing state.
  const effectiveNodeId = nodeId ?? nodes[0]?.id ?? null;
  const meta = useNodeMeta(effectiveNodeId);
  const containers = effectiveNodeId ? (nodeContainers[effectiveNodeId] ?? []) : [];

  const effectiveContainerId =
    containerId && containers.some((c) => c.id === containerId)
      ? containerId
      : (containers[0]?.id ?? null);

  const { lines, state, dropped, clear } = useContainerLogs({
    nodeId: effectiveNodeId,
    containerId: effectiveContainerId,
    follow,
  });

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return lines;
    return lines.filter((l) => l.text.toLowerCase().includes(needle));
  }, [lines, filter]);

  // Stick to the bottom while following, but don't fight the user scrolling up.
  const viewport = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = viewport.current;
    if (!el || !follow || !pinned.current) return;
    el.scrollTop = el.scrollHeight;
  }, [filtered, follow]);

  if (nodes.length === 0) return <NoNodes what='container logs' />;

  if (meta && !meta.capabilities.container_logs) {
    return (
      <>
        <PageHeader title='LOGS' />
        <FeatureDisabled
          icon={Logs}
          title='Logs are disabled on this agent'
          description={
            <>
              Set <code>allow_logs = true</code> in the agent&rsquo;s{' '}
              <code>agent.toml</code> and restart it.
            </>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title='LOGS'
        actions={
          <div className='flex items-center gap-2'>
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

            <Select value={effectiveContainerId ?? ''} onValueChange={setContainerId}>
              <SelectTrigger className='w-56'>
                <SelectValue placeholder='Container' />
              </SelectTrigger>
              <SelectContent>
                {containers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant={follow ? 'default' : 'outline'}
              size='icon'
              onClick={() => setFollow((f) => !f)}
              title={follow ? 'Pause' : 'Follow'}
            >
              {follow ? <Pause /> : <Play />}
            </Button>
            <Button variant='outline' size='icon' onClick={clear} title='Clear'>
              <Trash2 />
            </Button>
          </div>
        }
      />

      <div className='flex items-center gap-2'>
        <Input
          placeholder='Filter lines…'
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className='max-w-sm'
        />
        <Badge variant='outline' className='font-mono text-[10px]'>
          {state}
        </Badge>
        <span className='text-xs text-muted-foreground tabular-nums'>
          {filtered.length.toLocaleString()} line{filtered.length === 1 ? '' : 's'}
          {filter && ` of ${lines.length.toLocaleString()}`}
        </span>
        {dropped > 0 && (
          <span className='text-xs text-warning'>
            {dropped.toLocaleString()} dropped (output faster than the stream)
          </span>
        )}
      </div>

      <Card className='h-[calc(100vh-17rem)] min-h-64'>
        <CardContent className='h-full p-0'>
          <div
            ref={viewport}
            onScroll={(e) => {
              const el = e.currentTarget;
              pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
            className='h-full overflow-auto font-mono text-xs leading-relaxed p-3'
          >
            {filtered.length === 0 ? (
              <p className='text-muted-foreground'>
                {effectiveContainerId ? 'No output yet.' : 'Select a container.'}
              </p>
            ) : (
              filtered.map((line, i) => (
                <div
                  key={`${line.ts ?? ''}-${i}`}
                  className={cn(
                    'whitespace-pre-wrap break-all',
                    line.stream === 'stderr' && 'text-error',
                  )}
                >
                  {line.ts && (
                    <span className='text-muted-foreground/60 mr-2 select-none'>
                      {line.ts.slice(11, 19)}
                    </span>
                  )}
                  {line.text}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

export default LogsPage;
