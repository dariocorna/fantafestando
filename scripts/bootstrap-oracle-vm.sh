#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root (use sudo)." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

install_pkg() {
  local pkg="$1"
  if ! dpkg -s "$pkg" >/dev/null 2>&1; then
    apt-get install -y "$pkg"
  fi
}

echo "[bootstrap] Updating apt index..."
apt-get update -y

# Base tooling
install_pkg ca-certificates
install_pkg curl
install_pkg gnupg
install_pkg lsb-release
install_pkg git
install_pkg rsync
install_pkg ufw

# OCI cloud images may preload iptables rules that allow only SSH (22) and reject all other inbound traffic.
# Patch the persistent rules file so 80/443 stay reachable also after reboot.
if [[ -f /etc/iptables/rules.v4 ]]; then
  if ! grep -q -- "--dport 80 -j ACCEPT" /etc/iptables/rules.v4; then
    sed -i '/--dport 22 -j ACCEPT/a -A INPUT -p tcp -m state --state NEW -m tcp --dport 80 -j ACCEPT\n-A INPUT -p tcp -m state --state NEW -m tcp --dport 443 -j ACCEPT' /etc/iptables/rules.v4
  fi
fi

# Docker official repository
if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi

if [[ ! -f /etc/apt/sources.list.d/docker.list ]]; then
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
fi

apt-get update -y
install_pkg docker-ce
install_pkg docker-ce-cli
install_pkg containerd.io
install_pkg docker-buildx-plugin
install_pkg docker-compose-plugin

systemctl enable --now docker

# Allow the SSH sudo user to run docker without sudo on next login.
if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
  usermod -aG docker "${SUDO_USER}" || true
fi

# Web servers / reverse proxies
install_pkg nginx
install_pkg caddy

# Avoid port 80/443 conflicts: keep nginx installed but disabled by default, caddy active.
systemctl disable --now nginx || true
systemctl enable --now caddy

# Firewall baseline
ufw allow OpenSSH || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
ufw --force enable || true

echo "[bootstrap] Completed."
echo "[bootstrap] docker: $(docker --version)"
echo "[bootstrap] compose: $(docker compose version)"
echo "[bootstrap] caddy: $(caddy version)"
echo "[bootstrap] nginx: $(nginx -v 2>&1)"
