# Piano di Sviluppo OSGFest

Questo documento descrive l'architettura tecnica e le fasi di sviluppo proposte per il gestionale OSGFest, formulate tramite supporto della documentazione Context7.

## 1. Stack Tecnologico Proposto

- **Framework Full-Stack**: **Next.js** (App Router) con **React** e **TypeScript**.
  - *Perché*: Permette di unire l'interfaccia ultra-veloce (POS) alle API di rete che parleranno con le stampanti (backend).
- **Styling**: **Tailwind CSS**.
  - *Perché*: Ideale per creare interfacce POS con pulsanti touch-friendly e leggibilità ottimale in ambienti serali.
- **Database**: **MongoDB** ospitato in container **Docker**, con **Mongoose** (o driver nativo) su Node.
  - *Perché*: Approccio eccellente per un'architettura a microservizi pulita e scalabile. I dati non strutturati (es. comande libere, array dinamici di varianti) si sposano perfettamente con lo schema flessibile di un DB documentale. Isolarlo in Docker previene conflitti ambientali sul PC locale e velocizza il deploy sulla macchina target della sagra.
- **Integrazione Stampanti Termiche**: **`node-thermal-printer`** (Libreria Context7: `/klemen1337/node-thermal-printer`).
  - *Perché*: Ottimo modulo Node.js identificato tramite ricerca, che supporta sintassi command-line diretta, protocollo ESC/POS e comunicazioni sia USB che di rete (per l'invio delle comande in cucina).
- **Testing**:
  - Unit Tests: **Vitest**
  - E2E Tests: **Playwright**

## 2. Fasi di Sviluppo (Approccio Agile)

Sviluppo strutturato in epiche iterabili con piccoli commit ("atomici" come richiesto in `AGENTS.md`).

### Epica 1: Fondamenta e Setup
- Inizializzazione applicazione Next.js con Tailwind.
- Startup file `docker-compose.yml` per MongoDB locale.
- Configurazione Mongoose e schema base (Feste, Categorie, Prodotti, Varianti).
- Schema "Impostazioni Festa" (es. per attivare obbligatoriamente i campi Nome e Tavolo).
- Setup libreria QRCode (`qrcode.react`) e strumenti Testing.

### Epica 2: Catalogo e Menù
- API + UI per la gestione del Menu e Varianti (es. "Senza Cipolla", "Doppio").
- UI base gestione prodotti e prezzi.

### Epica 3: L'Interfaccia POS (Cassa)
- UI principale "Point of Sale" ottimizzata per touchscreen.
- Scanner QRCode per il caricamento di un pre-ordine generato dal cliente.
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
> **Scelte da Approvare:**
> - Next.js come applicazione unificata che funge sia da Backend (API x stampanti) che Frontend (Cassa POS e **App Pubblica**).
> - La comunicazione App Pubblica -> Cassa avviene esclusivamente **offline** tramite QRCode, o i dispositivi cliente dovranno essere collegati al WiFi della festa? Presumo offline via QR code come richiesto, dove la stringa del QR contiene l'intero ordine codificato (JSON zippato o base64).
> - MongoDB su Docker isolato e gestito tramite Mongoose, per flessibilità sullo schema varianti e sulle impostazioni variabili della festa.
> - `node-thermal-printer` confermato per EPSON (ESC/POS) e `qrcode.react` per la generazione a schermo del cliente.
