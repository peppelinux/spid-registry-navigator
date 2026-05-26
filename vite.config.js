import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('vite').Plugin} */
function noCacheHtmlPlugin() {
  const stamp = new Date().toISOString();
  return {
    name: 'no-cache-html',
    transformIndexHtml(html) {
      const meta =
        '<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />';
      const comment = `<!-- spid-registry-navigator build ${stamp} -->`;
      return html.replace('<head>', `<head>\n    ${meta}\n    ${comment}`);
    },
  };
}

/**
 * SPA statica, nessun backend in runtime.
 * - entry Vite: app/index.html (non il redirect in root)
 * - locale / preview: base `./`
 * - GitHub Pages (CI): VITE_BASE_PATH=/nome-repo/
 */
export default defineConfig({
  root: resolve(__dirname, 'app'),
  publicDir: resolve(__dirname, 'public'),
  base: process.env.VITE_BASE_PATH || './',
  plugins: [noCacheHtmlPlugin()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
});
