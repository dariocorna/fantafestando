# Changelog

Tutte le modifiche rilevanti al progetto vengono annotate in questo file.

## [Unreleased]

### Added

- Sincronizzate in tempo reale le scorte tra postazioni POS della stessa serata tramite SSE, con snapshot dal database, stato del canale e fallback a polling senza azzerare carrello o selezioni.
- Aggiunta la coda persistente delle stampe reparto: il cassiere può proseguire dopo un errore, vedere i job in attesa e lasciarli reinviare automaticamente in ordine quando la stampante torna disponibile.

### Changed

- Unificati i dialog di creazione e modifica prodotto in un solo form condiviso, preservando payload e comportamento dei due flussi.
- Separati i comandi delle impostazioni per area funzionale e centralizzata la risoluzione sicura degli upload runtime.
- Riscritta la documentazione architetturale come descrizione del sistema effettivamente distribuito.

### Fixed

- Riallineato automaticamente il flag esaurito quando storni e transizioni delle sessioni cassa ripristinano una quantità positiva.
- Stabilizzato l'autosave delle immagini Easter egg anche quando il componente padre ricrea il callback di salvataggio.
- Eliminato il tracciamento indiscriminato del repository durante la build standalone degli asset gestiti.

### Removed

- Rimossi componenti, helper, route duplicate e dipendenze senza consumer.

## [0.25.0] - 2026-08-10

### Changed

- Ampliata la header desktop del POS con menu contestuale per selezione, apertura e chiusura cassa e con i preset sconto integrati; rimossi dal carrello i controlli duplicati e il conteggio reparti/prodotti.
- Semplificati gli indicatori quantità sulle card prodotto mostrando solo il numero, senza prefisso `x`.

### Fixed

- Mantenuti sempre visibili gli avvisi delle sessioni TEST e delle chiusure da ripetere; il menu cassa ora si richiude dopo un comando o un click esterno.

## [0.24.0] - 2026-08-10

### Added

- Aggiunta al POS la modalità scorte inline: le quantità si modificano direttamente nelle card catalogo, mentre carrello e operazioni di cassa restano bloccati fino all'uscita dalla modalità.
- Aggiunto alla dashboard l'export PDF professionale A4 multipagina, con KPI, pagamenti, vendite per categoria e prodotto, intervallo attivo, header, footer e numerazione pagine.

### Changed

- Spostata la selezione del prezzo volontari nell'area sconti e resa più evidente la distinzione tra prezzo pieno e scontato, lontano dal pulsante di pagamento.
- Aumentata la leggibilità del POS con quantità e prezzi del carrello più grandi e indicatori quantità più evidenti sulle card prodotto, senza ridurre i font del menu.
- Paginato lo storico ordini admin a 50 righe, mantenendo totale evento, esclusione delle sessioni TEST e URL canonici per le pagine non valide.
- Allineati i riepiloghi per categoria di PDF, CSV ed Excel tramite l'identità stabile della categoria, anche quando più categorie condividono lo stesso nome.

### Fixed

- Sostituiti i comandi rapidi scorte instabili con il salvataggio esplicito della quantità assoluta e aggiunti feedback accessibili di esito/errore.
- Associati gli errori degli intervalli dashboard ai campi data e annunciati alle tecnologie assistive; tutti gli export restano disabilitati finché l'intervallo non è valido.

## [0.23.0] - 2026-08-09

### Added

- Il POS ricorda per ogni postazione il metodo di pagamento dell'ultimo ordine completato e lo ripropone al checkout successivo.

## [0.22.2] - 2026-08-09

### Fixed

- Corretto il ripristino dei backup runtime su Docker consentendo lo staging atomico degli upload nel volume persistente.

## [0.22.1] - 2026-08-09

### Fixed

- Ripristinato il POS dopo una risposta di checkout interrotta, con esito incerto esplicito e blocco anti-duplicazione fino all'avvio sicuro di un nuovo ordine.

## [0.22.0] - 2026-08-09

### Added

- Aggiunti alla dashboard e agli export i filtri temporali condivisi con viste rapide Tempo reale, Serata corrente, Intera festa e intervallo personalizzato.
- Introdotto l'aggiornamento automatico della dashboard in modalità Tempo reale e la validazione degli intervalli locali sui cambi d'ora del fuso evento.

### Fixed

- Allineato il calcolo temporale dei report al momento effettivo di pagamento tramite `paidAt`, con fallback sugli ordini storici e propagazione del fuso orario evento in clonazione/import.
- Preservato il messaggio di esito del salvataggio policy e del backup manuale evitando refresh automatici concorrenti con l'aggiornamento locale.

## [0.21.0] - 2026-08-09

### Added

- Aggiunto alla dashboard il riepilogo espandibile dei prodotti venduti nella serata corrente, con esclusione delle sessioni TEST.

## [0.20.1] - 2026-08-09

### Fixed

- Ripristinati il retry POS dei job di stampa falliti e la ristampa dal riepilogo ordini, con esiti coerenti all'invio reale.

## [0.16.0] - 2026-07-26

### Added

- Accesso remoto selettivo (Menu, Admin, POS, SSH) governato da `/admin/settings/remote-access` e applicato dal controller del tunnel SSH.

### Security

- Superficie pubblica `menu` filtrata con allow-list: login, backoffice, console pizza, API admin/pizza/internal e endpoint di autenticazione non sono piu' raggiungibili dal container esposto su Internet.
- Invertita la logica di fiducia del POS: l'esenzione dal login vale solo per gli hostname LAN dichiarati in `POS_LAN_HOSTNAMES`, mai per un `Host` sconosciuto o per l'hostname admin.
- Bloccato `/admin` sull'hostname pubblico del POS, che raggiunge lo stesso container del backoffice.
- Endpoint di controllo `/api/internal/*` limitato ai chiamanti della rete Docker.
- Aggiunto controllo same-origin sulle chiamate API mutative autenticate via cookie.
- Rate limiting sui tentativi di login falliti e sugli endpoint pubblici (ordine, riepilogo, upload immagine).
- Riepilogo ordine pubblico protetto da token opaco per ordine invece del numero di ritiro sequenziale.
- Prezzo delle opzioni di prodotto risolto sempre lato server dalle varianti, mai dal payload del client.
- Aggiunti header di sicurezza (CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy) e rimosso `X-Powered-By`.
- Sessione ridotta a 12 ore e fallback credenziali di sviluppo attivabile solo con `AUTH_ALLOW_DEV_CREDENTIALS=true` esplicito.
- Host key del tunnel SSH pinnata (`StrictHostKeyChecking=yes` con `known_hosts` montato) al posto di `accept-new` senza stato persistente.
- Estrazione archivi di backup/import con `--no-same-owner --no-same-permissions` e limite di dimensione sugli upload.
- Aggiornate Next.js a 16.2.12, sharp a 0.35.3, `@auth/core` e mongoose alle versioni non vulnerabili.

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
