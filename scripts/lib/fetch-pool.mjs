/** Parallelismo download registry (override: XML_FETCH_CONCURRENCY=12). */
export const FETCH_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.XML_FETCH_CONCURRENCY || '12', 10) || 12,
);

/**
 * Esegue worker su ogni elemento con al massimo `concurrency` task in volo.
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
export async function runPool(items, concurrency, worker) {
  if (!items.length) return [];
  const limit = Math.min(Math.max(1, concurrency), items.length);
  const results = new Array(items.length);
  let next = 0;

  async function workerLoop() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => workerLoop()));
  return results;
}

/**
 * @param {(args: { page: number }) => Promise<{ xml?: string, pages?: number }>} fetchPage
 * @param {{ entityType: string, federationType?: string|null }} params
 */
export async function detectXmlPageCount(fetchPage, params) {
  const first = await fetchPage({ ...params, page: 1 });
  if (first.pages > 0) return first.pages;

  let page = 1;
  while (true) {
    const batch = page === 1 ? first : await fetchPage({ ...params, page });
    if (!batch.xml || batch.xml.length < 100) {
      return Math.max(1, page - 1);
    }
    page += 1;
    if (page > 50_000) throw new Error('Troppe pagine');
    if (page % 50 === 0) {
      console.log(`  rilevamento pagine: ${page}…`);
    }
  }
}
