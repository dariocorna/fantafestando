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
- elenco job con stato (`SENT`, `FAILED`)
- destinazione (`host:port`)
- preview ricevuta renderizzata (layout demo)
- link al dump raw ESC/POS per diagnostica

Nota tecnica:
- La preview sarà basata sul payload applicativo (`PrintJob.document`) per affidabilità e semplicità.
- Il dump raw resta disponibile per controlli low-level sull’emulazione.

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
