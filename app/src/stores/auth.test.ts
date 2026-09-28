import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccessToken, ProviderUnreachable, useAuthStore } from './auth';

const auth = {
  kind: 'oidc' as const,
  issuer: 'https://auth.example/application/o/cosmos/',
  client_id: 'cosmos',
  scopes: 'openid profile email',
};

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;
}

const discovery = { token_endpoint: 'https://auth.example/token', authorization_endpoint: 'https://auth.example/authorize' };

beforeEach(() => {
  useAuthStore.setState({ sessions: {} });
  localStorage.clear();
});

afterEach(() => vi.unstubAllGlobals());

describe('getAccessToken', () => {
  it('reads the account from the token it gets', async () => {
    localStorage.setItem(`cosmos-oidc:${auth.issuer}`, 'rt');
    const access = jwt({
      exp: Math.floor(Date.now() / 1000) + 600,
      name: 'Pat Doe',
      preferred_username: 'pat',
      email: 'pat@example.com',
      groups: ['admins'],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('openid-configuration')
          ? new Response(JSON.stringify(discovery))
          : new Response(JSON.stringify({ access_token: access, refresh_token: 'rt2' })),
      ),
    );

    expect(await getAccessToken(auth)).toBe(access);
    expect(useAuthStore.getState().sessions[auth.issuer]).toMatchObject({
      name: 'Pat Doe',
      username: 'pat',
      email: 'pat@example.com',
      picture: null,
      groups: ['admins'],
    });
    expect(localStorage.getItem(`cosmos-oidc:${auth.issuer}`)).toBe('rt2');
  });

  it('means "sign in" when there is nothing to refresh with', async () => {
    expect(await getAccessToken(auth)).toBeNull();
  });

  it('rejects, keeping the refresh token, when the provider is down', async () => {
    localStorage.setItem(`cosmos-oidc:${auth.issuer}`, 'rt');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    await expect(getAccessToken(auth)).rejects.toBeInstanceOf(ProviderUnreachable);
    expect(localStorage.getItem(`cosmos-oidc:${auth.issuer}`)).toBe('rt');
  });

  it('still hands out a token that has not expired while the provider is down', async () => {
    useAuthStore.setState({
      sessions: {
        [auth.issuer]: {
          issuer: auth.issuer,
          accessToken: 'still-good',
          // Inside the refresh margin, but not expired.
          expiresAt: Date.now() + 30_000,
          name: null,
          username: null,
          email: null,
          picture: null,
          groups: [],
        },
      },
    });
    localStorage.setItem(`cosmos-oidc:${auth.issuer}`, 'rt');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    expect(await getAccessToken(auth)).toBe('still-good');
  });

  it('forgets a refresh token the provider revoked', async () => {
    localStorage.setItem(`cosmos-oidc:${auth.issuer}`, 'rt');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('openid-configuration')
          ? new Response(JSON.stringify(discovery))
          : new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
      ),
    );

    expect(await getAccessToken(auth)).toBeNull();
    expect(localStorage.getItem(`cosmos-oidc:${auth.issuer}`)).toBeNull();
  });
});
