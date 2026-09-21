import { expect, Page } from '@playwright/test';

export const TOKEN = 'e2e-token';
export const WEB_PORT = 1431;
export const agentUrl = () => process.env.E2E_AGENT_URL!;

export const PAGES = [
  '/overview',
  '/nodes',
  '/services',
  '/containers',
  '/volumes',
  '/network',
  '/monitoring',
  '/logs',
  '/backups',
  '/settings',
] as const;

export async function addNode(page: Page, token = TOKEN) {
  await page.goto('/nodes');
  await page.getByRole('button', { name: 'Add node' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Address').fill(agentUrl());
  await dialog.getByLabel('Token').fill(token);
  await dialog.getByRole('button', { name: 'Add' }).click();
  return dialog;
}

export async function addNodeOnline(page: Page) {
  await addNode(page);
  await expect(page).toHaveURL(/\/nodes\/[^/]+$/);
  await expect(page.locator('header').getByText('1/1')).toBeVisible({ timeout: 15_000 });
}
