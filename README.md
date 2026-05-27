# SPID SAML2 Federation Search Engine

**Single Page Application** statica in JavaScript: nessun backend in esecuzione. Il browser chiama direttamente le API del [Registro SPID](https://registry.spid.gov.it) (`registry.spid.gov.it`, CORS abilitato).

Documentazione etichette (badge) e filtri:

- Nell’app: **«Guida alle etichette»** nel pannello laterale
- Pagina statica: `labels.html` (nella cartella `dist/` dopo la build)
- Sorgente: [docs/LABELS.md](docs/LABELS.md)

## Architettura

| Componente | Ruolo |
|------------|--------|
| `dist/` | SPA compilata (HTML, JS, CSS) — **unico artefatto da pubblicare** |
| Browser | UI, filtri, validazione XML, cache `localStorage` |
| Registry SPID | Unico “server” dati (API REST + metadata SAML) |
| **npm / Vite** | Solo **sviluppo e build**; non servono in produzione |

## Demo online (GitHub Pages)

| Ambiente | URL | Aggiornamento |
|----------|-----|----------------|
| **Production** | https://peppelinux.github.io/spid-saml2-federation-search-engine/ | ogni push su `main` / `master` ([workflow](.github/workflows/deploy-pages.yml)) |
| **Nightbuild** | https://peppelinux.github.io/spid-saml2-federation-search-engine/nightly/ | ogni **24 ore** (04:00 UTC) + manuale ([workflow](.github/workflows/deploy-nightly.yml)) |

- **Production** — cache e bundle come nel commit su `main` (`public/data/`).
- **Nightbuild** — prima del deploy esegue `build:cache:refresh` e `build:cache:aggregators` sul registry live, poi pubblica in `/nightly/`.

### Configurazione GitHub Pages (una tantum)

1. Push del codice su GitHub.
2. **Settings → Pages → Build and deployment → Source:** **Deploy from a branch**
3. **Branch:** `gh-pages` · **Folder:** `/ (root)`
4. Dopo il primo workflow completato, gli URL sopra sono attivi.

I workflow usano [peaceiris/actions-gh-pages](https://github.com/peaceiris/actions-gh-pages) per pushare su `gh-pages` (`keep_files: true`: production in root, nightbuild in `nightly/`).

**Non** impostare *GitHub Actions* come sorgente Pages (quella modalità serve a `actions/deploy-pages` con un solo artefatto). Qui le Action **aggiornano il branch** `gh-pages`, e Pages serve quel branch.

| Meccanismo | Due URL (`/` + `/nightly/`) | Questo progetto |
|------------|-----------------------------|-----------------|
| Branch `gh-pages` + workflow che pushano | Sì | **Sì** |
| Solo *GitHub Actions* (`deploy-pages`) | Un artefatto per deploy → un URL | No (sostituito) |

## GitHub Pages (build locale)

In pipeline si esegue **`npm run build`** e si pubblica la cartella **`dist/`** sul branch `gh-pages` (nessun server Node in produzione).

La workflow [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) su push a `main` / `master` e sulle pull request:

1. `npm ci`
2. `npm run build` (base relativa `./`) e **test e2e Playwright** (`npm run test:e2e:ci`) — il deploy **non** parte se i test falliscono
3. su push a `main` / `master`: secondo `npm run build` con `VITE_BASE_PATH=/<nome-repo>/` e push su `gh-pages` (root)

Per testare la build come in CI:

```bash
VITE_BASE_PATH=/spid-saml2-federation-search-engine/ npm run build
./serve-static.sh
```

## Avvio in locale

Serve **Node solo per compilare**; in esecuzione usi un server HTTP statico (es. Python).

```bash
npm install
npm run build
cd dist
python3 -m http.server 8080
```

Apri **http://127.0.0.1:8080/**

Dalla root del progetto puoi usare anche lo script:

```bash
npm run build
./serve-static.sh        # http://127.0.0.1:8080/
./serve-static.sh 3000   # altra porta
```

> **Nota:** non aprire `index.html` con `file://` — moduli ES e `fetch` (guida, cache predefinita) richiedono HTTP. Non serve un backend Node, solo file statici da `dist/`.

## Uso senza backend (produzione / deploy)

Dopo `npm run build`, pubblica il contenuto di **`dist/`** su hosting statico (Apache, nginx, S3, GitHub Pages, …).

## Sviluppo (opzionale)

```bash
npm install
npm run dev
```

Apri l’URL indicato da Vite (es. `http://localhost:5173`).

## Funzionalità

- **IdP**, **SP**, **Aggregati (AG)** con ricerca e paginazione
- Filtri **professionale**, **firma** (ACS #77), **minori** (cache XML + euristica)
- Validazione metadata SAML in browser con log e progress bar
- Vista aggregatori full/light

## Cache metadata (export / import)

- **Esporta cache** — scarica un JSON con tutti i metadata XML analizzati (flag filtri: minori, firma, professionale, eIDAS)
- **Importa (unisci)** — unisce al `localStorage`; per ogni entity ID vince la scansione più recente
- **Importa (sostituisci)** — rimpiazza tutta la cache locale
- **Predefinita** — ricarica `public/data/metadata-cache-default.json` dal progetto

All’**primo avvio** (o se la cache locale è incompleta), l’app importa automaticamente `public/data/metadata-cache-default.json` in **IndexedDB** (~38.800 entity ID). I **filtri estensione** considerano solo il metadata XML in cache (risposte complete sul registro, non la sola pagina API né euristiche JSON).

Rigenerare la cache autorevole: `npm run build:cache` (completo) o `npm run build:cache:refresh` (solo aggiornamento flag da XML). I download XML usano un pool parallelo di **12** richieste (`XML_FETCH_CONCURRENCY=12` per cambiare).

La vista **Per aggregatore** richiede l’indice `aggregator-fields-default.json` (codice/nome aggregatore per ogni entity ID AG). Generarlo con:

```bash
npm run build:cache:aggregators
```

Senza questo file, in elenco compaiono solo gli aggregatori della pagina API corrente (~8), non tutti i soggetti aggregatori del registro.

Per pubblicare una cache aggiornata nel repo: esporta dall’app → sostituisci `public/data/metadata-cache-default.json` → commit (vedi `public/data/README.md`).

## Note tecniche

- **Paginazione:** ogni **pagina API** contiene un bundle con molti entity ID (fino a ~50 metadata). Il registry invia `tot-metadata` / `tot-pages` negli header HTTP, ma il browser non può leggerli (mancano in `Access-Control-Expose-Headers`); `tot-metadata` conta documenti metadata, non va confuso con entity ID distinti. L’app calcola i totali interrogando le pagine e li memorizza in `sessionStorage` per un’ora. Ordini di grandezza attuali: **~5.600 SP non aggregati**, **~33.200 aggregati**, **~38.800 entity ID SP** nel registro (somma delle due categorie).
- Endpoint: `GET https://registry.spid.gov.it/entities` (`output=json`, `page`, `numMetadata` ≤ 50)
- Dettaglio: `GET /entities/{entityId}?output=json`
- Metadata XML: `Accept: application/samlmetadata+xml`
- Asset con path relativi (`base: './'`) per deploy in sottocartelle

## Riferimenti

- [Registry API](https://registry.spid.gov.it/apidoc)
- [Regole tecniche – Metadata](https://docs.italia.it/italia/spid/spid-regole-tecniche/it/stabile/metadata.html)
