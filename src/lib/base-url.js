/** Base path Vite (`./` in produzione statica). */
export const BASE = import.meta.env.BASE_URL;

/** URL relativo alla root della SPA (es. `./labels.html`). */
export function baseUrl(path = '') {
  const clean = String(path).replace(/^\//, '');
  return `${BASE}${clean}`;
}
