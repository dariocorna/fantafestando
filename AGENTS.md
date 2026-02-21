# Agent Context

## Obiettivo del Progetto
OSGFest è un sistema gestionale per le feste di Bonate Sotto. 

## Regole Generali
- Utilizzare l'italiano come lingua principale per documentazione e testi rivolti all'utente.
- Mantenere il codice pulito e ben documentato.
- **Commit**: Realizzare sempre commit piccoli, frequenti e atomici, seguendo lo stile Agile (es. `feat:`, `fix:`, `docs:`, `chore:`). Ogni commit deve contenere un'unica modifica logica. **I messaggi di commit devono essere scritti in lingua inglese.** *IMPORTANTE: Esegui i commit in locale, ma non effettuare MAI il `git push` verso il remote a meno che non ti venga esplicitamente richiesto.*
- **Testing**: Sono obbligatori test unitari per coprire ogni nuova funzione introdotta.
- **Test E2E**: Utilizzare Playwright per implementare test end-to-end (E2E) sulle funzionalità dell'interfaccia utente.
