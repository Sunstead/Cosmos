import { beforeEach, describe, expect, it } from 'vitest';
import { migrateLegacyStorage } from './migrate-legacy-storage';

const ISSUER = 'https://auth.example/application/o/cosmos/';

beforeEach(() => localStorage.clear());

describe('migrateLegacyStorage', () => {
  it('copies every cosmos- key, including ones built at runtime', () => {
    localStorage.setItem('cosmos-theme', 'sunstead-light');
    localStorage.setItem('cosmos-nodes', '{"state":{"nodes":[]},"version":1}');
    localStorage.setItem('cosmos-scope-logs', '"jupiter"');
    localStorage.setItem('cosmos-sidebar-width', '320');
    localStorage.setItem('unrelated', 'x');

    migrateLegacyStorage();

    expect(localStorage.getItem('helion-theme')).toBe('sunstead-light');
    expect(localStorage.getItem('helion-nodes')).toBe('{"state":{"nodes":[]},"version":1}');
    expect(localStorage.getItem('helion-scope-logs')).toBe('"jupiter"');
    expect(localStorage.getItem('helion-sidebar-width')).toBe('320');
    expect(localStorage.getItem('helion-unrelated')).toBeNull();
  });

  it('keeps what the new keys already hold', () => {
    localStorage.setItem('cosmos-theme', 'sunstead-light');
    localStorage.setItem('helion-theme', 'sunstead-dark');
    migrateLegacyStorage();
    expect(localStorage.getItem('helion-theme')).toBe('sunstead-dark');
  });

  it('moves refresh tokens instead of leaving a copy', () => {
    localStorage.setItem(`cosmos-oidc:${ISSUER}`, 'refresh-1');
    migrateLegacyStorage();
    expect(localStorage.getItem(`helion-oidc:${ISSUER}`)).toBe('refresh-1');
    expect(localStorage.getItem(`cosmos-oidc:${ISSUER}`)).toBeNull();
  });

  it('runs once, so a sign-out is not undone by the next load', () => {
    localStorage.setItem('cosmos-nodes', '[]');
    migrateLegacyStorage();
    localStorage.removeItem('helion-nodes');
    migrateLegacyStorage();
    expect(localStorage.getItem('helion-nodes')).toBeNull();
  });

  it('does nothing on a fresh install beyond the marker', () => {
    migrateLegacyStorage();
    expect(Object.keys(localStorage)).toEqual(['helion-legacy-migrated']);
  });
});
