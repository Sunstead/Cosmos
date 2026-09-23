import { execFileSync } from 'node:child_process';
import { createSocket } from 'node:dgram';
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
    await expect(page.getByText('guest')).toBeVisible();
    await expect(page.getByText('Viewer')).toBeVisible();

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
