import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDefaultNodes } from './config';

describe('getDefaultNodes', () => {
  afterEach(() => vi.unstubAllGlobals());

  const serve = (body: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body))));

  it('resolves "/" to the origin serving the page', async () => {
    serve([{ url: '/' }]);
    expect(await getDefaultNodes()).toEqual([{ url: window.location.origin, token: undefined }]);
  });

  it('keeps absolute URLs and tokens, and drops malformed entries', async () => {
    serve(['http://a:7700', { url: 'https://b', token: 't' }, { nope: 1 }, 3]);
    expect(await getDefaultNodes()).toEqual([
      { url: 'http://a:7700' },
      { url: 'https://b', token: 't' },
    ]);
  });

  it('is empty in the desktop app', async () => {
    document.documentElement.dataset.platform = 'macos';
    serve([{ url: '/' }]);
    expect(await getDefaultNodes()).toEqual([]);
  });
});
