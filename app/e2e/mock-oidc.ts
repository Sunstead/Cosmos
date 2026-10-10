import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';

/**
 * Just enough of an OpenID Connect provider for the e2e suite: discovery,
 * JWKS, an authorize endpoint that approves at once (checking PKCE later),
 * and a token endpoint for codes and refreshes. Tokens are real RS256 JWTs,
 * so the agent verifies them exactly as it would Authentik's.
 *
 * `POST /test/user` picks who the next sign-in is; `POST /test/token`
 * mints a token directly, for specs that call the agent's API.
 */
export interface MockOidc {
  issuer: string;
  server: Server;
}

interface User {
  sub: string;
  preferred_username: string;
  groups: string[];
  /** Sent as the `picture` claim, like Authentik's profile mapping. */
  picture?: string;
}

const ADMIN: User = { sub: 'e2e-admin', preferred_username: 'riley', groups: ['homelab-users', 'homelab-admins'] };

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function startMockOidc(): Promise<MockOidc> {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'e2e', alg: 'RS256', use: 'sig' };

  const codes = new Map<string, { challenge: string; redirectUri: string; user: User }>();
  const refreshTokens = new Map<string, User>();
  let nextUser: User = ADMIN;
  let issuer = '';

  const sign = (user: User) => {
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'e2e' }));
    const payload = b64url(
      JSON.stringify({ iss: issuer, aud: 'cosmos', azp: 'cosmos', iat: now, exp: now + 600, ...user }),
    );
    const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKey);
    return `${header}.${payload}.${b64url(signature)}`;
  };

  const tokens = (user: User) => {
    const refresh = randomBytes(16).toString('hex');
    refreshTokens.set(refresh, user);
    return { access_token: sign(user), token_type: 'Bearer', expires_in: 600, refresh_token: refresh };
  };

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      // Like Authentik's token endpoint for a registered redirect origin.
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end(JSON.stringify(body));
  };

  const body = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let text = '';
      req.on('data', (c) => (text += c));
      req.on('end', () => resolve(text));
    });
  const form = async (req: IncomingMessage) => new URLSearchParams(await body(req));

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', issuer);
    const base = `/application/o/cosmos`;

    if (req.method === 'OPTIONS') return json(res, 204, {});

    if (url.pathname === `${base}/.well-known/openid-configuration`) {
      const origin = new URL(issuer).origin;
      return json(res, 200, {
        issuer,
        authorization_endpoint: `${origin}/application/o/authorize/`,
        token_endpoint: `${origin}/application/o/token/`,
        revocation_endpoint: `${origin}/application/o/revoke/`,
        jwks_uri: `${origin}${base}/jwks/`,
      });
    }
    if (url.pathname === `${base}/jwks/`) return json(res, 200, { keys: [jwk] });

    if (url.pathname === '/application/o/authorize/') {
      const p = url.searchParams;
      if (p.get('code_challenge_method') !== 'S256' || p.get('client_id') !== 'cosmos') {
        return json(res, 400, { error: 'invalid_request' });
      }
      const code = randomBytes(16).toString('hex');
      codes.set(code, { challenge: p.get('code_challenge')!, redirectUri: p.get('redirect_uri')!, user: nextUser });
      const back = new URL(p.get('redirect_uri')!);
      back.searchParams.set('code', code);
      back.searchParams.set('state', p.get('state') ?? '');
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }

    if (url.pathname === '/application/o/token/' && req.method === 'POST') {
      const p = await form(req);
      if (p.get('grant_type') === 'authorization_code') {
        const entry = codes.get(p.get('code') ?? '');
        codes.delete(p.get('code') ?? '');
        const verifier = p.get('code_verifier') ?? '';
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        if (!entry || entry.challenge !== challenge || entry.redirectUri !== p.get('redirect_uri')) {
          return json(res, 400, { error: 'invalid_grant' });
        }
        return json(res, 200, tokens(entry.user));
      }
      if (p.get('grant_type') === 'refresh_token') {
        const user = refreshTokens.get(p.get('refresh_token') ?? '');
        if (!user) return json(res, 400, { error: 'invalid_grant' });
        refreshTokens.delete(p.get('refresh_token')!);
        return json(res, 200, tokens(user));
      }
      return json(res, 400, { error: 'unsupported_grant_type' });
    }

    if (url.pathname === '/application/o/revoke/') {
      const p = await form(req);
      refreshTokens.delete(p.get('token') ?? '');
      return json(res, 200, {});
    }

    // Test controls, kept apart from the OIDC surface.
    if (url.pathname === '/test/user' && req.method === 'POST') {
      const input = JSON.parse((await body(req)) || '{}') as { groups?: string[]; name?: string; picture?: string };
      nextUser = input.groups
        ? {
            sub: `e2e-${input.name ?? 'user'}`,
            preferred_username: input.name ?? 'guest',
            groups: input.groups,
            ...(input.picture && { picture: input.picture }),
          }
        : ADMIN;
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/test/token' && req.method === 'POST') {
      return json(res, 200, { access_token: sign(ADMIN) });
    }

    json(res, 404, { error: 'not_found' });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      issuer = `http://127.0.0.1:${port}/application/o/cosmos/`;
      resolve({ issuer, server });
    });
  });
}
