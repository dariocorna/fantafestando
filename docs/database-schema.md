# Architettura Database & Backend

L'approccio scelto per FantaFestando è basato su **MongoDB**, documentale e schema-less.
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
    askName: boolean;           // Enables "Name" field in PWA
    askTable: boolean;          // Enables "Table" field in PWA
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
  printOrder: number;           // Sorting order in POS
  printerId?: ObjectId;         // OPTIONAL: Link to IPrinter for comanda routing
  printKitchenCopyAtCashier: boolean; // Optional department copy on cashier printer
  pizzaBarcodeEnabled: boolean; // Barcode numerazione piatto, opt-in
}
```

### 3. Stampante (Printer)
Definisce una stampante fisica in rete.
```typescript
interface IPrinter {
  _id: ObjectId;
  eventId: ObjectId;
  name: string;                 // e.g. "Stampante Cucina", "Stampante Bar"
  ip: string;                   // Indirizzo IP statico
  type: "CASHIER" | "KITCHEN";  // Scopo: Ricevute Cassa o Comande Reparto
}
```

### 4. Punto Cassa (PosDevice)
Definisce una postazione fisica di vendita.
```typescript
interface IPosDevice {
  _id: ObjectId;
  eventId: ObjectId;
  name: string;                 // e.g. "Cassa Centrale", "Cassa Bar"
  printerId: ObjectId;          // Link obbligatorio a una stampante di tipo CASHIER
  paymentTerminalId?: ObjectId; // Periferica pagamento elettronico (es. SumUp)
  cashBoxId?: ObjectId;         // Periferica cassetta contanti
}
```

### 5. Sessione Cassa (CashSession)
Traccia l'apertura/chiusura della cassa per singola postazione e festa.
```typescript
interface ICashSession {
  _id: ObjectId;
  eventId: ObjectId;
  posDeviceId: ObjectId;
  status: "OPEN" | "CLOSED";
  isTest: boolean;
  stockEffectStatus: "APPLIED" | "REVERTED";
  transition?: { token: string; type: "TO_TEST" | "TO_NORMAL" | "CLOSE" | "DELETE"; status: "IN_PROGRESS" | "FAILED"; claimedAt?: Date; error?: string };
  deletionStatus?: "IN_PROGRESS" | "FAILED";
  openedAt: Date;
  openingFloatAmount: number;       // Fondo iniziale
  openingNotes?: string;
  closedAt?: Date;
  closingCountedCashAmount?: number; // Contante contato in chiusura
  closingNotes?: string;
  paidOrdersCount?: number;
  cashSalesAmount?: number;
  cardSalesAmount?: number;
  otherSalesAmount?: number;
  expectedCashAmount?: number;      // Fondo + vendite CASH (esclude elettronici)
  varianceAmount?: number;          // contato - atteso
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
  shortName?: string;           // Optional operational label for POS/print (max 24 char)
  description?: string;         // Optional menu description shown on public menu
  basePrice: number;
  isSoldOut: boolean;
  stockQuantity?: number | null; // null = scorta non tracciata
  variants: Array<{
    optionName: string;         // e.g. "Extra Cheese", "No Onions"
    priceVariation: number;     // e.g. +1.50, 0.00
    stockQuantity?: number | null; // null = scorta non tracciata
  }>;
}
```

### Estensione Magazzino (Epica 9)

Regole dati previste per la gestione scorte:
- `stockQuantity = null`: articolo/variante non tracciato a magazzino (illimitato).
- `stockQuantity = 0`: articolo/variante esaurito.
- `stockQuantity > 0`: disponibilità residua.
- `isSoldOut`: flag derivato operativo (allineato allo stato stock durante i flussi di checkout).

Regole di consumo:
- decremento scorte solo quando l'ordine passa a `PAID`;
- niente valori negativi (decremento con clamp a `0`);
- nel POS è consentita forzatura vendita a stock `0` con conferma esplicita cassiere;
- nel Menu pubblico gli articoli esauriti non sono ordinabili.

### 4. Ordine / Pre-Ordine
La struttura è identica sia per il Cloud (Provvisori) sia per Locale (Saldati).
```typescript
interface IOrder {
  _id: ObjectId;                // Used as "Short Code" (last 3-4 digits) in POS e.g. "A72"
  eventId: ObjectId;
  status: "PENDING" | "PAID" | "CANCELLED";  // Pending in Cloud -> Paid when confirmed locally
  paymentMethod: "CASH" | "CARD" | "OTHER";
  posDeviceId?: ObjectId;
  cashSessionId?: ObjectId;
  stockAdjustments?: Array<{ entityType: "PRODUCT" | "INGREDIENT"; entityId: ObjectId; quantity: number }>;
  stockEffectStatus?: "APPLIED" | "REVERTED";
  stockEffectClaim?: { token: string; target: "APPLIED" | "REVERTED" };
  customer: {
    name?: string;
    table?: string;
  };
  createdAt: Date;
  totalAmount: number;
  discountApplied: number;
  discountMeta?: {
    type: "NONE" | "PERCENT" | "FIXED";
    label?: string;
    value?: number;
    baseAmount?: number;
    scope?: "ORDER";
  };
  discountComponents?: Array<{
    scope: "VOLUNTEER" | "LINE" | "ORDER";
    type: "PERCENT" | "FIXED";
    label?: string;
    value: number;
    baseAmount: number;
    appliedAmount: number;
    productId?: ObjectId;
  }>;
  cart: Array<{
    productId: ObjectId;
    snapshotName: string;       // Name shown at order time (POS uses shortName||name, menu uses name)
    customKitchenNotes?: string;  // e.g. "Well done for grandpa" - custom note
    quantity: number;
    lineTotal?: number;
    discountApplied?: number;
    discountMeta?: {
      type: "NONE" | "PERCENT" | "FIXED";
      label?: string;
      value?: number;
      baseUnitAmount?: number;
    };
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
