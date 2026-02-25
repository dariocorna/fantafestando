# Agent Context

---
alwaysApply: true
type: rules
scope: project
---

## Obiettivo del Progetto
OSGFest è un sistema gestionale per le feste di Bonate Sotto.

> **📋 Stato del Progetto**: Per una mappa dettagliata di tutte le epiche completate e pianificate, consultare **[`docs/EPICS.md`](docs/EPICS.md)** prima di iniziare qualsiasi lavoro.

---

## Workflow Sviluppo per Epica

Ogni nuova epica deve seguire obbligatoriamente questo processo in 4 fasi. Non passare alla fase successiva senza aver completato quella precedente.

### Fase 1 — Branching
```bash
git checkout -b feature/epic-<N>-<slug-descrittivo>
# es: feature/epic-8-dashboard-stats
```
Il branch si crea partendo dal branch di sviluppo principale corrente.

### Fase 2 — Pianificazione (PLANNING)
1. Analizzare il codice esistente per capire i punti di integrazione.
2. Redigere il piano tecnico in un documento `implementation_plan.md`.
3. Il piano deve coprire: modelli/schema da aggiornare, API/actions, componenti UI, strategia di test E2E.
4. **⛔ PAUSA OBBLIGATORIA**: Presentare il piano all'utente via `notify_user` e aspettare esplicita approvazione prima di scrivere una sola riga di codice.

### Fase 3 — Implementazione (EXECUTION)
1. Procedere all'implementazione seguendo il piano approvato.
2. Alla conclusione del codice, scrivere i **test E2E Playwright** esaustivi che coprono tutti i flussi principali della epica.
3. Verificare la documentazione esistente (`README.md`, `docs/*`) e aggiornarla **solo se** le novità introdotte non sono già documentate in modo esplicito.
4. Eseguire la suite E2E completa: `CI=true npx playwright test --project=chromium`.
5. **La fase di implementazione è conclusa solo quando tutti i test passano (exit code 0).**
6. **⛔ PAUSA OBBLIGATORIA**: Notificare l'utente con un riepilogo dei risultati e attendere conferma esplicita prima di procedere ai commit.

### Fase 4 — Rilascio (RELEASE)
1. Eseguire commit atomici per gruppi logici di modifiche, seguendo la convenzione `feat:`, `fix:`, `docs:`, `test:`, `chore:` con messaggi in **inglese**.
2. Ogni commit deve contenere una sola modifica logica. Nessun commit deve corrispondere a un rework di un commit precedente sulla stessa sessione (usare `git rebase -i` / squash se necessario).
3. Aprire la **Pull Request** su GitHub verso il branch di sviluppo principale.
4. Attendere la review e il merge da parte dell'utente.

---

> **📋 Stato del Progetto**: Per una mappa dettagliata di tutte le epiche completate e pianificate, consultare **[`docs/EPICS.md`](docs/EPICS.md)** prima di iniziare qualsiasi lavoro.


## Regole Generali

- Utilizzare l'**italiano** come lingua principale per documentazione e testi rivolti all'utente.
- Mantenere il codice pulito e ben documentato.
- **Commit atomici**: Realizzare sempre commit piccoli e atomici. **I messaggi di commit devono essere scritti in lingua inglese.** *IMPORTANTE: Esegui i commit in locale, ma non effettuare MAI il `git push` verso il remote a meno che non ti venga esplicitamente richiesto — il push avviene nella Fase 4.*
  - **Requisito Atomicità e PR**: Un commit successivo NON deve correggere errori macroscopici di un commit appena scritto. Se si verifica, i commit vanno uniti (`git rebase -i` / squash) per mantenere la cronologia 100% pulita prima della PR.
- **Testing**: Sono obbligatori test unitari per coprire ogni nuova funzione introdotta.
- **Test E2E**: Utilizzare Playwright per implementare test end-to-end sulle funzionalità dell'interfaccia utente.
- **Documentazione**: Aggiornare la documentazione solo quando le novità della epica non sono già descritte con sufficiente dettaglio nei documenti correnti.
- **Chiusura Epica**: Un'epica è **completata** solo quando: i test E2E passano ✅, l'utente ha approvato ✅, e la PR è stata mergiata ✅.
