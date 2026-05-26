import './styles/main.css';
import { ensureAggregatorFieldsBundle } from './api/aggregator-fields.js';
import { ensureBundledCache, initMetadataCache } from './api/metadata-cache.js';
import { ensureBundledRegistryTotals } from './api/pagination-probe.js';
import { mountApp } from './app.js';

async function bootstrap() {
  const root = document.getElementById('app');
  root.innerHTML = '<div class="list-placeholder">Caricamento cache e dati…</div>';
  await initMetadataCache();
  const cacheBootstrap = await ensureBundledCache();
  await Promise.all([ensureBundledRegistryTotals(), ensureAggregatorFieldsBundle()]);
  await mountApp(root, { cacheBootstrap });
}

bootstrap();
