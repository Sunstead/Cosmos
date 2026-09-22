/**
 * OpenID Connect for a public client: authorization code with PKCE.
 *
 * Only the browser build runs this flow itself. The desktop app does it in
 * Rust (`src-tauri/src/oidc.rs`) so the refresh token lives in the OS
 * keychain and never reaches the webview.
 */

export interface OidcClient {
  issuer: string;
  clientId: string;
  scopes: string;
}

export interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint?: string;
  revocation_endpoint?: string;
}

export interface TokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
}

export class OidcError extends Error {
  constructor(
    message: string,
    /** The provider's `error` code, e.g. `invalid_grant`. */
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'OidcError';
  }
}

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 32 random bytes, which RFC 7636 recommends for the verifier. */
export function randomString(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** `S256`: base64url(SHA-256(verifier)). */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

const discoveries = new Map<string, Promise<Discovery>>();

export function discover(issuer: string): Promise<Discovery> {
  let pending = discoveries.get(issuer);
  if (!pending) {
    pending = (async () => {
      const res = await fetch(`${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`);
      if (!res.ok) throw new OidcError(`Could not reach the sign-in provider (${res.status}).`);
      return (await res.json()) as Discovery;
    })();
    // A failure shouldn't stick: the provider may be back in a minute.
    pending.catch(() => discoveries.delete(issuer));
    discoveries.set(issuer, pending);
  }
  return pending;
}

export function authorizeUrl(
  d: Discovery,
  c: OidcClient,
  opts: { redirectUri: string; state: string; challenge: string },
): string {
  const url = new URL(d.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: c.clientId,
    redirect_uri: opts.redirectUri,
    scope: c.scopes,
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

async function tokenRequest(d: Discovery, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(d.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse & {
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new OidcError(json.error_description || json.error || `Sign-in failed (${res.status}).`, json.error ?? null);
  }
  return json;
}

export function exchangeCode(
  d: Discovery,
  c: OidcClient,
  opts: { code: string; verifier: string; redirectUri: string },
): Promise<TokenResponse> {
  return tokenRequest(d, {
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: c.clientId,
    code_verifier: opts.verifier,
  });
}

export function refreshTokens(d: Discovery, c: OidcClient, refreshToken: string): Promise<TokenResponse> {
  return tokenRequest(d, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: c.clientId,
  });
}

/** Best effort: signing out locally must work even if this fails. */
export async function revoke(d: Discovery, c: OidcClient, token: string): Promise<void> {
  if (!d.revocation_endpoint) return;
  try {
    await fetch(d.revocation_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, token_type_hint: 'refresh_token', client_id: c.clientId }),
    });
  } catch {
    /* ignore */
  }
}

export interface TokenClaims {
  exp?: number;
  sub?: string;
  preferred_username?: string;
  name?: string;
  groups?: string[];
}

/**
 * Reads a JWT's claims for display. No verification: the agents verify
 * every token they're given; this only labels the account in the UI.
 */
export function readClaims(jwt: string): TokenClaims {
  try {
    const part = jwt.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(escape(json))) as TokenClaims;
  } catch {
    return {};
  }
}
