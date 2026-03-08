# Deploy OSGFest su VM

Guida operativa per deploy produzione su VM mantenendo Apache come edge reverse proxy TLS e stack applicativo in Docker Compose.

## 1. Architettura

- Apache su host VM gestisce:
  - virtual host
  - certificati TLS Let's Encrypt
  - reverse proxy verso container locali
- Docker Compose gestisce:
  - `mongo`
  - `osgfest-backoffice` (admin + pos)
  - `osgfest-menu` (menu pubblico)

Mappatura porte locali host:
- `127.0.0.1:3101` -> `osgfest-backoffice:3000`
- `127.0.0.1:3102` -> `osgfest-menu:3000`

Domini previsti:
- `osgfest-backoffice.ddns.net` -> admin + pos
- `osgfest.ddns.net` -> portale pubblico menu

## 2. Prerequisiti VM

- Ubuntu/Debian con accesso sudo
- Docker Engine + Docker Compose plugin (`docker compose`)
- Apache2 con moduli:
  - `proxy`
  - `proxy_http`
  - `headers`
  - `ssl`
  - `rewrite`
- Certbot + plugin Apache
- Porte aperte: `80`, `443`

## 3. Setup applicazione

Sul server:

```bash
ssh <utente>@<host-vm>
cd /opt
sudo git clone git@github.com:dariocorna/osgfest.git
sudo chown -R $USER:$USER osgfest
cd osgfest
cp .env.production.example .env.production
```

Compilare `.env.production` con valori reali, in particolare:
- `MONGO_ROOT_PASSWORD`
- `MONGODB_URI`
- `AUTH_SECRET`
- `NEXTAUTH_URL` (dominio backoffice pubblico)

## 4. Primo deploy

```bash
cd /opt/osgfest
./scripts/deploy.sh
```

`deploy.sh` applica automaticamente una migrazione DB idempotente per l'indice
ordini `eventId + pickupNumber` (unique parziale su `pickupNumber` numerico).
Questo evita errori `E11000` sui flussi POS che non usano `pickupNumber`.

Verifica:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl -fsS http://127.0.0.1:3101/api/health
curl -fsS http://127.0.0.1:3102/api/health
```

## 5. Configurazione Apache (TLS edge)

Abilitare moduli:

```bash
sudo a2enmod proxy proxy_http headers ssl rewrite
sudo systemctl reload apache2
```

### 5.1 VirtualHost Backoffice

Esempio `/etc/apache2/sites-available/osgfest-backoffice.conf`:

```apache
<VirtualHost *:80>
    ServerName osgfest-backoffice.ddns.net
    RewriteEngine On
    RewriteCond %{REQUEST_URI} !^/\.well-known/acme-challenge/
    RewriteRule ^ https://%{SERVER_NAME}%{REQUEST_URI} [R=301,L]
</VirtualHost>

<VirtualHost *:443>
    ServerName osgfest-backoffice.ddns.net

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/osgfest-backoffice.ddns.net/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/osgfest-backoffice.ddns.net/privkey.pem

    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"
    ProxyPass / http://127.0.0.1:3101/
    ProxyPassReverse / http://127.0.0.1:3101/
</VirtualHost>
```

### 5.2 VirtualHost Portale Pubblico

Esempio `/etc/apache2/sites-available/menu-osgfest.conf`:

```apache
<VirtualHost *:80>
    ServerName osgfest.ddns.net
    RewriteEngine On
    RewriteCond %{REQUEST_URI} !^/\.well-known/acme-challenge/
    RewriteRule ^ https://%{SERVER_NAME}%{REQUEST_URI} [R=301,L]
</VirtualHost>

<VirtualHost *:443>
    ServerName osgfest.ddns.net

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/osgfest.ddns.net/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/osgfest.ddns.net/privkey.pem

    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"
    ProxyPass / http://127.0.0.1:3102/
    ProxyPassReverse / http://127.0.0.1:3102/
</VirtualHost>
```

Attivazione siti:

```bash
sudo a2ensite osgfest-backoffice.conf
sudo a2ensite menu-osgfest.conf
sudo systemctl reload apache2
```

Emettere certificati (se non già emessi):

```bash
sudo certbot --apache -d osgfest-backoffice.ddns.net -d osgfest.ddns.net
```

## 6. Aggiornamento applicazione

### 6.1 Flusso standard (server come clone Git)

```bash
cd /opt/osgfest
git pull
./scripts/update.sh
```

Anche `update.sh` riesegue automaticamente la migrazione indice ordini.

Verifica post update:

```bash
curl -fsS https://osgfest-backoffice.ddns.net/api/health
curl -fsS https://osgfest.ddns.net/api/health
```

### 6.2 Flusso consigliato per Bergamo (deploy del compilato locale)

Usare questo flusso quando vuoi evitare build applicativa sulla VM e pubblicare
esattamente gli artefatti generati in locale.

#### Script consigliato (one-command)

```bash
cd /path/to/osgfest
./scripts/deploy-bergamo.sh
```

Alias equivalente:

```bash
npm run deploy:bergamo
```

Opzioni principali:
- `--host <alias-ssh>` (default `bergamo`)
- `--path <remote-path>` (default `/opt/osgfest`)
- `--profile <compose-profile>` (default `demo`)
- `--skip-build` / `--skip-rsync` / `--skip-health-check`
- `--use-cache` (default build `--no-cache`)

Lo script esegue automaticamente:
- `npm run build` locale
- `rsync` verso `${host}:${path}` con exclude sicuri
- update di `APP_BUILD` in `.env.production` remoto
- `docker compose build` + `up -d --remove-orphans`
- health check `127.0.0.1:3101/3102`

#### Flusso manuale equivalente

1. Build locale:

```bash
cd /path/to/osgfest
npm ci
npm run build
```

2. Sync codice+artefatti su VM:

```bash
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.next/cache' \
  --exclude '.env*' \
  ./ bergamo:/opt/osgfest/
```

3. Rebuild immagine e restart stack (forzando aggiornamento runtime):

```bash
BUILD_SHA=$(git rev-parse --short HEAD)
ssh bergamo '
  cd /opt/osgfest &&
  if grep -q "^APP_BUILD=" .env.production; then
    sed -i -E "s/^APP_BUILD=.*/APP_BUILD='"${BUILD_SHA}"'/" .env.production
  else
    echo "APP_BUILD='"${BUILD_SHA}"'" >> .env.production
  fi &&
  docker compose --env-file .env.production -f docker-compose.prod.yml build --no-cache osgfest-backoffice osgfest-menu &&
  docker compose --env-file .env.production -f docker-compose.prod.yml --profile demo up -d --remove-orphans
'
```

4. Verifica release effettiva:

```bash
ssh bergamo 'curl -fsS http://127.0.0.1:3101/api/health'
ssh bergamo 'curl -fsS http://127.0.0.1:3102/api/health'
```

Controllare che `release` nei payload `/api/health` corrisponda al commit atteso.

### 6.3 Checklist anti-regressioni deploy

- `MONGODB_URI` in `.env.production` deve puntare a `mongo` (hostname di rete compose), non a IP hardcoded.
- Se usi stampanti virtuali, avvia lo stack con profilo `demo` e mantieni:
  - `PRINTER_EMULATOR_HOST=printer-emulator`
  - `PRINTER_EMULATOR_START_PORT=19100`
- Aggiorna `APP_BUILD` a ogni deploy (commit short SHA) per avere in admin la release effettiva.
- Quando vedi codice vecchio dopo un deploy, esegui `build --no-cache` prima di `up -d`.
- Verifica asset PWA pubblicati:
  - `https://osgfest.ddns.net/manifest-menu.webmanifest`
  - `https://osgfest.ddns.net/sw-menu.js`
- Dopo ogni deploy verifica sempre:
  - stato container (`docker compose ... ps`)
  - endpoint health locali (`127.0.0.1:3101/3102`)
  - release pubblicata (`/api/health`).

### 6.4 Deploy rapido su VM Oracle nuova

Per VM Oracle appena create (Ubuntu), usare lo script unificato che:
- installa e configura dipendenze base (`docker`, `docker compose`, `caddy`, `nginx`, `ufw`, `git`, `rsync`)
- sincronizza il repository sulla VM
- aggiorna metadata release (`APP_VERSION`, `APP_BUILD`, `APP_BUILD_DATE`)
- builda e avvia stack Docker Compose direttamente sulla VM (no dipendenza da `.next` locale)
- esegue health check locali su VM

Comando:

```bash
cd /path/to/osgfest
cp .env.production.example .env.production
# compilare .env.production con i valori reali prima del primo deploy

npm run deploy:oracle -- \
  --host 84.8.251.115 \
  --user ubuntu \
  --key ~/.ssh/<chiave-oracle>.pem \
  --profile demo
```

Note operative:
- Lo script bootstrap disabilita `nginx` e abilita `caddy` per evitare conflitti su porte `80/443` (entrambi restano installati).
- Lo script Oracle salta la build locale di default: la compilazione Next.js avviene dentro il Docker build remoto.
- Per deploy multipli sulla stessa VM, imposta almeno `--project-name`, `--backoffice-port`, `--menu-port` e `--remote-env-file` con valori distinti per ogni istanza.
- Lo script aggiorna automaticamente nel file env remoto `APP_RUNTIME_ENV_FILE`, `APP_IMAGE_NAME` e `APP_IMAGE_TAG`, cosi` ogni progetto usa il proprio file runtime e il proprio tag immagine.
- Se vuoi mantenere un controllo preliminare locale, puoi forzare la build locale:

```bash
npm run deploy:oracle -- \
  --host 84.8.251.115 \
  --user ubuntu \
  --key ~/.ssh/<chiave-oracle>.pem \
  --local-build
```

- Per rieseguire solo deploy applicativo senza reinstallare componenti host:

```bash
npm run deploy:oracle -- \
  --host 84.8.251.115 \
  --user ubuntu \
  --key ~/.ssh/<chiave-oracle>.pem \
  --no-bootstrap
```

- Esempio multi-istanza sulla stessa VM:

```bash
npm run deploy:oracle -- \
  --host 84.8.251.115 \
  --user ubuntu \
  --key ~/.ssh/<chiave-oracle>.pem \
  --project-name osgfest-sagra \
  --backoffice-port 3111 \
  --menu-port 3112 \
  --remote-env-file .env.sagra \
  --profile demo
```

## 7. Rollback

```bash
cd /opt/osgfest
./scripts/rollback.sh <git-ref>
```

Esempio:

```bash
./scripts/rollback.sh v0.3.1
```

## 8. Backup e Restore MongoDB

### Backup

```bash
cd /opt/osgfest
./scripts/backup-mongo.sh
ls -lh backups/
```

### Restore

```bash
cd /opt/osgfest
./scripts/restore-mongo.sh backups/mongo-YYYYMMDD-HHMMSS.archive.gz
```

Dopo restore, verificare frontali e admin.

## 9. Sicurezza minima consigliata

- Non esporre porte Docker applicative su interfacce pubbliche (già bindate su `127.0.0.1`).
- Usare password robuste in `.env.production`.
- Eseguire backup regolari e test restore periodico.
- Configurare firewall host (`ufw`) per consentire solo `22`, `80`, `443`.

## 10. Troubleshooting rapido

- Stato servizi:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

- Log servizio specifico:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f osgfest-backoffice
```

- Verifica proxy Apache:

```bash
sudo apachectl configtest
sudo systemctl status apache2
```
