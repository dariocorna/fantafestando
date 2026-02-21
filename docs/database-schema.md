# Architettura Database & Backend

L'approccio scelto per OSGFest è basato su **MongoDB**, documentale e schema-less.
Questa scelta è ideale per gestire entità flessibili come le *Varianti* (che possono avere opzioni e prezzi molto eterogenei) e per la logica Multi-tenant.

## I due Database (Cloud vs Local)

Per via della strategia di Deploy *Standalone Ibrido*, il sistema utilizzerà due cluster MongoDB distinti ma con schemi gemelli:
1. **Cloud DB (Atlas/Vercel)**: Ospita i `PreOrdini` provvisori dei clienti e una copia in sola lettura del `Catalogo` e dell'**unica Festa attiva** sincronizzata dalla Cassa.
2. **Local DB (Docker su Cassa)**: Il master. Ospita lo storico `Ordini` saldati, gli `Utenti` (cassieri), il `Catalogo` completo e le `Feste` (storico ed eventi futuri).

## Modelli Principali (Schema Mongoose)

### 1. Festa (Tenant)
Definisce l'evento in corso. Tutte le altre collezioni appenderanno il campo `festaId`.
```typescript
interface IEvent {
  _id: ObjectId;
  name: string;                 // e.g. "Sagra Madasca 2024"
  active: boolean;              // SEVER-SIDE Enforcement: only one event can be active.
  settings: {
    askName: boolean;           // Enables "Name" field in PWA
    askTable: boolean;          // Enables "Table" field in PWA
    defaultCashierPrinterIp?: string;
  }
  predefinedTables: string[];   // e.g. ["T1", "T2"]
}
```

### 2. Categoria
Raggruppa i prodotti.
```typescript
interface ICategory {
  _id: ObjectId;
  eventId: ObjectId;
  name: string;                 // e.g. "First Courses", "Grill", "Bar"
  uiColor: string;              // Semantic color for POS (e.g. "bg-orange-500")
  printOrder: number;           // Printer ID or routing queue (e.g. 1=Kitchen, 2=Pizzeria)
}
```

### 3. Prodotto
L'entità centrale del catalogo vendibile.
```typescript
interface IProduct {
  _id: ObjectId;
  eventId: ObjectId;
  categoryId: ObjectId;
  name: string;                 // e.g. "Casoncelli alla Bergamasca"
  basePrice: number;
  isSoldOut: boolean;
  variants: Array<{
    optionName: string;         // e.g. "Extra Cheese", "No Onions"
    priceVariation: number;     // e.g. +1.50, 0.00
  }>;
}
```

### 4. Ordine / Pre-Ordine
La struttura è identica sia per il Cloud (Provvisori) sia per Locale (Saldati).
```typescript
interface IOrder {
  _id: ObjectId;                // Used as "Short Code" (last 3-4 digits) in POS e.g. "A72"
  eventId: ObjectId;
  status: "PENDING" | "PAID" | "CANCELLED";  // Pending in Cloud -> Paid when confirmed locally
  customer: {
    name?: string;
    table?: string;
  };
  createdAt: Date;
  totalAmount: number;
  discountApplied: number;
  cart: Array<{
    productId: ObjectId;
    snapshotName: string;       // Name at order time (prevents bugs if product name changes)
    customKitchenNotes?: string;  // e.g. "Well done for grandpa" - custom note
    quantity: number;
    selectedOptions: Array<{
      name: string;
      priceVariation: number;
    }>;
  }>;
}
```

## Scelte Architetturali Backend (Next.js)

- Le **API (Route Handlers)** di Next.js agiranno come intermediari sia per servire i frontend (Cassa e Admin), sia per sincronizzare i DB.
- **Sincronizzazione Menu (PUSH)**: L'Amministratore in cassa clicca "Pubblica Menu". Il backend locale esegue una query `find()` su Prodotti e Feste nel DB Docker e fa una POST verso l'API del Cloud (Vercel) inserendo il JSON, sincronizzando istantaneamente la PWA.
- **Sincronizzazione Ordini (PULL)**: La cassa, tramite polling ogni X secondi, fa una GET al Vercel Cloud per la lista degli Ordini PENDENTI, la mostra nel Drawer e aspetta l'interazione per spostare i dati nel DB locale chiudendolo.
