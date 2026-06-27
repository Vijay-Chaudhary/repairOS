#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# RepairOS — one-time Hostinger VPS bootstrap (Ubuntu 24.04). Run as root.
# Idempotent: safe to re-run. Installs Docker, creates the deploy user, and
# applies baseline hardening (UFW, Fail2Ban, SSH, unattended-upgrades, swap).
#
#   curl -fsSL .../server-init.sh | bash      # or copy + run
#   DEPLOY_USER=deploy bash server-init.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
SWAP_GB="${SWAP_GB:-2}"

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

if [[ $EUID -ne 0 ]]; then echo "Run as root." >&2; exit 1; fi

log "Updating apt and installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg git ufw fail2ban unattended-upgrades

log "Installing Docker Engine + compose plugin (idempotent)"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

log "Creating deploy user '${DEPLOY_USER}'"
if ! id "${DEPLOY_USER}" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "${DEPLOY_USER}"
fi
usermod -aG docker "${DEPLOY_USER}"

log "Configuring swap (${SWAP_GB}G) — protects against OOM on the 8 GB box"
if [[ ! -f /swapfile ]]; then
  fallocate -l "${SWAP_GB}G" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10
  grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
fi

log "Configuring UFW firewall (SSH + HTTP + HTTPS only)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

log "Configuring Fail2Ban (sshd jail)"
cat > /etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled = true
maxretry = 5
bantime = 1h
findtime = 10m
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

log "Hardening SSH (key-only, no root login)"
SSHD=/etc/ssh/sshd_config.d/99-repaiross.conf
cat > "$SSHD" <<'EOF'
PermitRootLogin no
PasswordAuthentication no
ChallengeResponseAuthentication no
X11Forwarding no
EOF
# Only restart sshd if the deploy user already has an authorized key, so we
# don't lock ourselves out on a fresh box.
if [[ -s "/home/${DEPLOY_USER}/.ssh/authorized_keys" ]]; then
  systemctl restart ssh
else
  echo "WARNING: no authorized_keys for ${DEPLOY_USER} yet — NOT restarting sshd."
  echo "Add the deploy public key, then: systemctl restart ssh"
fi

log "Enabling automatic security updates"
echo 'Unattended-Upgrade::Automatic-Reboot "false";' > /etc/apt/apt.conf.d/51unattended-upgrades-local
dpkg-reconfigure -f noninteractive unattended-upgrades || true

log "Bootstrap complete. Next:"
cat <<EOF
  1. As ${DEPLOY_USER}: git clone the repo into ~/repairOS
  2. cp .env.production.example .env  &&  fill secrets  &&  chmod 600 .env
  3. Issue TLS certs (see docs/deployment.md), then run infra/scripts/deploy.sh
EOF
