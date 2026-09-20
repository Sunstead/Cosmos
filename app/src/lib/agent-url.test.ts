import { describe, expect, it } from 'vitest';
import { displayHost, normalizeAgentUrl, serviceHref } from './agent-url';

describe('normalizeAgentUrl', () => {
  it('assumes the agent port for a bare host', () => {
    expect(normalizeAgentUrl('jupiter.local')).toBe('http://jupiter.local:7700');
    expect(normalizeAgentUrl('10.0.0.4')).toBe('http://10.0.0.4:7700');
  });

  it('keeps an explicit port', () => {
    expect(normalizeAgentUrl('jupiter.local:9000')).toBe('http://jupiter.local:9000');
  });

  it('keeps an explicit scheme and drops the path', () => {
    expect(normalizeAgentUrl('https://jupiter.local')).toBe('https://jupiter.local');
    // A trailing slash would produce `//v1/host` once paths are appended.
    expect(normalizeAgentUrl('http://10.0.0.4:7700/')).toBe('http://10.0.0.4:7700');
  });

  it('tolerates surrounding whitespace', () => {
    expect(normalizeAgentUrl('  jupiter.local  ')).toBe('http://jupiter.local:7700');
  });

  it('rejects input it cannot make fetchable', () => {
    expect(normalizeAgentUrl('')).toBeNull();
    expect(normalizeAgentUrl('   ')).toBeNull();
    expect(normalizeAgentUrl('http://')).toBeNull();
  });
});

describe('serviceHref', () => {
  it('adds https to the bare hostnames Docker labels carry', () => {
    // This is the real shape in compose/management.yml. Left bare, an href
    // resolves as a relative path and navigates inside the app.
    expect(serviceHref('portainer.jupiter.sunstead.net')).toBe(
      'https://portainer.jupiter.sunstead.net',
    );
  });

  it('leaves an explicit scheme alone', () => {
    expect(serviceHref('http://nas.local:5000')).toBe('http://nas.local:5000');
    expect(serviceHref('https://gitea.example.com')).toBe('https://gitea.example.com');
  });

  it('returns null for nothing usable', () => {
    expect(serviceHref(null)).toBeNull();
    expect(serviceHref(undefined)).toBeNull();
    expect(serviceHref('  ')).toBeNull();
  });
});

describe('displayHost', () => {
  it('strips the scheme and trailing slashes', () => {
    expect(displayHost('https://gitea.example.com/')).toBe('gitea.example.com');
    expect(displayHost('http://10.0.0.4:7700')).toBe('10.0.0.4:7700');
    expect(displayHost('portainer.local')).toBe('portainer.local');
  });
});
