# Emulazione Stampanti Termiche (ESC/POS)

## Scopo

Questa documentazione definisce l’approccio operativo per virtualizzare stampanti ESC/POS su rete TCP, utile per:
- sviluppo locale senza hardware fisico
- test end-to-end ripetibili
- demo pratiche con anteprima ricevute in Admin

La stampa reale resta supportata senza modifiche al flusso business.

## Modalità stampante supportate

Ogni stampante avrà configurazione esplicita:
- `Host` (IP o hostname)
- `Porta TCP` (default 9100)
- `Tipo` (`CASHIER` o `KITCHEN`)
- `Virtuale` (sì/no)
- `Slot emulatore` (opzionale, 1..10, solo virtuale)

Esempi:
- Stampante reale LAN: `host=192.168.1.100`, `port=9100`
- Stampante virtuale in Docker (rete interna): `host=printer-emulator`, `port=19100`
- Stampante virtuale da host locale: `host=127.0.0.1`, `port=19100`

## Pool stampanti virtuali (10 istanze)

Per sviluppo e demo verrà predisposto un emulatore con 10 listener TCP:

| Slot | Porta |
| --- | --- |
| 1 | 19100 |
| 2 | 19101 |
| 3 | 19102 |
| 4 | 19103 |
| 5 | 19104 |
| 6 | 19105 |
| 7 | 19106 |
| 8 | 19107 |
| 9 | 19108 |
| 10 | 19109 |

I listener ricevono stream ESC/POS raw e salvano i job su volume persistente.

## Preview runtime in Admin

La vista Admin “Monitor Stampa” mostrerà:
- elenco job con stato (`QUEUED`, `HELD`, `SENT`, `FAILED`)
- destinazione (`host:port`)
- preview ricevuta renderizzata (layout operativo)
- link al dump raw ESC/POS per diagnostica

## Coda persistente delle stampe reparto

Quando una stampa su una stampante di tipo `KITCHEN` fallisce, il POS mantiene
il retry immediato e consente anche di proseguire lasciando il job nello stato
`HELD`. Il monitor Admin mostra il numero di stampe in attesa per reparto e il
momento di accodamento più vecchio.

Il poller del processo backoffice acquisisce una sola coda per stampante e
reinvia i job in ordine di creazione. Il lease persistito impedisce a poller
concorrenti di inviare contemporaneamente la stessa coda; un errore interrompe
la ripresa di quella stampante, senza bloccare le altre. La frequenza è
configurabile con `PRINTER_QUEUE_POLL_SECONDS` (30 secondi di default).

Nota tecnica:
- La preview è basata sul payload applicativo (`PrintJob.document`) normalizzato nello schema `PrintDocumentV2`.
- Il dump raw resta disponibile per controlli low-level sull’emulazione.

## Schema documento stampa (`PrintDocumentV2`)

I nuovi job salvano un payload canonico `schemaVersion: 2` con struttura stabile:
- `kind`, `printType`, `title`, `copyLabel`, `referenceCode`, `createdAt`
- `headerLines[]`
- `items[]` (qty, name, note, prezzi opzionali)
- `totals[]` (label, value, emphasis)
- `footerLines[]`
- `branding` (`logoPath`, `logoMode`)

Compatibilità:
- i job legacy restano leggibili tramite normalizzazione runtime (`totals` object -> array, mapping campi storici).
- retry e monitor supportano sia documenti legacy sia `V2`.

## Branding termico e fallback

Per i print type principali (`CUSTOMER_ORDER`, `CASHIER_SUMMARY`, `CASH_SESSION_SUMMARY`) il sistema tenta di stampare un logo PNG locale, se disponibile:
- sorgente: `settings.menuHeaderLogoUrl` evento corrente;
- path consentiti: solo `/uploads/menu-headers/*.png`;
- fallback: in caso di file assente/non valido/errore stampante, la stampa prosegue in modalità solo testo (nessun blocco del flusso cassa).

## Integrazione Docker

### Sviluppo locale
- `docker-compose.yml`: aggiunta servizio `printer-emulator` con porte `19100-19109`.
- Possibilità di provisioning automatico in Admin di 10 stampanti virtuali.

### Deploy VM
- `docker-compose.prod.yml`: servizio emulatore opzionale (profilo demo), non obbligatorio in produzione reale.
- In produzione standard si può continuare a puntare a stampanti fisiche LAN (`port=9100`).

## Riferimenti tecnici librerie

Scelta attuale:
- `node-thermal-printer` per invio ESC/POS su TCP (`tcp://host:port`), compatibile con il codice esistente.

Alternative valutate:
- `node-escpos` (architettura a adapter, valida ma richiederebbe refactor maggiore nel progetto corrente).

## Limiti e decisioni

- Non è previsto in questa epica un parser ESC/POS completo per ricostruire fedelmente ogni comando raw.
- Priorità: stabilità di sviluppo/demo, osservabilità job e assenza regressioni su stampa reale.
- Una connessione TCP accettata sulla porta della stampante non prova che la
  carta sia disponibile. Senza un protocollo di stato verificato sul modello
  fisico, il primo job reale della coda funge da sonda; non viene promessa la
  lettura del sensore carta.
- Il lease evita duplicazioni tra poller concorrenti, ma non può garantire una
  consegna exactly-once tra l'invio al socket e il salvataggio Mongo: un crash
  dopo l'invio e prima dello stato `SENT` può richiedere verifica operativa.
