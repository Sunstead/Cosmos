import { execFileSync } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { addNode, addNodeOnline, agentUrl, apiToken, nextSignIn, overflowing, PAGES, section } from './helpers';

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

  test('the sidebar opens on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/overview');
    // The search box once slid over the toggle at this width, taking its clicks.
    await page.getByRole('button', { name: 'Toggle sidebar' }).click({ timeout: 5_000 });
    const sheet = page.locator('[data-mobile=true]');
    await expect(sheet.getByRole('button', { name: 'Account' })).toBeVisible();
    // Following a link closes the sheet, so the page isn't left covered.
    await sheet.getByRole('link', { name: 'Logs' }).click();
    await expect(page).toHaveURL(/\/logs$/);
    await expect(sheet).toHaveCount(0);
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
  test('asks for a sign-in, naming the provider', async ({ page }) => {
    const dialog = await addNode(page);
    await expect(dialog.getByText('This node signs in with 127.0.0.1')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('a viewer sees the node but gets no actions', async ({ page, request }) => {
    await nextSignIn(request, { name: 'guest', groups: ['homelab-users'] });
    await addNodeOnline(page);
    await nextSignIn(request);

    await page.goto('/settings');
    const main = page.locator('main').last();
    await expect(main.getByText('guest')).toBeVisible();
    await expect(main.getByText('Viewer')).toBeVisible();
    // And at the foot of the sidebar.
    await expect(page.getByRole('button', { name: 'Account' })).toContainText('guest');
    await expect(page.getByRole('button', { name: 'Account' })).toContainText('Viewer');

    await page.goto('/network');
    const wol = section(page, 'Wake-on-LAN');
    await expect(wol).toBeVisible();
    await expect(wol.getByRole('button', { name: 'Add' })).toHaveCount(0);
  });

  test('signing out asks for a sign-in again', async ({ page }) => {
    await addNodeOnline(page);
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByText('Sign in needed').first()).toBeVisible({ timeout: 15_000 });
  });

  test('the account menu shows who you are and signs you out', async ({ page }, info) => {
    await addNodeOnline(page);
    const account = page.getByRole('button', { name: 'Account' });
    await expect(account).toContainText('pwb');
    await expect(account).toContainText('Admin');

    await account.click();
    const menu = page.getByRole('menu');
    await expect(menu).toContainText('pwb');
    await expect(menu.getByRole('menuitem', { name: /Settings/ })).toBeVisible();
    await page.screenshot({ path: info.outputPath('account-menu.png') });
    await menu.getByRole('menuitem', { name: 'Sign out' }).click();

    // Signed out on purpose: straight to the sign-in state, no "expired" toast.
    await expect(account).toContainText('Not signed in', { timeout: 15_000 });
    await expect(page.getByText('Your sign-in expired')).toHaveCount(0);
    await page.locator('[data-sidebar=footer]').getByRole('button', { name: 'Sign in' }).click();
    await expect(account).toContainText('pwb', { timeout: 15_000 });
  });

  test('the account shows the provider picture, or initials when it fails to load', async ({ page, request }) => {
    // A 1x1 PNG for the one that works; the other 404s, like a removed file.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    await page.route('https://avatars.e2e.test/**', (route) =>
      route.request().url().endsWith('/pat.png')
        ? route.fulfill({ contentType: 'image/png', body: png })
        : route.fulfill({ status: 404 }),
    );
    const account = page.getByRole('button', { name: 'Account' });

    await nextSignIn(request, { name: 'pat', groups: ['homelab-users'], picture: 'https://avatars.e2e.test/pat.png' });
    await addNodeOnline(page);
    await expect(account.locator('img')).toHaveAttribute('src', 'https://avatars.e2e.test/pat.png');
    await expect(account.locator('[data-slot=avatar-fallback]')).toHaveCount(0);

    await page.goto('/settings');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(account).toContainText('Not signed in', { timeout: 15_000 });

    await nextSignIn(request, { name: 'pat', groups: ['homelab-users'], picture: 'https://avatars.e2e.test/gone.png' });
    const failed = page.waitForResponse('https://avatars.e2e.test/gone.png');
    await page.locator('[data-sidebar=footer]').getByRole('button', { name: 'Sign in' }).click();
    await expect(account).toContainText('pat', { timeout: 15_000 });
    await failed;
    await expect(account.locator('[data-slot=avatar-fallback]')).toHaveText('P');
    await expect(account.locator('img')).toHaveCount(0);
    await nextSignIn(request);
  });

  test('G then a letter goes to a page', async ({ page }) => {
    await page.goto('/overview');
    await expect(page.locator('[data-page-header]')).toBeVisible();
    await page.keyboard.press('g');
    await page.keyboard.press('l');
    await expect(page).toHaveURL(/\/logs$/);
    await page.keyboard.press('g');
    await page.keyboard.press('p');
    await expect(page).toHaveURL(/\/updates$/);
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
    const card = section(page, 'Tailnet');
    // The agent reads the fake tailscaled from global-setup.
    await expect(card.getByRole('row', { name: /desktop/ })).toContainText('Direct', { timeout: 15_000 });
    await expect(card.getByRole('row', { name: /pixel/ })).toContainText('Relay sea');
    await expect(card.getByRole('row', { name: /air/ })).toContainText('Seen');
    // The agent's own device is this node.
    await expect(card.getByRole('row', { name: /e2e-node/ }).getByRole('link', { name: 'Node' })).toBeVisible();

    await page.getByPlaceholder('Search devices and ports').fill('pixel');
    await expect(card.getByRole('row')).toHaveCount(2);
  });

  test('network page is two columns when wide and fits when narrow', async ({ page }) => {
    await addNodeOnline(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/network');
    const tailnet = section(page, 'Tailnet');
    const wol = section(page, 'Wake-on-LAN');
    await expect(tailnet.getByRole('row', { name: /desktop/ })).toBeVisible({ timeout: 15_000 });

    // Side by side, not stacked.
    const [t, w] = [(await tailnet.boundingBox())!, (await wol.boundingBox())!];
    expect(Math.abs(t.y - w.y)).toBeLessThan(2);
    expect(w.x).toBeGreaterThan(t.x + t.width - 1);

    // A summary row sits above the sections.
    await expect(page.getByTestId('network-summary')).toContainText('3/4');

    // Quiet interfaces are folded away behind a toggle.
    const interfaces = page.locator('[data-slot=card][data-interfaces]').first();
    const toggle = interfaces.getByRole('button', { name: /more/ });
    if (await toggle.count()) {
      const before = await interfaces.getByRole('row').count();
      await toggle.click();
      expect(await interfaces.getByRole('row').count()).toBeGreaterThan(before);
    }

    for (const width of [900, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const c of await page.locator('main [data-slot=card]').all()) {
        expect(await overflowing(c), `@${width}`).toEqual([]);
      }
    }
  });

  test('adds a machine and wakes it with a real magic packet', async ({ page, request }) => {
    // Stand in for the sleeping PC: catch what the agent broadcasts.
    const socket = createSocket('udp4');
    const received = new Promise<Buffer>((resolve) => socket.once('message', resolve));
    await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
    const port = socket.address().port;

    await addNodeOnline(page);
    await page.goto('/network');
    const card = section(page, 'Wake-on-LAN');

    // Through the dialog.
    await card.getByRole('button', { name: 'Add' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('laptop');
    await dialog.getByLabel('MAC address').fill('11-22-33-44-55-66');
    await dialog.getByRole('button', { name: 'Add' }).click();
    await expect(card.getByRole('row', { name: /laptop/ })).toContainText('11:22:33:44:55:66');

    // Loopback isn't offered in the dialog, so this one goes in through the API.
    const res = await request.post(`${agentUrl()}/v1/wol/targets`, {
      headers: { Authorization: `Bearer ${await apiToken(request)}` },
      data: { name: 'desktop', mac: 'AA:BB:CC:DD:EE:FF', broadcast: '127.0.0.1', port },
    });
    expect(res.status()).toBe(201);

    const row = card.getByRole('row', { name: /desktop/ });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole('button', { name: 'Wake desktop' }).click();

    const packet = await received;
    socket.close();
    expect(packet.length).toBe(102);
    expect(packet.subarray(0, 6).toString('hex')).toBe('ffffffffffff');
    expect(packet.subarray(6, 12).toString('hex')).toBe('aabbccddeeff');
    await expect(row).toContainText('Waking');
  });

  test('the events page shows an action with who took it', async ({ page, request }) => {
    await addNodeOnline(page);
    const res = await request.post(`${agentUrl()}/v1/wol/targets`, {
      headers: { Authorization: `Bearer ${await apiToken(request)}` },
      data: { name: 'events-nas', mac: '02:00:00:00:00:01' },
    });
    expect(res.status()).toBe(201);

    await page.goto('/events');
    // The app polls every 10 seconds.
    const row = section(page, 'Timeline').locator('[data-event]', { hasText: 'Added events-nas' });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText('by pwb');

    await page.getByRole('radio', { name: 'Actions' }).click();
    await expect(row).toBeVisible();
  });

  test('a webhook channel gets a test sent from settings', async ({ page, request }) => {
    const received: { title: string; message: string }[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        received.push(JSON.parse(body));
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    await addNodeOnline(page);
    const res = await request.post(`${agentUrl()}/v1/notify/channels`, {
      headers: { Authorization: `Bearer ${await apiToken(request)}` },
      data: {
        name: 'e2e-hook',
        kind: 'webhook',
        url: `http://127.0.0.1:${port}/`,
        secret: 'not-sent-back',
        enabled: true,
        min_severity: 'warning',
        recoveries: true,
        categories: [],
      },
    });
    expect(res.status()).toBe(201);
    expect(await res.text()).not.toContain('not-sent-back');

    await page.goto('/settings');
    const channel = section(page, /Notifications from/).locator('[data-channel]', { hasText: 'e2e-hook' });
    await channel.getByRole('button', { name: 'Send test' }).click();
    await expect.poll(() => received.length).toBe(1);
    expect(received[0].title).toContain('Test notification');
    await expect(channel).toContainText('Delivered');
    server.close();
  });

  test('an uptime check added in the dialog reports its first run', async ({ page }) => {
    const server = createServer((_req, res) => res.writeHead(204).end());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    await addNodeOnline(page);
    await page.goto('/uptime');
    const add = async (name: string, url: string) => {
      await page.getByRole('button', { name: 'Add check' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Name').fill(name);
      await dialog.getByLabel('URL').fill(url);
      expect(await overflowing(dialog)).toEqual([]);
      await dialog.getByRole('button', { name: 'Add' }).click();
      await expect(dialog).toBeHidden();
    };

    await add('e2e-up', `http://127.0.0.1:${port}/`);
    await expect(page.getByText("It's up, answering in")).toBeVisible();
    const up = section(page, 'Checks').locator('[data-check]', { hasText: 'e2e-up' });
    await expect(up).toContainText('100%');

    server.close();
    await add('e2e-refused', `http://127.0.0.1:${port}/`);
    await expect(page.getByText('Added e2e-refused, but it failed')).toBeVisible();
    const down = section(page, 'Checks').locator('[data-check]', { hasText: 'e2e-refused' });
    await expect(down).toContainText("couldn't connect");
  });

  test('back up now leaves a request for the host, and the page follows it', async ({ page }) => {
    await addNodeOnline(page);
    await page.goto('/backups');
    await page.getByRole('button', { name: 'Back up now' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Back up', exact: true }).click();
    await expect(dialog).toBeHidden();

    const inbox = process.env.E2E_BACKUP_INBOX!;
    await expect.poll(() => readdirSync(inbox).filter((f) => f.endsWith('.json'))).toHaveLength(1);
    const [file] = readdirSync(inbox);
    expect(JSON.parse(readFileSync(join(inbox, file), 'utf8'))).toMatchObject({
      kind: 'backup',
      requested_by: 'pwb',
    });
    await expect(section(page, 'Started from Cosmos')).toContainText('Waiting for the server');
    await expect(page.getByRole('button', { name: 'Backing up' })).toBeDisabled();
    unlinkSync(join(inbox, file));
  });

  test('the restore guide fills in the commands', async ({ page }) => {
    await addNodeOnline(page);
    await page.goto('/backups');
    await page.getByRole('button', { name: 'Restore from 1a2b3c4d' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: 'A database' }).click();
    await expect(dialog).toContainText('sudo scripts/restore.sh dump primary 1a2b3c4d immich');
    await expect(dialog).toContainText('docker compose stop immich-server immich-machine-learning');
    expect(await overflowing(dialog)).toEqual([]);
  });

  test('the updates page shows what can move, and why not', async ({ page }, info) => {
    const now = Math.floor(Date.now() / 1000);
    const unit = (name: string, extra: Record<string, unknown>) => ({
      id: name,
      name,
      services: [name],
      images: [name],
      current: '1.0.0',
      available: null,
      patch: null,
      held: null,
      notes_url: null,
      policy: 'manual',
      paused: null,
      backup: false,
      blocked: null,
      run: null,
      previous: null,
      ...extra,
    });
    await page.route('**/v1/updates', (route) =>
      route.fulfill({
        json: {
          units: [
            unit('immich', {
              id: 'group:immich',
              images: ['ghcr.io/immich-app/immich-server', 'ghcr.io/immich-app/immich-machine-learning'],
              services: ['immich-server', 'immich-machine-learning'],
              current: 'v3.2.2',
              available: { tag: 'v3.3.0', change: 'minor', first_seen: now - 86_400 },
              notes_url: 'https://github.com/immich-app/immich/releases',
              backup: true,
            }),
            unit('nextcloud', {
              current: '35.0.0-apache',
              available: { tag: '36.0.3-apache', change: 'major', first_seen: now - 5 * 86_400 },
              patch: { tag: '35.0.1-apache', change: 'patch', first_seen: now - 5 * 86_400 },
              held: { tag: '37.0.0-apache', reason: 'one major version at a time' },
              policy: 'patch',
              backup: true,
            }),
            unit('ntfy', {
              id: 'binwiederhier/ntfy',
              images: ['binwiederhier/ntfy'],
              current: 'v2.29.0',
              previous: 'v2.28.0',
              run: {
                id: 'r1',
                unit: 'binwiederhier/ntfy',
                kind: 'update',
                from: 'v2.28.0',
                to: 'v2.29.0',
                by: 'pwb',
                state: 'watching',
                requested_at: now - 120,
                finished_at: null,
                run_url: 'https://github.com/o/r/actions/runs/42',
                detail: null,
                step: null,
                watch_until: now + 480,
              },
            }),
            unit('immich-postgres', { blocked: 'updates are off for it (cosmos.update: off)' }),
          ],
          checked_at: now - 600,
          errors: [],
          can_apply: true,
          token_expires_at: null,
          history: [],
          min_age_days: 3,
        },
      }),
    );
    await addNodeOnline(page);
    await page.goto('/updates');
    const rows = page.locator('[data-update]');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText('Updated to v2.29.0, checking it stays up for 8 more min');
    await expect(rows.nth(1)).toContainText('36.0.3-apache');
    await expect(rows.nth(1)).toContainText('37.0.0-apache held: one major version at a time');
    await expect(rows.nth(1)).toContainText('35.0.1-apache applies after the next nightly backup');
    await expect(page.getByText('Not updated: updates are off for it')).toBeVisible();

    await rows.nth(2).getByRole('button', { name: 'Update' }).click();
    await expect(page.getByRole('dialog')).toContainText('backs up its database');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await page.screenshot({ path: info.outputPath('updates.png'), fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: info.outputPath('updates-phone.png'), fullPage: true });
  });

  test('the add machine dialog keeps every field inside it', async ({ page }, info) => {
    await addNodeOnline(page);
    await page.goto('/network');
    await section(page, 'Wake-on-LAN').getByRole('button', { name: 'Add' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Send to')).toBeVisible();
    expect(await overflowing(dialog)).toEqual([]);

    // The longest option: an interface with its CIDR.
    await dialog.getByLabel('Send to').click();
    const options = page.getByRole('option');
    const texts = await options.allTextContents();
    const longest = texts.reduce((a, b) => (b.length > a.length ? b : a), '');
    await options.filter({ hasText: longest }).first().click();
    expect(await overflowing(dialog)).toEqual([]);
    await dialog.screenshot({ path: info.outputPath('wol-dialog.png') });

    // And on a phone.
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await overflowing(dialog)).toEqual([]);
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
        headers: { Authorization: `Bearer ${await apiToken(request)}` },
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

  test('pages show skeletons, not empty states, while data is on its way', async ({ page }, info) => {
    await addNodeOnline(page);
    const detail = new URL(page.url()).pathname;
    // The node is up (info and host pass) but nothing else has answered yet.
    await page.route(`${agentUrl()}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (['/v1/info', '/v1/host', '/v1/host/stream'].includes(path)) return route.continue();
      // Held: never answered while the spec looks.
    });
    const falseEmpty = /No containers|No volumes|No services yet|No machines yet|Loading devices|No ports published/;
    for (const path of ['/containers', '/volumes', '/services', '/logs', '/network', '/overview', detail]) {
      await page.goto(path);
      await expect(page.locator('main [data-slot=skeleton]').first(), path).toBeVisible();
      // The layout nests the scrolling <main> inside the sidebar inset's.
      await expect(page.locator('main').last(), path).not.toContainText(falseEmpty);
      await page.screenshot({ path: info.outputPath(`loading${path.replaceAll('/', '-')}.png`) });
    }
  });

  test('screenshots of every page in both themes', async ({ page }, info) => {
    // Every page twice: well past the default 30 s once earlier specs have
    // given the agent something to show.
    test.setTimeout(120_000);
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

test.describe('logs', () => {
  test.use({ timezoneId: 'Asia/Kolkata' });

    test('logs: all containers at once, coloured by level not stream, in local time', async ({ page }, info) => {
      // Needs Docker and a local alpine image; never pulls one.
      const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', stdio: 'pipe' });
      try {
        docker('image', 'inspect', 'alpine:3');
      } catch {
        test.skip(true, 'Docker or the alpine:3 image is not available');
      }
      const names = ['cosmos-e2e-chatty', 'cosmos-e2e-failing'];
      const scripts = [
        // Healthy output on stderr, the way nginx and Postgres write it.
        'while true; do echo "[notice] worker started" >&2; sleep 1; done',
        'while true; do echo "ERROR connection refused"; sleep 1; done',
      ];
      names.forEach((n, i) => docker('run', '-d', '--rm', '--name', n, 'alpine:3', 'sh', '-c', scripts[i]));
      try {
        await addNodeOnline(page);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('/logs');
        await page.getByRole('combobox', { name: 'Container' }).click();
        await page.getByRole('option', { name: 'All containers' }).click();

        const log = page.locator('[data-stream]');
        const notice = log.filter({ hasText: 'worker started' }).first();
        const failing = log.filter({ hasText: 'connection refused' }).first();
        await expect(notice).toBeVisible({ timeout: 15_000 });
        await expect(failing).toBeVisible();

        // Tagged with the container it came from.
        await expect(notice).toContainText('cosmos-e2e-chatty');
        await expect(failing).toContainText('cosmos-e2e-failing');
        // stderr is not an error; ERROR is, even on stdout.
        await expect(notice).toHaveAttribute('data-stream', 'stderr');
        await expect(notice).not.toHaveClass(/text-error/);
        await expect(failing).toHaveClass(/text-error/);

        // The time shown is the browser's zone (pinned to UTC+5:30 here), not
        // the UTC digits in Docker's stamp.
        const stamp = notice.locator('[data-ts]').first();
        const ts = (await stamp.getAttribute('data-ts'))!;
        const shown = (await stamp.textContent())!;
        const local = await page.evaluate(
          (iso) =>
            new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(
              new Date(`${iso.slice(0, 19)}Z`),
            ),
          ts,
        );
        expect(shown).toBe(local);
        expect(shown).not.toContain(ts.slice(11, 19));
        await page.screenshot({ path: info.outputPath('logs-all.png') });
      } finally {
        for (const n of names) {
          try {
            docker('rm', '-f', n);
          } catch {
            /* already gone */
          }
        }
      }
    });
});
