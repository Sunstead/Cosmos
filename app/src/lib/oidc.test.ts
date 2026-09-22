import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorizeUrl, base64url, exchangeCode, OidcError, pkceChallenge, readClaims } from './oidc';

const discovery = {
  authorization_endpoint: 'https://auth.example/application/o/authorize/',
  token_endpoint: 'https://auth.example/application/o/token/',
};
const client = { issuer: 'https://auth.example/application/o/cosmos/', clientId: 'cosmos', scopes: 'openid profile' };

afterEach(() => vi.unstubAllGlobals());

describe('PKCE', () => {
  it('matches the RFC 7636 appendix B example', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(await pkceChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('base64url has no padding or unsafe characters', () => {
    expect(base64url(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe('-__-');
  });
});

describe('authorizeUrl', () => {
  it('asks for a code with an S256 challenge', () => {
    const url = new URL(
      authorizeUrl(discovery, client, { redirectUri: 'https://cosmos.example/auth/callback', state: 's', challenge: 'c' }),
    );
    expect(url.origin + url.pathname).toBe(discovery.authorization_endpoint);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'cosmos',
      redirect_uri: 'https://cosmos.example/auth/callback',
      scope: 'openid profile',
      state: 's',
      code_challenge: 'c',
      code_challenge_method: 'S256',
    });
  });
});

describe('exchangeCode', () => {
  it('posts a form with the verifier and no secret', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 600 })));
    vi.stubGlobal('fetch', fetch);

    const tokens = await exchangeCode(discovery, client, { code: 'abc', verifier: 'v', redirectUri: 'r' });
    expect(tokens.refresh_token).toBe('rt');

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(discovery.token_endpoint);
    const body = new URLSearchParams(init.body as URLSearchParams);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toBe('v');
    expect(body.has('client_secret')).toBe(false);
  });

  it('surfaces the provider error code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })),
    );
    const err = await exchangeCode(discovery, client, { code: 'x', verifier: 'v', redirectUri: 'r' }).catch((e) => e);
    expect(err).toBeInstanceOf(OidcError);
    expect((err as OidcError).code).toBe('invalid_grant');
  });
});

describe('readClaims', () => {
  it('reads a JWT payload, including non-ASCII names', () => {
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ name: 'Zoë', groups: ['a'], exp: 5 }))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(readClaims(`x.${payload}.y`)).toEqual({ name: 'Zoë', groups: ['a'], exp: 5 });
    expect(readClaims('garbage')).toEqual({});
  });
});
