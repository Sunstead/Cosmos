import { describe, expect, it } from 'vitest';
import { LEGACY_CAPABILITIES } from '@/api/client';
import { ALL_NODES, resolveScope, scopeCandidates } from './node-scope';

const nodes = [{ id: 'jupiter' }, { id: 'pluto' }];

describe('scopeCandidates', () => {
  it('offers only nodes with the capability', () => {
    const meta = {
      jupiter: { capabilities: { ...LEGACY_CAPABILITIES, backups: true } },
      pluto: { capabilities: { ...LEGACY_CAPABILITIES, backups: false } },
    };
    expect(scopeCandidates(nodes, meta, 'backups')).toEqual(['jupiter']);
  });

  it('keeps a node that has not said what it can do yet', () => {
    const meta = {
      jupiter: { capabilities: { ...LEGACY_CAPABILITIES, backups: true } },
      pluto: { capabilities: LEGACY_CAPABILITIES },
    };
    expect(scopeCandidates(nodes, meta, 'backups')).toEqual(['jupiter', 'pluto']);
  });

  it('offers every node with no capability asked for', () => {
    expect(scopeCandidates(nodes, {})).toEqual(['jupiter', 'pluto']);
  });
});

describe('resolveScope', () => {
  it('keeps a stored node that is still on offer', () => {
    expect(resolveScope('pluto', ['jupiter', 'pluto'], false)).toBe('pluto');
  });

  it('falls back to the first candidate when the stored node is gone', () => {
    expect(resolveScope('pluto', ['jupiter'], true)).toBe('jupiter');
  });

  it('keeps all nodes only where allowed and there is more than one', () => {
    expect(resolveScope(ALL_NODES, ['jupiter', 'pluto'], true)).toBe(ALL_NODES);
    expect(resolveScope(ALL_NODES, ['jupiter', 'pluto'], false)).toBe('jupiter');
    expect(resolveScope(ALL_NODES, ['jupiter'], true)).toBe('jupiter');
  });

  it('is null with no candidates', () => {
    expect(resolveScope('jupiter', [], true)).toBeNull();
  });
});
