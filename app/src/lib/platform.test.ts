import { afterEach, describe, expect, it } from 'vitest';
import { applyPlatform, getPlatform, isDesktop } from './platform';
import { pageFor } from './navigation';

afterEach(() => {
  delete window.__COSMOS_PLATFORM__;
});

describe('platform', () => {
  it('defaults to web in a browser', () => {
    expect(applyPlatform()).toBe('web');
    expect(document.documentElement.dataset.platform).toBe('web');
    expect(isDesktop()).toBe(false);
  });

  it('adopts the platform injected by Tauri', () => {
    window.__COSMOS_PLATFORM__ = 'macos';
    applyPlatform();
    expect(getPlatform()).toBe('macos');
    expect(isDesktop()).toBe(true);
  });
});

describe('pageFor', () => {
  it('resolves nested routes to their section', () => {
    expect(pageFor('/nodes/abc')?.label).toBe('Nodes');
    expect(pageFor('/')?.label).toBe('Overview');
    expect(pageFor('/nope')).toBeUndefined();
  });
});
