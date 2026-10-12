/** `1.2.3` or `1.2.3-beta.1`, as release.mjs writes them; a leading `v` is allowed. */
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

type Parsed = { core: [number, number, number]; pre: string[] };

function parse(version: string): Parsed | null {
  const m = SEMVER.exec(version.trim());
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
}

/** Semver precedence: numeric identifiers numerically, below alphanumeric ones. */
function comparePre(a: string[], b: string[]): number {
  // A release sorts above any of its pre-releases.
  if (!a.length || !b.length) return b.length - a.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const an = /^\d+$/.test(a[i]);
    const bn = /^\d+$/.test(b[i]);
    if (an && bn) {
      const d = Number(a[i]) - Number(b[i]);
      if (d) return d;
    } else if (an !== bn) {
      return an ? -1 : 1;
    } else if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return 0;
}

/** Whether `a` is a newer version than `b`. False when either isn't a version. */
export function isNewer(a: string, b: string): boolean {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] > pb.core[i];
  }
  return comparePre(pa.pre, pb.pre) > 0;
}
