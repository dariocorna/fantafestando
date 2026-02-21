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
Quest'area (*Dashboard Amministrativa*) sarà protetta da **NextAuth.js** ed è pensata per l'uso "da scrivania" (Desktop-first).
- **Layout di Riferimento**: Design pulito e denso tipico delle dashboard Vercel/shadcn. 
  - *Sidebar laterale scura* per la navigazione principale (Menu, Feste, Impostazioni, Analytics).
  - *Header bianco* in alto con Breadcrumb per sapere sempre dove ci si trova (es. `Dashboard > Menu > Prodotti`).
- **Data Denseness**: Si occuperà del setup per il giorno corrente e dello storico. Utilizzeremo le classiche **Data Table di shadcn** interattive: righe dense, filtri, paginazione e un bottone globale primario `[+ Aggiungi Prodotto]` chiaramente visibile in alto a sinistra del contenuto.
- **Form Modali**: L'inserimento dati per listini, varianti e configurazione Feste (toggle "Nome" e "Tavolo") avverrà tramite eleganti maschere *Sheet* (pannelli laterali a scorrimento) o *Form Dialogs* in overlay, per non perdere mail il contesto della tabella sottostante.
- Dashboard riassuntiva incassi a fine giornata con grafici basilari (`recharts`).

### 2. Interfaccia "Point of Sale" (Vista Cassiere)
Quest'area, anch'essa sotto login o PIN, è il core operativo:
- **Tastiera Mirata (Keyboard on-demand)**: Il nucleo della spesa è gestito puramente al tocco (le card prodotto). La tastiera a schermo apparirà o sarà usata **solo ed esclusivamente** quando si deve fare una ricerca esplicita (es. cercare il Codice Breve di un Ordine Cloud), o quando si compila l'anagrafica cliente (Nome).
- **Selezione Rapida Tavoli**: Per evitare l'inserimento manuale lento, i Tavoli disponibili saranno pre-caricati dal backend. La UI mostrerà un "Picker" a bottoni (es. T1, T2, Panca1). Cliccandoci, si seleziona. Resterà comunque disponibile un bottone "+ Custom" per aprire la tastiera nei casi anomali.
- **Personalizzazione Testuale Piatti**: Quando si apre il modale della singola variante prodotto, l'operatore avrà la facoltà di inserire un Nome/Nota custom tramite tastiera (es. "Senza sale per la bimba"). Questa stringa testuale custom verrà stampata dritta sulla comanda della cucina.
- **Adattamento Desktop/Tablet (>= 13 pollici)**: L'interfaccia non necessita di bottoni spropositatamente "enormi", poiché lo spazio disponibile su classici monitor o tablet da >= 13 pollici consente una densità visiva maggiore ma comunque altamente leggibile.
- **Navigazione a Categorie Fisse (Tabs)**: Per gestire menù estesi (es. Primi, Griglia, Bevande, Piadineria), lo schermo avrà una colonna laterale o una barra fissa in alto a schede (Tabs) per filtrare istantaneamente la griglia centrale.
- **Griglia Prodotti Statica**: I prodotti all'interno di una categoria manterranno **sempre la stessa posizione geometrica** a schermo. Le card saranno proporzionate per garantire un input sicuro ("touch-friendly") ma contenute per far stare più voci a colpo d'occhio.
- **Gestione degli "Extra" (Salse/Pane)**: Poiché voci come maionese, ketchup e pane possono essere acquistate singolarmente, non possono essere legate "a cascata" ai piatti principali. Avranno card dedicate, preferibilmente più compatte o raggruppate in un'area rapida visivamente distinta (es. una mini-barra orizzontale fissa sul fondo o un Tab dedicato "Accessori"), sempre a portata di mano per le aggiunte dell'ultimo secondo.
- **Codici Colori Semantici Estremi**: 
  - *Sfondo Verde* (es. `bg-emerald-600`) per le Bevande.
  - *Sfondo Rosso/Arancio* (`bg-orange-500`) per la Griglieria e Cucina.
  - *Sfondo Giallo* per Piadineria e Stuzzicheria.
- **Carrello Fisso Laterale**: Un pannello congelato su un lato (su schermi larghi come Laptop) oppure uno "sticky footer" con un `Drawer` a scorrimento (su Tablet). Contiene la lista degli **"Ordini Pendenti"** presi dal Cloud.
- **Varianti**: Quando l'operatore clicca un prodotto che ammette varianti o extra, si apre istantaneamente un *Dialog modale* centrale, con bottoni a forma di grandi interruttori "Toggle".

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
