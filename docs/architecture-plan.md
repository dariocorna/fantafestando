# Architettura di FantaFestando

Questo documento descrive l'architettura effettivamente presente nel
repository. La roadmap funzionale e lo stato delle epiche sono mantenuti in
[`EPICS.md`](EPICS.md).

## Stack applicativo

- Next.js App Router, React e TypeScript per pagine, route HTTP e server
  action.
- MongoDB con Mongoose per la persistenza locale.
- Tailwind CSS e componenti Radix per l'interfaccia.
- `node-thermal-printer` per l'invio ESC/POS alle stampanti di rete.
- Vitest per i test unitari e Playwright per i flussi end-to-end.

L'evento è la radice dei dati operativi: catalogo, postazioni POS, stampanti,
periferiche, ordini, sessioni cassa e job di stampa sono associati a un evento.
Le operazioni devono sempre conservare questo confine.

## Confini del codice

### `src/app`

Contiene i boundary Next.js:

- pagine e layout;
- route HTTP;
- server action vicine alla feature che le invoca;
- componenti client specifici di una singola route.

Una page o una route può leggere direttamente un model per una query semplice
e server-only. Le orchestrazioni condivise, le transazioni con più entità e le
trasformazioni riutilizzate non devono essere duplicate nei boundary.

### `src/components`

Contiene componenti usati da più pagine o feature. Un componente usato da una
sola route resta vicino alla route proprietaria; non viene spostato qui solo
per separare fisicamente un file grande.

### `src/lib`

Contiene logica di dominio e infrastruttura condivisa da più consumer, tra cui
stampa, report, backup, trasferimento eventi, autenticazione e integrazioni.
Un modulo condiviso viene introdotto solo quando elimina duplicazioni reali o
offre un unico boundary di sicurezza e consistenza.

### `src/models`

Contiene schemi e modelli Mongoose. I model descrivono la persistenza; le
orchestrazioni applicative non devono accumularsi negli schema.

Non esiste un repository layer universale: aggiungere un wrapper a ogni
chiamata Mongoose aumenterebbe il numero di livelli senza ridurre la
complessità. I servizi sono mirati ai flussi che ne hanno bisogno.

## Flussi principali

### Catalogo e menu

L'amministrazione gestisce categorie, prodotti, varianti e disponibilità per
evento. POS e menu pubblico ricevono viste coerenti dello stesso catalogo, con
filtri diversi per il rispettivo canale.

### Ordini e cassa

Il server è la fonte di verità per prezzi, disponibilità e transizioni degli
ordini. Il POS compone il carrello e invoca server action che validano di nuovo
i dati, aggiornano scorte e sessione cassa e registrano l'esito del pagamento.
Gli ordini pendenti del menu pubblico vengono chiusi dallo stesso dominio
operativo del POS.

### Stampa

`PrinterService` mantiene la facade usata dalle action e dalle route. Il
routing genera job persistiti e li invia alle stampanti cassa o reparto. Stato
del job, retry e ristampa devono restare osservabili: una risposta HTTP non è
di per sé prova che una stampa fisica sia riuscita.

### Upload gestiti

Le intestazioni menu/ricevuta e le immagini Easter egg sono file runtime
persistenti. Path filesystem e URL pubbliche devono essere risolti da un solo
boundary con bucket consentiti e validazione dei segmenti; route, stampa e
trasferimento evento usano la stessa regola. Backup e ripristino preservano
invece l'intera directory runtime `public/uploads`.

## Runtime di produzione

`docker-compose.prod.yml` esegue:

- MongoDB con volume persistente;
- due istanze della stessa immagine Next.js:
  - `fantafestando-backoffice` per amministrazione e POS;
  - `fantafestando-menu` per la superficie pubblica filtrata;
- l'emulatore stampanti nel profilo `demo`;
- il controller dei tunnel remoti nel profilo `oracle-tunnel`.

Il mount `public` contiene anche gli upload runtime e non viene sostituito da
un normale rebuild dell'immagine. Backup, restore e deploy devono preservare i
volumi e verificare separatamente le superfici backoffice e menu.

## Vincoli di evoluzione

- Nessun cambio di schema o contratto pubblico implicito dentro un refactor.
- Preferire cancellazione e consolidamento alla creazione di nuovi livelli.
- Conservare i fallback legacy quando rappresentano dati persistiti già in
  uso; rimuoverli solo con una migrazione esplicita.
- Interrogare il code graph prima di modifiche e review, poi verificare le
  conclusioni sul sorgente e sui test.
- Una feature UI richiede test unitari per la logica introdotta e Playwright
  per i flussi principali.
- La suite Chromium completa resta il gate prima della pubblicazione.
