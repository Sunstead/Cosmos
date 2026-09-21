import { describe, expect, it } from 'vitest';
import { ContainerInfo } from '@/generated/ContainerInfo';
import { deriveNodeServices, userFacingServices } from './services';

function container(partial: Partial<ContainerInfo>): ContainerInfo {
  return {
    id: 'id',
    name: 'name',
    image: 'image',
    status: 'Up 2 hours',
    state: 'running',
    ports: [],
    started_at: null,
    created_unix: 0,
    restart_count: 0,
    compose_project: null,
    cosmos_service: null,
    cosmos_service_description: null,
    cosmos_service_url: null,
    cpu_pct: 0,
    mem_used_bytes: 0,
    mem_limit_bytes: 0,
    ...partial,
  };
}

describe('deriveNodeServices', () => {
  it('groups containers by the cosmos.service label', () => {
    const services = deriveNodeServices('n1', [
      container({ id: 'a', name: 'immich-server', cosmos_service: 'immich' }),
      container({ id: 'b', name: 'immich-machine-learning', cosmos_service: 'immich' }),
      container({ id: 'c', name: 'immich-postgres', cosmos_service: 'immich' }),
    ]);

    expect(services).toHaveLength(1);
    expect(services[0].key).toBe('immich');
    expect(services[0].total).toBe(3);
    expect(services[0].running).toBe(3);
    expect(services[0].status).toBe('running');
  });

  it('treats an unlabelled container as its own service', () => {
    const services = deriveNodeServices('n1', [container({ name: 'standalone' })]);
    expect(services[0].key).toBe('standalone');
    expect(services[0].name).toBe('Standalone');
  });

  it('title-cases names from hyphenated keys', () => {
    const services = deriveNodeServices('n1', [
      container({ cosmos_service: 'uptime-kuma' }),
    ]);
    expect(services[0].name).toBe('Uptime Kuma');
  });

  it('reports partial when only some containers run', () => {
    const services = deriveNodeServices('n1', [
      container({ id: 'a', cosmos_service: 'immich', state: 'running' }),
      container({ id: 'b', cosmos_service: 'immich', state: 'exited' }),
    ]);
    expect(services[0].status).toBe('partial');
    expect(services[0].running).toBe(1);
  });

  it('reports stopped when nothing runs', () => {
    const services = deriveNodeServices('n1', [
      container({ cosmos_service: 'gitea', state: 'exited' }),
    ]);
    expect(services[0].status).toBe('stopped');
  });

  it('sums cpu and memory across the group', () => {
    const services = deriveNodeServices('n1', [
      container({ id: 'a', cosmos_service: 'immich', cpu_pct: 1.5, mem_used_bytes: 100 }),
      container({ id: 'b', cosmos_service: 'immich', cpu_pct: 2.5, mem_used_bytes: 250 }),
    ]);
    expect(services[0].cpu_pct).toBe(4);
    expect(services[0].mem_used_bytes).toBe(350);
  });

  it('takes the earliest start among running containers', () => {
    const services = deriveNodeServices('n1', [
      container({
        id: 'a',
        cosmos_service: 'immich',
        started_at: '2024-03-01T12:00:00Z',
      }),
      container({
        id: 'b',
        cosmos_service: 'immich',
        started_at: '2024-03-01T10:00:00Z',
      }),
    ]);
    expect(services[0].startedAt).toBe(Date.parse('2024-03-01T10:00:00Z'));
  });

  it('ignores start times of containers that are not running', () => {
    const services = deriveNodeServices('n1', [
      container({ id: 'a', cosmos_service: 'x', started_at: '2024-01-01T00:00:00Z', state: 'exited' }),
      container({ id: 'b', cosmos_service: 'x', started_at: '2024-06-01T00:00:00Z' }),
    ]);
    expect(services[0].startedAt).toBe(Date.parse('2024-06-01T00:00:00Z'));
  });

  it('produces a stable result for identical input', () => {
    // The derivation must not embed `Date.now()`: an identity that changes
    // every tick re-renders every subscriber even when nothing moved.
    const input = [container({ cosmos_service: 'gitea', started_at: '2024-01-01T00:00:00Z' })];
    expect(deriveNodeServices('n1', input)).toEqual(deriveNodeServices('n1', input));
  });

  it('takes description and url from whichever container carries them', () => {
    const services = deriveNodeServices('n1', [
      container({ id: 'a', cosmos_service: 'gitea' }),
      container({
        id: 'b',
        cosmos_service: 'gitea',
        cosmos_service_description: 'Git hosting',
        cosmos_service_url: 'gitea.jupiter.sunstead.net',
      }),
    ]);
    expect(services[0].description).toBe('Git hosting');
    expect(services[0].url).toBe('gitea.jupiter.sunstead.net');
  });
});

describe('userFacingServices', () => {
  it('hides infrastructure labelled cosmos.service=system', () => {
    // caddy, postgres, redis and tailscale all carry this in core.yml.
    const services = deriveNodeServices('n1', [
      container({ id: 'a', name: 'caddy', cosmos_service: 'system' }),
      container({ id: 'b', name: 'postgres', cosmos_service: 'system' }),
      container({ id: 'c', name: 'gitea', cosmos_service: 'gitea' }),
    ]);

    expect(services).toHaveLength(2);
    expect(userFacingServices(services).map((s) => s.key)).toEqual(['gitea']);
  });
});
