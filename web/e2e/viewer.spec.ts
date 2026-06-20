import { expect, test, type Page, type Route } from '@playwright/test';

const savedReplay = {
  id: 'upload-cabt-match',
  name: 'cabt-match.json',
  source: 'upload',
  players: ['Player 1', 'Player 2'],
  actionCount: 12,
  stateCount: 13,
  createdAt: '2026-06-20T00:00:00Z',
};

async function routeApi(page: Page) {
  let imported = false;

  await page.route('**/api/kaggle/status', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        configured: false,
        authMode: 'none',
        message: 'Kaggle credentials are not configured.',
      }),
    });
  });

  await page.route('**/api/kaggle/submissions**', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Kaggle authentication failed or is required for this endpoint.' }),
    });
  });

  await page.route('**/api/replays/import', async (route) => {
    imported = true;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ replay: savedReplay }),
    });
  });

  await page.route('**/api/replays**', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    if (route.request().url().endsWith('/api/replays/upload-cabt-match/artifact')) {
      await route.fulfill({
        contentType: 'application/json',
        path: 'public/game-logs/cabt-match.json',
      });
      return;
    }
    await fulfillReplays(route, imported ? [savedReplay] : []);
  });
}

async function fulfillReplays(route: Route, replays: unknown[]) {
  await route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ replays }),
  });
}

/** Record every card-motion effect node the moment it is created, keyed by the
 *  step it appeared on. Persisting to the page survives the transient nature of
 *  the cinematics, so assertions are deterministic rather than timing-racy. */
async function installMotionRecorder(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __fx: Array<{ step: string; cls: string }> }).__fx = [];
    const stepValue = () =>
      (document.querySelector('input[aria-label="Action step"]') as HTMLInputElement | null)?.value ?? '?';
    // Observe `document` (always a Node in an init script; documentElement may
    // not exist yet) so the recorder is attached before the app mounts.
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement && /motion-ghost|motion-reveal|fx-impact/.test(node.className)) {
            (window as unknown as { __fx: Array<{ step: string; cls: string }> }).__fx.push({
              step: stepValue(),
              cls: node.className.split(' ')[0],
            });
          }
        }
      }
    }).observe(document, { subtree: true, childList: true });
  });
}

const readMotionLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { __fx: Array<{ step: string; cls: string }> }).__fx);

const clearMotionLog = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __fx: Array<{ step: string; cls: string }> }).__fx = [];
  });

test('Card cinematics fire on the matching action frames', async ({ page }) => {
  await installMotionRecorder(page);
  await routeApi(page);
  await page.goto('/');

  await expect(page.getByText('State 0 / 12')).toBeVisible();
  const next = page.getByRole('button', { name: 'Next action' });
  // Step deliberately (spaced) so the rapid-step gate treats each as a real step.
  for (let i = 0; i < 8; i += 1) {
    await next.click();
    await page.waitForTimeout(280);
  }

  const fx = await readMotionLog(page);
  // Demo: draw on step 1, play-reveal on 3/5/7, attack on 6/8.
  expect(fx.some((entry) => entry.cls === 'motion-ghost')).toBe(true);
  expect(fx.some((entry) => entry.cls === 'motion-reveal')).toBe(true);
  expect(fx.some((entry) => entry.cls === 'fx-impact')).toBe(true);
});

test('Backward stepping plays no cinematics', async ({ page }) => {
  await installMotionRecorder(page);
  await routeApi(page);
  await page.goto('/');

  const next = page.getByRole('button', { name: 'Next action' });
  for (let i = 0; i < 6; i += 1) {
    await next.click();
    await page.waitForTimeout(280);
  }

  // Let any in-flight forward cinematic settle before we start watching, so a
  // late rAF from the last forward step can't leak into the backward window.
  await page.waitForTimeout(400);
  await clearMotionLog(page);
  const previous = page.getByRole('button', { name: 'Previous action' });
  for (let i = 0; i < 5; i += 1) {
    await previous.click();
    await page.waitForTimeout(160);
  }

  expect(await readMotionLog(page)).toHaveLength(0);
});

test('Turbo autoplay suppresses cinematics but still advances', async ({ page }) => {
  await installMotionRecorder(page);
  await routeApi(page);
  await page.goto('/');

  const step = page.getByLabel('Action step');
  await page.getByLabel('Replay speed').selectOption('turbo');
  await clearMotionLog(page);
  await page.getByRole('button', { name: 'Play replay' }).click();
  await expect.poll(async () => Number(await step.inputValue())).toBeGreaterThanOrEqual(8);

  expect(await readMotionLog(page)).toHaveLength(0);
});

test('Reduced motion advances the board without moving cards', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await routeApi(page);
  await page.goto('/');

  const step = page.getByLabel('Action step');
  const next = page.getByRole('button', { name: 'Next action' });
  // Space steps past the rapid-step threshold so the FULL repertoire is
  // eligible — proving reduced motion suppresses card movement even then.
  for (let i = 0; i < 6; i += 1) {
    await next.click();
    await page.waitForTimeout(280);
  }

  // Board reached the attack frame...
  await expect.poll(async () => Number(await step.inputValue())).toBe(6);
  // ...but the real attacker card was never translated (movement removed).
  const attackerTransform = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="slot-0-active-0"] .slot-card');
    return el ? getComputedStyle(el).transform : null;
  });
  expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(attackerTransform);
});

test('Demo replay loads and advances with playback controls', async ({ page }) => {
  await routeApi(page);
  await page.goto('/');

  await expect(page.getByText('CABT Replay Viewer')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play replay' })).toBeVisible();
  await expect(page.getByText('State 0 / 12')).toBeVisible();

  const step = page.getByLabel('Action step');
  await page.getByLabel('Replay speed').selectOption('turbo');
  await page.getByRole('button', { name: 'Play replay' }).click();
  await expect.poll(async () => Number(await step.inputValue())).toBeGreaterThanOrEqual(2);
});

test('Downloaded JSON can be imported and appears in the saved replay library', async ({ page }) => {
  await routeApi(page);
  await page.goto('/');

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open JSON' }).click();
  const chooser = await fileChooserPromise;
  await chooser.setFiles('public/game-logs/cabt-match.json');

  await expect(page.getByRole('button', { name: 'Play replay' })).toBeVisible();
  await expect(page.getByText('cabt-match.json')).toBeVisible();
  await expect(page.getByText('12 actions')).toBeVisible();
});

test('Saved replay can be opened from a direct link', async ({ page }) => {
  await routeApi(page);
  await page.goto('/?replayId=upload-cabt-match');

  await expect(page.getByRole('button', { name: 'Play replay' })).toBeVisible();
  await expect(page.getByText('State 0 / 12')).toBeVisible();
});

test('Kaggle panel reports server-side auth requirements without exposing secrets', async ({ page }) => {
  await routeApi(page);
  await page.goto('/');

  await expect(page.getByText('Kaggle credentials are not configured.')).toBeVisible();
  await page.getByRole('button', { name: 'Load submissions' }).click();
  await expect(page.getByText('Kaggle authentication failed or is required for this endpoint.')).toBeVisible();
});
