import { test, expect } from '@playwright/test';
import { waitForAppReady } from './helpers.js';

test.describe('extension filters with bundled cache', () => {
  test('eIDAS filter on aggregati lists more than one page of results', async ({ page }) => {
    await waitForAppReady(page);

    await page.getByRole('button', { name: 'Aggregati', exact: true }).click();
    await page.locator('#entity-list .entity-row').first().waitFor({ timeout: 60_000 });

    const before = await page.locator('#entity-list .entity-row').count();
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThanOrEqual(50);

    await page.locator('#filter-eidas').check();
    await expect(page.locator('#filter-counts')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-pagination-bar]').first()).toBeHidden();
    await expect(page.locator('#filter-counts')).toContainText(/in elenco/i);

    await expect
      .poll(() => page.locator('#entity-list .entity-row').count(), { timeout: 30_000 })
      .toBeGreaterThan(50);
  });

  test('eIDAS filter lists more than one page of results', async ({ page }) => {
    await waitForAppReady(page);

    const before = await page.locator('#entity-list .entity-row').count();
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThanOrEqual(50);

    await page.locator('#filter-eidas').check();
    await expect(page.locator('#filter-counts')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#pagination')).toBeHidden();
    await expect(page.locator('#filter-counts')).toContainText(/in elenco/i);

    await expect
      .poll(() => page.locator('#entity-list .entity-row').count(), { timeout: 30_000 })
      .toBeGreaterThan(50);
  });
});
