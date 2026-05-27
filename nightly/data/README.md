# Cache metadata (bundle opzionale)

File `metadata-cache-default.json` — bundle opzionale con **entity ID** distinti (un `EntityDescriptor` = un entity ID). **Non** caricato automaticamente all’avvio se la cache locale è già popolata.

La cache locale dell’app si costruisce scaricando i metadata XML dal registry (`Costruisci cache (tutto il registro)` nel pannello sidebar).

## Bundle nel repository (solo import manuale)

1. Nell’app, eseguire **Costruisci cache (tutto il registro)** o le scansioni parziali.
2. Pannello **Cache e validazione XML** → **Esporta cache**.
3. Opzionale: sostituire `metadata-cache-default.json` per distribuzione offline.
4. Gli utenti possono importarlo con **Importa (unisci)** o **Importa (sostituisci)**.

Formato: JSON con `entries` (XML analizzato + opz. `registryJson` per campi API come `eidas_ready`), `idpSupportedAgeLimit`, `scans`.

All’avvio l’app importa il bundle in **IndexedDB** (non in `localStorage`, per dimensioni ~14 MB).

I **filtri** (professionale, firma, minori, eIDAS) usano solo i flag estratti dal **metadata XML** in cache, non il JSON API.

Per rigenerare i flag XML sul bundle esistente (senza rifare tutto da zero):

```bash
npm run build:cache:refresh
```

Questo comando aggiorna anche lo snapshot JSON degli aggregati dentro `metadata-cache-default.json`
(`registryJson` per le entry `AG`), così gli step successivi possono lavorare in locale senza altra rete.

Per eseguire in sequenza refresh + indice aggregatori (stesso flusso della nightbuild CI):

```bash
npm run build:cache:pipeline
```

Per ricostruire cache + totali da zero:

```bash
npm run build:cache
```

### Indice aggregatori (vista «Per aggregatore»)

`aggregator-fields-default.json` — mappa ogni entity ID aggregato → `aggregator_code` / `aggregator_name`.
È generato localmente da `metadata-cache-default.json` (nessuna chiamata rete in questo step).
Senza questo file la vista mostra solo gli aggregatori della pagina API corrente (~8), non tutti i **soggetti aggregatori** del registro (~340+).

```bash
npm run build:cache:aggregators
```

Download XML in parallelo (default **12** worker):

```bash
XML_FETCH_CONCURRENCY=12 npm run build:cache:refresh
```
