# Magazzino e Scorte Base (Epica 9)

Questo documento descrive il comportamento funzionale atteso per la gestione scorte.

## Obiettivo

Introdurre una gestione semplice ma robusta di disponibilità prodotti/varianti, con controlli lato server e UX operativa per la cassa.

## Modello dati

Campi previsti:
- `Product.stockQuantity: number | null`
- `Product.variants[].stockQuantity: number | null`
- `Product.isSoldOut: boolean` (flag operativo allineato allo stock)

Semantica:
- `null`: scorta non tracciata (illimitato)
- `0`: esaurito
- `> 0`: disponibile

## Regole di disponibilità

Disponibilità per canale:
- **Menu pubblico**: i prodotti esauriti non sono ordinabili.
- **POS**: i prodotti esauriti sono visibili e selezionabili, ma la chiusura ordine richiede warning + conferma cassiere.

Disponibilità temporale:
- resta valida anche la regola di disponibilità per giorni (`availableDays`).

## Regole di consumo scorte

Le scorte si decrementano solo quando un ordine passa a `PAID`:
- creazione ordine POS in contanti,
- chiusura ordine pendente da POS,
- conferma pagamento carta via webhook SumUp.

Vincoli:
- nessuna scorta negativa;
- decremento con clamp a `0`;
- quando si arriva a `0`, il prodotto resta sold-out.

## Ordini pendenti WebApp

Gli ordini pendenti **non prenotano** stock.

Conseguenze:
- in chiusura POS va sempre rifatta validazione disponibilità;
- se stock insufficiente, il sistema mostra warning bloccante;
- il cassiere può confermare override per procedere comunque.

## UX POS per override

Quando ci sono quantità non coperte:
1. mostrare dialog con elenco shortage (prodotto/quantità richiesta/disponibile),
2. bloccare il submit standard,
3. offrire azione esplicita `Prosegui comunque`,
4. inviare l’ordine con flag di override.

## Test richiesti

Unit:
- parsing stock,
- classificazione low/out/unlimited,
- decremento strict vs override,
- clamp a zero.

E2E:
- decremento stock in checkout POS,
- stato low stock in UI,
- sold-out (nascosto in menu, visibile in POS),
- warning + conferma override cassiere,
- chiusura ordine pendente con stock insufficiente.

## Scorte rapide POS e sessioni TEST (Epica 35)

La modalità `Scorte` del POS trasforma le card del catalogo in editor inline per prodotti e varianti. Il cassiere inserisce una quantità intera, `0` per esaurito oppure usa `Illimitata`; durante la modifica il carrello resta visibile ma non modificabile e il pagamento è sospeso. L'accesso usa le stesse regole del POS, quindi non richiede il ruolo Admin.

Ogni nuovo ordine salva gli aggiustamenti di prodotto e ingrediente realmente applicati e il relativo stato `APPLIED`/`REVERTED`. Quando una sessione TEST viene chiusa gli aggiustamenti vengono ripristinati con chiavi operative idempotenti; una successiva riclassificazione a normale li riapplica solo se le scorte sono sufficienti. Un claim atomico per ordine impedisce che storno e transizione della sessione modifichino contemporaneamente le stesse scorte; un claim breve sulla sessione impedisce inoltre che una chiusura intersechi la persistenza di un pagamento. Gli ordini storici senza snapshot vengono ricostruiti da carrello, componenti menu e piano ingredienti e sono segnalati come approssimativi.
