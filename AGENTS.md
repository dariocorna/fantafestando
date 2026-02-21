# Agent Context

## Obiettivo del Progetto
OSGFest è un sistema gestionale per le feste di Bonate Sotto. 

## Regole Generali
- Utilizzare l'italiano come lingua principale per documentazione e testi rivolti all'utente.
- Mantenere il codice pulito e ben documentato.
- **Commit**: Realizzare sempre commit piccoli, frequenti e atomici, seguendo lo stile Agile (es. `feat:`, `fix:`, `docs:`, `chore:`). Ogni commit deve contenere un'unica modifica logica essenziale. **I messaggi di commit devono essere scritti in lingua inglese.** *IMPORTANTE: Esegui i commit in locale, ma non effettuare MAI il `git push` verso il remote a meno che non ti venga esplicitamente richiesto.*
  - **Requisito Atomicità e PR**: In previsione delle Pull Request, un commit successivo NON deve eseguire un rework o correggere errori macroscopici di un commit immediatamente precedente appena scritto su quel branch. Qualora si presentasse questa eventualità (es. fix typo, fix build test fallito post-codifica), i commit vanno obbligatoriamente uniti (`git rebase -i` / squash) per mantenere la cronologia pulita e 100% atomica prima della PR.
- **Testing**: Sono obbligatori test unitari per coprire ogni nuova funzione introdotta.
- **Test E2E**: Utilizzare Playwright per implementare test end-to-end (E2E) sulle funzionalità dell'interfaccia utente.
