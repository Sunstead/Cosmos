/**
 * Before 0.14 the app was Cosmos and kept its settings in local storage under
 * `cosmos-…`. This copies them to `helion-…` once, so nodes, theme, sidebar and
 * the per-page scopes survive the rename.
 *
 * It runs once (the marker), not on every load: sign-out removes the new
 * refresh token, and a copy that kept running would bring the old one back.
 * The old refresh tokens are moved, not copied, so none are left behind. Other
 * old keys stay where they are; nothing reads them.
 *
 * Keys are found by prefix because some are built at runtime
 * (`cosmos-scope-<page>`, `cosmos-oidc:<issuer>`). Storage is per origin, so
 * this only carries settings across while the app is served from the same
 * address as before.
 */
const OLD = 'cosmos-';
const NEW = 'helion-';
const MARKER = 'helion-legacy-migrated';
const REFRESH_TOKENS = 'cosmos-oidc:';

export function migrateLegacyStorage(storage: Storage = localStorage): void {
  try {
    if (storage.getItem(MARKER) !== null) return;
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
      (k): k is string => k !== null && k.startsWith(OLD),
    );
    for (const key of keys) {
      const value = storage.getItem(key);
      const next = NEW + key.slice(OLD.length);
      if (value !== null && storage.getItem(next) === null) storage.setItem(next, value);
      if (key.startsWith(REFRESH_TOKENS)) storage.removeItem(key);
    }
    storage.setItem(MARKER, '1');
  } catch {
    // Storage blocked or full: start clean, as a first run would.
  }
}
