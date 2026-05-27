/** @param {import('@playwright/test').Page} page */
export function trackBadNavigation(page) {
  const bad = { urls: [], requests: [] };

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame() && frame.url().includes('/dist/dist')) {
      bad.urls.push(frame.url());
    }
  });

  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/dist/dist') || url.includes('/@vite/client')) {
      bad.requests.push(url);
    }
  });

  return bad;
}

/** @param {import('@playwright/test').Page} page */
export async function waitForAppReady(page) {
  await page.goto('/');
  await page.getByRole('heading', { name: 'SPID SAML2 Federation Search Engine' }).waitFor();
  await page.locator('#entity-list .entity-row').first().waitFor({ timeout: 60_000 });
}

/** @param {{ urls: string[], requests: string[] }} bad */
export function assertNoBadNavigation(bad) {
  if (bad.urls.length) {
    throw new Error(`Redirect loop detected: ${bad.urls.join(', ')}`);
  }
  if (bad.requests.length) {
    throw new Error(`Unexpected dev/loop requests: ${bad.requests.join(', ')}`);
  }
}
