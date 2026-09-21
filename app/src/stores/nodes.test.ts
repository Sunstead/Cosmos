import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEventSource, mockFetch, settle } from '@/test/fakes';
import { agentInfo, hostInfo } from '@/test/fixtures';
import { migrateNode, nodeDisplayName, useNodeStore } from './nodes';

describe('node store', () => {
  beforeEach(() => {
    FakeEventSource.reset();
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        mockFetch({
          '/v1/info': { body: agentInfo() },
          '/v1/host': { body: hostInfo() },
          '/v1/volumes': { body: { volumes: [], sampled_at: 0 } },
        }),
      ),
    );
  });

  afterEach(() => {
    for (const n of useNodeStore.getState().nodes) useNodeStore.getState().removeNode(n.id);
    vi.unstubAllGlobals();
  });

  it('adds a node after probing it', async () => {
    const result = await useNodeStore.getState().addNode('agent.test', 'tok');
    expect(result.ok).toBe(true);
    const [node] = useNodeStore.getState().nodes;
    expect(node.url).toBe('http://agent.test:7700');
    expect(node.agentName).toBe('jupiter');
  });

  it('keeps the nodes array stable across identical samples', async () => {
    // Regression: a stale comparison rewrote `nodes` on every sample, which
    // re-rendered the shell and rebuilt the constellation once a second.
    await useNodeStore.getState().addNode('agent.test', 'tok');
    await settle();

    const stream = FakeEventSource.latest('/v1/host/stream')!;
    stream.emit(hostInfo({ seq: 1 }));
    const before = useNodeStore.getState().nodes;

    for (let seq = 2; seq < 10; seq += 1) stream.emit(hostInfo({ seq }));
    expect(useNodeStore.getState().nodes).toBe(before);
  });

  it('updates the agent name only when it changes', async () => {
    await useNodeStore.getState().addNode('agent.test', 'tok');
    await settle();
    const stream = FakeEventSource.latest('/v1/host/stream')!;

    stream.emit(hostInfo({ name: 'saturn' }));
    const [node] = useNodeStore.getState().nodes;
    expect(node.agentName).toBe('saturn');
  });

  it('prefers a local alias over the agent name', async () => {
    await useNodeStore.getState().addNode('agent.test', 'tok');
    await settle();
    const id = useNodeStore.getState().nodes[0].id;

    useNodeStore.getState().renameNode(id, 'Media box');
    FakeEventSource.latest('/v1/host/stream')!.emit(hostInfo({ name: 'jupiter' }));

    expect(nodeDisplayName(useNodeStore.getState().nodes[0])).toBe('Media box');

    useNodeStore.getState().renameNode(id, '  ');
    expect(nodeDisplayName(useNodeStore.getState().nodes[0])).toBe('jupiter');
  });

  it('rejects a duplicate URL', async () => {
    await useNodeStore.getState().addNode('agent.test', 'tok');
    const again = await useNodeStore.getState().addNode('http://agent.test:7700', 'tok');
    expect(again).toEqual({ ok: false, error: expect.stringMatching(/already/i) });
  });

  it('rejects a missing token when the agent requires one', async () => {
    const result = await useNodeStore.getState().addNode('agent.test');
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/token/i) });
    expect(useNodeStore.getState().nodes).toHaveLength(0);
  });

  it('counts online nodes from stream events', async () => {
    await useNodeStore.getState().addNode('agent.test', 'tok');
    await settle();
    expect(useNodeStore.getState().onlineNodes).toBe(0);

    FakeEventSource.latest('/v1/host/stream')!.emit(hostInfo());
    expect(useNodeStore.getState().onlineNodes).toBe(1);
  });
});

describe('migrateNode', () => {
  it('moves the legacy name into agentName', () => {
    expect(migrateNode({ id: 'a', url: 'http://x:7700', name: 'jupiter' })).toEqual({
      id: 'a',
      url: 'http://x:7700',
      agentName: 'jupiter',
      alias: null,
    });
  });

  it('drops a legacy name that was just the URL placeholder', () => {
    expect(migrateNode({ id: 'a', url: 'http://x:7700', name: 'http://x:7700' })?.agentName).toBeNull();
  });

  it('rejects malformed entries', () => {
    expect(migrateNode(null)).toBeNull();
    expect(migrateNode({ id: 1 })).toBeNull();
  });
});
