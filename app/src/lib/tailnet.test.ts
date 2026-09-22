import { describe, expect, it } from 'vitest';
import { keyState, mergeTailnets, osLabel, primaryIp } from './tailnet';
import { tailnetDevice, tailnetStatus } from '@/test/fixtures';

describe('mergeTailnets', () => {
  it('matches a device to the node whose agent reports it as itself', () => {
    const merged = mergeTailnets([
      {
        nodeId: 'n-jupiter',
        status: tailnetStatus({
          devices: [
            tailnetDevice({ id: 'j', name: 'jupiter', is_self: true }),
            tailnetDevice({ id: 'd', name: 'desktop' }),
          ],
        }),
      },
    ]);
    expect(merged.find((d) => d.id === 'j')?.nodeId).toBe('n-jupiter');
    expect(merged.find((d) => d.id === 'd')?.nodeId).toBeNull();
  });

  it('dedupes a device seen by two agents, keeping the first view', () => {
    const merged = mergeTailnets([
      {
        nodeId: 'a',
        status: tailnetStatus({
          devices: [
            tailnetDevice({ id: 'a', name: 'alpha', is_self: true }),
            tailnetDevice({ id: 'x', name: 'phone', connection: { kind: 'direct', endpoint: '1.2.3.4:1' } }),
          ],
        }),
      },
      {
        nodeId: 'b',
        status: tailnetStatus({
          devices: [
            tailnetDevice({ id: 'b', name: 'beta', is_self: true }),
            tailnetDevice({ id: 'x', name: 'phone', connection: { kind: 'relay', region: 'nyc' } }),
            tailnetDevice({ id: 'a', name: 'alpha' }),
          ],
        }),
      },
    ]);

    expect(merged.map((d) => d.id).sort()).toEqual(['a', 'b', 'x']);
    const phone = merged.find((d) => d.id === 'x')!;
    expect(phone.reportedBy).toBe('a');
    expect(phone.connection.kind).toBe('direct');
    // Beta is a node even though alpha's agent saw it first as a peer.
    expect(merged.find((d) => d.id === 'b')?.nodeId).toBe('b');
  });

  it('puts nodes first, then online devices, then names', () => {
    const merged = mergeTailnets([
      {
        nodeId: 'n',
        status: tailnetStatus({
          devices: [
            tailnetDevice({ id: '1', name: 'zed', online: true }),
            tailnetDevice({ id: '2', name: 'Apple', online: false }),
            tailnetDevice({ id: '3', name: 'node', is_self: true }),
            tailnetDevice({ id: '4', name: 'bravo', online: true }),
          ],
        }),
      },
    ]);
    expect(merged.map((d) => d.name)).toEqual(['node', 'bravo', 'zed', 'Apple']);
  });
});

describe('keyState', () => {
  const now = Date.parse('2026-09-22T00:00:00Z');

  it('reads expiry against a two-week warning window', () => {
    expect(keyState({ key_expiry: null, key_expired: false }, now)).toBe('never');
    expect(keyState({ key_expiry: '2026-12-01T00:00:00Z', key_expired: false }, now)).toBe('ok');
    expect(keyState({ key_expiry: '2026-09-30T00:00:00Z', key_expired: false }, now)).toBe('expiring');
    expect(keyState({ key_expiry: '2026-09-01T00:00:00Z', key_expired: false }, now)).toBe('expired');
    expect(keyState({ key_expiry: '2027-01-01T00:00:00Z', key_expired: true }, now)).toBe('expired');
  });
});

describe('helpers', () => {
  it('prefers an IPv4 address', () => {
    expect(primaryIp({ ips: ['fd7a::1', '100.64.0.1'] })).toBe('100.64.0.1');
    expect(primaryIp({ ips: ['fd7a::1'] })).toBe('fd7a::1');
    expect(primaryIp({ ips: [] })).toBeNull();
  });

  it('names operating systems', () => {
    expect(osLabel('windows')).toBe('Windows');
    expect(osLabel('macOS')).toBe('macOS');
    expect(osLabel('plan9')).toBe('plan9');
  });
});
