import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeConnection, NodeMeta } from './connection';
import { FakeEventSource, mockFetch, settle } from '@/test/fakes';
import { agentInfo, hostInfo } from '@/test/fixtures';

const URL_BASE = 'http://agent.test:7700';

describe('NodeConnection', () => {
  beforeEach(() => {
    FakeEventSource.reset();
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function connect(routes: Parameters<typeof mockFetch>[0]) {
    vi.stubGlobal('fetch', vi.fn(mockFetch(routes)));
    const conn = new NodeConnection('n1', URL_BASE, 'tok');
    const metas: NodeMeta[] = [];
    conn.onMeta((m) => metas.push(m));
    return { conn, metas };
  }

  const healthy = {
    '/v1/info': { body: agentInfo() },
    '/v1/host': { body: hostInfo() },
    '/v1/volumes': { body: { volumes: [], sampled_at: 0 } },
  };

  it('opens exactly one host and one container stream', async () => {
    const { conn } = connect(healthy);
    conn.start();
    await settle();

    expect(FakeEventSource.instances.filter((s) => s.url.includes('/v1/host/stream'))).toHaveLength(1);
    expect(FakeEventSource.instances.filter((s) => s.url.includes('/v1/containers/stream'))).toHaveLength(1);
    conn.stop();
  });

  it('carries the token in stream URLs', async () => {
    const { conn } = connect(healthy);
    conn.start();
    await settle();
    expect(FakeEventSource.latest('/v1/host/stream')!.url).toContain('token=tok');
    conn.stop();
  });

  it('goes online on the first unnamed frame', async () => {
    const { conn, metas } = connect(healthy);
    const hosts: string[] = [];
    conn.onHost((h) => hosts.push(h.name));
    conn.start();
    await settle();

    FakeEventSource.latest('/v1/host/stream')!.emit(hostInfo());
    expect(metas.at(-1)?.status).toBe('online');
    expect(hosts).toEqual(['jupiter']);
    conn.stop();
  });

  it('ignores named events, matching how the browser delivers them', async () => {
    const { conn, metas } = connect(healthy);
    conn.start();
    await settle();

    FakeEventSource.latest('/v1/host/stream')!.emitNamed('sample', hostInfo());
    expect(metas.at(-1)?.status).not.toBe('online');
    conn.stop();
  });

  it('reports unauthorized on a 401 probe and does not retry', async () => {
    vi.useFakeTimers();
    const { conn, metas } = connect({
      '/v1/info': { body: agentInfo() },
      '/v1/host': { status: 401, body: { code: 'unauthorized', message: 'no' } },
    });
    conn.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(metas.at(-1)?.status).toBe('unauthorized');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeEventSource.instances).toHaveLength(0);
    conn.stop();
  });

  it('retries with backoff when the stream closes', async () => {
    vi.useFakeTimers();
    const { conn, metas } = connect(healthy);
    conn.start();
    await vi.advanceTimersByTimeAsync(0);

    FakeEventSource.latest('/v1/host/stream')!.fail(true);
    expect(metas.at(-1)?.status).toBe('offline');

    const before = FakeEventSource.instances.length;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeEventSource.instances.length).toBeGreaterThan(before);
    conn.stop();
  });

  it('does not retry while the browser is still reconnecting', async () => {
    vi.useFakeTimers();
    const { conn, metas } = connect(healthy);
    conn.start();
    await vi.advanceTimersByTimeAsync(0);

    FakeEventSource.latest('/v1/host/stream')!.fail(false);
    expect(metas.at(-1)?.status).not.toBe('offline');
    conn.stop();
  });

  it('signals a reset when the agent restarts', async () => {
    const { conn } = connect(healthy);
    const reset = vi.fn();
    conn.onReset(reset);
    conn.start();
    await settle();

    const stream = FakeEventSource.latest('/v1/host/stream')!;
    stream.emit(hostInfo({ seq: 50 }));
    stream.emit(hostInfo({ seq: 51 }));
    expect(reset).not.toHaveBeenCalled();
    stream.emit(hostInfo({ seq: 2 }));
    expect(reset).toHaveBeenCalledTimes(1);
    conn.stop();
  });

  it('replays the latest sample to late subscribers', async () => {
    const { conn } = connect(healthy);
    conn.start();
    await settle();
    FakeEventSource.latest('/v1/host/stream')!.emit(hostInfo({ cpu_pct: 42 }));

    const late = vi.fn();
    conn.onHost(late);
    expect(late).toHaveBeenCalledWith(expect.objectContaining({ cpu_pct: 42 }));
    conn.stop();
  });

  it('falls back to legacy capabilities when /v1/info is missing', async () => {
    const { conn, metas } = connect({
      '/v1/host': { body: hostInfo() },
      '/v1/containers': { body: { containers: [], sampled_at: 0 } },
      '/v1/volumes': { body: { volumes: [], sampled_at: 0 } },
    });
    conn.start();
    await settle();

    expect(metas.at(-1)?.apiVersion).toBe(0);
    expect(metas.at(-1)?.capabilities.container_actions).toBe(false);
    // Legacy agents have no container stream.
    expect(FakeEventSource.latest('/v1/containers/stream')).toBeUndefined();
    conn.stop();
  });

  it('hides actions from a viewer even where the node allows them', async () => {
    const { conn, metas } = connect({
      ...healthy,
      '/v1/info': { body: agentInfo({ api_version: 2, principal: { name: 'guest', admin: false } }) },
    });
    conn.start();
    await settle();

    const meta = metas.at(-1)!;
    expect(meta.principal).toEqual({ name: 'guest', admin: false });
    expect(meta.capabilities.container_actions).toBe(false);
    expect(meta.capabilities.volume_actions).toBe(false);
    // Reading is unaffected.
    expect(meta.capabilities.container_logs).toBe(true);
    conn.stop();
  });

  it('keeps actions for an admin', async () => {
    const { conn, metas } = connect({
      ...healthy,
      '/v1/info': { body: agentInfo({ api_version: 2, principal: { name: 'pwb', admin: true } }) },
    });
    conn.start();
    await settle();
    expect(metas.at(-1)?.capabilities.container_actions).toBe(true);
    conn.stop();
  });
});
