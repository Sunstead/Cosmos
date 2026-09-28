import { beforeEach, describe, expect, it } from 'vitest';
import { useContainersStore } from './containers';
import { containerInfo } from '@/test/fixtures';

const store = () => useContainersStore.getState();

describe('containers store', () => {
  beforeEach(() => useContainersStore.setState({ nodeContainers: {}, nodeServices: {}, services: [], dockerDown: {} }));

  it('derives services per node and flattens them sorted', () => {
    store().setNodeContainers('b', [containerInfo({ id: '1', cosmos_service: 'zulu' })]);
    store().setNodeContainers('a', [containerInfo({ id: '2', cosmos_service: 'alpha' })]);
    expect(store().services.map((s) => s.key)).toEqual(['alpha', 'zulu']);
  });

  it('leaves other nodes untouched on update', () => {
    store().setNodeContainers('a', [containerInfo({ cosmos_service: 'alpha' })]);
    const before = store().nodeServices.a;
    store().setNodeContainers('b', [containerInfo({ cosmos_service: 'zulu' })]);
    expect(store().nodeServices.a).toBe(before);
  });

  it('flags a node whose Docker is down, without churning on every sample', () => {
    store().setNodeContainers('a', [containerInfo()], true);
    const flagged = store().dockerDown;
    expect(flagged).toEqual({ a: true });
    store().setNodeContainers('a', [containerInfo()], true);
    expect(store().dockerDown).toBe(flagged);
    store().setNodeContainers('a', [containerInfo()]);
    expect(store().dockerDown).toEqual({});
  });

  it('drops a removed node', () => {
    store().setNodeContainers('a', [containerInfo({ cosmos_service: 'alpha' })]);
    store().removeNode('a');
    expect(store().nodeContainers).toEqual({});
    expect(store().services).toEqual([]);
  });
});
