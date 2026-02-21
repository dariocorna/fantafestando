# OSGFest

Sistema gestionale per feste e sagre di paese, progettato specificamente per la comunità di Bonate Sotto.

Il progetto mira a realizzare un sistema completo per la gestione delle casse (non fiscali) e delle comande smistate nei vari reparti (es. cucine, griglia, bar).

## Funzionalità Principali

- **Gestione Casse**: Interfaccia per la presa degli ordini.
- **WebApp Ordini Remoti**: Portale per il pubblico che permette di compilare l'ordine dal proprio smartphone e generare un QRCode. Il codice viene mostrato al cassiere per caricare immediatamente l'ordine nel POS, dove potrà essere saldato, modificato o chiuso.
- **Architettura Multi-Festa (Multi-tenant)**: Capacità del sistema di gestire dati e configurazioni separate per festività diverse da un unico portale web centrale.
- **Backend Autenticato**: Area riservata amministrativa protetta da login per l'accesso a configurazioni, catalogo, resoconti e gestione casse.
- **Campi Opzionali Configurabili**: Possibilità per l'amministratore di configurare (a livello di singola festa) la richiesta obbligatoria o facoltativa di campi extra in fase di pre-ordine, come **Nome** e **Tavolo** (es. disabilitati per i servizi al volo, abilitati per servizio al tavolo).
- **Stampa Scontrini Clienti**: Integrazione con stampanti termiche per l'emissione dello scontrino riepilogativo alla cassa.
- **Stampa Comande per Reparti**: Smistamento e stampa automatica delle comande direttamente nei reparti di preparazione interessati, tramite stampanti termiche dedicate.
- **Sconti e Agevolazioni**: Possibilità di applicare sconti volontari o manuali sugli ordini al momento del pagamento.
- **Gestione Varianti**: Supporto per l'applicazione di varianti ai singoli prodotti a menu (es. "ben cotto", "senza cipolla", "doppio", ecc.).
