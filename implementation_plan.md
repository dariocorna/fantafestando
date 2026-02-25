# Implementation Plan — Epic 16: Deploy su Macchina Virtuale (Bergamo)

## 1. Obiettivo e Vincoli

Obiettivo: deployare OSGFest su VM `ssh bergamo` con stack indipendente in Docker per applicazione e MongoDB, mantenendo Apache già installato come edge reverse proxy + terminazione TLS Let's Encrypt.

Vincoli confermati:
- Deploy applicativo indipendente da Apache (Apache resta solo entrypoint HTTP/HTTPS).
- Due domini pubblici:
  - `backoffice.<dominio>` per Admin + POS/Cassa.
  - `menu.<dominio>` per WebApp Menu pubblico.
- Container dedicati previsti:
  - `mongo`
  - `osgfest-backoffice`
  - `osgfest-menu`

## 2. Analisi Integrazione con Codice Esistente

- Applicazione attuale Next.js monolitica con route già separate (`/admin`, `/pos`, menu pubblico).
- Deploy target: due runtime separati della stessa codebase con configurazione differente via env.
- Nessuna modifica al modello dati Mongo richiesta per questa epica.
- Nessuna nuova API business richiesta: focus su infrastruttura, bootstrap, healthcheck e configurazione.

## 3. Architettura di Deploy

### 3.1 Livello Edge (Host)
- Apache su host VM:
  - VirtualHost HTTPS `backoffice.<dominio>` -> `http://127.0.0.1:3101`
  - VirtualHost HTTPS `menu.<dominio>` -> `http://127.0.0.1:3102`
- Certificati TLS gestiti con Certbot (Let's Encrypt) su Apache.

### 3.2 Livello Applicativo (Docker Compose)
- Servizi:
  - `mongo` con volume persistente (`mongo_data`).
  - `osgfest-backoffice` (admin + pos).
  - `osgfest-menu` (menu pubblico).
- Network Docker privata per comunicazione interna.
- Porte pubblicate solo in localhost host (`127.0.0.1:3101`, `127.0.0.1:3102`) per ridurre superficie esposta.
- Policy restart: `unless-stopped`.

### 3.3 Configurazione Runtime
- File `.env.production` con:
  - connessione Mongo
  - variabili auth/sessione
  - variabili endpoint pubblici per i due host
- Variabile di modalità runtime (`APP_SURFACE=backoffice|menu`) per controllare comportamento/visibilità se necessario.

## 4. Artefatti da Implementare

1. `docker-compose.prod.yml`
- Definizione servizi `mongo`, `osgfest-backoffice`, `osgfest-menu`.
- Volumi persistenti e healthcheck.

2. `Dockerfile` multi-stage aggiornato (se necessario)
- Build riproducibile produzione.
- Target runtime leggero.

3. Script operativi
- `scripts/deploy.sh`: bootstrap iniziale su VM.
- `scripts/update.sh`: pull/build/restart controllato.
- `scripts/rollback.sh`: rollback a versione precedente.
- `scripts/backup-mongo.sh` e `scripts/restore-mongo.sh`.

4. Documentazione
- `docs/deploy-vm.md` con runbook completo:
  - prerequisiti VM
  - setup iniziale
  - configurazione Apache vhost
  - rilascio e aggiornamento
  - backup/restore
  - troubleshooting

5. Healthcheck
- Endpoint applicativo leggero (`/api/health` o equivalente) per monitoraggio e verifiche deploy.

## 5. Modelli/Schema, API/Actions, UI

### 5.1 Modelli/Schema
- Nessuna modifica prevista su modelli Mongo (`Product`, `Order`, `Event`, ecc.).

### 5.2 API/Actions
- Aggiunta solo tecnica: endpoint healthcheck read-only.
- Nessuna modifica funzionale alle action business.

### 5.3 UI
- Nessun nuovo componente UI business.
- Solo eventuali guard/redirect minimi se richiesti per separare surface backoffice/menu in runtime dedicati.

## 6. Strategia Test

### 6.1 Test Tecnici Deploy
- Validazione compose:
  - `docker compose -f docker-compose.prod.yml config`
- Smoke test container:
  - servizi up/down
  - reachability su porte localhost
- Verifica persistenza Mongo dopo restart.

### 6.2 Test E2E Playwright (obbligatori)
- Eseguire suite completa: `CI=true npx playwright test --project=chromium`.
- Aggiungere test smoke deploy-oriented (se mancanti):
  - raggiungibilità backoffice route principale.
  - raggiungibilità menu pubblico.
  - flusso base ordine/menu non regressivo.
  - accesso pagina POS dal dominio backoffice.

### 6.3 Criteri di Completamento Fase Implementazione
- Tutti i test E2E passano (exit code 0).
- Runbook riproducibile su VM pulita.
- HTTPS operativo via Apache per entrambi i domini.

## 7. Sequenza di Esecuzione (Fase 3)

1. Preparare artefatti Docker produzione.
2. Introdurre healthcheck applicativo.
3. Scrivere script deploy/update/backup/restore.
4. Redigere documentazione `docs/deploy-vm.md`.
5. Validare localmente compose + smoke test.
6. Eseguire test unitari e E2E completi.
7. Preparare riepilogo risultati e fermarsi per approvazione utente.

## 8. Rischi e Mitigazioni

- Rischio: conflitti porte con servizi host.
  - Mitigazione: bind esplicito su 127.0.0.1 e porte dedicate 3101/3102.

- Rischio: variabili env incomplete in produzione.
  - Mitigazione: template `.env.production.example` + checklist pre-deploy.

- Rischio: regressioni dovute a runtime separati.
  - Mitigazione: smoke test per entrambe le superfici + suite E2E completa.

- Rischio: restore backup non verificato.
  - Mitigazione: test restore obbligatorio documentato nel runbook.

## 9. Deliverable Finali Epica

- Configurazione deploy Docker produzione.
- Script operativi deploy/update/rollback/backup/restore.
- Documentazione completa per VM Bergamo + Apache TLS.
- Test E2E passing con evidenza risultato.
