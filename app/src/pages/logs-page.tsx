import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Download, Eraser, Logs, Pause, Play, ScrollText, SearchX } from 'lucide-react';
import { useNodeStore } from '@/stores/nodes';
import { useContainersStore } from '@/stores/containers';
import { useNodeMeta } from '@/api/queries';
import { useContainerLogs } from '@/hooks/use-container-logs';
import { LogLine } from '@/generated/LogLine';
import { PageHeader } from '@/components/page-header';
import { NodeSelect, useSelectedNode } from '@/components/node-select';
import { SearchInput } from '@/components/search-input';
import { SegmentedControl } from '@/components/segmented-control';
import { EmptyState, NoNodesState } from '@/components/empty-state';
import { SETUP } from '@/components/setup-hint';
import { Hint } from '@/components/hint';
import { Dot } from '@/components/dot';
import { containerStateVariant } from '@/components/container-columns';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { stripAnsi } from '@/lib/ansi';
import { AnsiText } from '@/components/ansi-text';

type Stream = 'all' | 'stdout' | 'stderr';

function download(lines: LogLine[], name: string) {
  const text = lines.map((l) => (l.ts ? `${l.ts} ${stripAnsi(l.text)}` : stripAnsi(l.text))).join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${name}.log` });
  a.click();
  URL.revokeObjectURL(url);
}

const STATE_LABEL = {
  idle: 'Idle',
  connecting: 'Connecting',
  streaming: 'Live',
  closed: 'Ended',
  error: 'Error',
} as const;

export function LogsPage() {
  const nodeCount = useNodeStore((s) => s.nodes.length);
  const search = useSearch({ from: '/logs' });
  const navigate = useNavigate({ from: '/logs' });
  const [storedNode, setStoredNode] = useSelectedNode();
  const nodeContainers = useContainersStore((s) => s.nodeContainers);

  const nodeId = search.node ?? storedNode;
  const containers = useMemo(
    () => [...(nodeId ? (nodeContainers[nodeId] ?? []) : [])].sort((a, b) => a.name.localeCompare(b.name)),
    [nodeContainers, nodeId],
  );
  const containerId =
    search.container && containers.some((c) => c.id === search.container)
      ? search.container
      : (containers.find((c) => c.state === 'running') ?? containers[0])?.id ?? null;
  const container = containers.find((c) => c.id === containerId);

  const meta = useNodeMeta(nodeId);
  const [follow, setFollow] = useState(true);
  const [query, setQuery] = useState('');
  const [stream, setStream] = useState<Stream>('all');

  const { lines, state, dropped, clear } = useContainerLogs({ nodeId, containerId, follow });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines.filter(
      (l) => (stream === 'all' || l.stream === stream) && (!q || stripAnsi(l.text).toLowerCase().includes(q)),
    );
  }, [lines, query, stream]);

  // Stay pinned to the bottom while following, unless the user scrolled up.
  const viewport = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = viewport.current;
    if (el && follow && pinned.current) el.scrollTop = el.scrollHeight;
  }, [visible, follow]);

  const selectNode = (id: string) => {
    setStoredNode(id);
    void navigate({ search: { node: id } });
  };
  const selectContainer = (id: string) =>
    void navigate({ search: { node: nodeId ?? undefined, container: id } });

  const enabled = meta?.capabilities.container_logs ?? true;

  const body = () => {
    if (nodeCount === 0) return <NoNodesState />;
    if (meta?.status === 'online' && !enabled) {
      return (
        <EmptyState
          size='page'
          icon={Logs}
          title='Logs not enabled'
          description='This agent does not stream container logs.'
          setup={SETUP.logs}
        />
      );
    }
    if (containers.length === 0) {
      return <EmptyState size='page' icon={ScrollText} title='No containers on this node' />;
    }
    return (
      <Card className='min-h-0 flex-1 gap-0 py-0'>
        <div className='flex h-10 shrink-0 items-center gap-2 border-b px-3 text-xs text-muted-foreground'>
          <Dot variant={state === 'streaming' ? 'success' : state === 'error' ? 'error' : 'disabled'} pulse={state === 'streaming'} />
          {STATE_LABEL[state]}
          <span className='tabular-nums'>
            {visible.length.toLocaleString()}
            {visible.length !== lines.length && ` of ${lines.length.toLocaleString()}`} lines
          </span>
          {dropped > 0 && <span className='text-warning'>{dropped.toLocaleString()} dropped</span>}
        </div>
        <div
          ref={viewport}
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
          className='selectable min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed'
        >
          {visible.length === 0 ? (
            lines.length === 0 ? (
              <p className='text-muted-foreground'>Waiting for output</p>
            ) : (
              <EmptyState size='inline' icon={SearchX} title='No matching lines' />
            )
          ) : (
            visible.map((line, i) => (
              <div
                key={i}
                className={cn('break-all whitespace-pre-wrap', line.stream === 'stderr' && 'text-error')}
              >
                {line.ts && (
                  <span className='mr-3 text-muted-foreground/60 select-none'>
                    {line.ts.slice(11, 19)}
                  </span>
                )}
                <AnsiText text={line.text} />
              </div>
            ))
          )}
        </div>
      </Card>
    );
  };

  return (
    <>
      <PageHeader
        title='Logs'
        actions={
          nodeCount > 0 &&
          containers.length > 0 && (
            <>
              <NodeSelect value={nodeId} onChange={selectNode} />
              <Select value={containerId ?? ''} onValueChange={selectContainer}>
                <SelectTrigger className='w-52' aria-label='Container'>
                  <SelectValue placeholder='Container' />
                </SelectTrigger>
                <SelectContent>
                  {containers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <Dot variant={containerStateVariant(c.state)} />
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <SearchInput value={query} onChange={setQuery} placeholder='Filter lines' />
              <SegmentedControl<Stream>
                label='Stream'
                value={stream}
                onChange={setStream}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'stdout', label: 'Out' },
                  { value: 'stderr', label: 'Err' },
                ]}
              />
              <Hint label={follow ? 'Pause' : 'Follow'}>
                <Button
                  variant='outline'
                  size='icon'
                  aria-label={follow ? 'Pause' : 'Follow'}
                  aria-pressed={follow}
                  onClick={() => setFollow((f) => !f)}
                >
                  {follow ? <Pause /> : <Play />}
                </Button>
              </Hint>
              <Hint label='Clear'>
                <Button variant='outline' size='icon' aria-label='Clear' onClick={clear}>
                  <Eraser />
                </Button>
              </Hint>
              <Hint label='Download'>
                <Button
                  variant='outline'
                  size='icon'
                  aria-label='Download'
                  disabled={lines.length === 0}
                  onClick={() => download(lines, container?.name ?? 'logs')}
                >
                  <Download />
                </Button>
              </Hint>
            </>
          )
        }
      />
      {body()}
    </>
  );
}
