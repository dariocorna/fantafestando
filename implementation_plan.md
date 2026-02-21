# Piano di Sviluppo OSGFest

Questo documento descrive l'architettura tecnica e le fasi di sviluppo proposte per il gestionale OSGFest, formulate tramite supporto della documentazione Context7.

## 1. Stack Tecnologico Proposto

- **Framework Full-Stack**: **Next.js** (App Router) con **React** e **TypeScript**.
  - *Perché*: Permette di unire l'interfaccia ultra-veloce (POS) alle API di rete che parleranno con le stampanti (backend).
- **Styling**: **Tailwind CSS**.
  - *Perché*: Ideale per creare interfacce POS con pulsanti touch-friendly e leggibilità ottimale in ambienti serali.
- **Database**: **SQLite** + **Drizzle ORM** (Libreria Context7: `/drizzle-team/drizzle-orm`).
  - *Perché*: L'ORM moderno in TypeScript perfetto per SQLite. Leggerissimo e type-safe. Il DB locale basta e avanza per una sagra senza server dedicati.
- **Integrazione Stampanti Termiche**: **`node-thermal-printer`** (Libreria Context7: `/klemen1337/node-thermal-printer`).
  - *Perché*: Ottimo modulo Node.js identificato tramite ricerca, che supporta sintassi command-line diretta, protocollo ESC/POS e comunicazioni sia USB che di rete (per l'invio delle comande in cucina).
- **Testing**:
  - Unit Tests: **Vitest**
  - E2E Tests: **Playwright**

## 2. Fasi di Sviluppo (Approccio Agile)

Sviluppo strutturato in epiche iterabili con piccoli commit ("atomici" come richiesto in `AGENTS.md`).

### Epica 1: Fondamenta e Setup
- Inizializzazione applicazione Next.js con Tailwind.
- Configurazione Drizzle ORM e schema base (Categorie, Prodotti, Varianti).
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
> - DB SQLite (file locale rimosso ad ogni fine festa) e Drizzle ORM (invece di Prisma).
> - `node-thermal-printer` confermato per il supporto EPSON (ESC/POS) su rete e locale.
