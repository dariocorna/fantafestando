# Changelog

Tutte le modifiche rilevanti al progetto vengono annotate in questo file.

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
