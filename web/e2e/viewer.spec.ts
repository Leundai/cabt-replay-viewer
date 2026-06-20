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
