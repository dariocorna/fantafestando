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
- Configurazione Mongoose e schema base (Categorie, Prodotti, Varianti).
- Setup librerie di Testing base.

### Epica 2: Catalogo e Menù
- API + UI per la gestione del Menu e Varianti (es. "Senza Cipolla", "Doppio").
- UI base gestione prodotti e prezzi.

### Epica 3: L'Interfaccia POS (Cassa)
- UI principale "Point of Sale" ottimizzata per touchscreen.
- Carrello, gestione sconti volontari o manuali.
- Chiusura dell'ordine.

### Epica 4: Smistamento Comande e Stampanti
- Sviluppo integrato del modulo di stampa Node.js tramite `node-thermal-printer`.
- Generazione scontrino cliente cassa (USB).
- Generazione smistamento ticket reparti (TCP/LAN verso stampanti di rete per Bar, Griglia, ecc.).

### Epica 5: Statistiche Base
- Pagina per resoconti di fine giornata.

## User Review Required

> [!CAUTION]
> **Scelte da Approvare:**
> - Next.js come applicazione unificata che funge sia da Backend (API x stampanti) che Frontend (Cassa POS).
> - MongoDB su Docker isolato e gestito tramite Mongoose, per flessibilità sullo schema varianti.
> - `node-thermal-printer` confermato per il supporto EPSON (ESC/POS) su rete e locale.
