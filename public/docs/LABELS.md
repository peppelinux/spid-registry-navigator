# Guida alle etichette (badge) — SPID Registry Navigator

Questo documento descrive ogni **label** mostrata nell’interfaccia del navigator, come viene **rilevata** dal tool (campi API o metadata SAML) e i **riferimenti normativi/tecnici** che ne definiscono il significato.

Namespace SPID per le estensioni SAML: `https://spid.gov.it/saml-extensions` (prefisso `spid:`).

---

## Indice

1. [Etichette di tipo federazione](#etichette-di-tipo-federazione)
2. [Etichette aggregatore](#etichette-aggregatore)
3. [Estensioni e profili SPID](#estensioni-e-profili-spid)
4. [Stato amministrativo nel registro](#stato-amministrativo-nel-registro)
5. [Campi nel pannello dettaglio](#campi-nel-pannello-dettaglio)
6. [Filtri nella barra laterale](#filtri-nella-barra-laterale)
7. [Limitazioni del rilevamento automatico](#limitazioni-del-rilevamento-automatico)

---

## Etichette di tipo federazione

### `IDP`

| | |
|---|---|
| **Significato** | Identity Provider — gestore dell’identità digitale che autentica gli utenti e rilascia le asserzioni SAML. |
| **Rilevamento** | Modalità di navigazione «IdP»; parametro API `entity_type=IDP`. |
| **Riferimenti** | [Regole tecniche — Metadata (IdP)](https://docs.italia.it/italia/spid/spid-regole-tecniche/it/stabile/metadata.html); [Registro SPID](https://docs.italia.it/italia/spid/spid-regole-tecniche/it/stabile/registro.html); [Registry API](https://registry.spid.gov.it/apidoc). |

### `SP`

| | |
|---|---|
| **Significato** | Service Provider in federazione diretta (`federation_type=SP`) — fornitore di servizi che consuma l’autenticazione SPID con metadata propri. |
| **Rilevamento** | Modalità «SP»; API `entity_type=SP` e `federation_type=SP`. |
| **Riferimenti** | [Regole tecniche — Metadata (SP)](https://docs.italia.it/italia/spid/spid-regole-tecniche/it/stabile/metadata.html); [Registry API — `federation_type`](https://registry.spid.gov.it/apidoc). |

### `AG`

| | |
|---|---|
| **Significato** | Entità **aggregata** — SP il cui accesso SPID è mediato da un soggetto aggregatore (comune, piattaforma, ecc.). |
| **Rilevamento** | Campo JSON `federation_type: "AG"` oppure `entity_id` con pattern aggregatore (es. `…/pub-ag-full/ente/…`). |
| **Riferimenti** | [Regole tecniche — Soggetti aggregatori](https://docs.italia.it/italia/spid/spid-regole-tecniche/it/stabile/soggetti-aggregatori.html); [Avviso AgID n.19 v4 (aggregatori)](https://www.agid.gov.it/sites/default/files/repository_files/spid-avviso-n19v4-regole_tecniche_aggregatori_0.pdf); [Registry API — `federation_type`](https://registry.spid.gov.it/apidoc). |

---

## Etichette aggregatore

### `aggregatore full`

| | |
|---|---|
| **Significato** | Profilo **aggregatore full** (proxy): l’aggregatore espone endpoint e metadata per conto degli enti aggregati (tipico hub con path dedicati per ente). |
| **Rilevamento** | `entity_id` contiene `pub-ag-full` (PA) o `pri-ag-full` (privato). In XML: estensione `spid:PublicServicesFullAggregator` o `spid:PrivateServicesFullAggregator` sul `ContactPerson` dell’aggregatore. |
| **Riferimenti** | [Avviso AgID n.19 v4](https://www.agid.gov.it/sites/default/files/repository_files/spid-avviso-n19v4-regole_tecniche_aggregatori_0.pdf); profili di test in [spid-sp-test — `pub-ag-full`](https://github.com/italia/spid-sp-test); analogia concettuale OIDC: [SPID/CIE OIDC — Soggetti aggregatori (Full/Light)](https://docs.italia.it/italia/spid/spid-cie-oidc-docs/it/versione-corrente/soggetti_aggregatori.html). |

### `aggregatore light`

| | |
|---|---|
| **Significato** | Profilo **aggregatore light** (trasparente): gli aggregati mantengono maggiore autonomia su metadata/domini; l’aggregatore ha ruolo più limitato. |
| **Rilevamento** | `entity_id` contiene `pub-ag-lite` / `pub-ag-light` o `pri-ag-lite`. In XML: `spid:PublicServicesLightAggregator` / profili privati corrispondenti. |
| **Riferimenti** | [Avviso AgID n.19 v4](https://www.agid.gov.it/sites/default/files/repository_files/spid-avviso-n19v4-regole_tecniche_aggregatori_0.pdf); [spid-sp-test — `pub-ag-lite`](https://github.com/italia/spid-sp-test). |

---

## Estensioni e profili SPID

### `professionale`

| | |
|---|---|
| **Significato** | Supporto a **identità digitale ad uso professionale** e/o **persona giuridica** (non solo cittadino-privato). |
| **Rilevamento nel navigator** | **IdP:** `extensions.supported_purpose` contiene almeno uno tra `PG`, `PF`, `LP`, `PX`. **SP:** ACS con `ServiceName` «Pro» oppure attributi `companyName`, `companyFiscalNumber`, `ivaCode`, `registeredOffice`. |
| **Codici purpose (IdP)** | Convenzione su metadata IdP (`spid:SupportedPurposes` / `spid:Purpose` in XML). Significato operativo allineato agli avvisi AgID: |
| | • **P** — persona fisica (cittadino) |
| | • **LP** — legale rappresentante / persona giuridica |
| | • **PG** — persona giuridica |
| | • **PF** — persona fisica ad uso professionale |
| | • **PX** — estensioni professionali aggiuntive |
| **Riferimenti** | [Regole tecniche — SSO (uso professionale / PG)](https://docs.italia.it/italia/spid/spid-regole-tecniche/it/stabile/single-sign-on.html); [Avviso AgID n.15 (identità uso professionale)](https://www.agid.gov.it/sites/default/files/repository_files/spid-avviso-n15-_rilascio_identita_uso_professionale.pdf); [Avviso AgID n.18 v2 (PG / uso professionale)](https://www.agid.gov.it/sites/default/files/repository_files/spid-avviso-n18_v.2-_autenticazione_persona_giuridica_o_uso_professionale_per_la_persona_giuridica.pdf); [Regole tecniche — Tabella attributi (`companyName`, `ivaCode`, …)](https://docs.italia.it/italia/spid/spid-regole-tecniche/it/stabile/attributi.html). |

### `firma`

| | |
|---|---|
| **Significato** | Il SP offre il servizio di **sottoscrizione elettronica con SPID** (firma con SPID ai sensi art. 20 CAD), non la semplice autenticazione. |
| **Rilevamento** | Presenza di un `AttributeConsumingService` con **`index === 77`** (nome tipico: «Sottoscrizione elettronica ex art.20 CAD» o «Pro» in alcuni hub). |
| **Riferimenti** | [Linee guida firma SPID — §4.6 Metadata nel registro](https://docs.italia.it/AgID/documenti-in-consultazione/lg-spid-firma-docs/it/stabile/main/04/04.6_registry-metadata.html); [§5.1 SAML (AuthnRequest, `AttributeConsumingServiceIndex=77`, estensione `spid:Signature`)](https://docs.italia.it/AgID/documenti-in-consultazione/lg-spid-firma-docs/it/stabile/main/05/05.1_saml.html); [PDF Linee guida art.20 CAD (AgID, 2024)](https://www.agid.gov.it/sites/agid/files/2024-06/linee_guida_per_la_sottoscrizione_elettronica_di_documenti_ai_sensi_dellart.20_del_cad.pdf). |

### `minori`

| | |
|---|---|
| **Significato** | Supporto alla **fruizione SPID da parte di minori** (verifica fasce d’età, eventuale autorizzazione del genitore). |
| **Rilevamento** | **Affidabile (XML):** `spid:SupportedAgeLimit` su IdP, `spid:AgeLimit` su SP/aggregati — validazione JS con cache `localStorage` (24h, aggiornata a ogni scansione). Badge **minori (xml)**. **Euristica JSON** se manca cache: badge **minori (?)**. Pannello «Validazione metadata XML» nel sidebar. |
| **Riferimenti** | [Determinazione AgID 51/2022 — Linee guida minori (testo)](https://trasparenza.agid.gov.it/download/5637.html); [Repository AgID `lg-spid-minori-docs`](https://github.com/AgID/lg-spid-minori-docs); sintesi: [studio su determinazione 51/2022](https://www.studiocerbone.com/agid-determinazione-03-marzo-2022-n-51-adozione-e-applicazione-delle-linee-guida-operative-per-la-fruizione-dei-servizi-spid-da-parte-dei-minori/). |

### `eIDAS`

| | |
|---|---|
| **Significato** | Il metadata nel registro indica compatibilità / readiness per attributi e profili **eIDAS** (interoperabilità europea), oltre al profilo SPID nazionale. |
| **Rilevamento** | Campo API **`eidas_ready === "Y"`**. Spesso correlato ad ACS con indici **99** (Minimum Attribute Set) e **100** (Full Attribute Set) e nomi «eIDAS Natural Person …». |
| **Riferimenti** | [Regolamento eIDAS (UE) 910/2014](https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=uriserv:OJ.L_.2014.257.01.0001.01.ITA); [Registry API — parametro `eidas_ready`](https://registry.spid.gov.it/apidoc); profilo FICEP/eIDAS in [spid-sp-test — `public-sp-eidas`](https://github.com/italia/spid-sp-test) (riferimento «AV eIDAS n°1»). |

---

## Stato amministrativo nel registro

Queste etichette **non** sono estensioni SAML: descrivono lo **stato operativo** dell’entrata nel Registro SPID gestito da AgID.

### `disabilitato`

| | |
|---|---|
| **Significato** | L’entità risulta **temporaneamente disabilitata** nel registro (non andrebbe usata in produzione). |
| **Rilevamento** | `_disabled === "Y"` nel JSON API. |
| **Riferimenti** | [Registry API — schema entità](https://registry.spid.gov.it/apidoc); [Registro SPID](https://docs.italia.it/italia/spid/spid-regole-tecniche/it/stabile/registro.html). |

### `cancellato`

| | |
|---|---|
| **Significato** | L’entità risulta **marcata come eliminata** nel registro (`delete_date` può essere valorizzata). |
| **Rilevamento** | `_deleted === "Y"`. |
| **Riferimenti** | [Registry API — schema entità](https://registry.spid.gov.it/apidoc). |

---

## Campi nel pannello dettaglio

| Campo | Significato | Riferimenti |
|-------|-------------|-------------|
| **Tipo** | Combinazione modalità UI (IDP/SP/AG) e `federation_type` dal JSON. | [Registry API](https://registry.spid.gov.it/apidoc) |
| **Codice** | Codice IPA (PA) o identificativo univoco SPID dell’ente (`code`). | [Metadata SP — codifica `PA:IT-…` / CF / PIVA](https://docs.italia.it/italia/spid/spid-regole-tecniche/it/stabile/metadata.html) |
| **Organizzazione** | `organization_type`: **PA** (pubblica amministrazione) o **PR** (privato). | [Metadata — estensioni `Public` / `Private`](https://docs.italia.it/italia/spid/spid-regole-tecniche/it/stabile/metadata.html) |
| **Aggregatore** | Nome e codice (`aggregator_code`, spesso P.IVA) del soggetto che aggrega l’ente. | [Soggetti aggregatori](https://docs.italia.it/italia/spid/spid-regole-tecniche/it/stabile/soggetti-aggregatori.html) |
| **eIDAS ready** | Valore grezzo `Y` / `N` dal registro. | [Registry API — `eidas_ready`](https://registry.spid.gov.it/apidoc) |
| **Attribute Consuming Service** | Elenco ACS SAML con indice, nome servizio e attributi richiesti. | [Regole tecniche — SSO (`AttributeConsumingServiceIndex`)](https://docs.italia.it/italia/spid/spid-regole-tecniche/it/stabile/single-sign-on.html) |

### Indici ACS ricorrenti

| Indice | Uso tipico | Riferimento |
|--------|------------|-------------|
| **0–2** | Profili SPID Base / Avanzato / Full (attributi anagrafici). | Prassi SPID e metadata di esempio AgID |
| **77** | Firma elettronica con SPID (art. 20 CAD). | [lg-spid-firma — §4.6](https://docs.italia.it/AgID/documenti-in-consultazione/lg-spid-firma-docs/it/stabile/main/04/04.6_registry-metadata.html) |
| **99** | eIDAS Natural Person **Minimum** Attribute Set. | AV eIDAS / FICEP (cfr. spid-sp-test) |
| **100** | eIDAS Natural Person **Full** Attribute Set. | idem |

---

## Filtri nella barra laterale

I checkbox applicano la stessa logica delle etichette, **solo sui risultati della pagina corrente** dell’elenco API (max 50 record per pagina, non l’intero registro).

| Filtro UI | Etichetta correlata | Note |
|-----------|-------------------|------|
| SPID professionale | `professionale` | Vedi sezione sopra |
| Firma con SPID (ACS #77) | `firma` | Richiede ACS con indice 77 |
| SPID minori | `minori` | Preferisce cache XML; altrimenti euristica JSON sulla pagina corrente |
| Variante **full** / **light** | `aggregatore full` / `aggregatore light` | Solo in modalità Aggregati |

---

## Limitazioni del rilevamento automatico

1. **Paginazione** — I filtri estensione non scansionano l’intero registro (~5.500 SP, ~33.000 aggregati); usare anche i parametri API (`aggregator_code`, `code`, `eidas_ready`, …).
2. **JSON vs XML** — Il registro in JSON non espone `spid:AgeLimit` / `SupportedAgeLimit`. Il navigator valida i metadata SAML in JS (pagina per pagina o intero dataset) e memorizza i risultati in cache locale per 24h.
3. **Liste purpose vuote** — Molti IdP hanno `supported_purpose: []` nel JSON pur supportando profili standard; l’assenza della label `professionale` **non** prova che l’IdP non eroghi SPID base.
4. **ACS #77 vs nome «Pro»** — Alcuni SP usano indice 77 con nome diverso dalla norma firma; altri hanno profilo «Pro» professionale senza firma: verificare sempre il metadata XML.

---

## Riferimenti trasversali

| Risorsa | URL |
|---------|-----|
| Registry SPID (UI + API) | https://registry.spid.gov.it |
| OpenAPI / apidoc | https://registry.spid.gov.it/apidoc |
| Regole tecniche SPID (Docs Italia) | https://docs.italia.it/italia/spid/spid-regole-tecniche/it/stabile/ |
| Linee guida firma SPID | https://docs.italia.it/AgID/documenti-in-consultazione/lg-spid-firma-docs/it/stabile/ |
| Linee guida minori (AgID) | https://github.com/AgID/lg-spid-minori-docs |
| Validazione metadata (spid-sp-test) | https://github.com/italia/spid-sp-test |
