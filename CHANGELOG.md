# Changelog

Tutte le modifiche rilevanti al progetto vengono annotate in questo file.

## [0.15.3] - 2026-07-19

### Security

- Protetti gli endpoint amministrativi dei job di stampa e l'esportazione dei report cassa con verifica esplicita della sessione admin.
- Limitati i dati esposti dall'inizializzazione del menu pubblico ai soli campi necessari.
- Aggiornate Next.js e le dipendenze transitive vulnerabili.

### Fixed

- Resa atomica e idempotente la gestione dei webhook SumUp concorrenti, evitando doppie mutazioni delle scorte.
- Impedita la creazione di ordini per feste archiviate e completata la cancellazione dei dati operativi collegati a una festa.
- Eliminati mismatch di hydration nelle viste responsive e nel riepilogo ordine pubblico.
- Stabilizzata l'apertura dei dialog hardware durante l'hydration e aggiornate le opzioni Mongoose deprecate.

## [0.15.2] - 2026-07-18

### Fixed

- POS: mantenuta la base residua corretta quando vengono applicati più sconti percentuali.
- POS: preservate le note cucina quando si modificano i dettagli di un ordine pendente.
- Test E2E: completata la pulizia di sessioni cassa e job di stampa.

## [0.15.1] - 2026-07-18

### Fixed

- POS: corretto il layout del riepilogo carrello e del checkout con tastierino su desktop, tablet e mobile.

## [0.15.0] - 2026-06-30

### Added

- POS: aggiunto calcolo resto nel pagamento contanti con importo ricevuto, tasti rapidi e tastierino manuale espandibile.

### Changed

- Checkout POS ampliato su desktop con colonna laterale per il calcolo resto, riducendo lo scroll nel modal.

## [0.14.0] - 2026-06-29

### Added

- POS: aggiunto modal di contesto per personalizzare una singola unità del carrello con variazioni ingredienti, nota libera e stampa comanda separata.
- POS: aggiunta stampa immediata degli ingredienti del prodotto sulla stampante della cassa.

## [0.13.1] - 2026-06-24

### Changed

- POS: il layout compatto raggruppa categorie brevi nella stessa colonna per una griglia piu' omogenea.

### Fixed

- L'endpoint `/api/health` ora legge i metadati release runtime invece di esporre valori prerenderizzati.

## [0.13.0] - 2026-06-23

### Added

- POS: aggiunta modalità volontari con prezzi alternativi configurabili sulle voci di catalogo e audit dello sconto sulle righe ordine.

## [0.12.3] - 2026-06-23

### Added

- POS: le card prodotto mostrano la quantità già nel carrello e permettono di decrementare una unità con tasto destro, tastiera o controllo touch `-1`.

### Changed

- Migliorata la leggibilità delle card POS su touch e layout compatti quando quantità, scorte e controlli di decremento sono visibili insieme.

## [0.12.2] - 2026-05-27

### Changed

- POS responsive ottimizzato anche per tablet portrait, usando il layout touch fino a 1024px.
- Carrello POS più rapido da correggere con stepper quantità e azioni di rimozione più accessibili.
- Sconti rapidi POS resi idempotenti per evitare doppie applicazioni accidentali.

### Fixed

- Caricamento ordini pendenti protetto da conferma quando esiste già una bozza di carrello, cliente o tavolo.
- Dialog apertura e chiusura cassa resi scrollabili su viewport bassi e tastiere mobile.
- Migliorata l'accessibilità di campi codice ordine, metodi pagamento, categorie, selezione POS e messaggi di blocco tavolo obbligatorio.
- Stabilizzati i test unitari di import festa evitando il parsing multipart reale in ambiente Node/Undici.

## [0.12.0] - 2026-03-25

### Added

- Nuova area admin `/admin/settings/backups` per configurare backup periodici, scegliere una destinazione host o USB, scaricare un backup manuale e caricare un bundle per il restore.
- Nuovo formato di backup runtime con bundle `tar.gz` che include dump delle collection applicative, `public/uploads` e metadati di release, con relativi script `backup:runtime` e `restore:runtime`.
- Nuovo export/import della singola festa dall'admin, con trasferimento di configurazione evento, categorie, prodotti, stampanti, periferiche, casse e asset gestiti.

### Changed

- Il deploy Raspberry ora costruisce le immagini `linux/arm64` fuori dal target, trasferisce via SSH solo le immagini finali e riduce l'accumulo di cache Docker sulla SD.
- I deploy Docker applicano cleanup post-deploy, tagging `-dirty` da working tree sporco e rotazione log per contenere occupazione disco e tracciabilità release.
- Il job di backup periodico viene inizializzato all'avvio del processo backoffice tramite instrumentation server-side, senza dipendere solo dall'endpoint health.

### Notes

- L'import della singola festa crea sempre una nuova festa inattiva e non include ordini, sessioni cassa, print job o storico operativo.
