# Deploy FantaFestando su VM

Guida operativa per deploy produzione su VM con reverse proxy edge TLS e stack applicativo in Docker Compose.

Su VM Oracle la configurazione raccomandata usa `Caddy` come reverse proxy pubblico.
`Apache` resta supportato come alternativa legacy/manuale.

## 1. Architettura

- Il reverse proxy sull'host VM gestisce:
  - terminazione TLS
  - hostname pubblici
  - reverse proxy verso container locali
  - inoltro header (`Host`, `X-Forwarded-Proto`)
- Docker Compose gestisce:
  - `mongo`
  - `fantafestando-backoffice` (admin + pos)
  - `fantafestando-menu` (menu pubblico)

Configurazioni supportate:
- `Caddy` su host VM: opzione raccomandata per Oracle VM, installata e abilitata automaticamente da `scripts/bootstrap-oracle-vm.sh`
- `Apache`: opzione legacy/manuale, utile se la VM usa già Apache come edge

Mappatura porte locali host:
- `127.0.0.1:3101` -> `fantafestando-backoffice:3000`
- `127.0.0.1:3102` -> `fantafestando-menu:3000`

Domini previsti:
- `fantafestando-backoffice.ddns.net` -> admin + pos
- `fantafestando.ddns.net` -> portale pubblico menu

## 2. Prerequisiti VM

- Ubuntu/Debian con accesso sudo
- Docker Engine + Docker Compose plugin (`docker compose`)
- Reverse proxy host:
  - `Caddy` raccomandato su Oracle VM
  - oppure `Apache2` con moduli `proxy`, `proxy_http`, `headers`, `ssl`, `rewrite`
- DNS pubblico che punti alla VM per i domini esposti
- Porte aperte: `80`, `443`

## 3. Setup applicazione

Sul server:

```bash
ssh <utente>@<host-vm>
cd /opt
sudo git clone git@github.com:dariocorna/fantafestando.git
sudo chown -R $USER:$USER fantafestando
cd fantafestando
cp .env.production.example .env.production
```

Compilare `.env.production` con valori reali, in particolare:
- `MONGO_ROOT_PASSWORD`
- `MONGODB_URI`
- `AUTH_SECRET`
- `NEXTAUTH_URL` (dominio backoffice pubblico)
- `NEXTAUTH_URL_MENU` (dominio pubblico del menu)

## 4. Primo deploy

```bash
cd /opt/fantafestando
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

## 5. Configurazione Reverse Proxy (TLS edge)

### 5.1 Configurazione raccomandata su Oracle: Caddy

Lo script `scripts/bootstrap-oracle-vm.sh` installa `caddy`, lo abilita come servizio
di default e disabilita `nginx` per evitare conflitti su `80/443`.

Esempio `/etc/caddy/Caddyfile` con backoffice e menu pubblicati su host distinti:

```caddy
fantafestando-backoffice.ddns.net {
    reverse_proxy 127.0.0.1:3101
}

fantafestando.ddns.net {
    reverse_proxy 127.0.0.1:3102
}
```

Se vuoi esporre in pubblico solo il frontend utente del menu:

```caddy
fantafestando.ddns.net {
    reverse_proxy 127.0.0.1:3102
}
```

Applicazione configurazione:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Note operative:
- `Caddy` gestisce automaticamente TLS se il DNS del dominio punta alla VM e le porte `80/443` sono raggiungibili
- il backend Docker resta comunque privato, perche' `fantafestando-menu` e` bindato su `127.0.0.1:3102`
- per il menu pubblico usa `NEXTAUTH_URL_MENU` coerente col dominio esposto

### 5.2 Alternativa legacy/manuale: Apache

Abilitare moduli:

```bash
sudo a2enmod proxy proxy_http headers ssl rewrite
sudo systemctl reload apache2
```

#### 5.2.1 VirtualHost Backoffice

Esempio `/etc/apache2/sites-available/fantafestando-backoffice.conf`:

```apache
<VirtualHost *:80>
    ServerName fantafestando-backoffice.ddns.net
    RewriteEngine On
    RewriteCond %{REQUEST_URI} !^/\.well-known/acme-challenge/
    RewriteRule ^ https://%{SERVER_NAME}%{REQUEST_URI} [R=301,L]
</VirtualHost>

<VirtualHost *:443>
    ServerName fantafestando-backoffice.ddns.net

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/fantafestando-backoffice.ddns.net/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/fantafestando-backoffice.ddns.net/privkey.pem

    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"
    ProxyPass / http://127.0.0.1:3101/
    ProxyPassReverse / http://127.0.0.1:3101/
</VirtualHost>
```

#### 5.2.2 VirtualHost Portale Pubblico

Esempio `/etc/apache2/sites-available/menu-fantafestando.conf`:

```apache
<VirtualHost *:80>
    ServerName fantafestando.ddns.net
    RewriteEngine On
    RewriteCond %{REQUEST_URI} !^/\.well-known/acme-challenge/
    RewriteRule ^ https://%{SERVER_NAME}%{REQUEST_URI} [R=301,L]
</VirtualHost>

<VirtualHost *:443>
    ServerName fantafestando.ddns.net

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/fantafestando.ddns.net/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/fantafestando.ddns.net/privkey.pem

    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"
    ProxyPass / http://127.0.0.1:3102/
    ProxyPassReverse / http://127.0.0.1:3102/
</VirtualHost>
```

Attivazione siti:

```bash
sudo a2ensite fantafestando-backoffice.conf
sudo a2ensite menu-fantafestando.conf
sudo systemctl reload apache2
```

Emettere certificati (se non già emessi):

```bash
sudo certbot --apache -d fantafestando-backoffice.ddns.net -d fantafestando.ddns.net
```

## 6. Aggiornamento applicazione

### 6.1 Flusso standard (server come clone Git)

```bash
cd /opt/fantafestando
git pull
./scripts/update.sh
```

Anche `update.sh` riesegue automaticamente la migrazione indice ordini.

Verifica post update:

```bash
curl -fsS https://fantafestando-backoffice.ddns.net/api/health
curl -fsS https://fantafestando.ddns.net/api/health
```

### 6.2 Flusso consigliato per Bergamo (deploy del compilato locale)

Usare questo flusso quando vuoi evitare build applicativa sulla VM e pubblicare
esattamente gli artefatti generati in locale.

#### Script consigliato (one-command)

```bash
cd /path/to/fantafestando
./scripts/deploy-bergamo.sh
```

Alias equivalente:

```bash
npm run deploy:bergamo
```

Opzioni principali:
- `--host <alias-ssh>` (default `bergamo`)
- `--path <remote-path>` (default `/opt/fantafestando`)
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
cd /path/to/fantafestando
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
  ./ bergamo:/opt/fantafestando/
```

3. Rebuild immagine e restart stack (forzando aggiornamento runtime):

```bash
BUILD_SHA=$(git rev-parse --short HEAD)
ssh bergamo '
  cd /opt/fantafestando &&
  if grep -q "^APP_BUILD=" .env.production; then
    sed -i -E "s/^APP_BUILD=.*/APP_BUILD='"${BUILD_SHA}"'/" .env.production
  else
    echo "APP_BUILD='"${BUILD_SHA}"'" >> .env.production
  fi &&
  docker compose --env-file .env.production -f docker-compose.prod.yml build --no-cache fantafestando-backoffice fantafestando-menu &&
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
  - `https://fantafestando.ddns.net/manifest-menu.webmanifest`
  - `https://fantafestando.ddns.net/sw-menu.js`
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
cd /path/to/fantafestando
cp .env.production.example .env.production
# compilare .env.production con i valori reali prima del primo deploy

npm run deploy:oracle -- \
  --host 84.8.251.115 \
  --user ubuntu \
  --key ~/.ssh/<chiave-oracle>.pem \
  --profile demo
```

Dopo il primo deploy, configura `Caddy` sull'host Oracle per pubblicare i servizi:

```bash
ssh -i ~/.ssh/<chiave-oracle>.pem ubuntu@84.8.251.115
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
fantafestando-backoffice.ddns.net {
    reverse_proxy 127.0.0.1:3101
}

fantafestando.ddns.net {
    reverse_proxy 127.0.0.1:3102
}
EOF
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Se vuoi esporre solo il `menu`, mantieni nel `Caddyfile` soltanto il blocco
del dominio pubblico che punta a `127.0.0.1:3102`.

Note operative:
- Lo script bootstrap disabilita `nginx` e abilita `caddy` per evitare conflitti su porte `80/443` (entrambi restano installati).
- `Apache` non viene configurato automaticamente nello scenario Oracle: se vuoi usarlo come edge, devi abilitarlo e gestire tu virtual host e certificati.
- Lo script Oracle salta la build locale di default: la compilazione Next.js avviene dentro il Docker build remoto.
- Per deploy multipli sulla stessa VM, imposta almeno `--project-name`, `--backoffice-port`, `--menu-port` e `--remote-env-file` con valori distinti per ogni istanza.
- Lo script aggiorna automaticamente nel file env remoto `APP_RUNTIME_ENV_FILE`, `APP_IMAGE_NAME` e `APP_IMAGE_TAG`, cosi` ogni progetto usa il proprio file runtime e il proprio tag immagine.
- Se pubblichi solo il menu, mantieni comunque valorizzato `NEXTAUTH_URL_MENU` e puoi lasciare il backoffice non esposto.
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
  --project-name fantafestando-sagra \
  --backoffice-port 3111 \
  --menu-port 3112 \
  --remote-env-file .env.sagra \
  --profile demo
```

## 7. Rollback

```bash
cd /opt/fantafestando
./scripts/rollback.sh <git-ref>
```

Esempio:

```bash
./scripts/rollback.sh v0.3.1
```

## 8. Backup e Restore MongoDB

### Backup

```bash
cd /opt/fantafestando
./scripts/backup-mongo.sh
ls -lh backups/
```

### Restore

```bash
cd /opt/fantafestando
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
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f fantafestando-backoffice
```

- Verifica proxy Caddy (configurazione raccomandata Oracle):

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl status caddy
sudo journalctl -u caddy -n 100 --no-pager
```

- Verifica proxy Apache (solo se usi la configurazione alternativa):

```bash
sudo apachectl configtest
sudo systemctl status apache2
```
