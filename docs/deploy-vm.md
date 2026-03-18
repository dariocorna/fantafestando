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
- `${BACKOFFICE_BIND_HOST:-127.0.0.1}:3101` -> `fantafestando-backoffice:3000`
- `127.0.0.1:3102` -> `fantafestando-menu:3000`

Per il backoffice puoi rendere configurabile anche l'host di bind:
- `BACKOFFICE_BIND_HOST=127.0.0.1` per accesso solo locale/host
- `BACKOFFICE_BIND_HOST=<ip-lan>` per accesso privato in LAN

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
- `NEXTAUTH_URL` (origine reale del backoffice: LAN privata oppure dominio pubblico solo se esposto intenzionalmente)
- `NEXTAUTH_URL_MENU` (dominio pubblico del menu)
- `APP_RUNTIME_UID` / `APP_RUNTIME_GID` (UID/GID dell'utente host che deve poter scrivere su `public/uploads`)
- `BACKOFFICE_BIND_HOST` (default `127.0.0.1`, oppure IP LAN se il backoffice deve restare privato ma raggiungibile in rete locale)

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
BACKOFFICE_HOST=$(grep -E '^BACKOFFICE_BIND_HOST=' .env.production | cut -d= -f2)
curl -fsS "http://${BACKOFFICE_HOST:-127.0.0.1}:3101/api/health"
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
- il backoffice puo' restare privato: in quel caso `NEXTAUTH_URL` deve puntare a IP LAN o hostname interno reale, non a un dominio pubblico
- se il backoffice deve essere usato da altri device in LAN, imposta anche `BACKOFFICE_BIND_HOST` sullo stesso IP LAN del Docker host
- se usi bind mount verso `public/uploads`, imposta `APP_RUNTIME_UID` e `APP_RUNTIME_GID` sullo stesso utente del filesystem host oppure gli upload header/logo falliranno per permessi

#### 5.1.1 Oracle edge + host Docker remoto via reverse SSH tunnel

Se vuoi mantenere il deploy coerente e tenere anche il tunnel dentro Docker, puoi
avviare un sidecar `oracle-menu-tunnel` nello stesso `docker-compose.prod.yml`.
In questo assetto il tunnel non punta piu' a `127.0.0.1:3102` sull'host Linux, ma
direttamente al servizio Docker `fantafestando-menu:3000` sulla rete Compose.

In questo scenario:
- `fantafestando.ddns.net` continua a puntare alla VM Oracle
- `Caddy` termina TLS sulla VM Oracle
- il sidecar `oracle-menu-tunnel` apre `ssh -N -R 127.0.0.1:3302:fantafestando-menu:3000`
- sulla VM Oracle il reverse proxy continua a inoltrare verso `127.0.0.1:3302`

Configurazione `Caddy` sulla VM Oracle:

```bash
ssh -i ~/.ssh/<chiave-oracle>.pem ubuntu@84.8.251.115
sudo tee -a /etc/caddy/Caddyfile >/dev/null <<'EOF'

fantafestando.ddns.net {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3302
}
EOF
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Variabili runtime aggiuntive in `.env.production`:

- `ORACLE_TUNNEL_HOST`
- `ORACLE_TUNNEL_USER`
- `ORACLE_TUNNEL_SSH_DIR_HOST` directory host che contiene la chiave privata SSH
- `ORACLE_TUNNEL_KEY_FILENAME` nome file chiave dentro `ORACLE_TUNNEL_SSH_DIR_HOST`
- `ORACLE_TUNNEL_REMOTE_BIND_ADDRESS=127.0.0.1`
- `ORACLE_TUNNEL_REMOTE_PORT=3302`
- `ORACLE_TUNNEL_LOCAL_HOST=fantafestando-menu`
- `ORACLE_TUNNEL_LOCAL_PORT=3000`

#### 5.1.1.1 Utente SSH dedicato e chiave limitata per il tunnel

Non riutilizzare la chiave amministrativa/root che usi normalmente per entrare nella
VM Oracle. Per il sidecar del tunnel e' preferibile creare:

- un utente dedicato, per esempio `oracle-menu-tunnel`
- una chiave SSH dedicata
- permessi limitati al solo reverse port forwarding richiesto

Sulla VM Oracle:

```bash
sudo adduser --disabled-password --gecos "" oracle-menu-tunnel
sudo usermod -L oracle-menu-tunnel
sudo mkdir -p /home/oracle-menu-tunnel/.ssh
sudo chmod 700 /home/oracle-menu-tunnel/.ssh
sudo chown -R oracle-menu-tunnel:oracle-menu-tunnel /home/oracle-menu-tunnel/.ssh
```

Genera una nuova chiave sul Docker host remoto o sulla macchina da cui prepari il deploy:

```bash
mkdir -p .secrets/oracle-menu-tunnel
chmod 700 .secrets/oracle-menu-tunnel
ssh-keygen -t ed25519 -f .secrets/oracle-menu-tunnel/id_ed25519 -C "oracle-menu-tunnel"
chmod 600 .secrets/oracle-menu-tunnel/id_ed25519
```

Installa **solo la chiave pubblica** sulla VM Oracle con restrizioni per il tunnel:

```bash
PUBKEY=$(cat .secrets/oracle-menu-tunnel/id_ed25519.pub)
sudo tee /home/oracle-menu-tunnel/.ssh/authorized_keys >/dev/null <<EOF
restrict,port-forwarding,permitlisten="127.0.0.1:3302",no-agent-forwarding,no-pty,no-user-rc,no-X11-forwarding ${PUBKEY}
EOF
sudo chmod 600 /home/oracle-menu-tunnel/.ssh/authorized_keys
sudo chown oracle-menu-tunnel:oracle-menu-tunnel /home/oracle-menu-tunnel/.ssh/authorized_keys
```

Per irrigidire ulteriormente `sshd`, aggiungi una regola dedicata:

```bash
sudo tee /etc/ssh/sshd_config.d/oracle-menu-tunnel.conf >/dev/null <<'EOF'
Match User oracle-menu-tunnel
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    PubkeyAuthentication yes
    AllowTcpForwarding remote
    X11Forwarding no
    PermitTTY no
    AllowAgentForwarding no
    GatewayPorts no
EOF
sudo systemctl reload ssh
```

Con questa impostazione:

- l'utente non viene usato per shell amministrativa
- la chiave puo' aprire solo il listener `127.0.0.1:3302` sulla VM Oracle
- il sidecar non eredita accesso root o privilegi di deploy

#### 5.1.1.2 Pagina pubblica di fallback quando il tunnel e' assente

Se il dominio del menu e' pubblico, conviene evitare un `502` quando il tunnel non e'
attivo. Lo scenario piu' robusto e' questo:

- il menu reale continua a passare dal tunnel su `127.0.0.1:3302`
- una pagina statica locale viene servita su `127.0.0.1:3303`
- `Caddy` prova prima `3302` e, se l'health check fallisce, usa `3303`

Pagina offline locale sulla VM Oracle:

```bash
sudo mkdir -p /var/www/fantafestando-menu-offline/current/api/health
sudo cp systemd/oracle-menu-offline/index.html /var/www/fantafestando-menu-offline/current/index.html
sudo cp systemd/oracle-menu-offline/api/health/index.html /var/www/fantafestando-menu-offline/current/api/health/index.html
sudo chown -R root:root /var/www/fantafestando-menu-offline
sudo chmod -R a+rX /var/www/fantafestando-menu-offline
```

Il template `systemd/oracle-menu-offline/index.html` riprende il linguaggio visivo del
`menu` pubblico:

- sfondo `brand-surface-menu`
- palette `brand-blue` / `brand-yellow`
- card bianca con bordo azzurro e shadow morbida
- tipografia display coerente con la webapp

Micro-servizio statico locale:

```bash
sudo cp systemd/oracle-menu-offline/fantafestando-menu-offline.service \
  /etc/systemd/system/fantafestando-menu-offline.service
sudo systemctl daemon-reload
sudo systemctl enable --now fantafestando-menu-offline.service
```

Blocco `Caddy` per il dominio pubblico del menu:

```caddy
fantafestando.ddns.net {
    encode zstd gzip

    reverse_proxy 127.0.0.1:3302 127.0.0.1:3303 {
        lb_policy first
        lb_retries 2
        lb_try_interval 250ms
        health_uri /api/health
        health_interval 5s
        health_timeout 2s
    }
}
```

Verifica:

```bash
# tunnel down -> pagina offline
curl -I https://fantafestando.ddns.net/

# tunnel up -> menu reale
curl https://fantafestando.ddns.net/api/health
```

Preparazione chiave sul Docker host remoto:

```bash
cd /opt/fantafestando
mkdir -p .secrets/oracle-menu-tunnel
chmod 700 .secrets/oracle-menu-tunnel
cp <percorso-chiave-dedicata>/id_ed25519 .secrets/oracle-menu-tunnel/id_ed25519
chmod 600 .secrets/oracle-menu-tunnel/id_ed25519
```

Esempio env:

```bash
ORACLE_TUNNEL_HOST=84.8.251.115
ORACLE_TUNNEL_USER=oracle-menu-tunnel
ORACLE_TUNNEL_SSH_DIR_HOST=/opt/fantafestando/.secrets/oracle-menu-tunnel
ORACLE_TUNNEL_KEY_FILENAME=id_ed25519
ORACLE_TUNNEL_REMOTE_BIND_ADDRESS=127.0.0.1
ORACLE_TUNNEL_REMOTE_PORT=3302
ORACLE_TUNNEL_LOCAL_HOST=fantafestando-menu
ORACLE_TUNNEL_LOCAL_PORT=3000
```

Avvio stack con sidecar tunnel:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml \
  --profile oracle-tunnel up -d --build --remove-orphans
```

Se vuoi attivare anche altri profili nello stesso deploy, usa piu' flag `--profile`
oppure nei wrapper del progetto passa una lista separata da virgole, ad esempio:

```bash
DEPLOY_PROFILE=demo,oracle-tunnel ./scripts/deploy-oracle.sh --host <oracle-vm>
```

Verifiche consigliate:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f oracle-menu-tunnel
ssh ubuntu@84.8.251.115 'curl -fsS http://127.0.0.1:3302/api/health'
curl -I https://fantafestando.ddns.net/api/health
```

Note operative:

- questa variante non richiede `systemd` per il tunnel sul Docker host remoto
- il servizio `oracle-menu-tunnel` riutilizza `scripts/oracle-menu-reverse-tunnel.sh`
- la chiave privata resta fuori dall'immagine Docker e viene montata in sola lettura
- se il profilo `oracle-tunnel` non e' attivo, il sidecar non parte
- il tunnel effettivo usa `ssh -N -R 127.0.0.1:3302:fantafestando-menu:3000`

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

### 6.2 Deploy locale LAN

Per la macchina locale `fantafestando`, usare il deploy diretto dal repository.

#### Script consigliato (one-command)

```bash
cd /path/to/fantafestando
./scripts/deploy.sh
```

Lo script:
- usa `.env.production` locale
- avvia o aggiorna lo stack con `docker compose`
- applica la migrazione dell'indice pickup
- mostra lo stato dei servizi a fine deploy

#### Flusso manuale equivalente

1. Avvio stack:

```bash
cd /path/to/fantafestando
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build --remove-orphans
```

2. Migrazione indice:

```bash
./scripts/migrate-order-pickup-index.sh
```

3. Verifica stato:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

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
  - endpoint health locali (`${BACKOFFICE_BIND_HOST:-127.0.0.1}:3101` e `127.0.0.1:3102`)
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
- Se il backoffice resta privato, imposta `NEXTAUTH_URL` sull'URL LAN/interno reale del backoffice; per un futuro PoC pubblico basta sostituirlo con il dominio pubblico scelto.
- Se vuoi un PoC futuro con backoffice pubblico, puoi riportare `BACKOFFICE_BIND_HOST=127.0.0.1` e rimettere il reverse proxy davanti al container senza cambiare il menu pubblico.
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

- Verifica tunnel menu remoto -> Oracle:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f oracle-menu-tunnel
curl -fsS http://127.0.0.1:3102/api/health
ssh ubuntu@84.8.251.115 'curl -fsS http://127.0.0.1:3302/api/health'
```

- Verifica proxy Apache (solo se usi la configurazione alternativa):

```bash
sudo apachectl configtest
sudo systemctl status apache2
```
