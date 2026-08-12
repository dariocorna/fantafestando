# FantaFestando — Stato delle Epiche di Sviluppo

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
- Cloud API del lettore SumUp con callback verificata server-to-server prima della conferma ordine e delle stampe.
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
- **Modello `Peripheral`**: Rappresenta una periferica di pagamento (SumUp, POS manuale o Cassetta Contanti) associabile ai Punti Cassa. Campi: `eventId`, `name`, `type` (`SUMUP | ELECTRONIC_MANUAL | CASH_BOX | OTHER`), `config` (Merchant Code, Reader ID e credenziali cifrate per SumUp).
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
- Riepilogo espandibile di tutti i prodotti venduti nella serata corrente.
- Export CSV/Excel e report PDF A4 multipagina per rendicontazione di fine festa.
- Sezione **Sessioni Cassa** in admin con storico aperture/chiusure per postazione.
- Download report sessione cassa (CSV/XLS) dal pannello admin.
- Chiusura cassa POS con indicazione del **contante atteso** (solo cash, esclusi elettronici).
- Stampa automatica riepilogo chiusura sulla stampante associata alla postazione cassa.

**Test E2E**: `e2e/admin_dashboard_stats.spec.ts`, `e2e/admin_cash_sessions.spec.ts`, `e2e/pos_cash_session.spec.ts`.

**Issue collegate**: `#117`.

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

## ✅ Epica 14: Metodi di Pagamento Dinamici al POS (Dipende da Epica 13)

La UI del POS riflette le periferiche effettivamente associate al Punto Cassa selezionato.

- Se il POS ha un `paymentTerminalId`, viene mostrato il bottone "Carta / POS"; per una periferica SumUp la transazione viene inviata al lettore associato.
- Se il POS ha un `cashBoxId`, viene mostrato il bottone "Paga in Contanti".
- Supporto pagamento elettronico manuale (senza terminale fisico) per separazione contabile contanti/elettronico.
- Memoria locale per postazione dell'ultimo metodo di pagamento completato, riutilizzato come default al checkout successivo.
- Logica di pagamento estratta in modulo dedicato `src/lib/payment-logic.ts`.

**Test E2E**: `e2e/pos_electronic_payment.spec.ts`, `e2e/pos_payment_preference.spec.ts`.
**Issue collegate**: `#14`, `#124`.

---

## ✅ Epica GitHub #149: SumUp e sessioni TEST

- Pagamento in presenza tramite SumUp Reader Cloud API, con configurazione per periferica di Merchant Code, Reader ID, API Key, Affiliate App ID e Affiliate Key.
- Callback pubblica limitata alla sola route SumUp e verifica della transazione tramite API prima di contabilizzare e stampare; le scorte sono prenotate all'avvio e ripristinate in modo idempotente sugli esiti negativi.
- Pagamenti automatici SumUp esclusi dalle sessioni `TEST`; checkout pendenti e pagamenti certificati impediscono la riclassificazione di sessioni aperte o chiuse.
- Pagamenti elettronici manuali ammessi nelle sessioni `TEST`, senza rimborso SumUp né blocco della riclassificazione.
- Ordini con un checkout SumUp attivo non completabili manualmente, per evitare doppio incasso.
- Gli avvii con esito di rete incerto restano prenotati e visibili in Admin: la recovery riconcilia gli identificativi SumUp oppure, dopo almeno 15 minuti, libera scorte e ordine solo con doppio lookup negativo e reader online/idle. Se il pagamento compare dopo l'annullamento locale, il webhook lo segnala come tardivo e Admin ne consente il rimborso senza toccare nuovamente le scorte.

**Test E2E**: `e2e/sumup_test_sessions.spec.ts`.
**Issue collegata**: `#149`.

---

## ✅ Epica GitHub #118: Filtri temporali dashboard e report

Filtro temporale condiviso per dashboard statistiche ed export amministrativi.

- Viste rapide **Tempo reale**, **Serata corrente** e **Intera festa** con indicazione sempre visibile dell'intervallo attivo.
- Intervallo personalizzato con data/ora iniziale e finale, validazione errori e blocco export su input non valido.
- Aggiornamento automatico della dashboard in modalità realtime senza ricaricamento manuale.
- Applicazione coerente del filtro a KPI, prodotti venduti, classifiche, ordini esportati e riepiloghi CSV/XLSX.
- Calcolo basato su `paidAt` quando disponibile, con fallback agli ordini storici e uso del fuso orario configurato per l'evento.

**Test E2E**: `e2e/admin_dashboard_stats.spec.ts`.
**Issue collegata**: `#118` (chiusa).

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
- Configurazione documentata per domini pubblici distinti:
  - `https://menu.example.com` (Menu)
  - `https://backoffice.example.com` (Admin/POS)
- HTTPS abilitato via Certbot + Apache reverse proxy.

---

## ⬜ Epica: Supporto Pagamenti Satispay

- Integrazione metodo di pagamento Satispay nel flusso POS.
- Gestione stato transazione e chiusura ordine coerente con la contabilità cassa.
- Tracciamento/reportistica incassi Satispay in dashboard e export.

---

## ✅ Issue GitHub #22: Descrizione prodotto menu + shortName operativo

Estensione del catalogo prodotti con campi testuali dedicati ai diversi canali.

- `description` opzionale per il menu pubblico (`/menu`), mostrata solo se valorizzata.
- `shortName` opzionale per uso operativo POS e stampe, con fallback `shortName || name`.
- Vincolo applicativo di unicità `shortName` per evento (case-insensitive).
- Compatibilità retroattiva con prodotti legacy senza nuovi campi.

**Issue collegata**: `#22` (chiusa).

---

## ⬜ Epica 30: Report stampe runtime + report sessione cassa

Refactoring dei report di stampa con focus su completezza informativa e leggibilità operativa.

- Nuovo schema canonico `PrintDocumentV2` per i job di stampa.
- Compatibilità legacy per i documenti job preesistenti.
- Monitor stampa runtime con anteprima e dettaglio strutturato (metadati, righe, totali, footer).
- Uniformazione layout termico per comande cliente/reparto, scontrino cassa e chiusura cassa.
- Export sessione cassa CSV/XLS con campi operativi estesi (`Totale incassi`, `Codice ordine`, `Sconto`, `Totale netto`).

**Issue collegata**: `#24` (chiusa).

---

## 🔄 Epica 31: Preparazione repository pubblico

- Esclusione di chiavi locali, directory runtime e backup dai Docker build context.
- Esclusione degli stessi percorsi dai trasferimenti generici di deploy.
- Neutralizzazione di IP, hostname e riferimenti macchina-specifici nel tree corrente.
- Audit della cronologia Git e dei metadati GitHub prima del cambio di visibilità.
- Hardening applicativo e infrastrutturale rinviato a issue dedicate.

---

## 🔄 Epica 32: Accesso remoto selettivo e autenticazione POS

- Gestione da Admin dei tunnel inversi per Menu, Admin, POS e SSH, con stato
  richiesto/applicato e avvisi di sicurezza.
- Controller del sidecar Docker che applica dinamicamente solo i forward
  abilitati.
- Autenticazione POS opzionale in LAN e obbligatoria tramite proxy remoto,
  riutilizzando le credenziali del pannello Admin.
- Configurazione documentata per listener Oracle in loopback, Caddy e accesso
  SSH tramite `ProxyJump`.

**Test E2E**: `e2e/remote_access.spec.ts`.

---

## 🔄 Issue #97: Report vendite e sconti

- Tracciamento sequenziale dei componenti sconto ordine, riga e Volontari,
  mantenendo compatibilità con gli ordini storici.
- Export evento e sessione cassa con dettaglio per categoria, prodotto e regime
  prezzo, subtotali categoria, totale generale e riepilogo monetario sconti.
- Chiusura cassa con sezioni prezzo pieno/sconti, nomi brevi e subtotali
  lordo/sconto/netto, condivisi con l'aggregato degli export.
- Compatibilità di anteprima e ristampa per i documenti di chiusura storici.

**Issue collegata**: `#97`.

---

## 🔄 Epica 33: Numerazione generica piatti

- Generalizzazione del flusso pizza per categorie con preparazione numerata,
  con un numero distinto per ogni prodotto numerato e una sequenza globale
  condivisa tra reparti.
- Etichette operative generiche in catalogo, menu pubblico, console, monitor,
  anteprime e stampe, mantenendo compatibili campi e URL storici `pizza*`.
- `PIATTO N°` ingrandito soltanto sulle copie cliente e reparto; riepilogo cassa
  privo di numero e barcode.

**Test E2E**: `e2e/admin_pizza_category.spec.ts`, `e2e/pizza_monitor_flow.spec.ts`.

---

## ✅ Epica 34: Doppia copia opzionale e numerazione per unità

- Il comportamento predefinito `Default Cassa` conserva una sola copia
  cliente per il normale ritiro self service.
- Ogni categoria può abilitare esplicitamente la stampa aggiuntiva della copia
  reparto sulla stampante cassa.
- Per i prodotti con stampa separata per unità, ogni coppia reparto/cliente
  riceve un numero piatto univoco della sequenza globale.
- Categorie e prodotti senza le nuove opzioni mantengono il routing corrente.

**Test E2E**: `e2e/category_skip_kitchen_print.spec.ts`,
`e2e/product_split_kitchen_print.spec.ts`, `e2e/pizza_monitor_flow.spec.ts`.

---

## 🔄 Epica 35: Leggibilità POS, catalogo, sessioni TEST e reportistica

- Catalogo filtrabile con ricerca smart, palette ad alto contrasto e barcode dei piatti numerati esplicitamente opt-in.
- POS più leggibile con titoli su due righe, tastiera fisica per il calcolo resto ed editor rapido delle scorte.
- Header desktop POS ampliata con menu contestuale della cassa, sconti integrati e indicatori quantità senza prefisso `x`.
- Errori di stampa raggruppati per stampante e retry atomico dei soli job falliti.
- Retry POS e ristampa dal riepilogo ordini corretti con recupero immediato dei job interrotti ed esito reale mostrato all'operatore.
- Checkout POS recuperato dopo una risposta interrotta, senza consentire una seconda contabilizzazione accidentale dell'ordine incerto.
- Sessioni TEST reversibili: incidono durante l'apertura, vengono escluse e ripristinano le scorte alla chiusura; eliminazione sicura delle sessioni chiuse.
- Riepiloghi per categoria, ristampa dalla dashboard e workbook `.xlsx` multi-sheet reali.
- Selezione di più sessioni cassa chiuse per generare un unico workbook `.xlsx` aggregato e tracciabile per postazione.

**Test principali**: unit test catalogo, scorte, stampa, transizioni sessione e workbook; flussi Playwright POS/Admin.
**Issue collegate**: `#106`, `#107`, `#116`, `#137`.

---

## Epica 36: Semplificazione del codice e dell'architettura

- Rimossi file, helper e dipendenze senza consumer verificati tramite code graph e sorgente.
- Unificati i form create/edit del catalogo mantenendo wrapper e contratti specifici dei due flussi.
- Consolidati path e URL degli upload gestiti in un solo boundary validato; eliminate le route duplicate.
- Suddivise le server action delle impostazioni per feature, senza introdurre repository layer o barrel di compatibilità.
- Sostituita la roadmap architetturale obsoleta con la descrizione dell'architettura corrente.
- Mantenuti fuori scope i refactor generalizzati di POS e stampa, da affrontare solo con slice a rischio e riduzione misurabili.

**Test principali**: unit/component test per form, autosave, upload, event transfer e settings; suite Playwright Chromium completata con 87 test passati e 7 test hardware saltati.
**Issue collegata**: `#140`.

---

## Issue GitHub #141: Scorte POS realtime

- Sincronizzazione entro pochi secondi di quantità, varianti e stato esaurito tra postazioni della stessa serata.
- SSE come segnale di invalidazione e snapshot autenticato dal database come fonte di verità.
- Carrello, categoria e cassa locale preservati durante il riallineamento.
- Fallback a polling con stato visibile e ritorno automatico al canale realtime.
- Validazione server della sovravendita invariata e ripristino coerente del flag sold-out dopo storno.

**Test E2E**: `e2e/pos_stock_realtime.spec.ts` con due contesti browser, fallback e riconnessione.
**Issue collegata**: `#141`.

---

## Issue GitHub #121: Coda persistente stampe reparto

- Il POS consente di proseguire dopo un errore di stampa reparto lasciando i
  job falliti in una coda persistente, senza perdere l'ordine contabilizzato.
- Un poller backoffice riprende automaticamente i job in ordine di creazione
  quando la stampante torna disponibile, con lease per evitare invii concorrenti.
- Il monitor stampa mostra per reparto il numero di job in attesa e il job
  accodato da più tempo.
- Il retry manuale resta disponibile; le stampe cassa e gli errori permanenti
  non vengono accodati automaticamente.
- Il ritorno online è verificato tentando il primo job reale: la sola
  connessione TCP non certifica lo stato del sensore carta.

**Test E2E**: `e2e/print_queue_recovery.spec.ts` con accodamento POS di più
ordini, ripresa automatica e verifica anti-duplicazione.
**Issue collegata**: `#121`.
