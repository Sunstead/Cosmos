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

vi.mock('@/stores/nodes', () => ({
  getConnection: (id: string) => (id === 'n1' ? { client } : null),
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
});
