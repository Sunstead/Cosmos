import { createSocket } from 'node:dgram';
import { expect, test } from '@playwright/test';
import { addNode, addNodeOnline, agentUrl, PAGES, TOKEN } from './helpers';

test.describe('empty app', () => {
  test('every page keeps its header with no nodes', async ({ page }) => {
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.locator('[data-page-header]'), path).toBeVisible();
    }
    await page.goto('/containers');
    await expect(page.locator('[data-empty-state]')).toBeVisible();
  });

  test('command palette navigates', async ({ page }) => {
    await page.goto('/overview');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('combobox').fill('volumes');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/volumes$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('keyboard shortcut opens the palette', async ({ page }) => {
    await page.goto('/overview');
    await expect(page.locator('[data-page-header]')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('combobox')).toBeFocused();
  });

  test('sidebar navigation', async ({ page }) => {
    await page.goto('/overview');
    await page.getByRole('link', { name: 'Monitoring' }).click();
    await expect(page).toHaveURL(/\/monitoring$/);
    await expect(page.getByRole('heading', { name: 'Monitoring' })).toBeVisible();
  });

  test('theme persists across reloads', async ({ page }) => {
    await page.goto('/settings');
    const html = page.locator('html');
    await expect(html).toHaveClass(/dark/);
    await page.getByRole('radio', { name: 'Light' }).click();
    await expect(html).toHaveClass(/light/);
    await page.reload();
    await expect(html).toHaveClass(/light/);
  });

  test('body never scrolls and nothing overflows horizontally', async ({ page }) => {
    for (const width of [900, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      for (const path of PAGES) {
        await page.goto(path);
        const m = await page.evaluate(() => {
          const el = document.scrollingElement!;
          return {
            overflow: getComputedStyle(document.body).overflow,
            scrollH: el.scrollHeight - el.clientHeight,
            scrollW: el.scrollWidth - el.clientWidth,
          };
        });
        expect(m.overflow, path).toBe('hidden');
        expect(m.scrollH, `${path} @${width}`).toBeLessThanOrEqual(0);
        expect(m.scrollW, `${path} @${width}`).toBeLessThanOrEqual(0);
      }
    }
  });
});

test.describe('with a node', () => {
  test('rejects a wrong token', async ({ page }) => {
    const dialog = await addNode(page, 'wrong');
    await expect(dialog.getByRole('alert')).toHaveText('Token rejected.');
  });

  test('adds a node and it comes online', async ({ page }) => {
    await addNodeOnline(page);
    await page.goto('/nodes');
    await expect(page.locator('[data-page-header]')).toContainText('Nodes');
  });

  test('headers line up across pages', async ({ page }) => {
    await addNodeOnline(page);
    const rows: { path: string; top: number; height: number; controls: number[] }[] = [];
    for (const path of PAGES) {
      await page.goto(path);
      const header = page.locator('[data-page-header]');
      await expect(header).toBeVisible();
      const box = (await header.locator('h1').boundingBox())!;
      const controls = await header
        .locator('[data-page-actions] > :is(button, [role=group], [role=combobox], [data-slot=input-group])')
        .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
      rows.push({ path, top: Math.round(box.y), height: Math.round(box.height), controls });
    }
    const top = rows[0].top;
    for (const r of rows) {
      expect(r.top, r.path).toBe(top);
      expect(r.height, r.path).toBe(32);
      for (const h of r.controls) expect(h, r.path).toBe(32);
    }
  });

  test('network page lists the tailnet', async ({ page }) => {
    await addNodeOnline(page);
    await page.goto('/network');
    const section = page.locator('[data-slot=card]', { hasText: 'Tailnet' });
    // The agent reads the fake tailscaled from global-setup.
    await expect(section.getByRole('row', { name: /desktop/ })).toContainText('Direct', { timeout: 15_000 });
    await expect(section.getByRole('row', { name: /pixel/ })).toContainText('Relay sea');
    await expect(section.getByRole('row', { name: /air/ })).toContainText('Seen');
    // The agent's own device is this node.
    await expect(section.getByRole('row', { name: /e2e-node/ }).getByRole('link', { name: 'Node' })).toBeVisible();

    await page.getByPlaceholder('Search devices and ports').fill('pixel');
    await expect(section.getByRole('row')).toHaveCount(2);
  });

  test('adds a machine and wakes it with a real magic packet', async ({ page, request }) => {
    // Stand in for the sleeping PC: catch what the agent broadcasts.
    const socket = createSocket('udp4');
    const received = new Promise<Buffer>((resolve) => socket.once('message', resolve));
    await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
    const port = socket.address().port;

    await addNodeOnline(page);
    await page.goto('/network');
    const section = page.locator('[data-slot=card]', { hasText: 'Wake-on-LAN' });

    // Through the dialog.
    await section.getByRole('button', { name: 'Add' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('laptop');
    await dialog.getByLabel('MAC address').fill('11-22-33-44-55-66');
    await dialog.getByRole('button', { name: 'Add' }).click();
    await expect(section.getByRole('row', { name: /laptop/ })).toContainText('11:22:33:44:55:66');

    // Loopback isn't offered in the dialog, so this one goes in through the API.
    const res = await request.post(`${agentUrl()}/v1/wol/targets`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: { name: 'desktop', mac: 'AA:BB:CC:DD:EE:FF', broadcast: '127.0.0.1', port },
    });
    expect(res.status()).toBe(201);

    const row = section.getByRole('row', { name: /desktop/ });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole('button', { name: 'Wake desktop' }).click();

    const packet = await received;
    socket.close();
    expect(packet.length).toBe(102);
    expect(packet.subarray(0, 6).toString('hex')).toBe('ffffffffffff');
    expect(packet.subarray(6, 12).toString('hex')).toBe('aabbccddeeff');
    await expect(row).toContainText('Waking');
  });

  test('constellation canvas is stable over time', async ({ page }) => {
    await addNodeOnline(page);
    await page.goto('/overview');
    const canvas = page.getByRole('img', { name: 'Node map' });
    await expect(canvas).toBeVisible();
    await canvas.evaluate((el) => ((window as unknown as { __c: Element }).__c = el));
    await page.waitForTimeout(3_000);
    const same = await canvas.evaluate((el) => (window as unknown as { __c: Element }).__c === el);
    expect(same).toBe(true);
  });

  test('logs deep link selects node and container', async ({ page, request }) => {
    await addNodeOnline(page);
    const nodeId = page.url().split('/').pop()!;
    const list = async () => {
      const res = await request.get(`${process.env.E2E_AGENT_URL}/v1/containers`, {
        headers: { Authorization: 'Bearer e2e-token' },
      });
      return res.ok() ? ((await res.json()) as { containers: { id: string; name: string }[] }) : null;
    };
    // The first Docker sample can take a moment; 503 until then.
    let body = await list();
    for (let i = 0; !body && i < 20; i += 1) {
      await page.waitForTimeout(250);
      body = await list();
    }
    test.skip(!body, 'Docker is not available');
    test.skip(body!.containers.length === 0, 'No containers to open');

    const c = body!.containers[0];
    await page.goto(`/logs?node=${nodeId}&container=${c.id}`);
    await expect(page.getByRole('combobox').filter({ hasText: c.name })).toBeVisible();
  });

  test('screenshots of every page in both themes', async ({ page }, info) => {
    await addNodeOnline(page);
    const detail = new URL(page.url()).pathname;
    for (const theme of ['dark', 'light']) {
      await page.evaluate((t) => localStorage.setItem('cosmos-theme', t), theme);
      for (const path of [...PAGES, detail]) {
        await page.goto(path);
        await page.waitForTimeout(300);
        await page.screenshot({ path: info.outputPath(`${theme}${path.replaceAll('/', '-')}.png`) });
      }
    }
  });
});
