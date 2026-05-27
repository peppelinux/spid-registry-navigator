/**
 * Indice entity ID → codice/nome aggregatore, letto dalla cache locale.
 * Scrive public/data/aggregator-fields-default.json (usato dalla vista «Per aggregatore»).
 *
 * Uso: npm run build:cache:aggregators
 *      npm run build:cache:pipeline   (dopo refresh; include questo step)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_FIELDS = join(ROOT, 'public/data/aggregator-fields-default.json');
const CACHE_PATH = join(ROOT, 'public/data/metadata-cache-default.json');

async function main() {
  console.log(`Build indice aggregatori (locale) → ${OUT_FIELDS}`);
  console.log(`Sorgente: ${CACHE_PATH}\n`);

  const bundle = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
  const cacheEntries = bundle.entries || {};
  const byEntityId = {};
  const aggregatorCodes = new Set();
  let agCount = 0;
  let withAggregator = 0;

  for (const entry of Object.values(cacheEntries)) {
    if (!entry || entry.entityType !== 'AG') continue;
    agCount += 1;
    const json = entry.registryJson || {};
    const code = json.aggregator_code ?? null;
    const name = json.aggregator_name ?? null;
    byEntityId[entry.entityId] = { c: code, n: name };
    if (code || name) {
      withAggregator += 1;
      if (code) aggregatorCodes.add(code);
    }
  }

  const exportedAt = new Date().toISOString();
  if (agCount > 0 && withAggregator === 0) {
    throw new Error(
      'Nessun campo aggregatore trovato in cache AG. Eseguire prima: npm run build:cache:pipeline oppure npm run build:cache:refresh (oppure build:cache).',
    );
  }
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
    `\nScritto ${OUT_FIELDS}: ${Object.keys(byEntityId).length} entity AG, ${withAggregator} con codice/nome, ${aggregatorCodes.size} soggetti aggregatori`,
  );
  console.log(`Entry AG con campi aggregatore in cache: ${withAggregator}/${agCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
