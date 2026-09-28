import { TailnetDevice } from '@/generated/TailnetDevice';
import { TailnetStatus } from '@/generated/TailnetStatus';

/** A tailnet device as the app shows it, across every reporting agent. */
export interface Device extends TailnetDevice {
  /** The Cosmos node this device is, when one of our agents runs on it. */
  nodeId: string | null;
  /** The agent whose view of this device we're showing. */
  reportedBy: string;
}

/**
 * The name Tailscale shows for a device: the first label of its MagicDNS
 * name, which is the machine name from the admin console. The OS hostname
 * is `localhost` on every iPhone and iPad, and agents 0.8.0 and older send
 * that as `name`.
 */
export function machineName(d: Pick<TailnetDevice, 'name' | 'dns_name'>): string {
  return d.dns_name.split('.')[0] || d.name;
}

/** Warn this long before a device's key expires and it drops off. */
export const KEY_EXPIRY_WARN_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * One list from several agents' views of the same tailnet.
 *
 * An agent that reports a device as `is_self` is running on it, which is
 * how devices are matched to nodes: no guessing from hostnames. For any
 * other device the first reporting agent's view wins; connection paths are
 * per-viewer anyway.
 */
export function mergeTailnets(reports: { nodeId: string; status: TailnetStatus }[]): Device[] {
  const byId = new Map<string, Device>();
  const selfOf = new Map<string, string>();

  for (const { nodeId, status } of reports) {
    for (const d of status.devices) {
      if (d.is_self) selfOf.set(d.id, nodeId);
      if (!byId.has(d.id)) byId.set(d.id, { ...d, name: machineName(d), nodeId: null, reportedBy: nodeId });
    }
  }

  const out = [...byId.values()].map((d) => ({ ...d, nodeId: selfOf.get(d.id) ?? null }));
  // Nodes first, then online devices, then by name.
  return out.sort(
    (a, b) =>
      Number(b.nodeId !== null) - Number(a.nodeId !== null) ||
      Number(b.online) - Number(a.online) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}

export type KeyState = 'ok' | 'expiring' | 'expired' | 'never';

export function keyState(d: Pick<TailnetDevice, 'key_expiry' | 'key_expired'>, now = Date.now()): KeyState {
  if (d.key_expired) return 'expired';
  if (!d.key_expiry) return 'never';
  const at = Date.parse(d.key_expiry);
  if (!Number.isFinite(at)) return 'never';
  if (at <= now) return 'expired';
  return at - now < KEY_EXPIRY_WARN_MS ? 'expiring' : 'ok';
}

/** The address worth showing: IPv4 if there is one. */
export function primaryIp(d: Pick<TailnetDevice, 'ips'>): string | null {
  return d.ips.find((ip) => !ip.includes(':')) ?? d.ips[0] ?? null;
}

/** "Windows", "macOS" and friends, from Tailscale's OS strings. */
export function osLabel(os: string): string {
  const known: Record<string, string> = {
    windows: 'Windows',
    linux: 'Linux',
    macos: 'macOS',
    ios: 'iOS',
    android: 'Android',
    freebsd: 'FreeBSD',
    openbsd: 'OpenBSD',
    tvos: 'tvOS',
  };
  return known[os.toLowerCase()] ?? os;
}
