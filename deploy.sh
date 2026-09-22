#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# EzFD — Production deployment script
# Supports Debian, Ubuntu and Raspberry Pi OS only, plus derivatives that
# declare that heritage (Mint, Pop!_OS). It stops on anything else.
#
# That is a deliberately small surface, not a judgement about other
# distributions: the app is an ordinary Node standalone build against
# PostgreSQL and runs anywhere. What is narrow is this script, and keeping it
# narrow is what keeps it correct while the app changes underneath it. On
# another distribution, build and deploy by hand.
#
# Usage (run from the root of the cloned repository):
#   sudo bash deploy.sh
#
# Re-running the script performs an in-place update: packages already
# installed are skipped, the app is rebuilt and redeployed, and the
# service is restarted. No data is lost.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
IFS=$'\n\t'

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $*"; }
info() { echo -e "${BLUE}[→]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
die()  { echo -e "${RED}[✗] $*${NC}" >&2; exit 1; }
hr()   { echo -e "${BOLD}──────────────────────────────────────────────${NC}"; }
prompt() {
  # prompt <var_name> <label> [default]
  local var="$1" label="$2" default="${3:-}"
  local hint=""
  [[ -n "$default" ]] && hint=" [default: $default]"
  read -rp "$(echo -e "  ${BOLD}${label}${NC}${hint}: ")" value
  value="${value:-$default}"
  printf -v "$var" '%s' "$value"
}
confirm() {
  # confirm <message>  — exits unless user says y/Y/enter
  read -rp "$(echo -e "  ${BOLD}$1${NC} [Y/n]: ")" ans
  if [[ "${ans,,}" == "n" ]]; then die "Aborted."; fi
}

# ── Pre-flight checks ─────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && die "Run with root privileges: sudo bash deploy.sh"
[[ ! -f "package.json" ]] && die "Must be run from the root of the EzFD repository."

# The Node major this app is built, tested and run on. .nvmrc is the one place
# it is written: CI reads it too, so a server can't be put on a Node version CI
# never ran. It is a floor, not a pin — a newer major is left alone.
NODE_MAJOR="$(tr -d '[:space:]v' < .nvmrc 2>/dev/null || true)"
[[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] || die ".nvmrc is missing or does not hold a Node major version."

# Debian and Ubuntu (and derivatives, which declare it in ID_LIKE) get the
# automatic package install below. Anything else is still supported and is not
# a hard failure: a field server is often whatever hardware a club already has,
# an old laptop running something else included. On those the script installs
# nothing and checks the prerequisites are present instead, which is a far more
# useful answer than refusing to run on a machine that is perfectly capable.
# OS_RELEASE is overridable so scripts/test-deploy-detect.sh can drive this
# block with real /etc/os-release files from distros this machine is not.
OS_RELEASE="${OS_RELEASE:-/etc/os-release}"
DISTRO_ID=""; DISTRO_CODENAME=""; DISTRO_LIKE=""
if [[ -r "$OS_RELEASE" ]]; then
  DISTRO_ID="$(grep '^ID=' "$OS_RELEASE" | cut -d= -f2 | tr -d '"' || true)"
  DISTRO_CODENAME="$(grep '^VERSION_CODENAME=' "$OS_RELEASE" | cut -d= -f2 | tr -d '"' || true)"
  DISTRO_LIKE="$(grep '^ID_LIKE=' "$OS_RELEASE" | cut -d= -f2 | tr -d '"' || true)"
fi

APT_OS=false
if [[ "$DISTRO_ID" == "ubuntu" || "$DISTRO_ID" == "debian" ]] ||
   [[ " $DISTRO_LIKE " == *" debian "* || " $DISTRO_LIKE " == *" ubuntu "* ]]; then
  APT_OS=true
fi
# ID_LIKE can claim a heritage the machine does not actually have the tooling
# for, so the deciding question is whether apt-get is really there.
command -v apt-get >/dev/null 2>&1 || APT_OS=false
# ── end of distro detection (scripts/test-deploy-detect.sh reads to here) ────

# systemd is not negotiable — the service unit this script writes is the whole
# mechanism by which EzFD starts, and starts again after a power cut.
command -v systemctl >/dev/null 2>&1 || \
  die "systemd is required (no systemctl found). EzFD runs as a systemd service."

# Everything past this point assumes Debian's layout — where nginx reads server
# blocks from, that the PostgreSQL package creates and starts a cluster, that
# the firewall is ufw, where nologin lives. Those assumptions used to be made
# silently on machines that did not hold them, which produced a deploy that
# reported success and a site that served nginx's welcome page. Stopping here
# is the honest version of the same scope.
if [[ "$APT_OS" == "false" ]]; then
  echo
  warn "This script supports Debian, Ubuntu and Raspberry Pi OS."
  warn "This machine reports '${DISTRO_ID:-unknown}', so it stops here."
  echo
  warn "EzFD itself runs anywhere — it is a Node standalone build against"
  warn "PostgreSQL, behind any reverse proxy. What is Debian-specific is this"
  warn "script. To deploy by hand, the shape is:"
  warn "  • Node ${NODE_MAJOR}+, PostgreSQL, nginx, rsync, openssl from your package manager"
  warn "  • createuser/createdb, then apply db/schema.sql once — it is complete,"
  warn "    and the migrations in this script are only for upgrading older installs"
  warn "  • npm ci && npm run build, then run .next/standalone/server.js"
  warn "  • a reverse proxy with proxy_buffering off, or SSE will not stream"
  echo
  die "Unsupported distribution for automatic deployment."
fi

REPO_DIR="$(pwd)"
APP_DIR="/opt/ezfd"
APP_USER="ezfd"
SERVICE_FILE="/etc/systemd/system/ezfd.service"
NGINX_SITE="/etc/nginx/sites-available/ezfd"

# ── Detect update vs fresh install ───────────────────────────────────────────
UPDATING=false
if [[ -d "$APP_DIR" ]] || systemctl is-active --quiet ezfd 2>/dev/null; then
  UPDATING=true
fi

# ── Banner ────────────────────────────────────────────────────────────────────
echo
echo -e "${BOLD}${GREEN}"
echo "  ███████╗███████╗███████╗██████╗ "
echo "  ██╔════╝╚══███╔╝██╔════╝██╔══██╗"
echo "  █████╗    ███╔╝ █████╗  ██║  ██║"
echo "  ██╔══╝   ███╔╝  ██╔══╝  ██║  ██║"
echo "  ███████╗███████╗██║     ██████╔╝"
echo "  ╚══════╝╚══════╝╚═╝     ╚═════╝ "
echo -e "${NC}"
echo -e "  ${BOLD}Field Day Logger — Deployment Script${NC}"
if [[ "$UPDATING" == "true" ]]; then
  echo -e "  ${YELLOW}Existing installation detected — running update${NC}"
fi
hr

# ── Gather configuration ─────────────────────────────────────────────────────
echo
echo -e "${BOLD}Configuration${NC}"
echo

# Domain — pre-fill from previous deploy if available
SAVED_DOMAIN="$(grep '^EZFD_DOMAIN=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2- || true)"
prompt DOMAIN "Domain name (e.g. fd.w0ny.xyz) — leave blank for IP-only access" "${SAVED_DOMAIN}"
DOMAIN="${DOMAIN,,}"

# SSL / Let's Encrypt — pre-fill email from previous deploy if available
SETUP_SSL=false
CERT_EMAIL=""
if [[ -n "$DOMAIN" ]]; then
  SAVED_EMAIL="$(grep '^EZFD_CERT_EMAIL=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2- || true)"
  echo
  echo -e "  ${BLUE}Tip:${NC} SSL requires that ${BOLD}$DOMAIN${NC} already points to this server's IP."
  prompt CERT_EMAIL "Email for Let's Encrypt (leave blank to skip SSL for now)" "${SAVED_EMAIL}"
  [[ -n "$CERT_EMAIL" ]] && SETUP_SSL=true
fi

# PostgreSQL password
echo
GENERATED_PW="$(openssl rand -base64 32 | tr -d '/+=' | head -c 30)"
if [[ -f "$APP_DIR/.env" ]]; then
  # Reuse existing password on updates
  EXISTING_PW="$(grep '^DATABASE_URL=' "$APP_DIR/.env" 2>/dev/null | sed 's|.*://ezfd:\(.*\)@.*|\1|')"
  prompt PG_PASS "PostgreSQL password" "${EXISTING_PW:-$GENERATED_PW}"
else
  prompt PG_PASS "PostgreSQL password (leave blank to auto-generate)" "$GENERATED_PW"
fi

# Encryption key — auto-generated on first run, preserved on updates
EZFD_ENC_KEY=""
if [[ -f "$APP_DIR/.env" ]]; then
  EZFD_ENC_KEY="$(grep '^EZFD_ENCRYPTION_KEY=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2- || true)"
fi
if [[ -z "$EZFD_ENC_KEY" ]]; then
  EZFD_ENC_KEY="$(openssl rand -hex 32)"
  info "Generated new EZFD_ENCRYPTION_KEY (stored in $APP_DIR/.env)"
fi

# Admin key — optional, preserved on updates, prompt to set on fresh install
EZFD_ADMIN_KEY=""
if [[ -f "$APP_DIR/.env" ]]; then
  EZFD_ADMIN_KEY="$(grep '^EZFD_ADMIN_KEY=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2- || true)"
fi
if [[ "$UPDATING" == "false" && -z "$EZFD_ADMIN_KEY" ]]; then
  echo
  echo -e "  ${BLUE}Tip:${NC} Setting an admin key prevents unauthorised event creation on public servers."
  prompt EZFD_ADMIN_KEY "Admin key (leave blank to allow open event creation)" ""
fi

echo
hr
echo -e "${BOLD}Summary${NC}"
echo
printf "  %-22s %s\n" "OS:"      "${DISTRO_ID:-unknown} ${DISTRO_CODENAME:-}"
printf "  %-22s %s\n" "Packages:" "installed automatically (apt)"
printf "  %-22s %s\n" "Mode:"    "$([[ $UPDATING == true ]] && echo 'Update existing install' || echo 'Fresh install')"
printf "  %-22s %s\n" "Domain:"  "${DOMAIN:-"(none — IP access only)"}"
printf "  %-22s %s\n" "SSL:"     "$([[ $SETUP_SSL == true ]] && echo "Let's Encrypt ($CERT_EMAIL)" || echo 'No')"
printf "  %-22s %s\n" "App dir:" "$APP_DIR"
printf "  %-22s %s\n" "Service:" "ezfd.service (systemd)"
printf "  %-22s %s\n" "DB:"      "postgresql://ezfd:***@localhost/ezfd"
echo
confirm "Proceed with deployment?"
echo

# ── Install system packages (skip on update) ──────────────────────────────────
if [[ "$UPDATING" == "false" && "$APT_OS" == "true" ]]; then
  info "Installing system packages..."
  export DEBIAN_FRONTEND=noninteractive
  # Remove any PGDG source left over from a previous partial run so the
  # initial apt-get update doesn't fail on it before we handle it properly.
  rm -f /etc/apt/sources.list.d/pgdg.list
  apt-get update -qq

  # Core utilities
  apt-get install -y -qq curl ca-certificates gnupg lsb-release rsync git ufw >/dev/null

  # ── PostgreSQL (PGDG preferred; falls back to distro default) ────────────
  if ! command -v psql &>/dev/null; then
    info "Installing PostgreSQL..."
    install -d /usr/share/postgresql-common/pgdg
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt ${DISTRO_CODENAME}-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list
    # Try PGDG (PostgreSQL 16). If the distro codename isn't in PGDG (e.g.
    # focal is EOL), fall back to whatever PostgreSQL the distro ships.
    if apt-get update -qq 2>/dev/null && apt-get install -y -qq postgresql-16 >/dev/null 2>&1; then
      true
    else
      warn "PGDG PostgreSQL 16 unavailable for '${DISTRO_CODENAME}' — installing distro PostgreSQL"
      rm -f /etc/apt/sources.list.d/pgdg.list
      apt-get update -qq
      apt-get install -y -qq postgresql >/dev/null
    fi
  fi
  log "PostgreSQL $(psql --version | awk '{print $3}')"

  # ── nginx ─────────────────────────────────────────────────────────────────
  if ! command -v nginx &>/dev/null; then
    info "Installing nginx..."
    apt-get install -y -qq nginx >/dev/null
  fi
  log "nginx $(nginx -v 2>&1 | awk -F/ '{print $2}')"


  # ── Firewall ──────────────────────────────────────────────────────────────
  info "Configuring UFW firewall..."
  ufw --force reset >/dev/null 2>&1
  ufw default deny incoming  >/dev/null 2>&1
  ufw default allow outgoing >/dev/null 2>&1
  ufw allow OpenSSH          >/dev/null 2>&1
  ufw allow 'Nginx Full'     >/dev/null 2>&1
  ufw --force enable         >/dev/null 2>&1
  log "Firewall: SSH + HTTP(S) allowed, all else blocked"

fi

# ── Node.js (NodeSource) — on updates too ────────────────────────────────────
# Outside the fresh-install block on purpose. Inside it, a server installed on
# Node 20 stayed on Node 20 through every redeploy — past its end of life — and
# the old check (`grep '^v20'`) also treated a newer Node as missing. A server
# below NODE_MAJOR is moved up to it here; the build below then runs on the new
# Node and the service restart picks it up. An update already needs the network
# for `npm ci`, so this adds no new dependency on it.
if [[ "$APT_OS" == "true" ]]; then
  CUR_NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [[ ! "$CUR_NODE_MAJOR" =~ ^[0-9]+$ ]] || [[ "$CUR_NODE_MAJOR" -lt "$NODE_MAJOR" ]]; then
    if [[ "$CUR_NODE_MAJOR" == "0" ]]; then
      info "Installing Node.js ${NODE_MAJOR}..."
    else
      info "Upgrading Node.js ${CUR_NODE_MAJOR} → ${NODE_MAJOR}..."
    fi
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null 2>&1 \
      || die "Could not add the NodeSource repository for Node.js ${NODE_MAJOR} (it publishes for amd64 and arm64 only)."
    apt-get install -y -qq nodejs >/dev/null \
      || die "Could not install Node.js ${NODE_MAJOR}."
  fi
  log "Node.js $(node -v)"
fi

# ── System user ───────────────────────────────────────────────────────────────
# Not Debian-specific, and needed on every path, so it sits outside the block
# above rather than inside it.
if [[ "$UPDATING" == "false" ]] && ! id "$APP_USER" &>/dev/null; then
  useradd --system \
          --shell /usr/sbin/nologin \
          --home-dir "$APP_DIR" \
          --create-home \
          "$APP_USER"
  log "System user '$APP_USER' created"
fi

# ── certbot (runs every deploy — needed before SSL step below) ───────────────
if [[ "$SETUP_SSL" == "true" ]]; then
  NEED_CERTBOT=false
  ! command -v certbot &>/dev/null && NEED_CERTBOT=true
  ! dpkg -l python3-certbot-nginx 2>/dev/null | grep -q '^ii' && NEED_CERTBOT=true
  if [[ "$NEED_CERTBOT" == "true" && "$APT_OS" == "true" ]]; then
    info "Installing certbot and nginx plugin..."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
    log "certbot $(certbot --version 2>&1 | awk '{print $NF}')"
  elif [[ "$NEED_CERTBOT" == "true" ]]; then
    warn "certbot is not installed and this script cannot install it here."
    warn "Install certbot and its nginx plugin, then re-run to obtain a certificate."
    warn "Continuing without SSL — the site will serve over plain HTTP."
    SETUP_SSL=false
  else
    log "certbot + nginx plugin already installed — $(certbot --version 2>&1 | awk '{print $NF}')"
  fi
fi

# ── PostgreSQL: database + schema ─────────────────────────────────────────────
info "Configuring database..."
systemctl start  postgresql >/dev/null 2>&1 || true
systemctl enable postgresql >/dev/null 2>&1 || true

# Create role (idempotent)
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='ezfd'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE USER ezfd WITH PASSWORD '$PG_PASS';" >/dev/null
  log "Database user 'ezfd' created"
else
  # Update password in case it changed
  sudo -u postgres psql -c "ALTER USER ezfd WITH PASSWORD '$PG_PASS';" >/dev/null
  log "Database user 'ezfd' password updated"
fi

# Create database (idempotent)
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='ezfd'" | grep -q 1; then
  sudo -u postgres createdb -O ezfd ezfd
  log "Database 'ezfd' created"
fi

# Apply base schema (CREATE TABLE IF NOT EXISTS, triggers — safe to re-run on fresh DB)
# The input redirect is deliberately performed by *this* shell, not by the
# sudo'd process: schema.sql lives in the repo checkout, which the deploying
# user can read and the postgres user generally cannot. SC2024 warns about the
# opposite case (a redirect needing the elevated user's privileges).
# shellcheck disable=SC2024
sudo -u postgres psql -d ezfd >/dev/null < "$REPO_DIR/db/schema.sql"
log "Database schema applied"

# ── Schema migrations ─────────────────────────────────────────────────────────
# Each migration is checked against the live schema before running — safe to
# re-run on any install. Add new migrations at the END of this block only;
# never edit or remove existing entries.
# Format: apply_migration "description" "check SQL → returns 1 if done" "SQL to run"
# ─────────────────────────────────────────────────────────────────────────────
MIGRATIONS_APPLIED=0
MIGRATIONS_SKIPPED=0

apply_migration() {
  local name="$1" check_sql="$2" apply_sql="$3"
  if sudo -u postgres psql -d ezfd -tAc "$check_sql" 2>/dev/null | grep -q 1; then
    ((MIGRATIONS_SKIPPED++)) || true
  else
    if sudo -u postgres psql -d ezfd -c "$apply_sql" >/dev/null 2>&1; then
      log "  [new]  $name"
      ((MIGRATIONS_APPLIED++)) || true
    else
      warn "  [FAIL] $name — check DB manually"
    fi
  fi
}

# ── v2: bonus point tracker ───────────────────────────────────────────────────
apply_migration \
  "events.bonuses (bonus point tracker)" \
  "SELECT 1 FROM information_schema.columns
     WHERE table_name='events' AND column_name='bonuses'" \
  "ALTER TABLE events
     ADD COLUMN bonuses JSONB NOT NULL DEFAULT '{}'::jsonb"

# ── v3: Winter Field Day support ──────────────────────────────────────────────
apply_migration \
  "events.event_type (FD/WFD)" \
  "SELECT 1 FROM information_schema.columns
     WHERE table_name='events' AND column_name='event_type'" \
  "ALTER TABLE events
     ADD COLUMN event_type TEXT NOT NULL DEFAULT 'FD'"

# ── v4: power category ────────────────────────────────────────────────────────
apply_migration \
  "events.power (HIGH/LOW/QRP)" \
  "SELECT 1 FROM information_schema.columns
     WHERE table_name='events' AND column_name='power'" \
  "ALTER TABLE events
     ADD COLUMN power TEXT NOT NULL DEFAULT 'HIGH'"

# ── v5: N1MM call history + master callsign (MASTER.SCP) file ─────────────────
apply_migration \
  "events.use_call_history / use_master_callsign_file (call databases)" \
  "SELECT 1 FROM information_schema.columns
     WHERE table_name='events' AND column_name='use_call_history'" \
  "ALTER TABLE events
     ADD COLUMN use_call_history         BOOLEAN NOT NULL DEFAULT FALSE,
     ADD COLUMN use_master_callsign_file BOOLEAN NOT NULL DEFAULT FALSE"

apply_migration \
  "call_history_entries + master_callsigns tables" \
  "SELECT 1 FROM information_schema.tables
     WHERE table_name='master_callsigns'" \
  "CREATE TABLE IF NOT EXISTS call_history_entries (
     id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
     callsign    TEXT NOT NULL,
     sent_class  TEXT,
     section     TEXT,
     name        TEXT,
     user_text   TEXT,
     UNIQUE (event_id, callsign));
   CREATE INDEX IF NOT EXISTS call_history_event_idx ON call_history_entries(event_id);
   CREATE TABLE IF NOT EXISTS master_callsigns (
     callsign   TEXT        PRIMARY KEY,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
   GRANT SELECT, INSERT, UPDATE, DELETE ON call_history_entries, master_callsigns TO ezfd"

# ── add future migrations above this line ────────────────────────────────────

if   [[ $MIGRATIONS_APPLIED -gt 0 ]]; then
  log "Migrations: $MIGRATIONS_APPLIED applied, $MIGRATIONS_SKIPPED already up to date"
else
  log "Migrations: all ${MIGRATIONS_SKIPPED} up to date"
fi

# ── Swap file (prevents npm ci / next build from getting OOM-killed on ──────
# ── low-RAM VPS instances, e.g. the 1GB droplets this is commonly deployed on)
TOTAL_MEM_MB="$(free -m | awk '/^Mem:/{print $2}')"
SWAP_MB="$(free -m | awk '/^Swap:/{print $2}')"
if [[ "$SWAP_MB" -eq 0 && "$TOTAL_MEM_MB" -lt 2048 ]]; then
  info "Low RAM (${TOTAL_MEM_MB}MB) with no swap — adding a 2GB swap file so the build can't get OOM-killed..."
  if [[ -f /swapfile ]]; then
    swapon /swapfile 2>/dev/null || true
    log "Swap file already present"
  elif fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 2>/dev/null; then
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null 2>&1
    swapon /swapfile 2>/dev/null || true
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    log "Swap file active ($(free -m | awk '/^Swap:/{print $2}')MB)"
  else
    warn "Could not create a swap file — if the build below gets 'Killed', add swap manually and re-run."
  fi
else
  log "Memory OK (${TOTAL_MEM_MB}MB RAM, ${SWAP_MB}MB swap)"
fi

# ── Build ─────────────────────────────────────────────────────────────────────
info "Building application (this takes ~60 seconds)..."
cd "$REPO_DIR"
npm ci --silent
npm run build
log "Build complete"

# ── Deploy files ──────────────────────────────────────────────────────────────
info "Deploying to $APP_DIR..."
mkdir -p "$APP_DIR"

# Sync standalone server and assets; --delete removes files no longer present
rsync -a --delete "${REPO_DIR}/.next/standalone/"  "$APP_DIR/"
rsync -a --delete "${REPO_DIR}/.next/static/"      "$APP_DIR/.next/static/"
rsync -a --delete "${REPO_DIR}/public/"            "$APP_DIR/public/"

# Environment file — owns secrets, restricted to app user
cat > "$APP_DIR/.env" <<EOF
NODE_ENV=production
PORT=3000
HOSTNAME=127.0.0.1
DATABASE_URL=postgresql://ezfd:${PG_PASS}@localhost/ezfd
EZFD_ENCRYPTION_KEY=${EZFD_ENC_KEY}
EZFD_ADMIN_KEY=${EZFD_ADMIN_KEY}
EZFD_DOMAIN=${DOMAIN}
EZFD_CERT_EMAIL=${CERT_EMAIL}
EZFD_REPO_DIR=${REPO_DIR}
EOF
chmod 600   "$APP_DIR/.env"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
log "Files deployed"

# ── systemd service ───────────────────────────────────────────────────────────
info "Configuring systemd service..."
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=EzFD Field Day Logger
Documentation=https://github.com/nreed97/EzFD
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=$(command -v node) $APP_DIR/server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ezfd

# Sandbox hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR
PrivateTmp=true
CapabilityBoundingSet=

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --quiet ezfd
systemctl restart ezfd

# Give the process a moment to start
sleep 3
if systemctl is-active --quiet ezfd; then
  log "ezfd service is running"
else
  die "ezfd failed to start. Check logs: journalctl -u ezfd -n 50"
fi

# ── nginx ─────────────────────────────────────────────────────────────────────
info "Configuring nginx..."
SERVER_NAME="${DOMAIN:-"_"}"
[[ -n "$DOMAIN" ]] && SERVER_NAME="$DOMAIN www.$DOMAIN"

cat > "$NGINX_SITE" <<'NGINXEOF'
# EzFD — managed by deploy.sh; manual edits may be overwritten on next deploy
NGINXEOF

cat >> "$NGINX_SITE" <<EOF
server {
    listen 80;
    server_name ${SERVER_NAME};

    # Allow long-lived SSE connections (real-time QSO updates stream indefinitely)
    proxy_read_timeout  3600s;
    proxy_send_timeout  3600s;
    send_timeout        3600s;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # Pass upgrade headers for WebSocket compatibility
        proxy_set_header   Upgrade           \$http_upgrade;
        proxy_set_header   Connection        '';
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;

        # CRITICAL: disable nginx buffering — without this SSE is broken
        proxy_buffering           off;
        proxy_cache               off;
        chunked_transfer_encoding on;
    }
}
EOF

ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/ezfd
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t >/dev/null 2>&1 || die "nginx config invalid — check $NGINX_SITE"
systemctl reload nginx
log "nginx configured"

# ── SSL certificate ───────────────────────────────────────────────────────────
if [[ "$SETUP_SSL" == "true" ]]; then
  info "Obtaining Let's Encrypt certificate for $DOMAIN..."
  if certbot --nginx \
       --non-interactive \
       --agree-tos \
       --email "$CERT_EMAIL" \
       --domains "$DOMAIN" \
       --redirect \
       >/dev/null 2>&1; then
    log "SSL certificate issued — auto-renewal enabled via certbot.timer"
    # Verify the renewal timer is active
    systemctl is-active --quiet snap.certbot.renew.timer 2>/dev/null || \
    systemctl is-active --quiet certbot.timer 2>/dev/null || \
      warn "Could not verify auto-renewal timer — run 'certbot renew --dry-run' to test"
  else
    warn "Certbot failed. Possible reasons:"
    warn "  • DNS A record for $DOMAIN hasn't propagated yet"
    warn "  • Port 80 is not reachable from the internet"
    warn "Once DNS is ready, run: certbot --nginx -d $DOMAIN"
  fi
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo
hr
echo -e "${GREEN}${BOLD}  Deployment complete!${NC}"
hr
echo

SERVER_IP="$(hostname -I | awk '{print $1}')"
if [[ "$SETUP_SSL" == "true" ]]; then
  APP_URL="https://$DOMAIN"
elif [[ -n "$DOMAIN" ]]; then
  APP_URL="http://$DOMAIN"
else
  APP_URL="http://$SERVER_IP"
fi

echo -e "  ${BOLD}URL:${NC}       $APP_URL"
echo
echo -e "  ${BOLD}DB password:${NC}"
echo -e "    $PG_PASS"
if [[ -n "$EZFD_ADMIN_KEY" ]]; then
echo -e "  ${BOLD}Admin key:${NC}"
echo -e "    $EZFD_ADMIN_KEY"
fi
echo -e "  ${YELLOW}(secrets saved to $APP_DIR/.env — keep this file private)${NC}"
echo
echo -e "  ${BOLD}Useful commands:${NC}"
echo -e "    Live logs:   journalctl -u ezfd -f"
echo -e "    Status:      systemctl status ezfd"
echo -e "    Restart:     systemctl restart ezfd"
echo -e "    Update:      git pull && sudo bash deploy.sh"
echo
echo -e "  ${BOLD}Backup:${NC}"
echo -e "    pg_dump -U ezfd ezfd | gzip > ezfd_\$(date +%Y%m%d).sql.gz"
echo
