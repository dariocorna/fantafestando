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
  - *Perché*: Ottimo modulo Node.js identificato tramite ricerca, che supporta sintassi command-line diretta, protocollo ESC/POS e comunicazioni sia USB che di rete (per l'invio delle comande in cucina).
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
- UI principale "Point of Sale" ottimizzata per touchscreen.
- Integrazione Lettore QRCode via WebCam: l'operatore in cassa usa la fotocamera del tablet/laptop per inquadrare lo schermo del cliente (tramite `react-qr-scanner`), senza hardware aggiuntivo.
- Carrello, gestione sconti volontari o manuali.
- Modifica o conferma dell'ordine (con campi "Autore" e "Tavolo" se configurati).

### Epica 4: WebApp Ordini Pubblica
- Creazione rotte frontend pubbliche accessibili via smartphone (es. tramite QR al tavolo).
- Interfaccia per la selezione dei prodotti e personalizzazione (varianti).
- Form di check-out cliente con richiesta Condizionale di "Nome" e "Tavolo" (secondo i settings della festa).
- Generazione stringa codificata e render del componente QRCode finale per il cassiere.

### Epica 4: Smistamento Comande e Stampanti
- Sviluppo integrato del modulo di stampa Node.js tramite `node-thermal-printer`.
- Generazione scontrino cliente cassa (USB).
- Generazione smistamento ticket reparti (TCP/LAN verso stampanti di rete per Bar, Griglia, ecc.).

### Epica 5: Statistiche Base
- Pagina per resoconti di fine giornata.

## User Review Required

> [!CAUTION]
## 4. Strategia di Deploy Multi-Festa

Per gestire più feste ci sono due vie, a seconda della rete disponibile alle sagre:

1. **Standalone Locale su RPi (Offline-First)**: Visto che dobbiamo stampare in rete locale via TCP sulle stampanti IP delle cucine, serve tendenzialmente che il server backend fisicamente "giri" sul PC in cassa (es: tramite un container Docker unico con MongoDB e l'app Next.js avviata via Docker Compose).  
  **Il "Trucco" Offline per la WebApp Clienti**:
  - *Come sincronizza il menu?* La WebApp sarà una **PWA (Progressive Web App) ospitata sul Cloud pubblico** (es. Vercel). Prima dell'inizio della festa, l'amministratore aggiorna il menù dal backend locale (RPi) ed esporta il "Menu del Giorno" verso la PWA in Cloud. I clienti che arrivano in fiera dal loro telefono 4G caricano la PWA pubblica aggiornata.
  - *Come arriva l'ordine alla cassa offline?* La magia sta nel QR Code: non contiene un semplice link, ma **l'intero ordine codificato in un JSON compresso e convertito in Base64 (Data Payload)**. Il cliente compila l'ordine sulla PWA (che a questo punto funziona persino in modalità "aereo"), clicca "Genera", e lo schermo del telefono mostra il QR Data. Alla cassa locale, l'operatore inquadra lo schermo del cliente con la **webcam del PC o tablet di cassa** (nessun hardware extra richiesto): il backend Next.js offline decodifica il JSON al volo e riempie il carrello del POS istantaneamente senza che i dispositivi condividano una rete.

2. **Cloud Backend + Local Print Node**: Se c'è sempre internet, l'app Next.js e MongoDB stanno in Cloud (es: Vercel + MongoDB Atlas), offrendo un vero portale multi-tenant unico accessibile da ovunque. Per le stampe locali, alle singole casse gira un piccolo script Node.js in background collegato in "ascolto" al cloud via Websocket, che fa da ponte verso le stampanti IP.

> [!CAUTION]
> **Scelte da Approvare:**
> - Hai preferenze sulla strategia del deploy **Standalone Locale** o **Cloud Backend + Local Print Node**? 
> - Next.js come applicazione unificata che funge sia da Backend (API x stampanti) che Frontend protetto da `NextAuth.js`.
> - MongoDB Isolation vs Multi-tenant collection design nel DB.
> - `node-thermal-printer` confermato per EPSON (ESC/POS). Per i QR: `qrcode.react` (creazione lato cliente) e `react-qr-scanner` (lettura via webcam in cassa).
