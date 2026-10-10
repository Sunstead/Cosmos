import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { FakeWebSocket } from '@/test/fakes';
import { ALL_CONTAINERS, useContainerLogs } from './use-container-logs';

const client = {
  logsSocketUrl: (id: string) => `ws://agent.test/v1/containers/${id}/logs/ws`,
  allLogsSocketUrl: () => 'ws://agent.test/v1/logs/ws',
  getLogs: vi.fn(),
  getAllLogs: vi.fn(),
};

const client2 = {
  ...client,
  allLogsSocketUrl: () => 'ws://other.test/v1/logs/ws',
};

vi.mock('@/stores/nodes', () => ({
  getConnection: (id: string) => (id === 'n1' ? { client } : id === 'n2' ? { client: client2 } : null),
}));

const line = (text: string) => ({ type: 'line', stream: 'stdout', ts: null, text });

describe('useContainerLogs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.reset();
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('is idle without a selection', () => {
    const { result } = renderHook(() =>
      useContainerLogs({ nodeId: 'n1', containerId: null, follow: true }),
    );
    expect(result.current.state).toBe('idle');
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('batches lines into timed flushes', () => {
    const { result } = renderHook(() =>
      useContainerLogs({ nodeId: 'n1', containerId: 'c1', follow: true }),
    );
    expect(result.current.state).toBe('connecting');
    const ws = FakeWebSocket.instances[0];

    act(() => {
      ws.open();
      ws.send(line('a'));
      ws.send(line('b'));
    });
    expect(result.current.state).toBe('streaming');
    expect(result.current.lines).toHaveLength(0);

    act(() => vi.advanceTimersByTime(200));
    expect(result.current.lines.map((l) => l.text)).toEqual(['a', 'b']);
  });

  it('counts truncated lines and reports close', () => {
    const { result } = renderHook(() =>
      useContainerLogs({ nodeId: 'n1', containerId: 'c1', follow: true }),
    );
    const ws = FakeWebSocket.instances[0];
    act(() => {
      ws.open();
      ws.send({ type: 'truncated', dropped: 12 });
      ws.send({ type: 'closed', reason: 'container exited' });
    });
    expect(result.current.dropped).toBe(12);
    expect(result.current.state).toBe('closed');
  });

  it('says why the agent closed it, and reconnects on request', () => {
    const { result } = renderHook(() =>
      useContainerLogs({ nodeId: 'n1', containerId: 'c1', follow: true }),
    );
    const first = FakeWebSocket.instances[0];
    act(() => {
      first.open();
      first.send(line('before'));
      first.send({ type: 'closed', reason: 'the agent is restarting' });
    });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.reason).toBe('the agent is restarting');

    act(() => result.current.reconnect());
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(result.current.state).toBe('connecting');
    expect(result.current.lines, 'the new stream brings its own backlog').toHaveLength(0);
    act(() => {
      FakeWebSocket.instances[1].open();
      FakeWebSocket.instances[1].send(line('after'));
    });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.lines.map((l) => l.text)).toEqual(['after']);
    expect(result.current.reason).toBeNull();
  });

  it('switching container clears the view and closes the old socket', () => {
    const { result, rerender } = renderHook(
      ({ id }) => useContainerLogs({ nodeId: 'n1', containerId: id, follow: true }),
      { initialProps: { id: 'c1' } },
    );
    const first = FakeWebSocket.instances[0];
    act(() => {
      first.open();
      first.send(line('old'));
      vi.advanceTimersByTime(200);
    });
    expect(result.current.lines).toHaveLength(1);

    rerender({ id: 'c2' });
    expect(first.closed).toBe(true);
    expect(result.current.lines).toHaveLength(0);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('clear empties the buffer', () => {
    const { result } = renderHook(() =>
      useContainerLogs({ nodeId: 'n1', containerId: 'c1', follow: true }),
    );
    const ws = FakeWebSocket.instances[0];
    act(() => {
      ws.open();
      ws.send(line('a'));
      vi.advanceTimersByTime(200);
    });
    act(() => result.current.clear());
    expect(result.current.lines).toHaveLength(0);
  });

  it('uses a plain request when not following', async () => {
    client.getLogs.mockResolvedValue({ lines: [{ stream: 'stderr', ts: null, text: 'x' }] });
    const { result } = renderHook(() =>
      useContainerLogs({ nodeId: 'n1', containerId: 'c1', follow: false }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(result.current.lines).toHaveLength(1);
    expect(result.current.state).toBe('closed');
  });

  describe('all containers', () => {
    const at = (ts: string, container: string) => ({ type: 'line', stream: 'stdout', ts, text: `${container}@${ts}`, container });

    it('opens the one merged socket, not one per container', () => {
      renderHook(() => useContainerLogs({ nodeId: 'n1', containerId: ALL_CONTAINERS, follow: true }));
      expect(FakeWebSocket.instances.map((w) => w.url)).toEqual(['ws://agent.test/v1/logs/ws']);
    });

    it('orders interleaved backlogs by time', () => {
      const { result } = renderHook(() =>
        useContainerLogs({ nodeId: 'n1', containerId: ALL_CONTAINERS, follow: true }),
      );
      const ws = FakeWebSocket.instances[0];
      act(() => {
        ws.open();
        // Each container's backlog arrives whole, one after the other.
        ws.send(at('2026-09-22T10:00:02Z', 'web'));
        ws.send(at('2026-09-22T10:00:04Z', 'web'));
        ws.send(at('2026-09-22T10:00:01Z', 'db'));
        ws.send(at('2026-09-22T10:00:03.5Z', 'db'));
        vi.advanceTimersByTime(200);
      });
      act(() => {
        ws.send(at('2026-09-22T10:00:03Z', 'cache'));
        vi.advanceTimersByTime(200);
      });
      expect(result.current.lines.map((l) => l.text)).toEqual([
        'db@2026-09-22T10:00:01Z',
        'web@2026-09-22T10:00:02Z',
        'cache@2026-09-22T10:00:03Z',
        'db@2026-09-22T10:00:03.5Z',
        'web@2026-09-22T10:00:04Z',
      ]);
    });

    it('uses the merged request when not following', async () => {
      client.getAllLogs.mockResolvedValue({ lines: [{ stream: 'stdout', ts: null, text: 'x', container: 'c1' }] });
      const { result } = renderHook(() =>
        useContainerLogs({ nodeId: 'n1', containerId: ALL_CONTAINERS, follow: false }),
      );
      await act(async () => {
        await Promise.resolve();
      });
      expect(client.getAllLogs).toHaveBeenCalled();
      expect(result.current.lines[0].container).toBe('c1');
    });
  });

  describe('all nodes', () => {
    const at = (ts: string) => ({ type: 'line', stream: 'stdout', ts, text: ts, container: 'c' });

    it('opens one merged socket per node and tags lines with their node', () => {
      const { result } = renderHook(() =>
        useContainerLogs({ nodeId: null, nodeIds: ['n1', 'n2'], containerId: ALL_CONTAINERS, follow: true }),
      );
      expect(FakeWebSocket.instances.map((w) => w.url)).toEqual([
        'ws://agent.test/v1/logs/ws',
        'ws://other.test/v1/logs/ws',
      ]);
      const [a, b] = FakeWebSocket.instances;
      act(() => {
        a.open();
        a.send(at('2026-10-10T10:00:02Z'));
        b.send(at('2026-10-10T10:00:01Z'));
        vi.advanceTimersByTime(200);
      });
      expect(result.current.state).toBe('streaming');
      expect(result.current.lines.map((l) => [l.node, l.ts])).toEqual([
        ['n2', '2026-10-10T10:00:01Z'],
        ['n1', '2026-10-10T10:00:02Z'],
      ]);
    });

    it('stays live while one node is, and fails only when all have', () => {
      const { result } = renderHook(() =>
        useContainerLogs({ nodeId: null, nodeIds: ['n1', 'n2'], containerId: ALL_CONTAINERS, follow: true }),
      );
      const [a, b] = FakeWebSocket.instances;
      act(() => {
        a.open();
        b.onerror?.();
      });
      expect(result.current.state).toBe('streaming');
    });
  });

  describe('a replaced socket that is still talking', () => {
    // Seen in WebKit (the desktop app, Safari): the socket being replaced
    // reports its close, sometimes as an error, after the new one has
    // opened. The old hook let that re-stamp the session with the old
    // target, so the new container's lines were ignored and the page sat on
    // "Connecting" and its skeleton until a refresh. Chromium orders these
    // events differently, which is why it only showed up there.
    it('does not let the old socket\'s late close strand the new selection', () => {
      const { result, rerender } = renderHook(
        ({ id }) => useContainerLogs({ nodeId: 'n1', containerId: id, follow: true }),
        { initialProps: { id: 'auto-picked' } },
      );
      const stale = FakeWebSocket.instances[0];
      act(() => stale.open());
      const staleError = stale.onerror;
      const staleClose = stale.onclose;

      rerender({ id: 'chosen' });
      const fresh = FakeWebSocket.instances[1];
      act(() => fresh.open());

      act(() => {
        staleError?.();
        staleClose?.();
      });
      expect(result.current.state).toBe('streaming');

      act(() => {
        fresh.send(line('hello'));
        vi.advanceTimersByTime(200);
      });
      expect(result.current.lines.map((l) => l.text)).toEqual(['hello']);
    });

    it('does not let a socket replaced mid-handshake strand it either', () => {
      const { result, rerender } = renderHook(
        ({ id }) => useContainerLogs({ nodeId: 'n1', containerId: id, follow: true }),
        { initialProps: { id: 'auto-picked' } },
      );
      const staleError = FakeWebSocket.instances[0].onerror;
      rerender({ id: 'chosen' });
      act(() => FakeWebSocket.instances[1].open());
      act(() => staleError?.());
      expect(result.current.state).toBe('streaming');
    });

    it('drops lines the old socket delivers after the switch', () => {
      const { result, rerender } = renderHook(
        ({ id }) => useContainerLogs({ nodeId: 'n1', containerId: id, follow: true }),
        { initialProps: { id: 'c1' } },
      );
      const stale = FakeWebSocket.instances[0];
      const staleMessage = stale.onmessage;
      act(() => stale.open());

      rerender({ id: 'c2' });
      const fresh = FakeWebSocket.instances[1];
      act(() => {
        fresh.open();
        staleMessage?.({ data: JSON.stringify(line('from c1')) });
        staleMessage?.({ data: JSON.stringify({ type: 'closed', reason: 'gone' }) });
        fresh.send(line('from c2'));
        vi.advanceTimersByTime(200);
      });
      expect(result.current.lines.map((l) => l.text)).toEqual(['from c2']);
      expect(result.current.state).toBe('streaming');
    });
  });
});
