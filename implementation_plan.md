# Implementation Plan — Epic 17: Emulazione Stampanti Termiche

## 1. Obiettivo e vincoli

Obiettivo: introdurre una modalità di emulazione stampanti ESC/POS via rete LAN (TCP) per sviluppo, test e demo, mantenendo invariato il flusso di stampa reale in produzione.

Vincoli confermati:
- Stack backend attuale: Next.js + Node.js/TypeScript.
- Libreria stampa reale già in uso: `node-thermal-printer`.
- Le stampanti emulabili devono essere configurabili da Admin come quelle reali.
- Servono fino a 10 stampanti virtuali avviabili con Docker.
- Serve una vista Admin runtime per vedere le ricevute renderizzate (uso demo), oltre alla diagnostica tecnica.
- Test E2E da eseguire su porta dedicata (`PLAYWRIGHT_PORT`) per evitare conflitti con altre sessioni.

## 2. Analisi integrazione con codice esistente

Stato attuale:
- `src/lib/printer.ts` invia stampa via `node-thermal-printer` su `tcp://<ip>`.
- Il modello `Printer` (`src/models/Printer.ts`) salva `ip` ma non `port`.
- La UI hardware (`/admin/settings/hardware`) gestisce nome, IP e tipo (`CASHIER | KITCHEN`).
- Non esiste un archivio storico dei job di stampa né una preview admin.

Impatto:
- Per supportare emulatori multipli serve separare host e porta.
- Per la preview runtime serve persistere i metadati del job e un payload renderizzabile.
- La pipeline di stampa va resa osservabile senza rompere il comportamento attuale.

## 3. Scelte architetturali

### 3.1 Libreria e trasporto di stampa
- Mantenere `node-thermal-printer` come driver principale (coerenza con codice e stampa reale).
- Estendere il transport a `tcp://<host>:<port>` con default `9100`.

### 3.2 Modello dati stampanti
- Estendere `Printer` con:
  - `port: number` (default `9100`)
  - `isVirtual: boolean` (default `false`)
  - `emulatorSlot?: number` (1..10, opzionale)
- Compatibilità retroattiva:
  - stampanti esistenti migrate con `port=9100`, `isVirtual=false`.

### 3.3 Tracciamento e preview dei job
- Introdurre un nuovo modello `PrintJob` per audit/preview:
  - `eventId`, `printerId`, `orderId?`, `source` (`ORDER`, `CASH_SESSION`, `MANUAL_TEST`)
  - `status` (`QUEUED`, `SENT`, `FAILED`)
  - `destinationHost`, `destinationPort`, `isVirtual`
  - `document` (payload strutturato per rendering UI)
  - `rawCapturePath?` (dump ESC/POS catturato dall’emulatore)
  - `errorMessage?`, `createdAt`
- La preview Admin userà `document` (non parsing raw ESC/POS in tempo reale).
- I dump raw restano disponibili per diagnostica tecnica.

### 3.4 Emulatore Docker
- Aggiungere un servizio `printer-emulator` (Node TCP server) con 10 listener.
- Range porte proposto: `19100-19109` (evita conflitti con 9100 fisica).
- Ogni listener salva il buffer raw ricevuto su volume persistente.
- Output minimo dell’emulatore:
  - file `.bin` raw per job
  - metadati (`printerSlot`, timestamp, bytes)
- In compose produzione, emulatore opzionale via profilo `demo`.

## 4. Modelli/schema, API/actions, UI

### 4.1 Modelli/Schema
1. Aggiornare `Printer` con i nuovi campi (`port`, `isVirtual`, `emulatorSlot`).
2. Creare `PrintJob` per tracking e preview.
3. Script di migrazione dati stampanti legacy (`port=9100`).

### 4.2 API/Actions
1. Aggiornare `createPrinterAction` / `updatePrinterAction` con validazioni:
   - host non vuoto
   - porta numerica 1..65535
   - `emulatorSlot` coerente quando `isVirtual=true`
2. Nuova action admin: `provisionVirtualPrintersAction`:
   - crea/aggiorna 10 stampanti virtuali per evento.
3. Nuove API admin:
   - `GET /api/admin/print-jobs` (filtri per stampante/stato/intervallo temporale)
   - `GET /api/admin/print-jobs/:id` (dettaglio + preview)
4. Aggiornare `PrinterService`:
   - risoluzione destinazione `host:port`
   - persistenza `PrintJob` in ogni invio
   - stato `FAILED` con errore connessione.

### 4.3 UI Admin
1. Hardware:
   - aggiungere campi `Porta TCP`, `Stampante virtuale`, `Slot emulatore`.
   - bottone “Provisiona 10 stampanti virtuali”.
2. Nuova pagina Admin “Monitor Stampa”:
   - elenco job in tempo reale (polling breve).
   - dettaglio con preview ricevuta renderizzata.
   - badge stato (`SENT` / `FAILED`) e destinazione (`host:port`).

## 5. Strategia di test

### 5.1 Test unitari
- Validazione input stampanti (`host/porta/slot`).
- Serializzazione `PrintJob.document`.
- Mapping destinazioni reali vs virtuali.

### 5.2 Test integrazione backend
- `PrinterService`:
  - successo connessione verso emulatore TCP.
  - errore connessione con marcatura `FAILED`.
- API `print-jobs`:
  - filtri e ordinamento.

### 5.3 Test E2E Playwright
- Estendere `e2e/hardware.spec.ts`:
  - creazione/modifica stampante con porta + virtual flag.
  - provisioning 10 virtual printers.
- Nuovo spec `e2e/printer_emulation.spec.ts`:
  - genera ordine (menu/POS), verifica creazione `PrintJob`.
  - verifica comparsa preview in pagina monitor.
  - verifica stato errore quando stampante non raggiungibile.
- Esecuzione finale:
  - `PLAYWRIGHT_PORT=3400 CI=true npx playwright test --project=chromium`

## 6. Piano di esecuzione (Fase 3)

1. Estendere schema `Printer` e azioni admin.
2. Implementare `PrintJob` e logging nel `PrinterService`.
3. Implementare servizio `printer-emulator` + integrazione Docker.
4. Implementare UI monitor stampa con preview runtime.
5. Scrivere/aggiornare test unitari.
6. Scrivere test E2E dedicati.
7. Eseguire suite E2E completa su porta dedicata.
8. Fermarsi per approvazione utente prima dei commit.

## 7. Rischi e mitigazioni

- Rischio: divergenza tra preview e output fisico ESC/POS.
  - Mitigazione: preview basata su payload applicativo + dump raw allegato.
- Rischio: crescita storage per raw capture.
  - Mitigazione: retention configurabile (es. ultimi N giorni/job).
- Rischio: conflitti porte in ambienti condivisi.
  - Mitigazione: range dedicato 19100-19109 e variabili env configurabili.
- Rischio: regressioni su stampa reale.
  - Mitigazione: default invariato (`port=9100`, `isVirtual=false`) + test regressione.

## 8. Deliverable dell’epica

- Estensione modello stampanti con host/porta/modalità virtuale.
- Servizio emulatore Docker con 10 endpoint TCP.
- Tracciamento persistente `PrintJob` con stati ed errori.
- Nuova vista Admin “Monitor Stampa” con preview runtime.
- Test unitari + E2E Playwright passing.
