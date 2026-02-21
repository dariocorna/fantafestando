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

### 1. Interfaccia "Backend/Manager"
Quest'area (*Dashboard Amministrativa*) sarà protetta da **NextAuth.js**.
- Layout classico a Sidebar sinistro + Contenuto centrale.
- Si occuperà del setup per il giorno corrente: Inserimento Prodotti, definizione Prezzi, Varianti e creazione della singola entità "Festa" (attivando i toggle "Nome" e "Tavolo" per la WebApp Web).
- La UI qui può usare i classici Data Table densi (Tabelle Radix UI), filtri e form tradizionali. La visibilità fine non è una priorità come per il POS.
- Dashboard riassuntiva incassi a fine giornata.

### 2. Interfaccia "Point of Sale" (Vista Cassiere)
Quest'area, anch'essa sotto login o PIN, è il core operativo:
- La cassa deve ricordare il layout dei moderni registratori di cassa touch o dei chioschi McDonald's:
- **Griglia Prodotti**: I prodotti devono essere visualizzati come grosse Card "quadrate" (min. `min-h-32 min-w-32`) facili da colpire ("fat-finger friendly").
- **Codici Colori Semantici**: 
  - *Verde* (es. `bg-emerald-600`) per le bevande.
  - *Rosso/Arancio* (`bg-orange-500`) per la griglieria.
  - *Giallo* per stuzzicheria (Patatine).
- **Carrello Fisso Laterale**: Un pannello congelato su un lato (su schermi larghi come Laptop) oppure uno "sticky footer" con un `Drawer` a scorrimento (su Tablet). Contiene la lista degli **"Ordini Pendenti"** presi dal Cloud.
- **Varianti**: Quando l'operatore clicca un prodotto che ammette varianti, si apre istantaneamente un *Dialog modale* centrale, con bottoni a forma di grandi interruttori "Toggle".

### 3. Interfaccia WebApp Remota (PWA Clienti)
- Ottimizzata per formato **Verticale** (Mobile-first).
- **Stile Visivo (Deliveroo-Like)**: Le app di food delivery sono lo standard aureo per l'ordinazione. Useremo lo stesso paradigma:
  - *Product Cards orizzontali*: Immagine quadrata smussata a sinistra, titolo in grassetto e descrizione compatta a destra, con il bottone "+" in basso a destra.
  - *Navigazione fluida*: Una singola pagina che scrolla attraverso le categorie (es. Griglia, Bar, Dolci) con un Header "Sticky" che evidenzia la categoria attiva.
  - *Bottom Bar (Carrello)*: Una barra inferiore sempre visibile ("Sticky Footer") con un pulsante primario largo, di un colore sgargiante (es. verde smeraldo o teal vibrante) riportante il totale provvisorio e "Vai al Carrello".
- Checkout in 3 step chiari e rassicuranti:
  1. *Riepilogo Carrello* (modale a scorrimento dal basso).
  2. *Dati Anagrafici (se richiesti)* - Nome, Tavolo.
  3. *Schermata di Conferma*: Display luminoso a pieno schermo con il **Codice Breve** a lettere cubitali (es. **D45**) e istruzioni chiare per la Cassa.
- Checkout in 3 step chiari e rassicuranti:
  1. *Riepilogo Carrello*.
  2. *Dati Anagrafici (se richiesti)* - Nome, Tavolo.
  3. *Il tuo Ordine è pronto!* - Display luminoso a pieno schermo con il **QR Code gigante e un Codice Breve** a lettere cubitali (es. **D45**) da mostrare al cassiere.

### 3. Palette e Dark Mode
Essendo sagre serali, la UI di default del POS Cassa dovrebbe preferire una **Dark Theme** (`bg-slate-900`) con accent color ad alto contrasto. I bottoni di Azione Primaria ("[ PAGA ]") devono estendersi per tutta la larghezza del carrello (`w-full`) ed essere evidenti. L'app pubblica Web per il cliente, invece, rileverà il tema (chiaro/scuro) del suo sistema operativo.
