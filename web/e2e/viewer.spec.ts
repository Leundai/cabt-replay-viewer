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

const kaggleReplay = {
  id: 'kaggle-9001',
  name: 'TrustHub hiroingk vs The Debauchery Tea Party',
  source: 'kaggle',
  players: ['TrustHub hiroingk', 'The Debauchery Tea Party'],
  actionCount: 12,
  stateCount: 13,
  createdAt: '2026-06-20T12:00:00Z',
  episodeId: 9001,
  submissionId: 111,
};

const leaderboardSnapshot = {
  competition: 'pokemon-tcg-ai-battle',
  entries: [
    {
      rank: 1,
      teamId: 16376775,
      teamName: 'TrustHub hiroingk',
      score: '1307.9',
      submissionDate: '2026-06-18T08:20:23.220Z',
      submissions: [
        {
          id: 111,
          teamId: 16376775,
          teamName: 'TrustHub hiroingk',
          score: '1307.9',
          status: 'complete',
          date: '2026-06-18T08:20:23.220Z',
          episodes: [
            {
              id: 9001,
              submissionId: 111,
              competitionName: 'pokemon-tcg-ai-battle',
              reward: '1',
              status: 'complete',
              agents: [
                { submissionId: 111, teamId: 16376775, teamName: 'TrustHub hiroingk', reward: '1' },
                { submissionId: 222, teamId: 16378170, teamName: 'The Debauchery Tea Party', reward: '-1' },
              ],
            },
            {
              id: 9002,
              submissionId: 111,
              competitionName: 'pokemon-tcg-ai-battle',
              reward: '-1',
              status: 'complete',
              agents: [
                { submissionId: 111, teamId: 16376775, teamName: 'TrustHub hiroingk', reward: '-1' },
                { submissionId: 333, teamId: 16393904, teamName: 'InkCartridge', reward: '1' },
              ],
            },
            {
              id: 9003,
              submissionId: 111,
              competitionName: 'pokemon-tcg-ai-battle',
              reward: '1',
              status: 'complete',
              agents: [
                { submissionId: 111, teamId: 16376775, teamName: 'TrustHub hiroingk', reward: '1' },
                { submissionId: 444, teamId: 16394000, teamName: 'Kazama', reward: '-1' },
              ],
            },
          ],
        },
      ],
    },
    {
      rank: 2,
      teamId: 16378170,
      teamName: 'The Debauchery Tea Party',
      score: '1302.2',
      submissionDate: '2026-06-20T11:54:31.206Z',
      submissions: [],
    },
  ],
  refreshedAt: '2026-06-20T12:00:00Z',
  expiresAt: '2026-06-20T12:30:00Z',
  stale: false,
  refreshInSeconds: 1800,
  pageSize: 50,
  nextPageToken: 'next',
  source: 'cache',
  message: 'Leaderboard served from cache.',
};

async function routeApi(page: Page) {
  let importedReplay: unknown | null = null;

  await page.route('**/api/admin/session', async (route) => {
    const token = route.request().headers()['x-cabt-admin-token'];
    await route.fulfill({
      status: token === 'test-token' ? 200 : 403,
      contentType: 'application/json',
      body: JSON.stringify(token === 'test-token' ? { ok: true } : { detail: 'Admin token is required for replay imports and Kaggle access.' }),
    });
  });

  await page.route('**/api/kaggle/status', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        configured: true,
        authMode: 'bearer',
        adminRequired: true,
        publicImportsEnabled: false,
        message: 'Kaggle credentials are configured server-side.',
      }),
    });
  });

  await page.route(/\/api\/kaggle\/leaderboard\/refresh(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ...leaderboardSnapshot,
        source: 'kaggle',
        message: 'Leaderboard refreshed from Kaggle.',
      }),
    });
  });

  await page.route(/\/api\/kaggle\/leaderboard(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(leaderboardSnapshot),
    });
  });

  await page.route('**/api/kaggle/leaderboard/episodes/9001/import**', async (route) => {
    importedReplay = kaggleReplay;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ replay: kaggleReplay }),
    });
  });

  await page.route('**/api/kaggle/submissions**', async (route) => {
    const token = route.request().headers()['x-cabt-admin-token'];
    if (token === 'test-token') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          submissions: [
            {
              id: 111,
              teamId: 16376775,
              teamName: 'TrustHub hiroingk',
              score: '1307.9',
              status: 'complete',
            },
          ],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Kaggle authentication failed or is required for this endpoint.' }),
    });
  });

  await page.route('**/api/replays/import', async (route) => {
    importedReplay = savedReplay;
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
    const url = route.request().url();
    if (url.endsWith('/api/replays/upload-cabt-match/artifact') || url.endsWith('/api/replays/kaggle-9001/artifact')) {
      await route.fulfill({
        contentType: 'application/json',
        path: 'public/game-logs/cabt-match.json',
      });
      return;
    }
    await fulfillReplays(route, importedReplay ? [importedReplay] : []);
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
  // Use the synthetic demo (deterministic draw/play/attack frames), not the real
  // recorded episode the Demo button now loads.
  await page.goto('/?replayId=upload-cabt-match');

  await expect(page.getByLabel('Action step')).toHaveValue('0');
  await expect(page.locator('[data-testid="motion-overlay"]')).toBeVisible();
  await expect(page.locator('[data-testid="deck-pile-0"]')).toBeVisible();
  await expect(page.locator('[data-testid="hand-0"]')).toBeVisible();
  await page.waitForTimeout(300);
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
  await expect(page.getByLabel('Action step')).toHaveValue('0');

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
  await expect(page.getByLabel('Action step')).toHaveValue('0');
});

test('Cached leaderboard is visible without exposing admin controls', async ({ page }) => {
  await routeApi(page);
  await page.goto('/');

  await expect(page.getByText('Leaderboard', { exact: true })).toBeVisible();
  await expect(page.getByText('TrustHub hiroingk', { exact: true })).toBeVisible();
  await expect(page.getByText('1307.9').first()).toBeVisible();
  await expect(page.getByText('Submission #111')).toBeVisible();
  const replaySummary = page.locator('summary').filter({ hasText: '3 replays' });
  await expect(replaySummary).toBeVisible();
  await replaySummary.click();
  await expect(page.getByText('TrustHub hiroingk vs The Debauchery Tea Party').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Episode 9001/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load submissions' })).toHaveCount(0);
  await expect(page.getByPlaceholder('CABT_ADMIN_TOKEN')).toHaveCount(0);
});

test('Cached leaderboard replay opens without admin unlock', async ({ page }) => {
  await routeApi(page);
  await page.goto('/');

  await page.locator('summary').filter({ hasText: '3 replays' }).click();
  await page.getByRole('button', { name: /Episode 9001/ }).click();
  await expect(page.getByRole('button', { name: 'Play replay' })).toBeVisible();
  await expect(page.getByLabel('Action step')).toHaveValue('0');
  await expect(page.getByText('TrustHub hiroingk vs The Debauchery Tea Party').first()).toBeVisible();
  await expect(page.getByPlaceholder('CABT_ADMIN_TOKEN')).toHaveCount(0);
});

test('Kaggle admin controls unlock only after hotkey and password', async ({ page }) => {
  await routeApi(page);
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Kaggle admin' })).toHaveCount(0);
  await page.keyboard.press('Control+Shift+K');
  await expect(page.getByRole('button', { name: 'Kaggle admin' })).toHaveCount(0);
  await expect(page.getByPlaceholder('CABT_ADMIN_TOKEN')).toBeVisible();

  await page.getByPlaceholder('CABT_ADMIN_TOKEN').fill('test-token');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('button', { name: 'Load submissions' })).toBeVisible();
  await expect(page.locator('summary').filter({ hasText: '3 replays' })).toBeVisible();
  await page.getByRole('button', { name: 'Load submissions' }).click();
  await expect(page.getByText('#111 - 1307.9')).toBeVisible();
});
