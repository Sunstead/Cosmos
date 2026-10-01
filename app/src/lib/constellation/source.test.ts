import { beforeEach, describe, expect, it } from 'vitest';
import { useContainersStore } from '@/stores/containers';
import { DEFAULT_META, useNodeStore } from '@/stores/nodes';
import { containerInfo, hostInfo, tailnetDevice, wolEntry } from '@/test/fixtures';
import { HostHub, StoreSource } from './source';

describe('StoreSource', () => {
  beforeEach(() => {
    useContainersStore.setState({ nodeContainers: {}, nodeServices: {}, services: [], dockerDown: {} });
    useNodeStore.setState({
      nodes: [{ id: 'a', url: 'http://a', agentName: 'jupiter', alias: null }],
      meta: { a: { ...DEFAULT_META, status: 'online' } },
    });
  });

  it('builds nodes and moons from the stores, without infrastructure', () => {
    const source = new StoreSource();
    const stop = source.subscribe(() => {});
    useContainersStore.getState().setNodeContainers('a', [
      containerInfo({ id: '1', cosmos_service: 'immich', state: 'running' }),
      containerInfo({ id: '2', cosmos_service: 'system', state: 'running' }),
    ]);
    const snap = source.snapshot();
    expect(snap.nodes).toEqual([{ id: 'a', name: 'jupiter', state: 'online', memBytes: null }]);
    expect(snap.moons.map((m) => m.service)).toEqual(['immich']);
    stop();
  });

  it('only tells the scene when something it draws changed', () => {
    const source = new StoreSource();
    let calls = 0;
    const stop = source.subscribe(() => (calls += 1));
    calls = 0;
    const containers = [containerInfo({ id: '1', cosmos_service: 'immich', state: 'running' })];
    useContainersStore.getState().setNodeContainers('a', containers);
    expect(calls).toBe(1);
    // The container stream repeats itself every 2 s, with new CPU figures.
    useContainersStore.getState().setNodeContainers('a', [{ ...containers[0], cpu_pct: 42 }]);
    expect(calls).toBe(1);
    useContainersStore.getState().setNodeContainers('a', [{ ...containers[0], state: 'exited' }]);
    expect(calls).toBe(2);
    expect(source.snapshot().moons[0].state).toBe('stopped');
    stop();
  });

  it('turns tailnet devices that are not nodes into probes, with their wake state', () => {
    const source = new StoreSource();
    const stop = source.subscribe(() => {});
    source.setNetwork(
      [
        { ...tailnetDevice({ id: 'phone', name: 'iphone', os: 'iOS', online: false }), nodeId: null, reportedBy: 'a' },
        { ...tailnetDevice({ id: 'self', name: 'jupiter' }), nodeId: 'a', reportedBy: 'a' },
      ],
      [{ ...wolEntry({ state: 'waking' }), target: { ...wolEntry().target, tailnet_device: 'phone' }, nodeId: 'a' }],
    );
    expect(source.snapshot().probes).toEqual([{ id: 'phone', name: 'iphone', os: 'iOS', online: false, wol: 'waking' }]);
    stop();
  });
});

describe('HostHub', () => {
  it('replays the latest sample to a late subscriber', () => {
    const hub = new HostHub();
    hub.push('a', hostInfo({ cpu_pct: 33 }));
    const seen: number[] = [];
    const off = hub.on('a', (h) => seen.push(h.cpu_pct));
    hub.push('a', hostInfo({ cpu_pct: 44 }));
    off();
    hub.push('a', hostInfo({ cpu_pct: 55 }));
    expect(seen).toEqual([33, 44]);
  });
});
