import { test, expect } from '@playwright/test';
import { assertNoBadNavigation, trackBadNavigation } from './helpers.js';

test('/dist/ serves built SPA without redirect to /dist/dist/', async ({ page }) => {
  const bad = trackBadNavigation(page);
  const response = await page.goto('/dist/');

  expect(response?.status()).toBe(200);
  await page.getByRole('heading', { name: 'SPID Registry Navigator' }).waitFor({
    timeout: 30_000,
  });

  expect(page.url()).toMatch(/\/dist\/?$/);
  expect(page.url()).not.toContain('/dist/dist');
  assertNoBadNavigation(bad);

  const html = await page.content();
  expect(html).not.toContain('location.replace');
  expect(html).not.toContain('@vite/client');
  expect(html).toMatch(/assets\/index-[^"]+\.js/);
});

test('repo root / is landing page without auto redirect loop', async ({ page }) => {
  const bad = trackBadNavigation(page);
  await page.goto('/');

  await expect(page.locator('a[href="dist/"]')).toBeVisible();
  expect(page.url()).not.toContain('/dist/dist');
  assertNoBadNavigation(bad);
});
