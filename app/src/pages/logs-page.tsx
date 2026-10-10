import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Download, Eraser, Logs, Pause, Play, RefreshCw, ScrollText, SearchX } from 'lucide-react';
import { nodeDisplayName, useNodeName, useNodeStore } from '@/stores/nodes';
import { useContainersStore } from '@/stores/containers';
import { useNodeMeta } from '@/api/queries';
import { ALL_CONTAINERS, useContainerLogs, ViewLine } from '@/hooks/use-container-logs';
import { useAwaiting } from '@/hooks/use-awaiting';
import { PageHeader } from '@/components/page-header';
import { NodeSelect } from '@/components/node-select';
import { ALL_NODES, useNodeScope } from '@/hooks/use-node-scope';
import { SearchInput } from '@/components/search-input';
import { SegmentedControl } from '@/components/segmented-control';
import { EmptyState, NoNodesState } from '@/components/empty-state';
import { SETUP } from '@/lib/setup';
import { Hint } from '@/components/hint';
import { Dot } from '@/components/dot';
import { containerStateVariant } from '@/components/container-columns';
import { Card } from '@sunstead/ui/components/card';
import { Button } from '@sunstead/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@sunstead/ui/components/select';
import { stripAnsi } from '@/lib/ansi';
import { LogRow } from '@/components/log-row';
import { LogSkeleton } from '@/components/skeletons';
import { SelectSeparator } from '@sunstead/ui/components/select';

type Stream = 'all' | 'stdout' | 'stderr';

/** Timestamps stay in UTC ISO form here: a saved file should be unambiguous. */
function download(lines: ViewLine[], name: string, labelOf: (line: ViewLine) => string | undefined) {
  const text = lines
    .map((l) => {
      const label = labelOf(l);
      const who = label ? `[${label}] ` : '';
      return `${l.ts ? `${l.ts} ` : ''}${who}${stripAnsi(l.text)}`;
    })
    .join('\n');
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
  const nodes = useNodeStore((s) => s.nodes);
  const nodeCount = nodes.length;
  const allMeta = useNodeStore((s) => s.meta);
  const search = useSearch({ from: '/logs' });
  const navigate = useNavigate({ from: '/logs' });
  const [storedScope, setStoredScope, candidates] = useNodeScope('logs', { capability: 'container_logs', allowAll: true });
  const nodeContainers = useContainersStore((s) => s.nodeContainers);

  // A link (`?node=`) wins over the remembered choice.
  const scope =
    search.node && (search.node === ALL_NODES ? candidates.length > 1 : candidates.includes(search.node))
      ? search.node
      : storedScope;
  const allNodes = scope === ALL_NODES;
  const nodeId = allNodes ? null : scope;
  // Every node that can stream its containers merged, for "All nodes".
  const streamingNodes = useMemo(
    () =>
      allNodes
        ? candidates.filter((id) => allMeta[id]?.status === 'online' && allMeta[id]?.capabilities.all_logs)
        : [],
    [allNodes, candidates, allMeta],
  );
  const awaiting = useAwaiting(nodeContainers, nodeId);

  const containers = useMemo(
    () => [...(nodeId ? (nodeContainers[nodeId] ?? []) : [])].sort((a, b) => a.name.localeCompare(b.name)),
    [nodeContainers, nodeId],
  );
  const meta = useNodeMeta(nodeId);
  const nodeName = useNodeName(nodeId);
  const dockerDown = useContainersStore((s) => (nodeId ? !!s.dockerDown[nodeId] : false));
  const canAll = meta?.capabilities.all_logs ?? false;

  const containerId = allNodes
    ? ALL_CONTAINERS
    : search.container === ALL_CONTAINERS && canAll
      ? ALL_CONTAINERS
      : search.container && containers.some((c) => c.id === search.container)
        ? search.container
        : (containers.find((c) => c.state === 'running') ?? containers[0])?.id ?? null;
  const container = containers.find((c) => c.id === containerId);
  const showAll = containerId === ALL_CONTAINERS;
  // Container IDs are unique across nodes, so one map serves all of them.
  const names = useMemo(
    () =>
      new Map(
        (allNodes ? Object.values(nodeContainers).flat() : containers).map((c) => [c.id, c.name]),
      ),
    [allNodes, nodeContainers, containers],
  );
  const nodeNames = useMemo(() => new Map(nodes.map((n) => [n.id, nodeDisplayName(n)])), [nodes]);
  /** `pluto/cosmos-agent` when every node is shown, else the container. */
  const labelOf = (l: ViewLine) => {
    const container = l.container ? (names.get(l.container) ?? l.container.slice(0, 12)) : undefined;
    if (!l.node) return container;
    const node = nodeNames.get(l.node) ?? l.node;
    return container ? `${node}/${container}` : node;
  };
  const [follow, setFollow] = useState(true);
  const [query, setQuery] = useState('');
  const [stream, setStream] = useState<Stream>('all');

  const { lines, state, dropped, reason, clear, reconnect } = useContainerLogs({
    nodeId,
    nodeIds: allNodes ? streamingNodes : undefined,
    containerId,
    follow,
  });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q && stream === 'all') return lines;
    return lines.filter(
      (l) =>
        (stream === 'all' || l.stream === stream) &&
        (!q ||
          l.search.includes(q) ||
          (!!l.container && !!names.get(l.container)?.toLowerCase().includes(q)) ||
          (!!l.node && !!nodeNames.get(l.node)?.toLowerCase().includes(q))),
    );
  }, [lines, query, stream, names, nodeNames]);

  // JSON lines opened to show every field, by line ID.
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const toggle = useCallback(
    (id: number) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );

  // Only the rows on screen are rendered: a busy container keeps thousands.
  // Rows wrap and open, so each is measured once it renders. TanStack
  // Virtual, like Table, leaves the page unmemoized by the compiler; the
  // rows themselves are memoised.
  const viewport = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library
  const rows = useVirtualizer({
    count: visible.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => 20,
    getItemKey: (i) => visible[i].id,
    overscan: 20,
    paddingStart: 12,
    paddingEnd: 12,
  });

  // Stay pinned to the bottom while following, unless the user scrolled up.
  // A new stream (another container, or Follow after Pause) starts empty and
  // pins again.
  const pinned = useRef(true);
  useEffect(() => {
    if (lines.length === 0) pinned.current = true;
    else if (follow && pinned.current && visible.length > 0) rows.scrollToIndex(visible.length - 1, { align: 'end' });
  }, [lines.length, visible, follow, rows]);

  const selectNode = (id: string) => {
    setStoredScope(id);
    void navigate({ search: { node: id } });
  };
  const selectContainer = (id: string) =>
    void navigate({ search: { node: nodeId ?? undefined, container: id } });

  const enabled = meta?.capabilities.container_logs ?? true;

  const logView = () => (
    <Card className='min-h-0 flex-1 gap-0 py-0'>
      <div className='flex h-10 shrink-0 items-center gap-2 border-b px-3 text-xs text-muted-foreground'>
        <Dot variant={state === 'streaming' ? 'success' : state === 'error' ? 'error' : 'disabled'} pulse={state === 'streaming'} />
        {STATE_LABEL[state]}
        <span className='tabular-nums'>
          {visible.length.toLocaleString()}
          {visible.length !== lines.length && ` of ${lines.length.toLocaleString()}`} lines
        </span>
        {dropped > 0 && <span className='text-warning'>{dropped.toLocaleString()} dropped</span>}
        {follow && (state === 'closed' || state === 'error') && (
          <>
            {reason && <span className='truncate'>{reason}</span>}
            <Button variant='ghost' size='xs' className='ml-auto' onClick={reconnect}>
              <RefreshCw /> Reconnect
            </Button>
          </>
        )}
      </div>
      <div
        ref={viewport}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className='selectable min-h-0 flex-1 overflow-auto font-mono text-xs leading-relaxed'
      >
        {visible.length === 0 ? (
          <div className='p-3'>
            {lines.length === 0 && state === 'connecting' ? (
              <LogSkeleton />
            ) : lines.length === 0 ? (
              <p className='text-muted-foreground'>Waiting for output</p>
            ) : (
              <EmptyState size='inline' icon={SearchX} title='No matching lines' />
            )}
          </div>
        ) : (
          <div className='relative w-full' style={{ height: rows.getTotalSize() }}>
            {rows.getVirtualItems().map((item) => {
              const line = visible[item.index];
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={rows.measureElement}
                  className='absolute inset-x-0 top-0 px-3'
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <LogRow
                    line={line}
                    container={showAll ? labelOf(line) : undefined}
                    expanded={expanded.has(line.id)}
                    onToggle={toggle}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );

  const body = () => {
    if (nodeCount === 0) return <NoNodesState />;
    if (allNodes) {
      return streamingNodes.length === 0 ? (
        <EmptyState
          size='page'
          icon={ScrollText}
          title='No node is streaming logs'
          description='Nodes appear here once they are online and on agent 0.3 or later.'
        />
      ) : (
        logView()
      );
    }
    if (!nodeId || (meta?.status === 'online' && !enabled)) {
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
    if (containers.length === 0 && awaiting) {
      return (
        <Card className='min-h-0 flex-1 gap-0 py-0'>
          <div className='h-10 shrink-0 border-b' />
          <div className='p-3'>
            <LogSkeleton />
          </div>
        </Card>
      );
    }
    if (containers.length === 0) {
      return dockerDown ? (
        <EmptyState
          size='page'
          icon={ScrollText}
          title={`Docker isn't answering on ${nodeName ?? 'this node'}`}
          description='Logs come back when it does.'
        />
      ) : (
        <EmptyState size='page' icon={ScrollText} title='No containers on this node' />
      );
    }
    return logView();
  };

  return (
    <>
      <PageHeader
        title='Logs'
        actions={
          nodeCount > 0 && (
            <>
              <NodeSelect value={scope} onChange={selectNode} candidates={candidates} allowAll />
              {(allNodes || containers.length > 0) && (
                <>
                  {!allNodes && (
                    <Select
                      value={containerId}
                      onValueChange={(id) => id && selectContainer(id)}
                      items={[
                        { value: ALL_CONTAINERS, label: 'All containers' },
                        ...containers.map((c) => ({
                          value: c.id,
                          label: (
                            <>
                              <Dot variant={containerStateVariant(c.state)} />
                              {c.name}
                            </>
                          ),
                        })),
                      ]}
                    >
                      <SelectTrigger className='w-52' aria-label='Container'>
                        <SelectValue placeholder='Container' />
                      </SelectTrigger>
                      <SelectContent>
                        {canAll && (
                          <>
                            <SelectItem value={ALL_CONTAINERS}>All containers</SelectItem>
                            <SelectSeparator />
                          </>
                        )}
                        {containers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            <Dot variant={containerStateVariant(c.state)} />
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
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
                      onClick={() =>
                        download(
                          lines,
                          allNodes ? 'all-nodes' : showAll ? 'all-containers' : (container?.name ?? 'logs'),
                          labelOf,
                        )
                      }
                    >
                      <Download />
                    </Button>
                  </Hint>
                </>
              )}
            </>
          )
        }
      />
      {body()}
    </>
  );
}
