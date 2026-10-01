import { APIRequestContext, expect, Locator, Page } from '@playwright/test';

export const WEB_PORT = 1431;
export const agentUrl = () => process.env.E2E_AGENT_URL!;

export const PAGES = [
  '/overview',
  '/constellation',
  '/nodes',
  '/services',
  '/containers',
  '/volumes',
  '/network',
  '/monitoring',
  '/uptime',
  '/logs',
  '/backups',
  '/events',
  '/updates',
  '/settings',
] as const;

const issuer = () => process.env.E2E_OIDC_ISSUER!;
const mockOrigin = () => new URL(issuer()).origin;

/** Who the mock provider signs in next. No groups given means the admin. */
export async function nextSignIn(
  request: APIRequestContext,
  user?: { name: string; groups: string[]; picture?: string },
) {
  await request.post(`${mockOrigin()}/test/user`, { data: user ?? {} });
}

/** A bearer token for calling the agent's API directly from a spec. */
export async function apiToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${mockOrigin()}/test/token`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Opens Add node and submits the agent's address; sign-in comes next. */
export async function addNode(page: Page) {
  await page.goto('/nodes');
  await page.getByRole('button', { name: 'Add node' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Address').fill(agentUrl());
  await dialog.getByRole('button', { name: 'Add' }).click();
  return dialog;
}

/** Adds the node through the real sign-in round trip, and waits for it. */
export async function addNodeOnline(page: Page) {
  const dialog = await addNode(page);
  await dialog.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/nodes\/[^/]+$/, { timeout: 15_000 });
  await expect(page.locator('header').getByText('1/1')).toBeVisible({ timeout: 15_000 });
}

/**
 * Every descendant stays inside the container's box horizontally. Returns
 * the offenders (tag, slot, how far past the edge) so a failure says what.
 */
export async function overflowing(container: Locator) {
  return container.evaluate((root) => {
    const box = root.getBoundingClientRect();
    const out: string[] = [];
    for (const el of root.querySelectorAll<HTMLElement>('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || getComputedStyle(el).position === 'fixed') continue;
      const past = Math.max(r.right - box.right, box.left - r.left);
      if (past > 1) out.push(`${el.tagName.toLowerCase()}[${el.dataset.slot ?? el.id ?? ''}] +${Math.round(past)}px`);
    }
    return out;
  });
}

/** A page section (not a summary stat card) by its heading. */
export function section(page: Page, title: string | RegExp) {
  return page.locator('[data-slot=card]:not([data-stat-card])', {
    has: page.getByRole('heading', { name: title }),
  });
}
