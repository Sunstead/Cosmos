import { afterEach, describe, expect, it, vi } from 'vitest';
import { hash, planetExtent, planetStyle } from './planet';
import { msToDuration, relativeTime, secondsToDuration } from './time';
import { matchesQuery, NO_VALUE, plural, sentence } from './format';
import { cancelDraw, requestDraw } from './frame-scheduler';
import { canvasTokens, onThemeChange } from './theme-tokens';
import {
  formatBytes,
  formatDiskRead,
  formatDiskReadWrite,
  formatDiskWrite,
  getDiskType,
  getMemUsagePct,
  hasDiskIo,
  sumDisk,
} from './node-metrics';
import { DiskInfo } from '@/generated/DiskInfo';
import { hostInfo } from '@/test/fixtures';

describe('planet', () => {
  it('is deterministic per name', () => {
    expect(planetStyle('orion')).toEqual(planetStyle('orion'));
    expect(planetStyle('Orion ')).toEqual(planetStyle('orion'));
    expect(hash('a')).not.toBe(hash('b'));
  });

  it('uses presets for classic names', () => {
    expect(planetStyle('saturn').ring).not.toBeNull();
    expect(planetStyle('jupiter').kind).toBe('gas');
    expect(planetStyle('mars').kind).toBe('rocky');
    expect(planetStyle('mars').bands).toHaveLength(0);
    expect(planetStyle('mars').craters.length).toBeGreaterThan(0);
  });

  it('keeps generated values in range', () => {
    for (const name of ['alpha', 'beta', 'nas', 'pi-hole', 'node-7']) {
      const s = planetStyle(name);
      expect(s.hue).toBeGreaterThanOrEqual(0);
      expect(s.hue).toBeLessThan(360);
      for (const b of s.bands) expect(Math.abs(b.y)).toBeLessThanOrEqual(1);
    }
  });

  it('extends past the body only for rings', () => {
    expect(planetExtent(planetStyle('saturn'))).toBeGreaterThan(2);
    expect(planetExtent(planetStyle('mars'))).toBe(1.2);
  });
});

describe('time', () => {
  it('formats durations in whole units', () => {
    expect(secondsToDuration(42)).toBe('42s');
    expect(secondsToDuration(3_660)).toBe('1h 1m');
    expect(secondsToDuration(90_000)).toBe('1d 1h 0m');
    expect(msToDuration(120_000)).toBe('2m');
    expect(secondsToDuration(-1)).toBe(NO_VALUE);
  });

  it('formats relative times', () => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    expect(relativeTime('2026-01-01T09:00:00Z', now)).toBe('3h ago');
    expect(relativeTime('2026-01-01T17:00:00Z', now)).toBe('in 5h');
    expect(relativeTime('2026-01-01T11:59:30Z', now)).toBe('just now');
    expect(relativeTime('garbage', now)).toBeNull();
    expect(relativeTime(null, now)).toBeNull();
  });
});

describe('format', () => {
  it('matches queries case-insensitively across fields', () => {
    expect(matchesQuery('', 'x')).toBe(true);
    expect(matchesQuery('GIT', null, 'gitea')).toBe(true);
    expect(matchesQuery('nope', 'gitea', undefined)).toBe(false);
  });

  it('pluralises', () => {
    expect(plural(1, 'node')).toBe('1 node');
    expect(plural(2, 'node')).toBe('2 nodes');
    expect(plural(0, 'entry', 'entries')).toBe('0 entries');
  });

  it('joins clauses into a sentence, whichever comes first', () => {
    expect(sentence(['last run 2h ago', 'took 14m'])).toBe('Last run 2h ago, took 14m');
    expect(sentence([null, 'took 14m', false])).toBe('Took 14m');
    expect(sentence([])).toBe('');
  });
});

describe('node metrics', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(20 * 1024 ** 3)).toBe('20 GB');
  });

  it('derives memory and disk type', () => {
    expect(getMemUsagePct(hostInfo())).toBe(25);
    expect(getDiskType(hostInfo())).toBe('Unknown');
  });

  describe('disk rates', () => {
    const MiB = 1024 ** 2;
    const disk = (read: number, io_available?: boolean): DiskInfo => ({
      mount: '/',
      label: '/',
      used_bytes: 0,
      total_bytes: 1,
      read_bps: read,
      write_bps: read / 2,
      kind: 'ssd',
      ...(io_available === undefined ? {} : { io_available }),
    });

    it('sums only disks with I/O counters', () => {
      const host = hostInfo({ disk: [disk(2 * MiB, true), disk(9 * MiB, false), disk(MiB, true)] });
      expect(sumDisk(host, 'read_bps')).toBe(3 * MiB);
      expect(formatDiskRead(host)).toBe('3 MB/s');
      expect(formatDiskWrite(host)).toBe('1.5 MB/s');
      expect(formatDiskReadWrite(host)).toBe('3 / 1.5 MB/s');
    });

    it('counts disks from older agents, which do not say', () => {
      const host = hostInfo({ disk: [disk(MiB)] });
      expect(hasDiskIo(host)).toBe(true);
      expect(formatDiskRead(host)).toBe('1 MB/s');
    });

    it('is n/a when no disk has I/O counters', () => {
      for (const host of [hostInfo({ disk: [disk(0, false)] }), hostInfo(), undefined]) {
        expect(hasDiskIo(host)).toBe(false);
        expect(formatDiskRead(host)).toBe(NO_VALUE);
        expect(formatDiskWrite(host)).toBe(NO_VALUE);
        expect(formatDiskReadWrite(host)).toBe(NO_VALUE);
      }
    });
  });
});

describe('frame scheduler', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('coalesces and dedupes draws into one frame', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));

    const a = vi.fn();
    const b = vi.fn(() => {
      throw new Error('bad chart');
    });
    const c = vi.fn();
    requestDraw(a);
    requestDraw(a);
    requestDraw(b);
    requestDraw(c);
    cancelDraw(c);

    expect(frames).toHaveLength(1);
    frames[0](0);
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    expect(c).not.toHaveBeenCalled();
  });
});

describe('theme tokens', () => {
  afterEach(() => {
    document.documentElement.className = '';
    document.documentElement.style.cssText = '';
  });

  it('reads CSS variables and refreshes on theme change', async () => {
    document.documentElement.style.setProperty('--orbit', 'red');
    document.documentElement.style.setProperty('--planet-light', '70');
    const first = canvasTokens();
    expect(first.orbit).toBe('red');
    expect(first.planetLight).toBe(70);
    expect(canvasTokens()).toBe(first);

    const changed = vi.fn();
    const stop = onThemeChange(changed);
    document.documentElement.style.setProperty('--orbit', 'blue');
    document.documentElement.classList.add('light');
    await Promise.resolve();

    expect(changed).toHaveBeenCalledOnce();
    expect(canvasTokens().orbit).toBe('blue');
    expect(canvasTokens().theme).toBe('light');
    stop();
  });
});
