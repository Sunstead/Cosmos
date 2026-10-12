import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailableUpdate } from '@/lib/app-update';

const checkForUpdate = vi.fn<() => Promise<AvailableUpdate | null>>();
vi.mock('@/lib/app-update', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/app-update')>()),
  checkForUpdate: () => checkForUpdate(),
}));
vi.mock('@/lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform')>()),
  isDesktop: () => true,
}));

const { useAppUpdate, useWaitingVersion, startBackgroundChecks } = await import('./app-update');

const release = (version: string, install = vi.fn(async () => {})): AvailableUpdate => ({
  version,
  notes: '',
  install,
});

const initial = useAppUpdate.getState();

beforeEach(() => {
  useAppUpdate.setState(initial, true);
  checkForUpdate.mockReset();
  // Failed checks are logged; the tests make them fail on purpose.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe('app updates', () => {
  it('keeps a failed background check out of sight', async () => {
    checkForUpdate.mockRejectedValue(new Error('offline'));
    await useAppUpdate.getState().check();
    expect(useAppUpdate.getState().dialogOpen).toBe(false);
  });

  it('keeps a found update through a later failed background check', async () => {
    checkForUpdate.mockResolvedValueOnce(release('0.13.0'));
    await useAppUpdate.getState().check();
    checkForUpdate.mockRejectedValueOnce(new Error('offline'));
    await useAppUpdate.getState().check();
    expect(useAppUpdate.getState().status).toEqual({ state: 'available' });
    expect(useAppUpdate.getState().update?.version).toBe('0.13.0');
  });

  it('answers a manual check in the dialog, failure included', async () => {
    checkForUpdate.mockRejectedValue(new Error('offline'));
    await useAppUpdate.getState().check({ manual: true });
    const s = useAppUpdate.getState();
    expect(s.dialogOpen).toBe(true);
    expect(s.status).toEqual({ state: 'error', message: 'Error: offline' });
  });

  it('hides a version the user put off until a newer one appears', async () => {
    const { result } = renderHook(() => useWaitingVersion());
    checkForUpdate.mockResolvedValue(release('0.13.0'));
    await act(() => useAppUpdate.getState().check());
    expect(result.current).toBe('0.13.0');

    act(() => useAppUpdate.getState().later('0.13.0'));
    expect(result.current).toBeNull();

    checkForUpdate.mockResolvedValue(release('0.13.1'));
    await act(() => useAppUpdate.getState().check());
    expect(result.current).toBe('0.13.1');
  });

  it('ignores a check while installing', async () => {
    let finish!: () => void;
    const install = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    checkForUpdate.mockResolvedValue(release('0.13.0', install));
    await useAppUpdate.getState().check();
    const installing = useAppUpdate.getState().install();
    expect(useAppUpdate.getState().status.state).toBe('installing');

    await useAppUpdate.getState().check();
    expect(checkForUpdate).toHaveBeenCalledTimes(1);
    finish();
    await installing;
  });

  it('shows why an install failed', async () => {
    checkForUpdate.mockResolvedValue(release('0.13.0', vi.fn(async () => Promise.reject(new Error('bad signature')))));
    await useAppUpdate.getState().check();
    await useAppUpdate.getState().install();
    expect(useAppUpdate.getState().status).toEqual({ state: 'error', message: 'Error: bad signature' });
  });

  it('checks in the background only while automatic checks are on', async () => {
    vi.useFakeTimers();
    checkForUpdate.mockResolvedValue(null);
    const stop = startBackgroundChecks();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(checkForUpdate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(checkForUpdate).toHaveBeenCalledTimes(2);

    useAppUpdate.getState().setAutoCheck(false);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(checkForUpdate).toHaveBeenCalledTimes(2);

    useAppUpdate.getState().setAutoCheck(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(checkForUpdate).toHaveBeenCalledTimes(3);
    stop();
  });
});
