# OSGFest

Gestionale per feste locali (Bonate Sotto) con:
- pannello admin per catalogo/eventi/hardware
- dashboard admin con metriche vendite e sezione sessioni cassa
- download report sessione cassa (CSV/XLS) dalla dashboard admin
- POS touch per cassa
- sconti POS dinamici con preset rapidi multipli configurabili in admin (es. Staff 50%, Promo cassa)
- tab "Sconti" nel catalogo POS: ogni tap aggiunge una riga sconto negativa nel carrello con ricalcolo immediato totale
- chiusura cassa con contante atteso (solo contanti) e stampa riepilogo su stampante associata
- storno sicuro ordine pagato da admin con ripristino contabile/scorte
- web app pubblica per ordini cliente
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
MONGODB_URI=mongodb://root:password@localhost:27017/osgfest?authSource=admin
AUTH_SECRET=replace-with-a-long-random-secret

# Opzionali / in base alla funzionalita'
SUMUP_API_KEY=
SUMUP_WEBHOOK_SECRET=
EVENT_SETTINGS_ENCRYPTION_KEY=
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
- `GET /login`: login admin

Credenziali di sviluppo attuali (placeholder): `admin / admin`.

## Script principali

```bash
npm run dev         # sviluppo
npm run build       # build produzione
npm run start       # avvio build
npm run lint        # linting
npm run test:unit   # test unitari
npm run test:e2e    # test E2E Playwright (Chromium)
npm run test:ci     # lint + unit + E2E (CI=true)
npm run db:up       # avvio MongoDB via docker compose
npm run db:down     # stop MongoDB via docker compose
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

## Documentazione di progetto

- Stato epiche: `docs/EPICS.md`
- Piano architettura: `docs/architecture-plan.md`
- Schema database: `docs/database-schema.md`
- Strategia UI: `docs/ui-strategy.md`

## Note

- Le integrazioni SumUp e webhook richiedono la configurazione delle relative variabili ambiente.
- Il README descrive lo stato corrente del repository `master`.
