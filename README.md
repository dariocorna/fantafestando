# FantaFestando

Gestionale per feste locali (Bonate Sotto) con:
- pannello admin per catalogo/eventi/hardware
- dashboard admin con metriche vendite e sezione sessioni cassa
- autenticazione RBAC per backoffice (`ADMIN`/`CASHIER`) con blocco accesso `/admin` ai soli `ADMIN`
- download report sessione cassa (CSV/XLS) dalla dashboard admin
- POS touch per cassa
- sconti POS dinamici con preset rapidi multipli configurabili in admin (es. Staff 50%, Promo cassa)
- tab "Sconti" nel catalogo POS: ogni tap aggiunge una riga sconto negativa nel carrello con ricalcolo immediato totale
- chiusura cassa con contante atteso (solo contanti) e stampa riepilogo su stampante associata
- storno sicuro ordine pagato da admin con ripristino contabile/scorte
- web app pubblica per ordini cliente
- PWA dedicata per `menu` (pubblico), installabile e online-first
- integrazione pagamenti elettronici SumUp
- rimborso SumUp in caso di storno ordine pagato con carta
- stampa comande su stampanti termiche di rete

## Stack

- Next.js (App Router) + TypeScript
- React + Tailwind CSS
- MongoDB + Mongoose
- NextAuth (Auth.js)
- Vitest (unit test) + Playwright (E2E)

## Avvio rapido

Prerequisiti:
- Node.js 20+
- Docker (per MongoDB locale)

1. Installa dipendenze:
```bash
npm install
```

2. Configura variabili ambiente in `.env.local`:
```bash
MONGODB_URI=mongodb://root:password@localhost:27017/fantafestando?authSource=admin
AUTH_SECRET=replace-with-a-long-random-secret
AUTH_ALLOW_DEV_CREDENTIALS=true
APP_VERSION=0.2.0
APP_BUILD=

# Opzionali / in base alla funzionalita'
SUMUP_API_KEY=
SUMUP_WEBHOOK_SECRET=
EVENT_SETTINGS_ENCRYPTION_KEY=
PRINTER_EMULATOR_HOST=127.0.0.1
PRINTER_EMULATOR_START_PORT=19100
```

3. Avvia MongoDB locale:
```bash
npm run db:up
```

4. Avvia l'app:
```bash
npm run dev
```

App disponibile su `http://localhost:3000`.

## Rotte utili

- `GET /admin`: pannello amministrazione
- `GET /pos`: interfaccia punto cassa
- `GET /menu`: web app ordini pubblica
- `GET /manifest-menu.webmanifest`: manifest PWA menu
- `GET /login`: login admin

Accesso backoffice:
- ambienti standard: utenti letti da MongoDB collection `User` (`username`, `passwordHash`, `role`) con verifica password `bcrypt`;
- sviluppo locale: fallback `admin / admin` attivo solo fuori produzione (disattivabile con `AUTH_ALLOW_DEV_CREDENTIALS=false`).

## Script principali

```bash
npm run dev         # sviluppo
npm run build       # build produzione
npm run start       # avvio build
npm run lint        # linting
npm run test:unit   # test unitari
npm run test:e2e    # test E2E Playwright (Chromium)
npm run test:ci     # lint + unit + E2E (CI=true)
npm run printer:emulator  # avvio emulatore ESC/POS TCP (10 porte)
npm run db:up       # avvio MongoDB via docker compose
npm run db:down     # stop MongoDB via docker compose
```

E2E su porta dedicata (per evitare conflitti con altre sessioni):
```bash
PLAYWRIGHT_PORT=3400 CI=true npx playwright test --project=chromium
```

## Testing

Esegui la suite completa locale:
```bash
npm run test:ci
```

Oppure solo E2E Chromium come da workflow progetto:
```bash
CI=true npx playwright test --project=chromium
```

Suite di stampa reale opt-in:
```bash
ENABLE_REAL_PRINT_TESTS=1 \
REAL_PRINT_CASHIER_HOST=192.168.68.203 \
REAL_PRINT_CASHIER_PORT=9100 \
REAL_PRINT_KITCHEN_HOST=192.168.68.201 \
REAL_PRINT_KITCHEN_PORT=9100 \
npm run test:e2e:real-print
```

La suite `e2e/real-printing.spec.ts` crea una festa E2E dedicata, stampa davvero su rete TCP 9100 e poi ripulisce festa, ordini, sessioni cassa e print job. Se mancano le env richieste, il test viene saltato.

## Documentazione di progetto

- Stato epiche: `docs/EPICS.md`
- Piano architettura: `docs/architecture-plan.md`
- Schema database: `docs/database-schema.md`
- Strategia UI: `docs/ui-strategy.md`
- Deploy VM produzione (`Caddy` raccomandato su Oracle VM): `docs/deploy-vm.md`
- Emulazione stampanti: `docs/printer-emulation.md`

## Licenza

Questo progetto e` distribuito sotto licenza `GNU AGPL v3.0` (`AGPL-3.0-only`).
Il testo completo e` disponibile nel file `LICENSE`.

Se redistribuisci una versione modificata del software, devi rendere disponibile
anche il relativo codice sorgente secondo i termini della AGPL.

Se esegui una versione modificata del software e la rendi disponibile agli utenti
attraverso una rete, devi offrire anche a quegli utenti l'accesso al sorgente
corrispondente della versione in esecuzione.

## Note

- Le integrazioni SumUp e webhook richiedono la configurazione delle relative variabili ambiente.
- In Admin la versione mostrata usa `APP_VERSION` (fallback: `package.json`), con suffisso opzionale `APP_BUILD`.
- La PWA `menu` è configurata in modalità online-first: installabile, ma senza flussi offline operativi.
- Il README descrive lo stato corrente del repository `master`.
