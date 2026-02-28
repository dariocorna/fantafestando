# OSGFest — Stato delle Epiche di Sviluppo

Documento di riferimento per agenti AI e sviluppatori. Elenca tutte le epiche di sviluppo del progetto con lo stato attuale (✅ Completata / 🔄 In corso / ⬜ Pianificata).

> **Regola d'oro**: Prima di considerare un'epica **Completata**, è **obbligatorio** che esistano test E2E (Playwright) che coprano i flussi principali e che questi passino con successo.

---

## ✅ Epica 1: Setup Progetto

Inizializzazione dell'ambiente tecnologico.

- Stack: Next.js 14 (App Router), TypeScript, Tailwind CSS, MongoDB + Mongoose, NextAuth.js.
- Configurazione Docker Compose per lo sviluppo locale.
- Setup dei test: Vitest (unit) e Playwright (E2E).

---

## ✅ Epica 2: Backend e Catalogo

Gestione del catalogo prodotti tramite interfaccia admin.

- CRUD completo per **Categorie** e **Prodotti** (con **Varianti** e varianza di prezzo).
- API di configurazione Festa.

---

## ✅ Epica 2.5: Refactoring Struttura Festa-Centrica

Tutte le entità del sistema sono ora associate a un `eventId` (Festa).

- Selettore "Contesto Festa Attiva" globale nell'header admin.
- Filtri automatici basati sulla festa selezionata.
- Funzione di **clonazione Festa** da template (duplica categorie, prodotti, stampanti).
- Funzione di **archiviazione** Festa.

---

## ✅ Epica 3: Punto Cassa LAN

POS Touch ottimizzato per l'uso su tablet/totem in locale.

- Lista ordini pendenti con aggiornamento polling.
- Ricerca rapida ordine via Short-code.
- Chiusura e salvataggio ordine saldato su MongoDB.

---

## ✅ Epica 4: WebApp Ordini Pubblica

PWA pubblica per i clienti della festa.

- Navigazione catalogo, composizione carrello.
- Checkout con form condizionale (Nome/Tavolo) configurabile per evento.
- Pagina di riepilogo con Short-code univoco per il ritiro ordine.

---

## ✅ Epica GitHub #17/#18: PWA Menu dedicata

Completamento della PWA per il solo frontale pubblico `menu`.

- Manifest dedicato su `GET /manifest-menu.webmanifest` con scope `/menu/`.
- Service worker dedicato `sw-menu.js` (strategia online-first) con cache versionata su release.
- Prompt installazione PWA nel layout `menu`.
- Branding UI menu allineato alle nuove grafiche e icone ufficiali.
- Nessuna modalità offline operativa per `menu` (coerente con il flusso ordine online).
- Nessuna PWA su `admin` in questa epica (rinviata a epica futura).

**Test E2E**: `e2e/pwa.spec.ts`.
**Issue collegate**: `#17`, `#18` (chiuse).

---

## ✅ Epica 5: Smistamento e Stampe di Rete

Routing intelligente delle stampe termiche ESC/POS.

- Libreria: `node-thermal-printer`.
- Doppia copia: una per il reparto (cucina/bar/ecc.) e una per la cassa.
- Fallback su stampante della cassa se la categoria non ha stampante di reparto associata.

---

## ✅ Epica 6: Integrazione Pagamenti Elettronici (SumUp)

Supporto pagamenti con carta tramite terminale SumUp.

- SDK: `@sumup/sdk`.
- Bottone "Paga con POS" nel frontale cassa.
- Webhook SumUp per conferma automatica ordine e triggering stampe.
- Localizzazione completa della UI in lingua italiana.

---

## ✅ Epica 7: Multi-Cassa e Stampe Avanzate

Supporto per più postazioni cassa fisiche.

- Modelli `Printer` (CASHIER/KITCHEN) e `PosDevice`.
- Pannello admin per la gestione di stampanti e punti cassa.
- Selezione obbligatoria del Punto Cassa all'avvio del POS (persistente in `localStorage`).
- Routing stampe con logica per reparto e copia cliente.

**Test E2E**: `e2e/hardware.spec.ts`, `e2e/pos_selection.spec.ts`.

---

## ✅ Epica 12: Modifica Entità — Full CRUD

Completamento del ciclo CRUD con le operazioni di modifica per tutte le entità principali.

- **Categorie**: modifica di nome, colore UI e stampante associata.
- **Prodotti**: modifica di nome, categoria, prezzo base e gestione varianti.
- **Stampanti**: modifica di nome, IP e tipo.
- **Punti Cassa**: modifica di nome e stampante cassa.

Architettura: Dialog Client-Side controllate (si chiudono automaticamente a successo), gestione del refresh tramite `router.refresh()`.

**Test E2E**: `e2e/admin.spec.ts`, `e2e/hardware.spec.ts` (6/6 passing).

---

## ✅ Epica 13: Hardware Modulare & Periferiche

Rifattorizzazione dell'architettura hardware per supportare periferiche modulari.

### Architettura
- **Modello `Peripheral`**: Rappresenta una periferica di pagamento (SumUp o Cassetta Contanti) associabile ai Punti Cassa. Campi: `eventId`, `name`, `type` (`SUMUP | CASH_BOX | OTHER`), `config` (es. `merchantId`, `affiliateKey` per SumUp).
- **`PosDevice` aggiornato**: Aggiunto `paymentTerminalId` (ref a `Peripheral`) e `cashBoxId` (ref a `Peripheral`) — entrambi opzionali.

### UI
- Pagina **Hardware Unificata** (`/admin/settings/hardware`) con Tabs: Stampanti / Periferiche.
- Componente `PeripheralDialog`: CRUD per le periferiche con campo configurazione SumUp condizionale.
- Componente `EditPosDeviceDialog` aggiornato: selezione di terminale di pagamento e cassetta contanti durante la modifica del Punto Cassa.

### Actions
- `createPeripheralAction`, `updatePeripheralAction`, `deletePeripheralAction` in `src/app/admin/settings/actions.ts`.
- `deletePeripheralAction` esegue lo scollegamento atomico (`$unset`) dai PosDevice associati.

**Test E2E**: Suite esistente (6/6 passing) — test specifici per le periferiche pianificati.

---

## ✅ Epica 8: Dashboard Statistiche e Reportistica

**Priorità: Alta** — Funzionalità operativa critica.

- Calcolo incassi totali live per la serata attiva.
- Dashboard con metriche: incasso contanti vs. carte (SumUp).
- Tracciamento vendite prodotti (Best Seller, Sotto Performanti).
- Export CSV/Excel per rendicontazione di fine festa.
- Sezione **Sessioni Cassa** in admin con storico aperture/chiusure per postazione.
- Download report sessione cassa (CSV/XLS) dal pannello admin.
- Chiusura cassa POS con indicazione del **contante atteso** (solo cash, esclusi elettronici).
- Stampa automatica riepilogo chiusura sulla stampante associata alla postazione cassa.

**Test E2E**: `e2e/admin_dashboard_stats.spec.ts`, `e2e/admin_cash_sessions.spec.ts`, `e2e/pos_cash_session.spec.ts`.

---

## ✅ Epica 9: Magazzino e Scorte Base

- Campo giacenza (scorta) sul modello `Product` e su ogni `Variant`.
- Decremento automatico scorta al passaggio ordine in stato `PAID` (checkout POS cash / chiusura pendente / webhook carta).
- Auto Sold-Out quando le scorte arrivano a `0` (con clamp per evitare valori negativi).
- Indicatori visivi "Low stock warning" in Admin Catalogo e POS.
- **Regola operativa POS**: a scorta `0` il prodotto resta vendibile solo con warning bloccante e conferma esplicita del cassiere.
- **Regola operativa Menu pubblico**: prodotti esauriti non ordinabili.
- Nessuna prenotazione scorte sugli ordini web pendenti: la verifica avviene in chiusura.

Riferimento funzionale dettagliato: `docs/inventory-stock.md`.

**Test E2E**: `e2e/inventory_stock.spec.ts`, `e2e/menu_day_availability.spec.ts`.

---

## ✅ Epica 10: Sicurezza e Ruoli (RBAC)

- Differenziazione ruoli: **Admin/Gestione** vs. **Cassiere**.
- Restrizione rigida delle rotte `/admin` ai soli utenti Gestori.
- Login credenziali via DB (`User`) con verifica `bcrypt` e ruolo propagato in sessione JWT/Auth.js.
- Defense in depth su backoffice:
  - guard rete su `proxy` per `/admin`;
  - guard server-side su layout admin;
  - controllo autorizzazione su server action/route admin (settings, catalogo, ordini, export).
- Pagina `/login` dedicata + logout backoffice.
- (Opzionale) PIN Cassa per passaggio rapido di sessione tra volontari.

**Test E2E**: `e2e/rbac_admin_access.spec.ts` (suite Chromium completa verde).

---

## ✅ Epica 11: Operazioni Cassa Avanzate

- Sconti dinamici nel POS:
  - preset rapidi multipli configurabili in admin (es. Staff 50%, Promo Cassa) applicabili in 1 tap in una tab "Sconti" affiancata alle categorie prodotto;
  - applicazione a carrello come riga negativa (simile a prodotto sconto) con ricalcolo immediato del totale;
- Opzioni sconto custom avanzate rimosse dall'interfaccia operativa principale per semplificare il flusso cassa.
- Persistenza audit sconti su `Order` (`discountApplied`, `discountMeta`, metadati riga).
- Storno sicuro ordine pagato da admin con lock idempotente (`stornoMeta`):
  - annullamento contabile ordine (`status: CANCELLED`);
  - ripristino scorte tracciate;
  - rimborso SumUp per ordini carta (con fallback recupero transaction id da checkout).
- Aggiornamento webhook SumUp con salvataggio `sumupPaymentId` quando disponibile.

**Test E2E**: `e2e/pos_discounts_and_storno.spec.ts`.

---

## ⬜ Epica 14: Metodi di Pagamento Dinamici al POS (Dipende da Epica 13)

La UI del POS deve riflettere le periferiche effettivamente associate al Punto Cassa selezionato.

- Se il POS ha un `paymentTerminalId`, mostrare il bottone "Paga con POS (SumUp)".
- Se il POS ha un `cashBoxId`, mostrare il bottone "Paga in Contanti".
- Se non ci sono periferiche, disabilitare entrambe le opzioni o usare un default.
- Migrazione impostazioni SumUp: da globali (`Event.settings.sumupApiKey`) a specifiche del `Peripheral`.

---

## ⬜ Epica 15: (Futuro) Notifiche e Alerting

- Notifica in tempo reale al cassiere quando un ordine WebApp viene creato.
- Eventuale integrazione con WebSocket o polling avanzato.

---

## ✅ Epica 17: Emulazione Stampanti

- Virtualizzazione stampanti termiche ESC/POS su TCP per sviluppo, test e demo.
- Supporto a pool di 10 stampanti virtuali via Docker.
- Tracciamento job di stampa con stato (`SENT`/`FAILED`) e diagnostica.
- Vista Admin runtime con anteprima ricevute renderizzate.
- Compatibilità con stampanti reali LAN mantenuta (nessuna regressione attesa sul path attuale).
- Documentazione tecnica: `docs/printer-emulation.md`.

**Test E2E**: `e2e/printer_emulation.spec.ts`, `e2e/print_retry.spec.ts`.

---

## ✅ Epica GitHub #28/#29: Refactoring template UI tema nuovo logo

Allineamento visuale delle superfici `menu`, `admin` e `pos` con priorita' operativa su leggibilita' e velocita' in cassa.

- Introduzione e consolidamento token brand nel layer globale UI.
- Restyling `menu` con header brand, footer informativo e coerenza cromatica su pagine core.
- Restyling `admin` mantenendo densita' informativa e componenti operativi.
- Evoluzione `pos` con doppia modalita' catalogo configurabile da impostazioni admin:
  - vista compatta per cassa (colonne categoria sempre visibili);
  - vista moderna filtrata per categoria (con prezzi e CTA esplicite).
- Hardening su creazione entita' duplicate (feste/prodotti) con controlli lato admin e copertura test.

**Test E2E**: `e2e/responsive_surfaces.spec.ts`, `e2e/pos_catalog_layout.spec.ts`, `e2e/admin_duplicates.spec.ts`.
**Issue collegate**: `#28`, `#29` (chiuse).

---

## ✅ Epica: Deploy progetto su macchina virtuale

- Pacchettizzazione e rilascio del gestionale su VM dedicata.
- Configurazione servizi runtime (app, database, reverse proxy) e persistenza dati.
- Procedure operative di backup/ripristino e aggiornamento.
- Deploy attivo su domini DDNS pubblici:
  - `https://osgfest.ddns.net` (Menu)
  - `https://osgfest-backoffice.ddns.net` (Admin/POS)
- HTTPS abilitato via Certbot + Apache reverse proxy.

---

## ⬜ Epica: Supporto Pagamenti Satispay

- Integrazione metodo di pagamento Satispay nel flusso POS.
- Gestione stato transazione e chiusura ordine coerente con la contabilità cassa.
- Tracciamento/reportistica incassi Satispay in dashboard e export.
