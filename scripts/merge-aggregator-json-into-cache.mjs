/**
 * Indice entity ID → codice/nome aggregatore (JSON API layer AG).
 * Scrive public/data/aggregator-fields-default.json (usato dalla vista «Per aggregatore»).
 * Opzionale: --patch-cache aggiorna anche registryJson in metadata-cache-default.json.
 *
 * Uso: npm run build:cache:aggregators
 *      node scripts/merge-aggregator-json-into-cache.mjs --patch-cache
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FETCH_CONCURRENCY, runPool } from './lib/fetch-pool.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_FIELDS = join(ROOT, 'public/data/aggregator-fields-default.json');
const CACHE_PATH = join(ROOT, 'public/data/metadata-cache-default.json');
const API_BASE = 'https://registry.spid.gov.it';
const patchCache = process.argv.includes('--patch-cache');

async function fetchJsonPage({ page, pageSize = 50 }) {
  const url = new URL(`${API_BASE}/entities`);
  url.searchParams.set('entity_type', 'SP');
  url.searchParams.set('federation_type', 'AG');
  url.searchParams.set('output', 'json');
  url.searchParams.set('page', String(page));
  url.searchParams.set('numMetadata', String(pageSize));

  const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (response.status === 404) return { items: [] };
  if (!response.ok) throw new Error(`JSON HTTP ${response.status} pagina ${page}`);
  const body = await response.json();
  const items = Array.isArray(body) ? body : body?.items ?? [];
  return { items };
}

async function findLastJsonPage(pageSize = 50) {
  const first = await fetchJsonPage({ page: 1, pageSize });
  if (first.items.length < pageSize) return 1;

  let lastFull = 1;
  let probePage = 2;
  while (true) {
    const batch = await fetchJsonPage({ page: probePage, pageSize });
    if (batch.items.length === 0) break;
    if (batch.items.length < pageSize) return probePage;
    lastFull = probePage;
    probePage *= 2;
    if (probePage > 50_000) throw new Error('Limite pagine superato');
  }

  let lo = lastFull + 1;
  let hi = probePage - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const batch = await fetchJsonPage({ page: mid, pageSize });
    if (batch.items.length > 0) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

async function main() {
  console.log(`Build indice aggregatori → ${OUT_FIELDS}`);
  if (patchCache) console.log(`(+ patch registryJson in ${CACHE_PATH})`);
  console.log(`Workers: ${FETCH_CONCURRENCY}\n`);

  const byEntityId = {};
  let cacheEntries = null;
  if (patchCache) {
    const bundle = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
    cacheEntries = bundle.entries || {};
  }

  const lastPage = await findLastJsonPage();
  console.log(`Pagine AG JSON: ${lastPage}`);

  const pages = Array.from({ length: lastPage }, (_, i) => i + 1);
  const aggregatorCodes = new Set();
  let merged = 0;
  let done = 0;

  await runPool(pages, FETCH_CONCURRENCY, async (page) => {
    const batch = await fetchJsonPage({ page });
    for (const item of batch.items) {
      if (!item?.entity_id) continue;
      const code = item.aggregator_code ?? null;
      const name = item.aggregator_name ?? null;
      if (code) aggregatorCodes.add(code);
      byEntityId[item.entity_id] = { c: code, n: name };

      if (patchCache && cacheEntries) {
        const entry = cacheEntries[item.entity_id];
        if (!entry || entry.entityType !== 'AG') continue;
        entry.registryJson = {
          ...(entry.registryJson || {}),
          aggregator_code: code,
          aggregator_name: name,
        };
        merged += 1;
      }
    }
    done += 1;
    if (done % 50 === 0 || done === lastPage) {
      console.log(
        `  ${done}/${lastPage} pagine · ${Object.keys(byEntityId).length} entity · ${aggregatorCodes.size} aggregatori distinti`,
      );
    }
  });

  const exportedAt = new Date().toISOString();
  mkdirSync(dirname(OUT_FIELDS), { recursive: true });
  writeFileSync(
    OUT_FIELDS,
    JSON.stringify({
      version: 1,
      exportedAt,
      entityCount: Object.keys(byEntityId).length,
      aggregatorCount: aggregatorCodes.size,
      byEntityId,
    }),
  );
  console.log(
    `\nScritto ${OUT_FIELDS}: ${Object.keys(byEntityId).length} aggregati, ${aggregatorCodes.size} soggetti aggregatori`,
  );

  if (patchCache && cacheEntries) {
    const bundle = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
    bundle.entries = cacheEntries;
    bundle.exportedAt = exportedAt;
    writeFileSync(CACHE_PATH, JSON.stringify(bundle));
    console.log(`Cache aggiornata: ${merged} entry AG con aggregator in registryJson`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
