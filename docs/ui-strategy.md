# UI & UX Strategy per OSGFest

Il sistema verrà utilizzato principalmente da volontari in un ambiente caotico e spesso poco illuminato (sagre serali all'aperto). Pertanto l'interfaccia deve essere **resistente agli errori umani**, **estremamente chiara** e pensata per un input tattile rapido.

## Framework UI Scelto: `shadcn/ui` + Tailwind CSS
Non utilizzeremo template a pagamento monolitici chiusi, ma lo stack più flessibile e moderno del momento nell'ecosistema Next.js.

**Perché `shadcn/ui`?**
- Non è una libreria da installare (`npm install...`), ma un set di componenti React (scritti con Tailwind e Radix UI) di cui si fa *copia-incolla* nel progetto tramite CLI. 
- Permette di modificare il codice sorgente di ogni sinolo bottone o input direttamente nel progetto.
- Offre i fondamentali accessibili e touch-ready: **Dialogs** (modali full-screen perfetti per il carrello), **Drawer**, **Toast** (notifiche di errore) e **Cards** espandibili interattive per i prodotti.
- Ha il supporto nativo alla **Dark Mode** essenziale per non accecare gli operatori di notte.

## Linee Guida UX (User Experience)

### 1. Interfaccia Punto Cassa (Il POS)
La cassa deve ricordare il layout dei moderni registratori di cassa touch o dei chioschi McDonald's:
- **Griglia Prodotti**: I prodotti devono essere visualizzati come grosse Card "quadrate" (min. `min-h-32 min-w-32`) facili da colpire ("fat-finger friendly").
- **Codici Colori Semantici**: 
  - *Verde* (es. `bg-emerald-600`) per le bevande.
  - *Rosso/Arancio* (`bg-orange-500`) per la griglieria (es. Casoncelli, Costine).
  - *Giallo* per stuzzicheria (Patatine).
  Questo accelera enormemente l'orientamento visivo rispetto alla sola lettura del testo.
- **Carrello Fisso Laterale (o Inferiore)**: Il carrello deve essere un pannello congelato su un lato (su schermi larghi come Laptop) oppure uno "sticky footer" con un `Drawer` a scorrimento (su Tablet).
- **Varianti**: Quando l'operatore clicca un prodotto che ammette varianti, deve aprirsi istantaneamente un *Dialog modale* centrale, in cui i bottoni delle varianti ("Ben Cotto", "Senza Patatine") siano a forma di grandi interruttori "Toggle".

### 2. Interfaccia WebApp Remota (PWA Clienti)
- Ottimizzata per formato **Verticale** (Mobile-first).
- Una singola pagina "Infinita" che mostra in sequenza le Categorie, scrollando fluidamente giù.
- Checkout in 3 step chiari e rassicuranti:
  1. *Riepilogo Carrello*.
  2. *Dati Anagrafici (se richiesti)* - Nome, Tavolo.
  3. *Il tuo Ordine è pronto!* - Display luminoso a pieno schermo con il **QR Code gigante e un Codice Breve** a lettere cubitali (es. **D45**) da mostrare al cassiere.

### 3. Palette e Dark Mode
Essendo sagre serali, la UI di default del POS Cassa dovrebbe preferire una **Dark Theme** (`bg-slate-900`) con accent color ad alto contrasto. I bottoni di Azione Primaria ("[ PAGA ]") devono estendersi per tutta la larghezza del carrello (`w-full`) ed essere evidenti. L'app pubblica Web per il cliente, invece, rileverà il tema (chiaro/scuro) del suo sistema operativo.
