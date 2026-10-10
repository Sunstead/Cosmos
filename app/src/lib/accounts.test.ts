import { describe, expect, it } from 'vitest';
import { NodeMeta } from '@/api/connection';
import { DEFAULT_META } from '@/stores/nodes';
import { signedIn, ISSUER } from '@/test/fixtures';
import { deriveAccounts, initials, openPrincipal, providerHost, roleLabel } from './accounts';

const oidc = { kind: 'oidc' as const, issuer: ISSUER, client_id: 'cosmos', scopes: 'openid' };

function meta(partial: Partial<NodeMeta>): NodeMeta {
  return { ...DEFAULT_META, ...partial };
}

describe('deriveAccounts', () => {
  it('groups nodes by provider and says which wait for a sign-in', () => {
    const accounts = deriveAccounts(
      {
        a: meta({ status: 'online', auth: oidc, principal: { name: 'riley', admin: false } }),
        b: meta({ status: 'unauthorized', auth: oidc }),
        c: meta({ status: 'online', auth: null }),
      },
      {},
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ session: null, admin: false, nodes: ['a', 'b'], waiting: ['b'] });
    expect(roleLabel(accounts[0])).toBe('Viewer');
  });

  it("doesn't guess a role before any node has said", () => {
    const [account] = deriveAccounts({ a: meta({ status: 'connecting', auth: oidc }) }, signedIn());
    expect(account.admin).toBeNull();
    expect(roleLabel(account)).toBeNull();
  });

  it('is an admin when any node says so, and puts signed-in accounts first', () => {
    const other = { ...oidc, issuer: 'https://a.test/' };
    const accounts = deriveAccounts(
      {
        a: meta({ status: 'online', auth: oidc, principal: { name: 'riley', admin: false } }),
        b: meta({ status: 'online', auth: oidc, principal: { name: 'riley', admin: true } }),
        c: meta({ status: 'unauthorized', auth: other }),
      },
      signedIn(),
    );
    expect(accounts.map((a) => a.auth.issuer)).toEqual([ISSUER, 'https://a.test/']);
    expect(accounts[0].admin).toBe(true);
    expect(accounts[0].session?.username).toBe('riley');
  });
});

describe('openPrincipal', () => {
  it('names you on nodes without sign-in, and only when none has one', () => {
    const open = meta({ status: 'online', principal: { name: 'Anonymous', admin: true } });
    expect(openPrincipal({ a: open })).toBe('Anonymous');
    expect(openPrincipal({ a: open, b: meta({ auth: oidc }) })).toBeNull();
    expect(openPrincipal({})).toBeNull();
  });
});

describe('labels', () => {
  it('makes initials from names and usernames', () => {
    expect(initials('Pat Doe')).toBe('PD');
    expect(initials('pat')).toBe('P');
    expect(initials('pat.doe@example.com')).toBe('PD');
    expect(initials('Zoë Ångström')).toBe('ZÅ');
    expect(initials('  ')).toBe('?');
  });

  it('shows the provider by host', () => {
    expect(providerHost('https://auth.example.com/application/o/cosmos/')).toBe('auth.example.com');
    expect(providerHost('not a url')).toBe('not a url');
  });
});
