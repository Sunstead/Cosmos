import { describe, expect, it } from 'vitest';
import type { NodeMeta } from '@/api/connection';
import type { NodeConfig } from '@/stores/nodes';
import { servedUpdate } from './app-update';

const node = (id: string, url: string): NodeConfig => ({ id, url, agentName: null, alias: null });
const meta = (agentVersion: string | null) => ({ agentVersion }) as NodeMeta;

const ORIGIN = 'https://helion.example.com';

describe('servedUpdate', () => {
  it('offers the newer version of the agent serving this page', () => {
    const nodes = [node('a', 'https://edge.example.com'), node('b', `${ORIGIN}/`)];
    const metas = { a: meta('0.14.0'), b: meta('0.13.0') };
    expect(servedUpdate(nodes, metas, ORIGIN, '0.12.1')).toBe('0.13.0');
  });

  it('stays quiet when that agent is the same version or older', () => {
    const nodes = [node('b', ORIGIN)];
    expect(servedUpdate(nodes, { b: meta('0.12.1') }, ORIGIN, '0.12.1')).toBeNull();
    expect(servedUpdate(nodes, { b: meta('0.12.0') }, ORIGIN, '0.12.1')).toBeNull();
    expect(servedUpdate(nodes, { b: meta(null) }, ORIGIN, '0.12.1')).toBeNull();
  });

  it('ignores other nodes, as on the dev server', () => {
    const nodes = [node('a', 'https://edge.example.com'), node('b', 'not a url')];
    const metas = { a: meta('0.14.0'), b: meta('0.14.0') };
    expect(servedUpdate(nodes, metas, 'http://localhost:1420', '0.12.1')).toBeNull();
  });
});
