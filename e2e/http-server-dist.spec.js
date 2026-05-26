import { test, expect } from '@playwright/test';
import { assertNoBadNavigation, trackBadNavigation } from './helpers.js';

test('serves app at / when cwd is dist', async ({ page }) => {
  const bad = trackBadNavigation(page);
  await page.goto('/');

  await page.getByRole('heading', { name: 'SPID Registry Navigator' }).waitFor();
  await page.locator('#entity-list .entity-row').first().waitFor({ timeout: 60_000 });

  expect(page.url()).not.toContain('/dist/dist');
  assertNoBadNavigation(bad);
});

test('/dist/ returns 404 when server root is already dist', async ({ page }) => {
  const response = await page.goto('/dist/');
  expect(response?.status()).toBe(404);
});
