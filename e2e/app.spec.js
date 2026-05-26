import { test, expect } from '@playwright/test';
import { assertNoBadNavigation, trackBadNavigation, waitForAppReady } from './helpers.js';

test.describe('serve-root (recommended)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('loads SPA at / without /dist/dist redirect', async ({ page }) => {
    const bad = trackBadNavigation(page);
    await waitForAppReady(page);

    expect(page.url()).not.toContain('/dist/dist');
    assertNoBadNavigation(bad);
  });

  test('loads startup bundles and registry totals', async ({ page }) => {
    const bad = trackBadNavigation(page);
    const cacheReq = page.waitForResponse(
      (r) => r.url().includes('metadata-cache-default.json') && r.ok(),
    );
    const totalsReq = page.waitForResponse(
      (r) => r.url().includes('registry-totals-default.json') && r.ok(),
    );
    const aggregatorsReq = page.waitForResponse(
      (r) => r.url().includes('aggregator-fields-default.json') && r.ok(),
    );
    await page.goto('/');
    await Promise.all([cacheReq, totalsReq, aggregatorsReq]);

    await page.getByRole('heading', { name: 'SPID Registry Navigator' }).waitFor({
      timeout: 60_000,
    });

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const raw = localStorage.getItem('spid-nav-registry-totals:v1');
            if (!raw) return 0;
            const data = JSON.parse(raw);
            return data.byQuery?.['SP|SP|']?.entityCount ?? 0;
          }),
        { timeout: 15_000 },
      )
      .toBe(5573);

    assertNoBadNavigation(bad);
  });

  test('shows entity list and pagination from registry API', async ({ page }) => {
    await waitForAppReady(page);

    const rows = page.locator('#entity-list .entity-row');
    await expect(rows).not.toHaveCount(0);

    await expect(page.locator('[data-page-label]').first()).toContainText(/in questa pagina/i);
    await expect(page.locator('[data-page-label]').first()).toContainText(/pagina/i);
  });

  test('switches entity mode IdP / SP / Aggregati', async ({ page }) => {
    await waitForAppReady(page);

    await page.getByRole('button', { name: 'IdP', exact: true }).click();
    await expect(page.locator('#ag-controls')).toBeHidden();
    await page.locator('#entity-list .entity-row').first().waitFor();

    await page.getByRole('button', { name: 'Aggregati', exact: true }).click();
    await expect(page.locator('#ag-controls')).toBeVisible();
    await page.locator('#entity-list .entity-row').first().waitFor();
  });

  test('aggregators view lists all entities per aggregator and opens detail', async ({
    page,
  }) => {
    await waitForAppReady(page);

    await page.getByRole('button', { name: 'Aggregati', exact: true }).click();
    await page.getByRole('button', { name: 'Per aggregatore', exact: true }).click();

    await expect(page.locator('.aggregator-view')).toBeVisible();
    await expect
      .poll(() => page.locator('.aggregator-picker__item').count(), { timeout: 15_000 })
      .toBeGreaterThan(8);
    await expect(page.locator('[data-pagination-bar]').first()).toBeHidden();

    const pickerItems = page.locator('.aggregator-picker__item');
    await expect(pickerItems).not.toHaveCount(0);
    await expect(pickerItems.filter({ hasText: '3PItalia' })).toHaveCount(1);

    const listCount = await page.locator('[data-aggregator-list]').getAttribute('data-count');
    expect(Number(listCount)).toBeGreaterThan(0);

    const rows = page.locator('.aggregator-entities__list .entity-row');
    await expect(rows).not.toHaveCount(0);

    await rows.first().click();
    await expect(page.locator('#entity-detail .detail-header')).toBeVisible();
    await expect(page.locator('.aggregator-entities__list .entity-row.is-selected')).toHaveCount(
      1,
    );
  });

  test('exports full search results as CSV (not current page only)', async ({ page }) => {
    await waitForAppReady(page);

    await page.locator('#search-input').fill('teamsystem');
    await page.waitForTimeout(400);

    const hint = page.locator('#export-results-hint');
    await expect(hint).toContainText(/record nel risultato completo/i);

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export-results-csv').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/filtrato.*\.csv$/i);
    expect(download.suggestedFilename()).toMatch(/teamsystem|filtrato/i);
  });

  test('search narrows the list', async ({ page }) => {
    await waitForAppReady(page);

    const before = await page.locator('#entity-list .entity-row').count();
    expect(before).toBeGreaterThan(0);

    await page.locator('#search-input').fill('teamsystem');
    await page.waitForTimeout(350);

    const after = await page.locator('#entity-list .entity-row').count();
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
  });

  test('opens labels guide panel', async ({ page }) => {
    await waitForAppReady(page);

    await page.locator('#labels-help').click();
    await expect(page.locator('#labels-panel')).toBeVisible();
    await expect(page.locator('#labels-panel-title')).toHaveText('Guida alle etichette');
    await page.locator('#labels-panel-close').click();
    await expect(page.locator('#labels-panel')).toBeHidden();
  });

  test('registry totals table is populated from bundle', async ({ page }) => {
    await waitForAppReady(page);

    const body = page.locator('#registry-totals-body');
    await expect(body).toContainText('IdP');
    await expect(body).toContainText('5573');
    await expect(body).toContainText('33.236');
  });
});
