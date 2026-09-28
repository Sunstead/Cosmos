import { NodeMeta, OidcAuthInfo } from '@/api/connection';
import { Session } from '@/stores/auth';

/**
 * One identity provider the nodes use, and where you stand with it. Nodes
 * that trust the same issuer share one sign-in.
 */
export interface Account {
  auth: OidcAuthInfo;
  session: Session | null;
  /**
   * Admin on any node that trusts this provider, as the agents report it.
   * Null until one has said who you are.
   */
  admin: boolean | null;
  /** Nodes that trust this provider. */
  nodes: string[];
  /** Of those, the ones waiting for a sign-in. */
  waiting: string[];
}

/** Signed-in accounts first, then by provider. */
export function deriveAccounts(meta: Record<string, NodeMeta>, sessions: Record<string, Session>): Account[] {
  const byIssuer = new Map<string, Account>();
  for (const [nodeId, m] of Object.entries(meta)) {
    if (m.auth?.kind !== 'oidc') continue;
    const issuer = m.auth.issuer;
    let account = byIssuer.get(issuer);
    if (!account) {
      account = { auth: m.auth, session: sessions[issuer] ?? null, admin: null, nodes: [], waiting: [] };
      byIssuer.set(issuer, account);
    }
    account.nodes.push(nodeId);
    if (m.status === 'unauthorized') account.waiting.push(nodeId);
    if (m.principal) account.admin = account.admin || m.principal.admin;
  }
  return [...byIssuer.values()].sort(
    (a, b) => Number(!!b.session) - Number(!!a.session) || a.auth.issuer.localeCompare(b.auth.issuer),
  );
}

/**
 * Who you are on nodes that don't sign in (`allow_anonymous`), when every
 * node is like that. Null otherwise, or before any has answered.
 */
export function openPrincipal(meta: Record<string, NodeMeta>): string | null {
  const all = Object.values(meta);
  if (all.some((m) => m.auth?.kind === 'oidc')) return null;
  return all.find((m) => m.principal)?.principal?.name ?? null;
}

/** "Admin", "Viewer", or null while nobody has said. */
export function roleLabel(account: Pick<Account, 'admin'>): string | null {
  return account.admin === null ? null : account.admin ? 'Admin' : 'Viewer';
}

/** "PD" for Pat Doe, "P" for pat, for an avatar without a picture. */
export function initials(name: string): string {
  const words = name.trim().split('@')[0].split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...words[0]][0] ?? '';
  const last = words.length > 1 ? ([...words[words.length - 1]][0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** `auth.example.com` from an issuer URL. */
export function providerHost(issuer: string): string {
  try {
    return new URL(issuer).host;
  } catch {
    return issuer;
  }
}
