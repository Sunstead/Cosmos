import { create } from 'zustand';
import { AuthInfo } from '@/generated/AuthInfo';
import { isDesktop } from '@/lib/platform';
import {
  authorizeUrl,
  discover,
  exchangeCode,
  OidcClient,
  OidcError,
  pkceChallenge,
  randomString,
  readClaims,
  refreshTokens,
  revoke,
  TokenResponse,
} from '@/lib/oidc';

export type OidcAuth = Extract<AuthInfo, { kind: 'oidc' }>;

/**
 * One sign-in per identity provider. Every node that trusts the same
 * issuer shares it, so signing in once covers them all.
 */
export interface Session {
  issuer: string;
  accessToken: string;
  /** ms since epoch. */
  expiresAt: number;
  /** Full name, falling back to the username. */
  name: string | null;
  username: string | null;
  email: string | null;
  /** An avatar URL, when the provider's mappings include one. */
  picture: string | null;
  groups: string[];
}

interface AuthState {
  /** Keyed by issuer. Access tokens live only in memory. */
  sessions: Record<string, Session>;
}

export const useAuthStore = create<AuthState>(() => ({ sessions: {} }));

/** Providers signed out of on purpose since the last sign-in, so nothing says the session expired. */
const signedOut = new Set<string>();

export function wasSignedOut(issuer: string): boolean {
  return signedOut.has(issuer);
}

/** Refresh this long before expiry, so a request never carries a dying token. */
const REFRESH_MARGIN_MS = 60_000;
const PENDING_KEY = 'cosmos-oidc-pending';
const refreshKey = (issuer: string) => `cosmos-oidc:${issuer}`;

export function clientOf(auth: OidcAuth): OidcClient {
  return { issuer: auth.issuer, clientId: auth.client_id, scopes: auth.scopes };
}

function setSession(issuer: string, tokens: { access_token: string; expires_in?: number | null }) {
  signedOut.delete(issuer);
  const claims = readClaims(tokens.access_token);
  const expiresAt = claims.exp
    ? claims.exp * 1000
    : Date.now() + (tokens.expires_in ?? 300) * 1000;
  useAuthStore.setState((s) => ({
    sessions: {
      ...s.sessions,
      [issuer]: {
        issuer,
        accessToken: tokens.access_token,
        expiresAt,
        name: claims.name || claims.preferred_username || null,
        username: claims.preferred_username || null,
        email: claims.email || null,
        picture: claims.picture?.startsWith('https://') ? claims.picture : null,
        groups: claims.groups ?? [],
      },
    },
  }));
}

function clearSession(issuer: string) {
  useAuthStore.setState((s) => {
    const { [issuer]: _gone, ...rest } = s.sessions;
    return { sessions: rest };
  });
}

// --- refresh tokens: keychain on desktop, localStorage in the browser --------

interface DesktopTokens {
  access_token: string;
  expires_in: number | null;
}

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

function readRefresh(issuer: string): string | null {
  try {
    return localStorage.getItem(refreshKey(issuer));
  } catch {
    return null;
  }
}

function writeRefresh(issuer: string, token: string | null) {
  try {
    if (token) localStorage.setItem(refreshKey(issuer), token);
    else localStorage.removeItem(refreshKey(issuer));
  } catch {
    // Private browsing: the session still works until the tab closes.
  }
}

/** `null` means "no usable sign-in"; a network failure throws instead. */
async function refresh(auth: OidcAuth): Promise<{ access_token: string; expires_in?: number | null } | null> {
  if (isDesktop()) {
    return invoke<DesktopTokens | null>('oidc_access_token', {
      issuer: auth.issuer,
      clientId: auth.client_id,
    });
  }
  const rt = readRefresh(auth.issuer);
  if (!rt) return null;
  try {
    const tokens = await refreshTokens(await discover(auth.issuer), clientOf(auth), rt);
    if (tokens.refresh_token) writeRefresh(auth.issuer, tokens.refresh_token);
    return tokens;
  } catch (e) {
    // Revoked or expired: sign in again. Anything else may be transient.
    if (e instanceof OidcError && e.code === 'invalid_grant') {
      writeRefresh(auth.issuer, null);
      return null;
    }
    throw e;
  }
}

const inflight = new Map<string, Promise<string | null>>();

/** The provider couldn't be reached. Retry later; don't ask to sign in. */
export class ProviderUnreachable extends Error {
  constructor(cause?: unknown) {
    super("Can't reach the sign-in provider", { cause });
    this.name = 'ProviderUnreachable';
  }
}

/**
 * A current access token for this provider, refreshing when it's close to
 * expiry. `null` means the user has to sign in. Rejects with
 * `ProviderUnreachable` when a refresh is needed and the provider is down: a
 * deploy that restarts it must not look like a sign-out. Concurrent callers
 * share one refresh.
 */
export function getAccessToken(auth: OidcAuth, opts: { force?: boolean } = {}): Promise<string | null> {
  const s = useAuthStore.getState().sessions[auth.issuer];
  if (!opts.force && s && s.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return Promise.resolve(s.accessToken);
  }

  let pending = inflight.get(auth.issuer);
  if (!pending) {
    pending = refresh(auth)
      .then((tokens) => {
        if (!tokens) {
          clearSession(auth.issuer);
          return null;
        }
        setSession(auth.issuer, tokens);
        return tokens.access_token;
      })
      // A provider that's briefly down keeps the refresh token for later.
      .catch((e: unknown) => {
        if (s && s.expiresAt > Date.now()) return s.accessToken;
        throw new ProviderUnreachable(e);
      })
      .finally(() => inflight.delete(auth.issuer));
    inflight.set(auth.issuer, pending);
  }
  return pending;
}

// --- sign in and out ----------------------------------------------------------

/** What to do once the provider sends the browser back. */
export interface AfterSignIn {
  returnTo: string;
  /** An Add node attempt that was waiting on sign-in. */
  addNodeUrl?: string;
}

interface Pending extends AfterSignIn {
  issuer: string;
  clientId: string;
  scopes: string;
  state: string;
  verifier: string;
  redirectUri: string;
}

export function webRedirectUri(): string {
  return `${window.location.origin}/auth/callback`;
}

/**
 * Starts sign-in. On desktop this resolves once the browser round trip is
 * done. In the browser it navigates away and never resolves; the callback
 * route finishes the job with `completeSignIn`.
 */
export async function signIn(auth: OidcAuth, after: AfterSignIn): Promise<void> {
  if (isDesktop()) {
    const tokens = await invoke<DesktopTokens>('oidc_sign_in', {
      issuer: auth.issuer,
      clientId: auth.client_id,
      scopes: auth.scopes,
    });
    setSession(auth.issuer, tokens);
    return;
  }

  const d = await discover(auth.issuer);
  const verifier = randomString();
  const pending: Pending = {
    ...after,
    issuer: auth.issuer,
    clientId: auth.client_id,
    scopes: auth.scopes,
    state: randomString(16),
    verifier,
    redirectUri: webRedirectUri(),
  };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  window.location.assign(
    authorizeUrl(d, clientOf(auth), {
      redirectUri: pending.redirectUri,
      state: pending.state,
      challenge: await pkceChallenge(verifier),
    }),
  );
  await new Promise(() => {});
}

/** Finishes a browser sign-in from the callback URL. */
export async function completeSignIn(href: string): Promise<AfterSignIn> {
  const params = new URL(href).searchParams;
  const raw = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);

  const error = params.get('error');
  if (error) throw new OidcError(params.get('error_description') || `Sign-in was refused (${error}).`, error);
  if (!raw) throw new OidcError('This sign-in link has expired. Start again from Cosmos.');

  const pending = JSON.parse(raw) as Pending;
  const code = params.get('code');
  if (!code || params.get('state') !== pending.state) {
    throw new OidcError('This sign-in response does not match the request. Start again.');
  }

  const client: OidcClient = { issuer: pending.issuer, clientId: pending.clientId, scopes: pending.scopes };
  const tokens: TokenResponse = await exchangeCode(await discover(pending.issuer), client, {
    code,
    verifier: pending.verifier,
    redirectUri: pending.redirectUri,
  });
  writeRefresh(pending.issuer, tokens.refresh_token ?? null);
  setSession(pending.issuer, tokens);
  return { returnTo: pending.returnTo, addNodeUrl: pending.addNodeUrl };
}

export async function signOut(auth: OidcAuth): Promise<void> {
  signedOut.add(auth.issuer);
  clearSession(auth.issuer);
  if (isDesktop()) {
    await invoke('oidc_sign_out', { issuer: auth.issuer, clientId: auth.client_id }).catch(() => {});
    return;
  }
  const rt = readRefresh(auth.issuer);
  writeRefresh(auth.issuer, null);
  if (rt) {
    const d = await discover(auth.issuer).catch(() => null);
    if (d) await revoke(d, clientOf(auth), rt);
  }
}
