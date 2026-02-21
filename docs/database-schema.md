# Architettura Database & Backend

L'approccio scelto per OSGFest è basato su **MongoDB**, documentale e schema-less.
Questa scelta è ideale per gestire entità flessibili come le *Varianti* (che possono avere opzioni e prezzi molto eterogenei) e per la logica Multi-tenant.

## I due Database (Cloud vs Local)

Per via della strategia di Deploy *Standalone Ibrido*, il sistema utilizzerà due cluster MongoDB distinti ma con schemi gemelli:
1. **Cloud DB (Atlas/Vercel)**: Ospita i `PreOrdini` provvisori dei clienti e una copia in sola lettura del `Catalogo` e della singola `Festa` attiva sincronizzata dalla Cassa.
2. **Local DB (Docker su Cassa)**: Il master. Ospita lo storico `Ordini` saldati, gli `Utenti` (cassieri), il `Catalogo` modificabile completo e le `Feste`.

## Modelli Principali (Schema Mongoose)

### 1. Festa (Tenant)
Definisce l'evento in corso. Tutte le altre collezioni appenderanno il campo `festaId`.
```typescript
interface IFesta {
  _id: ObjectId;
  nome: string;                 // es. "Sagra Madasca 2024"
  attiva: boolean;
  impostazioni: {
    chiediNome: boolean;        // Abilita campo "Nome" in PWA
    chiediTavolo: boolean;      // Abilita campo "Tavolo" in PWA
  }
  tavoliPredefiniti: string[];  // es. ["T1", "T2", "Panca 1"] per popolare il picker visivo al POS
}
```

### 2. Categoria
Raggruppa i prodotti.
```typescript
interface ICategoria {
  _id: ObjectId;
  festaId: ObjectId;
  nome: string;                 // es. "Prime Piatti", "Griglia", "Bar"
  coloreUI: string;             // Colore semantico per la cassa (es. "bg-orange-500")
  ordineStampa: number;         // ID Stampante o Coda di routing (es. 1=Cucina, 2=Pizzeria)
}
```

### 3. Prodotto
L'entità centrale del catalogo vendibile.
```typescript
interface IProdotto {
  _id: ObjectId;
  festaId: ObjectId;
  categoriaId: ObjectId;
  nome: string;                 // es. "Casoncelli alla Bergamasca"
  prezzoBase: number;
  esaurito: boolean;
  varianti: Array<{
    nomeOpzione: string;        // es. "Aggiunta Formaggio", "Senza Cipolla"
    variazionePrezzo: number;   // es. +1.50, 0.00
  }>;
}
```

### 4. Ordine / Pre-Ordine
La struttura è identica sia per il Cloud (Provvisori) sia per Locale (Saldati).
```typescript
interface IOrdine {
  _id: ObjectId;                // Usato come "Codice Breve" (ultime 3-4 cifre) in Cassa es: "A72"
  festaId: ObjectId;
  stato: "PENDENTE" | "SALDATO" | "ANNULLATO";  // Pendente in Cloud -> Saldato passa in Locale
  cliente: {
    nome?: string;
    tavolo?: string;
  };
  orarioCreazione: Date;
  totale: number;
  scontoApplicato: number;
  carrello: Array<{
    prodottoId: ObjectId;
    nomeSnapshot: string;       // Nome al momento dell'ordine (previene bug se il nome cambia)
    noteCucinaCustom?: string;  // es. "Molto ben cotto per il nonno" - nome personalizzato
    quantita: number;
    opzioniScelte: Array<{
      nome: string;
      sovrapprezzo: number;
    }>;
  }>;
}
```

## Scelte Architetturali Backend (Next.js)

- Le **API (Route Handlers)** di Next.js agiranno come intermediari sia per servire i frontend (Cassa e Admin), sia per sincronizzare i DB.
- **Sincronizzazione Menu (PUSH)**: L'Amministratore in cassa clicca "Pubblica Menu". Il backend locale esegue una query `find()` su Prodotti e Feste nel DB Docker e fa una POST verso l'API del Cloud (Vercel) inserendo il JSON, sincronizzando istantaneamente la PWA.
- **Sincronizzazione Ordini (PULL)**: La cassa, tramite polling ogni X secondi, fa una GET al Vercel Cloud per la lista degli Ordini PENDENTI, la mostra nel Drawer e aspetta l'interazione per spostare i dati nel DB locale chiudendolo.
