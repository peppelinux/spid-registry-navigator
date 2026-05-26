import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const distIndex = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.html');
const html = readFileSync(distIndex, 'utf8');

const forbidden = [
  { pattern: /@vite\/client/, message: 'dev-only Vite client probe' },
  { pattern: /location\.replace\([^)]*dist/, message: 'redirect loop to dist/' },
];

for (const { pattern, message } of forbidden) {
  if (pattern.test(html)) {
    console.error(`dist/index.html invalid: contains ${message}`);
    process.exit(1);
  }
}

if (!/assets\/index-[^"]+\.js/.test(html)) {
  console.error('dist/index.html invalid: missing built JS bundle in assets/');
  process.exit(1);
}

console.log('dist/index.html OK');
