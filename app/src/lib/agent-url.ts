/**
 * URL handling for agents and for the service links they advertise.
 */

/**
 * Normalises whatever the user typed in "Add node" into an origin.
 *
 * Accepts `jupiter.local`, `jupiter.local:7700`, `http://10.0.0.4:7700/`, and
 * so on. Returns null when it can't be made into something fetchable, so the
 * dialog can say so instead of creating a node that will never connect.
 */
export function normalizeAgentUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!url.hostname) return null;

  // The agent's default port. Someone typing a bare hostname means the agent,
  // not a web server on :80.
  if (!url.port && url.protocol === 'http:') url.port = '7700';

  // Trailing slashes would produce `//v1/host` once paths are appended.
  return `${url.protocol}//${url.host}`;
}

/**
 * Makes a service URL safe to put in an `href`.
 *
 * Labels often carry bare hostnames, which an href treats as a relative path.
 * Assume https, as served by a reverse proxy.
 */
export function serviceHref(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** The bit worth showing a human: no scheme, no trailing slash. */
export function displayHost(url: string | null | undefined): string {
  const trimmed = url?.trim() ?? '';
  return trimmed.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}
