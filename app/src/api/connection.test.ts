import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventsUpdate, NodeConnection, NodeMeta, TokenProvider } from './connection';
import { EventsResponse } from '@/generated/EventsResponse';
import { FakeEventSource, mockFetch, settle } from '@/test/fakes';
import { agentInfo, containerInfo, event, eventsResponse, hostInfo, problem } from '@/test/fixtures';

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

  function connect(routes: Parameters<typeof mockFetch>[0], tokens: TokenProvider = async () => 'tok') {
    vi.stubGlobal('fetch', vi.fn(mockFetch(routes)));
    const conn = new NodeConnection('n1', URL_BASE, tokens);
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

  it('says when Docker stops answering, keeping the last list', async () => {
    const { conn } = connect(healthy);
    const updates: { names: string[]; down: boolean }[] = [];
    conn.onContainers((u) => updates.push({ names: u.containers.map((c) => c.name), down: u.dockerUnavailable }));
    conn.start();
    await settle();

    const stream = FakeEventSource.latest('/v1/containers/stream')!;
    stream.emit({ containers: [containerInfo()], sampled_at: 1 });
    stream.emit({ containers: [containerInfo()], sampled_at: 1, docker_unavailable: true });
    expect(updates).toEqual([
      { names: ['gitea'], down: false },
      { names: ['gitea'], down: true },
    ]);
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

  describe('volumes', () => {
    const vol = (name: string) => ({
      name,
      driver: 'local',
      mountpoint: `/var/lib/docker/volumes/${name}/_data`,
      created_at: null,
      scope: 'local',
      compose_project: null,
      cosmos_service: null,
      in_use_by: [],
    });
    const names = (lists: { name: string }[][]) => lists.map((l) => l.map((v) => v.name));

    it('streams them, so a delete shows up with the next frame', async () => {
      const { conn } = connect(healthy);
      const seen: { name: string }[][] = [];
      conn.onVolumes((v) => seen.push(v));
      conn.start();
      await settle();

      const stream = FakeEventSource.latest('/v1/volumes/stream')!;
      expect(stream.url).toContain('token=tok');
      stream.emit({ volumes: [vol('data'), vol('cache')], sampled_at: 1 });
      stream.emit({ volumes: [vol('data')], sampled_at: 2 });
      expect(names(seen).slice(-2)).toEqual([['data', 'cache'], ['data']]);
      conn.stop();
    });

    it('hands the latest list to a late subscriber', async () => {
      const { conn } = connect(healthy);
      conn.onVolumes(() => {});
      conn.start();
      await settle();
      FakeEventSource.latest('/v1/volumes/stream')!.emit({ volumes: [vol('data')], sampled_at: 1 });

      const late: { name: string }[][] = [];
      conn.onVolumes((v) => late.push(v));
      expect(names(late)).toEqual([['data']]);
      conn.stop();
    });

    it('polls an agent without a volume stream', async () => {
      const info = agentInfo();
      const { conn } = connect({
        ...healthy,
        '/v1/info': { body: { ...info, capabilities: { ...info.capabilities, volume_stream: false } } },
        '/v1/volumes': { body: { volumes: [vol('data')], sampled_at: 0 } },
      });
      const seen: { name: string }[][] = [];
      conn.onVolumes((v) => seen.push(v));
      conn.start();
      await settle();

      expect(FakeEventSource.latest('/v1/volumes/stream')).toBeUndefined();
      expect(names(seen).at(-1)).toEqual(['data']);
      conn.stop();
    });

    it('falls back to polling when the stream closes, without going offline', async () => {
      const { conn, metas } = connect({
        ...healthy,
        '/v1/volumes': { body: { volumes: [vol('data')], sampled_at: 0 } },
      });
      const seen: { name: string }[][] = [];
      conn.onVolumes((v) => seen.push(v));
      conn.start();
      await settle();
      FakeEventSource.latest('/v1/host/stream')!.emit(hostInfo());

      FakeEventSource.latest('/v1/volumes/stream')!.fail();
      await settle();
      expect(names(seen).at(-1)).toEqual(['data']);
      expect(metas.at(-1)?.status).toBe('online');
      conn.stop();
    });
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
    // Legacy agents have no container or volume stream.
    expect(FakeEventSource.latest('/v1/containers/stream')).toBeUndefined();
    expect(FakeEventSource.latest('/v1/volumes/stream')).toBeUndefined();
    conn.stop();
  });

  it('asks for a sign-in instead of opening streams when there is no session', async () => {
    const { conn, metas } = connect(healthy, async () => null);
    conn.start();
    await settle();

    const meta = metas.at(-1)!;
    expect(meta.status).toBe('unauthorized');
    expect(meta.auth).toMatchObject({ kind: 'oidc', client_id: 'cosmos' });
    expect(FakeEventSource.instances).toHaveLength(0);
    conn.stop();
  });

  it('retries, rather than asking for a sign-in, when the provider is down', async () => {
    const { conn, metas } = connect(healthy, async () => {
      throw new Error("Can't reach the sign-in provider");
    });
    conn.start();
    await settle();

    const meta = metas.at(-1)!;
    expect(meta.status).toBe('offline');
    expect(meta.error).toBe("Can't reach the sign-in provider");
    expect(FakeEventSource.instances).toHaveLength(0);
    conn.stop();
  });

  it('refreshes once on a 401 before asking for a sign-in', async () => {
    const tokens = vi.fn(async (_auth: unknown, opts?: { force?: boolean }) => (opts?.force ? 'fresh' : 'stale'));
    let hostCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/v1/host')) {
          hostCalls += 1;
          const auth = new Headers(init?.headers).get('Authorization');
          return auth === 'Bearer fresh'
            ? new Response(JSON.stringify(hostInfo()))
            : new Response(JSON.stringify({ code: 'unauthorized', message: 'x', detail: null }), { status: 401 });
        }
        return mockFetch(healthy)(input);
      }),
    );
    const conn = new NodeConnection('n1', URL_BASE, tokens);
    const metas: NodeMeta[] = [];
    conn.onMeta((m) => metas.push(m));
    conn.start();
    await settle();

    expect(hostCalls).toBe(2);
    expect(tokens).toHaveBeenLastCalledWith(expect.anything(), { force: true });
    expect(metas.at(-1)?.status).not.toBe('unauthorized');
    expect(FakeEventSource.latest('/v1/host/stream')!.url).toContain('token=fresh');
    conn.stop();
  });

  it('says a pre-0.3 token agent needs updating', async () => {
    const { conn, metas } = connect({
      ...healthy,
      '/v1/info': { body: agentInfo({ api_version: 2, auth: undefined, auth_required: true }) },
    });
    conn.start();
    await settle();
    expect(metas.at(-1)?.status).toBe('unauthorized');
    expect(metas.at(-1)?.error).toMatch(/older than 0\.3/);
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
    // Notification channels are admin-only to read, too.
    expect(meta.capabilities.notify).toBe(false);
    expect(meta.capabilities.notify_actions).toBe(false);
    // Reading is unaffected.
    expect(meta.capabilities.container_logs).toBe(true);
    expect(meta.capabilities.events).toBe(true);
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

describe('NodeConnection events', () => {
  beforeEach(() => {
    FakeEventSource.reset();
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** Answers /v1/events from `events` by its query, like the agent. */
  function connectWithEvents(respond: (params: URLSearchParams) => EventsResponse, info = agentInfo()) {
    const calls: string[] = [];
    const routes = mockFetch({
      '/v1/info': { body: info },
      '/v1/host': { body: hostInfo() },
      '/v1/volumes': { body: { volumes: [], sampled_at: 0 } },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === 'string' ? input : input.toString());
        if (url.pathname !== '/v1/events') return routes(input);
        calls.push(url.search);
        return new Response(JSON.stringify(respond(url.searchParams)), {
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    const conn = new NodeConnection('n1', URL_BASE, async () => 'tok');
    const updates: EventsUpdate[] = [];
    conn.onEvents((u) => updates.push(u));
    return { conn, updates, calls };
  }

  it('loads the newest events once, then polls for what comes after', async () => {
    const { conn, updates, calls } = connectWithEvents((q) =>
      q.has('after')
        ? eventsResponse({ events: [event({ id: 4 })], latest_id: 4 })
        : eventsResponse({
            events: [event({ id: 3 }), event({ id: 2 }), event({ id: 1 })],
            problems: [problem()],
            latest_id: 3,
            more: true,
          }),
    );
    conn.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(updates[0].initial).toBe(true);
    expect(updates[0].more).toBe(true);
    expect(updates[0].events.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(updates[0].problems).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.at(-1)).toContain('after=3');
    expect(updates[1].initial).toBe(false);
    expect(updates[1].events.map((e) => e.id)).toEqual([4]);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.at(-1)).toContain('after=4');
    conn.stop();
  });

  it('starts over when the log was replaced', async () => {
    let replaced = false;
    const { conn, updates } = connectWithEvents((q) => {
      if (!q.has('after')) return eventsResponse({ events: [event({ id: replaced ? 1 : 9 })], latest_id: replaced ? 1 : 9 });
      replaced = true;
      return eventsResponse({ latest_id: 1 });
    });
    conn.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_000);

    const last = updates.at(-1)!;
    expect(last.initial).toBe(true);
    expect(last.events.map((e) => e.id)).toEqual([1]);
    conn.stop();
  });

  it('leaves agents without an event log alone', async () => {
    const info = agentInfo({ capabilities: { ...agentInfo().capabilities, events: false } });
    const { conn, calls } = connectWithEvents(() => eventsResponse(), info);
    conn.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toHaveLength(0);
    conn.stop();
  });

  it('reconnects when the host stream goes quiet without closing', async () => {
    const { conn } = connectWithEvents(() => eventsResponse());
    const metas: NodeMeta[] = [];
    conn.onMeta((m) => metas.push(m));
    conn.start();
    await vi.advanceTimersByTimeAsync(0);

    const first = FakeEventSource.latest('/v1/host/stream')!;
    for (let i = 0; i < 10; i += 1) {
      first.emit(hostInfo({ seq: i }));
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(metas.at(-1)?.status).toBe('online');

    await vi.advanceTimersByTimeAsync(25_000);
    expect(metas.some((m) => m.status === 'offline' && m.error?.startsWith('no data'))).toBe(true);
    expect(first.readyState).toBe(FakeEventSource.CLOSED);
    expect(FakeEventSource.latest('/v1/host/stream')).not.toBe(first);
    conn.stop();
  });
});
