# Piano di Sviluppo OSGFest

Questo documento descrive l'architettura tecnica e le fasi di sviluppo proposte per il gestionale OSGFest, formulate tramite supporto della documentazione Context7.

## 1. Stack Tecnologico Proposto

- **Framework Full-Stack**: **Next.js** (App Router) con **React** e **TypeScript**.
  - *Perché*: Permette di unire l'interfaccia ultra-veloce (POS) alle API di rete che parleranno con le stampanti (backend).
- **Styling**: **Tailwind CSS**.
  - *Perché*: Ideale per creare interfacce POS con pulsanti touch-friendly e leggibilità ottimale in ambienti serali.
- **Autenticazione Backend**: **NextAuth.js (Auth.js)** (Libreria Context7: `/nextauthjs/next-auth`).
  - *Perché*: Lo standard per gestire in modo sicuro e plug-and-play le sessioni di login degli amministratori su Next.js.
- **Database Multitenant**: **MongoDB** ospitato in container **Docker**, con **Mongoose** (o driver nativo) su Node.
  - *Perché*: Approccio eccellente per un'architettura a microservizi pulita e scalabile. I dati non strutturati si sposano bene con lo schema flessibile di un DB documentale. Inoltre le collection MongoDB filtrabili per `festaId` offrono una struttura multi-tenant perfetta.
- **Integrazione Stampanti Termiche**: **`node-thermal-printer`** (Libreria Context7: `/klemen1337/node-thermal-printer`).
  - *Perché*: Ottimo modulo Node.js identificato tramite ricerca, in grado di comunicare in rete locale (TCP/IP via Ethernet o WiFi) con tutte le stampanti (cassa e reparti) usando il protocollo ESC/POS.
- **Testing**:
  - Unit Tests: **Vitest**
  - E2E Tests: **Playwright**

## 2. Fasi di Sviluppo (Approccio Agile)

Sviluppo strutturato in epiche iterabili con piccoli commit ("atomici" come richiesto in `AGENTS.md`).

### Epica 1: Fondamenta, Autenticazione e Setup
- Inizializzazione applicazione Next.js con Tailwind.
- Startup file `docker-compose.yml` per MongoDB locale.
- Configurazione NextAuth per il login amministrativo protetto.
- Configurazione Mongoose e schema base Multi-tenant (Feste, Categorie, Prodotti, Varianti).
- Schema "Impostazioni Festa" (es. abilitazione campi opzionali Nome e Tavolo).
- Setup libreria QRCode (`qrcode.react`) e strumenti Testing.

### Epica 2: Catalogo e Menù
- API + UI per la gestione del Menu e Varianti (es. "Senza Cipolla", "Doppio").
- UI base gestione prodotti e prezzi.

### Epica 3: L'Interfaccia POS (Cassa)
- UI principale "Point of Sale" ottimizzata per touchscreen (Dati e incassi salvati Localmente).
- Integrazione Sincronizzazione "Ordini Pendenti" dal Cloud via API (fetch pre-ordini WebApp).
- Interfaccia rapida di selezione ordine pendente o inserimento Codice Breve/QR identificativo.
- Carrello, gestione sconti volontari o manuali.
- Modifica o conferma dell'ordine (con campi "Autore" e "Tavolo" se configurati).

### Epica 4: WebApp Ordini Pubblica (in Cloud)
- Portale esposto pubblicamente in Cloud (Vercel) su database MongoDB Cloud separato (Bucket).
- Interfaccia per la selezione dei prodotti e personalizzazione (varianti).
- Form di check-out cliente con richiesta Condizionale di "Nome" e "Tavolo" (secondo i settings della festa).
- Generazione nel Cloud dell'ordine "Provvisorio" e visualizzazione al cliente di un Codice Breve Formattato (e relativo QR minimale identificativo) da comunicare in Cassa.

### Epica 5: Smistamento Comande e Stampanti (solo Rete)
- Sviluppo integrato del modulo di stampa Node.js tramite `node-thermal-printer`.
- Generazione scontrino cliente cassa (invio a stampante IP di cassa).
- Generazione smistamento ticket reparti (invio a stampanti IP per Bar, Griglia, ecc. via TCP/LAN).

### Epica 5: Statistiche Base
- Pagina per resoconti di fine giornata.

## User Review Required

> [!CAUTION]
## 4. Strategia di Deploy Multi-Festa

## 4. Strategia di Deploy Definitiva: Standalone Locale Ibrido

Su indicazione del cliente, l'architettura scelta per il deploy alle feste è un ibrido che mira a **isolare i dati sensibili di incasso localmente, sfruttando il Cloud solo per raccogliere i clienti**:

- **Il Backend Cassa Locale (RPi o PC cassa)** gestisce gli ordini "saldati", lo storico incassi e parla fisicamente TCP sulle reti WiFi/Ethernet con le stampanti di cucina e barra. 
- **Il Portale Web PWA Cloud (es. Vercel + DB Mongo Atlas Bucket)** fornisce il menu pubblico ai cellulari dei clienti (anche sotto rete 4G esterna alla fiera) e genera "Ordini Provvisori Pendenti" sul db in cloud assegnando un *Codice Breve*.
- **Sincronizzazione Unidirezionale in Cassa**: Il POS locale interroga periodicamente il DB in Cloud. Il cassiere aggancia l'ordine pendente e, una volta saldato, questo viene salvato *esclusivamente* sul DB Locale, mentre viene purgato dal Cloud. Partono infine le stampe IP locali in cucina.

*Documento Approvato - Architettura Definitiva*.
