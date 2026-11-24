#!/usr/bin/env bash
set -Eeuo pipefail

# RebeccaSellBot — Minimal, production-grade installer & lifecycle bootstrapper
# Supports Ubuntu 22.04/24.04 LTS & Debian 12+, interactive TTY (including curl | bash),
# unattended --env-file provisioning, and zero-downtime --from-backup migration.

readonly INSTALL_ROOT="${RSBOT_BASE_PATH:-/opt/RebeccaSellBot}"
readonly DEFAULT_REPOSITORY_URL="${RSBOT_REPOSITORY_URL:-${REPOSITORY_URL:-https://github.com/Ho3einK84/RebeccaSellBot.git}}"

if [[ -t 1 ]]; then
  readonly BOLD=$'\033[1m' DIM=$'\033[2m' RESET=$'\033[0m'
  readonly CYAN=$'\033[38;5;51m' BLUE=$'\033[38;5;75m' GREEN=$'\033[38;5;42m'
  readonly YELLOW=$'\033[38;5;220m' RED=$'\033[38;5;203m' PURPLE=$'\033[38;5;141m'
else
  readonly BOLD="" DIM="" RESET="" CYAN="" BLUE="" GREEN="" YELLOW="" RED="" PURPLE=""
fi

NON_INTERACTIVE=false
ASSUME_YES=false
ACTION_MODE="install"
INSTANCE_INPUT="${RSBOT_INSTANCE:-}"
REPOSITORY_INPUT="$DEFAULT_REPOSITORY_URL"
ACCESS_METHOD_INPUT="${RSBOT_ACCESS_METHOD:-}"
SSH_KEY_INPUT="${RSBOT_SSH_KEY_PATH:-}"
CONFIG_SOURCE_FILE=""
BACKUP_INPUT="${RSBOT_FROM_BACKUP:-}"
BACKUP_WORKSPACE=""
MANIFEST_INSTANCE=""

banner() {
  printf '\n%s  ✦ RebeccaSellBot%s %s— Telegram Storefront & Mini App Deployment%s\n' "$BOLD$PURPLE" "$RESET" "$DIM" "$RESET"
  printf '%s  ────────────────────────────────────────────────────────────%s\n' "$DIM" "$RESET"
}

section() { printf '\n%s▸ %s%s%s\n' "$PURPLE" "$BOLD" "$*" "$RESET"; }
step() { printf '\n%s[%s%s%s]%s %s%s%s\n' "$DIM" "$CYAN" "$1" "$DIM" "$RESET" "$BOLD" "$2" "$RESET"; }
info() { printf '  %s•%s %s\n' "$CYAN" "$RESET" "$*"; }
success() { printf '  %s✔%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die() { printf '  %s✘%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

on_error() {
  local exit_code=$?
  printf '\n  %s✘%s Installation stopped near line %s (exit %s).%s\n' \
    "$RED" "$RESET" "${BASH_LINENO[0]:-unknown}" "$exit_code" "$RESET" >&2
  exit "$exit_code"
}
trap on_error ERR

show_help() {
  cat <<'EOF'
RebeccaSellBot — Installer & Lifecycle Bootstrapper

Usage:
  ./install.sh [options]

Core Options:
  --instance <name>          Instance namespace (default: main)
  --env-file <path>          Pre-populated KEY=value environment file
  --from-backup <path>       Bootstrap and restore directly from a backup bundle (.tar.gz)
  --update                   Update an existing instance (git pull, rebuild, migrate, restart)
  --uninstall                Uninstall an existing instance and its volumes
  --non-interactive          Never prompt; fail if required values are missing
  --yes, -y                  Overwrite existing instance .env without confirmation
  -h, --help                 Show this help message

Delivery & Mini App Options:
  --webapp-url <url>         Public Telegram Mini App HTTPS URL (e.g. https://shop.example.com)
  --webapp-port <port>       Internal container Fastify port (default: 3002)
  --webapp-host-port <port>  Host published port for Mini App reverse proxy (auto-assigned)
  --webapp-bind-host <ip>    Host bind address for Mini App (default: 127.0.0.1)
  --admin-session-secret <s> Secret key for Mini App admin JWT cookies (auto-generated)
  --webhook                  Enable Telegram Webhook delivery mode (default: Long Polling)
  --webhook-url <url>        Public Telegram Webhook HTTPS URL
  --webhook-secret <token>   Webhook secret token (auto-generated if omitted)
  --webhook-port <port>      Internal container webhook port (default: 3000)
  --webhook-host-port <port> Host published port for webhook reverse proxy (auto-assigned)

Repository Options:
  --repository <url>         GitHub HTTPS or SSH repository URL
  --access-method <method>   public, ssh, or pat (auto-detected by default)
  --ssh-key <path>           SSH deploy-key path (for --access-method ssh)

Examples:
  # Interactive guided setup (supports local clone or curl | sudo bash)
  curl -fsSL https://raw.githubusercontent.com/Ho3einK84/RebeccaSellBot/main/install.sh | sudo bash

  # Unattended deployment from an env file
  ./install.sh --instance main --env-file /root/rsbot.env --non-interactive --yes

  # Server migration from a backup archive
  ./install.sh --from-backup /root/backup_main.tar.gz --non-interactive --yes
EOF
}

option_value() {
  local option="$1" value="${2:-}"
  [[ -n "$value" ]] || die "Missing value for $option."
  printf '%s' "$value"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --instance)
      INSTANCE_INPUT="$(option_value "$1" "${2:-}")"
      shift 2
      ;;
    --from-backup)
      BACKUP_INPUT="$(option_value "$1" "${2:-}")"
      shift 2
      ;;
    --update)
      ACTION_MODE="update"
      shift
      ;;
    --uninstall)
      ACTION_MODE="uninstall"
      shift
      ;;
    --repository)
      REPOSITORY_INPUT="$(option_value "$1" "${2:-}")"
      shift 2
      ;;
    --access-method)
      ACCESS_METHOD_INPUT="$(option_value "$1" "${2:-}")"
      shift 2
      ;;
    --ssh-key)
      SSH_KEY_INPUT="$(option_value "$1" "${2:-}")"
      shift 2
      ;;
    --env-file)
      CONFIG_SOURCE_FILE="$(option_value "$1" "${2:-}")"
      shift 2
      ;;
    --webhook)
      BOT_DELIVERY_MODE="webhook"
      shift
      ;;
    --webhook-url)
      WEBHOOK_URL="$(option_value "$1" "${2:-}")"
      BOT_DELIVERY_MODE="webhook"
      shift 2
      ;;
    --webhook-secret)
      WEBHOOK_SECRET_TOKEN="$(option_value "$1" "${2:-}")"
      shift 2
      ;;
    --webhook-port)
      WEBHOOK_PORT="$(option_value "$1" "${2:-}")"
      shift 2
      ;;
    --webhook-host-port)
      WEBHOOK_HOST_PORT="$(option_value "$1" "${2:-}")"
      shift 2
      ;;
    --webapp-url)
      WEBAPP_URL="$(option_value "$1" "${2:-}")"
      shift 2
      ;;
    --webapp-port)
      WEBAPP_PORT="$(option_value "$1" "${2:-}")"
      shift 2
      ;;
    --webapp-host-port)
      WEBAPP_HOST_PORT="$(option_value "$1" "${2:-}")"
      shift 2
      ;;
    --webapp-bind-host)
      WEBAPP_BIND_HOST="$(option_value "$1" "${2:-}")"
      shift 2
      ;;
    --admin-session-secret)
      ADMIN_SESSION_SECRET="$(option_value "$1" "${2:-}")"
      shift 2
      ;;
    --non-interactive)
      NON_INTERACTIVE=true
      shift
      ;;
    --yes|-y)
      ASSUME_YES=true
      shift
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      die "Unknown option: $1. Run ./install.sh --help."
      ;;
  esac
done

validate_instance() { [[ "$1" =~ ^[a-z0-9][a-z0-9_-]{0,31}$ ]]; }
validate_bot_token() { [[ "$1" =~ ^[0-9]{5,16}:[A-Za-z0-9_-]{20,}$ && "$1" != *"replace_me"* ]]; }
validate_admin_ids() { [[ "$1" =~ ^[1-9][0-9]*([[:space:]]*,[[:space:]]*[1-9][0-9]*)*$ ]]; }
validate_https_url() {
  local port
  [[ "$1" =~ ^https://[A-Za-z0-9][A-Za-z0-9.-]*(:([0-9]{1,5}))?/?$ ]] || return 1
  port="${BASH_REMATCH[2]:-}"
  [[ -z "$port" ]] || ((10#$port >= 1 && 10#$port <= 65535))
}
validate_https_url_with_path() {
  local port
  [[ "$1" =~ ^https://[A-Za-z0-9][A-Za-z0-9.-]*(:([0-9]{1,5}))?(/.*)?$ ]] || return 1
  port="${BASH_REMATCH[2]:-}"
  [[ -z "$port" ]] || ((10#$port >= 1 && 10#$port <= 65535))
}
validate_identifier() { [[ "$1" =~ ^[a-z_][a-z0-9_]{0,62}$ ]]; }
validate_database_password() { [[ "$1" =~ ^[A-Za-z0-9._~-]{12,128}$ ]]; }
validate_locale() { [[ "$1" == "fa" || "$1" == "en" ]]; }
validate_service_id() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]] || return 1
  ((${#1} < 10)) || [[ ${#1} -eq 10 && "$1" < "2147483648" ]]
}
validate_panel_credentials_key() { [[ "$1" =~ ^[A-Za-z0-9._~+=/:-]{32,512}$ ]]; }
validate_webhook_url() { validate_https_url_with_path "$1"; }
validate_webhook_secret_token() { [[ "$1" =~ ^[A-Za-z0-9_-]{1,256}$ ]]; }
validate_port() { [[ "$1" =~ ^[1-9][0-9]{0,4}$ ]] && (( 10#$1 >= 1 && 10#$1 <= 65535 )); }

is_port_in_use() {
  local p="$1"
  (exec 6<>/dev/tcp/127.0.0.1/"$p") 2>/dev/null && { exec 6>&- ; return 0; }
  if command -v ss >/dev/null 2>&1; then
    ss -tlpn 2>/dev/null | grep -qE "(:|\])${p}[[:space:]]" && return 0
  fi
  return 1
}

find_next_safe_port() {
  local candidate="$1"
  local step="${2:-1}"
  shift 2 || true
  local used=("$@")

  while :; do
    local conflict=false
    for u in "${used[@]}"; do
      if [[ -n "$u" && "$candidate" -eq "$u" ]]; then
        conflict=true
        break
      fi
    done

    if [[ "$conflict" == false ]] && ! is_port_in_use "$candidate"; then
      printf '%s' "$candidate"
      return 0
    fi

    candidate=$(( candidate + step ))
    if (( candidate > 65535 )); then
      die "Unable to find an available host port starting from $1."
    fi
  done
}

env_value_from_file() {
  local file="$1" key="$2" raw_value value cr=$'\r' sq="'"
  [[ -f "$file" ]] || return 1
  raw_value="$(sed -n "s/^${key}=//p" "$file" | head -n 1)"
  [[ -n "$raw_value" ]] || return 1
  value="${raw_value%"$cr"}"
  if [[ "$value" =~ ^\"(.*)\"$ ]]; then
    value="${BASH_REMATCH[1]}"
  elif [[ "$value" =~ ^$sq(.*)$sq$ ]]; then
    value="${BASH_REMATCH[1]}"
  fi
  printf '%s' "$value"
}

OS_ID=""
OS_PRETTY_NAME=""
OS_VERSION_CODENAME=""
OS_UBUNTU_CODENAME=""

# Parse only OS metadata keys from /etc/os-release so keys like SUPPORT_URL
# (e.g. Ubuntu's https://help.ubuntu.com/) can never clobber bot configuration.
load_os_release() {
  local file="${1:-/etc/os-release}"
  OS_ID=""
  OS_PRETTY_NAME=""
  OS_VERSION_CODENAME=""
  OS_UBUNTU_CODENAME=""
  [[ -r "$file" ]] || return 0
  OS_ID="$(env_value_from_file "$file" ID 2>/dev/null || true)"
  OS_PRETTY_NAME="$(env_value_from_file "$file" PRETTY_NAME 2>/dev/null || true)"
  OS_VERSION_CODENAME="$(env_value_from_file "$file" VERSION_CODENAME 2>/dev/null || true)"
  OS_UBUNTU_CODENAME="$(env_value_from_file "$file" UBUNTU_CODENAME 2>/dev/null || true)"
}

is_complete_backup_bundle() {
  local backup_file="$1"
  tar -tzf "$backup_file" >/dev/null 2>&1 || return 1
  local entries
  entries="$(tar -tzf "$backup_file" 2>/dev/null)" || return 1

  # Refuse symlinks, devices, pipes, sockets, or directory traversal / absolute paths
  tar -tvzf "$backup_file" 2>/dev/null | awk '
    $1 ~ /^[lspbc]/ { exit 1 }
    $NF ~ /^\// || $NF ~ /\.\./ { exit 1 }
  ' || return 1

  local clean_entries
  clean_entries="$(printf '%s\n' "$entries" | sed 's#^\./##g; /^$/d')"

  # A bundle must contain manifest.txt and database.dump
  printf '%s\n' "$clean_entries" | grep -q '^manifest\.txt$' || return 1
  printf '%s\n' "$clean_entries" | grep -q '^database\.dump$' || return 1

  return 0
}

extract_complete_backup_bundle() {
  local backup_file="$1" destination="$2"
  is_complete_backup_bundle "$backup_file" || return 1
  mkdir -p "$destination"
  chmod 700 "$destination"
  tar --no-same-owner --no-same-permissions -xzf "$backup_file" -C "$destination"

  [[ -f "$destination/manifest.txt" && ! -L "$destination/manifest.txt" ]] || return 1
  [[ -f "$destination/database.dump" && ! -L "$destination/database.dump" ]] || return 1
  chmod 0600 "$destination"/* 2>/dev/null || true
}

cleanup_workspaces() {
  if [[ -n "${BACKUP_WORKSPACE:-}" && -d "$BACKUP_WORKSPACE" ]]; then
    rm -rf -- "$BACKUP_WORKSPACE"
  fi
}
trap cleanup_workspaces EXIT

terminate_db_backends() {
  local db_user="$1" db_name="$2"
  dc exec -T db psql -U "$db_user" -d "$db_name" -c "
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = '$db_name'
      AND pid <> pg_backend_pid();
  " >/dev/null 2>&1 || true
}

validate_database_dump() {
  local dump_file="$1"
  [[ -s "$dump_file" ]] || return 1

  if dc exec -T db pg_restore --list < "$dump_file" >/dev/null 2>&1; then
    return 0
  fi

  if dc run --rm --no-deps -T bot pg_restore --list < "$dump_file" >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

restore_database_dump() {
  local dump_file="$1" db_user="$2" db_name="$3"
  terminate_db_backends "$db_user" "$db_name"

  if dc exec -T db pg_restore \
    --single-transaction \
    --exit-on-error \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    -U "$db_user" \
    -d "$db_name" < "$dump_file" 2>/dev/null; then
    return 0
  fi

  terminate_db_backends "$db_user" "$db_name"
  if dc run --rm --no-deps -T bot pg_restore -f - \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges < "$dump_file" 2>/dev/null | \
    sed -E '/^SET (transaction_timeout|idle_session_timeout) =/d' | \
    dc exec -T db psql -U "$db_user" -d "$db_name" -v ON_ERROR_STOP=1 --single-transaction >/dev/null 2>&1; then
    return 0
  fi

  terminate_db_backends "$db_user" "$db_name"
  dc exec -T db pg_restore \
    --single-transaction \
    --exit-on-error \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    -U "$db_user" \
    -d "$db_name" < "$dump_file"
}

load_config_file() {
  local source_file="$1" line key value cr=$'\r' sq="'"
  [[ -f "$source_file" && -r "$source_file" ]] || die "Cannot read configuration file: $source_file"

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%"$cr"}"
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" == *=* ]] || die "Invalid configuration line in $source_file. Use KEY=value."
    key="${line%%=*}"
    value="${line#*=}"

    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"

    if [[ "$value" =~ ^\"(.*)\"$ ]]; then
      value="${BASH_REMATCH[1]}"
    elif [[ "$value" =~ ^$sq(.*)$sq$ ]]; then
      value="${BASH_REMATCH[1]}"
    fi

    case "$key" in
      INSTANCE_NAME)
        INSTANCE_NAME="$value"
        export INSTANCE_NAME
        [[ -n "${INSTANCE_INPUT:-}" ]] || INSTANCE_INPUT="$value"
        ;;
      BOT_TOKEN|ADMIN_IDS|PANEL_CREDENTIALS_KEY|REBECCA_API_URL|REBECCA_API_KEY|REBECCA_ADMIN_USERNAME|REBECCA_ADMIN_PASSWORD|REBECCA_SERVICE_ID|DB_USER|DB_PASSWORD|DB_NAME|DATABASE_URL|DATABASE_POOL_SIZE|DEFAULT_LOCALE|SUPPORT_URL|GITHUB_PAT|RSBOT_ACCESS_METHOD|RSBOT_REPOSITORY_URL|RSBOT_SSH_KEY_PATH|BOT_DELIVERY_MODE|WEBHOOK_URL|WEBHOOK_SECRET_TOKEN|WEBHOOK_PORT|WEBHOOK_PATH|WEBHOOK_HOST|WEBHOOK_HOST_PORT|WEBHOOK_BIND_HOST|PORT|HEALTH_CHECK_PORT|REBECCA_WEBHOOK_SECRET|REBECCA_WEBHOOK_PATH|WEBAPP_URL|WEBAPP_PORT|WEBAPP_HOST|WEBAPP_HOST_PORT|WEBAPP_BIND_HOST|ADMIN_SESSION_SECRET|NODE_ENV|REGISTRY_DIR|WEBAPP_TARGET_URL)
        # Skip template placeholder values from .env.example
        if [[ "$value" == "123456:replace_me" || "$value" == "replace_with_"* ]]; then
          continue
        fi
        printf -v "$key" '%s' "$value"
        export "$key"
        ;;
      *)
        die "Unsupported key '$key' in $source_file."
        ;;
    esac
  done < "$source_file"

  # Extract DB_USER / DB_PASSWORD / DB_NAME from DATABASE_URL if not explicitly specified
  if [[ -n "${DATABASE_URL:-}" && "$DATABASE_URL" =~ ^postgres(ql)?://([^:/@]+):([^@]+)@[^:/]+(:[0-9]+)?/([^?]+)$ ]]; then
    local parsed_user="${BASH_REMATCH[2]}"
    local parsed_pass="${BASH_REMATCH[3]}"
    local parsed_db="${BASH_REMATCH[5]}"
    if [[ "$parsed_pass" != "replace_me" ]]; then
      [[ -n "${DB_USER:-}" ]] || DB_USER="$parsed_user"
      [[ -n "${DB_PASSWORD:-}" ]] || DB_PASSWORD="$parsed_pass"
      [[ -n "${DB_NAME:-}" ]] || DB_NAME="$parsed_db"
    fi
  fi
}

if [[ -n "$BACKUP_INPUT" ]]; then
  [[ -f "$BACKUP_INPUT" && -r "$BACKUP_INPUT" ]] || die "Backup file not found or not readable: $BACKUP_INPUT"
  BACKUP_INPUT="$(realpath "$BACKUP_INPUT")"
  BACKUP_WORKSPACE="$(mktemp -d)"

  extract_complete_backup_bundle "$BACKUP_INPUT" "$BACKUP_WORKSPACE" ||
    die "The backup file '$BACKUP_INPUT' is not a valid RebeccaSellBot backup bundle."

  format_version="$(sed -n 's/^format_version=//p' "$BACKUP_WORKSPACE/manifest.txt" | head -n 1)"
  [[ "$format_version" == "1" ]] ||
    die "Unsupported backup format version: ${format_version:-missing}."

  MANIFEST_INSTANCE="$(sed -n 's/^instance=//p' "$BACKUP_WORKSPACE/manifest.txt" | head -n 1)"

  if [[ -f "$BACKUP_WORKSPACE/.env" ]]; then
    for k in BOT_TOKEN ADMIN_IDS PANEL_CREDENTIALS_KEY DB_USER DB_PASSWORD DB_NAME DATABASE_POOL_SIZE REBECCA_API_URL REBECCA_API_KEY REBECCA_ADMIN_USERNAME REBECCA_ADMIN_PASSWORD REBECCA_SERVICE_ID DEFAULT_LOCALE SUPPORT_URL BOT_DELIVERY_MODE WEBHOOK_URL WEBHOOK_SECRET_TOKEN WEBHOOK_PORT WEBHOOK_PATH WEBHOOK_HOST WEBHOOK_HOST_PORT WEBHOOK_BIND_HOST PORT HEALTH_CHECK_PORT REBECCA_WEBHOOK_SECRET REBECCA_WEBHOOK_PATH WEBAPP_URL WEBAPP_PORT WEBAPP_HOST WEBAPP_HOST_PORT WEBAPP_BIND_HOST ADMIN_SESSION_SECRET; do
      val="$(env_value_from_file "$BACKUP_WORKSPACE/.env" "$k" 2>/dev/null || true)"
      if [[ -n "$val" && -z "${!k:-}" ]]; then
        printf -v "$k" '%s' "$val"
        export "$k"
      fi
    done
  fi
fi

if [[ -n "$CONFIG_SOURCE_FILE" ]]; then
  load_config_file "$CONFIG_SOURCE_FILE"
  [[ "$REPOSITORY_INPUT" != "$DEFAULT_REPOSITORY_URL" ]] || REPOSITORY_INPUT="${RSBOT_REPOSITORY_URL:-$REPOSITORY_INPUT}"
  [[ -n "$ACCESS_METHOD_INPUT" ]] || ACCESS_METHOD_INPUT="${RSBOT_ACCESS_METHOD:-}"
  [[ -n "$SSH_KEY_INPUT" ]] || SSH_KEY_INPUT="${RSBOT_SSH_KEY_PATH:-}"
fi

if [[ $EUID -eq 0 ]]; then
  SUDO=()
  INSTALL_OWNER="${SUDO_USER:-root}"
else
  command -v sudo >/dev/null 2>&1 || die "sudo is required for installation."
  sudo -v
  SUDO=(sudo)
  INSTALL_OWNER="$USER"
fi

if [[ "$INSTALL_OWNER" == "root" ]]; then
  AS_OWNER=()
else
  AS_OWNER=(sudo -u "$INSTALL_OWNER")
fi
readonly INSTALL_OWNER_HOME="$(getent passwd "$INSTALL_OWNER" | cut -d: -f6)"
[[ -n "$INSTALL_OWNER_HOME" ]] || die "Could not determine the home directory for $INSTALL_OWNER."

run_as_owner() { "${AS_OWNER[@]}" "$@"; }
run_as_owner_env() {
  local assignment="$1"
  shift
  if [[ "$INSTALL_OWNER" == "root" ]]; then
    env "$assignment" "$@"
  else
    sudo -u "$INSTALL_OWNER" env "$assignment" "$@"
  fi
}

if docker info >/dev/null 2>&1; then
  DOCKER=(docker)
else
  DOCKER=("${SUDO[@]}" docker)
fi

# Read interactive input safely even when script is piped via `curl ... | sudo bash`
tty_read() {
  if [[ -t 0 ]]; then
    read -r "$@"
  elif { true </dev/tty; } 2>/dev/null; then
    read -r "$@" </dev/tty
  else
    die "Interactive terminal (TTY) is unavailable. Pass --non-interactive with --env-file or --from-backup."
  fi
}

prompt_required() {
  local label="$1" value=""
  while [[ -z "$value" ]]; do
    tty_read -p "  $label: " value
  done
  printf '%s' "$value"
}

prompt_default() {
  local label="$1" default_value="$2" value=""
  if [[ -n "$default_value" ]]; then
    tty_read -p "  $label [$default_value]: " value
  else
    tty_read -p "  $label: " value
  fi
  printf '%s' "${value:-$default_value}"
}

prompt_secret() {
  local label="$1" value=""
  tty_read -s -p "  $label: " value
  printf '\n' >&2
  printf '%s' "$value"
}

required_value() {
  local label="$1" supplied="${2:-}" secret="${3:-false}"
  if [[ "$NON_INTERACTIVE" == true ]]; then
    [[ -n "$supplied" ]] || die "$label must be supplied in --non-interactive mode."
    printf '%s' "$supplied"
    return
  fi
  if [[ -n "$supplied" ]]; then
    if [[ "$secret" == true ]]; then
      local masked="[keep current]"
      if ((${#supplied} >= 10)); then
        masked="[keep: ${supplied:0:4}...${supplied: -4}]"
      fi
      local input=""
      tty_read -s -p "  $label $masked: " input
      printf '\n' >&2
      printf '%s' "${input:-$supplied}"
      return
    else
      local input=""
      tty_read -p "  $label [$supplied]: " input
      printf '%s' "${input:-$supplied}"
      return
    fi
  fi
  if [[ "$secret" == true ]]; then
    prompt_secret "$label"
  else
    prompt_required "$label"
  fi
}

validated_required() {
  local label="$1" supplied="${2:-}" validator="$3" hint="$4" secret="${5:-false}" value
  while true; do
    value="$(required_value "$label" "$supplied" "$secret")"
    "$validator" "$value" && { printf '%s' "$value"; return; }
    [[ "$NON_INTERACTIVE" == false ]] || die "$label is invalid. $hint"
    warn "$hint"
    supplied=""
  done
}

dc() {
  local compose_args=(--env-file "$ENV_FILE" -p "$INSTANCE_NAME" -f "$INSTALL_DIR/docker-compose.yml")
  if [[ -f "$INSTALL_DIR/docker-compose.override.yml" ]]; then
    compose_args+=(-f "$INSTALL_DIR/docker-compose.override.yml")
  fi
  "${DOCKER[@]}" compose "${compose_args[@]}" "$@"
}

install_docker_engine() {
  local distro="${OS_ID:-ubuntu}"
  [[ "$distro" == "ubuntu" || "$distro" == "debian" ]] ||
    die "Automatic Docker installation requires Ubuntu or Debian. Install Docker Engine manually on this host."
  local codename="${OS_VERSION_CODENAME:-${OS_UBUNTU_CODENAME:-}}" architecture key_file
  [[ -n "$codename" ]] || die "Could not determine the OS codename for Docker's APT repository."
  architecture="$(dpkg --print-architecture)"
  key_file="$(mktemp)"

  info "Configuring Docker official APT repository ($distro/$codename)..."
  curl -fsSL "https://download.docker.com/linux/${distro}/gpg" -o "$key_file"
  "${SUDO[@]}" install -m 0755 -d /etc/apt/keyrings
  "${SUDO[@]}" install -m 0644 "$key_file" /etc/apt/keyrings/docker.asc
  rm -f "$key_file"

  printf '%s\n' \
    'Types: deb' \
    "URIs: https://download.docker.com/linux/${distro}" \
    "Suites: $codename" \
    'Components: stable' \
    "Architectures: $architecture" \
    'Signed-By: /etc/apt/keyrings/docker.asc' \
    | "${SUDO[@]}" tee /etc/apt/sources.list.d/docker.sources >/dev/null

  "${SUDO[@]}" apt-get update -qq
  "${SUDO[@]}" apt-get install -y -qq \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  "${SUDO[@]}" systemctl enable --now docker
  DOCKER=("${SUDO[@]}" docker)
}

clone_repository() {
  local access_method="$ACCESS_METHOD_INPUT" repository_url="$REPOSITORY_INPUT"
  local ssh_key ssh_command pat credential_file basic_auth

  if [[ -z "$access_method" ]]; then
    if [[ "$repository_url" =~ ^git@ ]]; then
      access_method="ssh"
    elif [[ -n "${GITHUB_PAT:-}" ]]; then
      access_method="pat"
    elif [[ -n "${SSH_KEY_INPUT:-}" ]]; then
      access_method="ssh"
    else
      access_method="public"
    fi
  fi

  case "$access_method" in
    public)
      [[ "$repository_url" =~ ^https://[^[:space:]]+$ ]] ||
        die "A public repository must use an HTTPS Git URL."
      run_as_owner git clone --depth 1 "$repository_url" "$INSTALL_DIR"
      ;;
    ssh)
      [[ "$repository_url" =~ ^git@github\.com:[^[:space:]]+\.git$ ]] ||
        die "An SSH repository must use git@github.com:owner/repo.git."
      ssh_key="${SSH_KEY_INPUT:-${RSBOT_SSH_KEY_PATH:-}}"
      if [[ -z "$ssh_key" ]]; then
        [[ "$NON_INTERACTIVE" == false ]] || die "RSBOT_SSH_KEY_PATH is required for SSH installation."
        ssh_key="$(prompt_default "Read-only SSH deploy key path" "$INSTALL_OWNER_HOME/.ssh/id_ed25519")"
      fi
      [[ -r "$ssh_key" ]] || die "SSH deploy key is not readable: $ssh_key"
      ssh_command="ssh -i '$ssh_key' -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
      run_as_owner_env "GIT_SSH_COMMAND=$ssh_command" git clone --depth 1 "$repository_url" "$INSTALL_DIR"
      run_as_owner git -C "$INSTALL_DIR" config core.sshCommand "$ssh_command"
      ;;
    pat)
      [[ "$repository_url" =~ ^https://github\.com/[^[:space:]]+\.git$ ]] ||
        die "A PAT repository must use a GitHub HTTPS URL ending in .git."
      pat="${GITHUB_PAT:-}"
      if [[ -z "$pat" ]]; then
        [[ "$NON_INTERACTIVE" == false ]] || die "GITHUB_PAT is required for PAT installation."
        pat="$(prompt_secret "Fine-grained GitHub PAT (Contents: Read)")"
      fi
      [[ -n "$pat" ]] || die "A fine-grained PAT is required."
      credential_file="$INSTALL_OWNER_HOME/.config/rebeccasellbot/$INSTANCE_NAME.git-credentials"
      basic_auth="$(printf 'x-access-token:%s' "$pat" | base64 | tr -d '\n')"
      run_as_owner git -c "http.extraHeader=Authorization: Basic $basic_auth" clone --depth 1 \
        "$repository_url" "$INSTALL_DIR"
      run_as_owner mkdir -p "$INSTALL_OWNER_HOME/.config/rebeccasellbot"
      run_as_owner chmod 700 "$INSTALL_OWNER_HOME/.config/rebeccasellbot"
      umask 077
      printf 'protocol=https\nhost=github.com\nusername=x-access-token\npassword=%s\n\n' "$pat" |
        run_as_owner git -C "$INSTALL_DIR" -c credential.helper="store --file=$credential_file" credential approve
      run_as_owner git -C "$INSTALL_DIR" config credential.helper "store --file=$credential_file"
      run_as_owner chmod 600 "$credential_file"
      ;;
    *)
      die "--access-method must be public, ssh, or pat."
      ;;
  esac
}

resolve_instance_name() {
  local candidate="$INSTANCE_INPUT"
  if [[ -z "$candidate" && -n "$MANIFEST_INSTANCE" ]]; then
    candidate="$MANIFEST_INSTANCE"
  fi
  while true; do
    if [[ -z "$candidate" ]]; then
      [[ "$NON_INTERACTIVE" == false ]] || candidate="main"
      if [[ "$NON_INTERACTIVE" == false ]]; then
        candidate="$(prompt_default "Instance name" "main")"
      fi
    fi
    candidate="${candidate,,}"
    if validate_instance "$candidate"; then
      if [[ -n "$MANIFEST_INSTANCE" && "$candidate" != "$MANIFEST_INSTANCE" ]]; then
        warn "Restoring backup originally created from instance '$MANIFEST_INSTANCE' into instance '$candidate'."
      fi
      printf '%s' "$candidate"
      return
    fi
    [[ "$NON_INTERACTIVE" == false ]] || die "Invalid instance name: $candidate"
    warn "Use 1–32 lowercase letters, numbers, underscores, or hyphens; start with a letter or number."
    candidate=""
  done
}

configure_environment() {
  local safe_instance="${INSTANCE_NAME//-/_}"

  # Discover ports already bound by peer instances on this host
  local used_host_ports=()
  if [[ -d "$INSTALL_ROOT" ]]; then
    shopt -s nullglob
    local env_candidates=("$INSTALL_ROOT"/*/.env)
    shopt -u nullglob
    for ef in "${env_candidates[@]}"; do
      local inst_dir_name
      inst_dir_name="$(basename "$(dirname "$ef")")"
      [[ "$inst_dir_name" != "$INSTANCE_NAME" ]] || continue
      local peer_wh peer_wa peer_p
      peer_wh="$(env_value_from_file "$ef" WEBHOOK_HOST_PORT 2>/dev/null || env_value_from_file "$ef" WEBHOOK_PORT 2>/dev/null || true)"
      peer_wa="$(env_value_from_file "$ef" WEBAPP_HOST_PORT 2>/dev/null || env_value_from_file "$ef" WEBAPP_PORT 2>/dev/null || true)"
      peer_p="$(env_value_from_file "$ef" PORT 2>/dev/null || true)"
      for val in "$peer_wh" "$peer_wa" "$peer_p"; do
        if [[ -n "$val" && "$val" =~ ^[1-9][0-9]*$ ]]; then
          used_host_ports+=("$val")
        fi
      done
    done
  fi

  section "Configuration ($INSTANCE_NAME)"
  info "Database credentials and encryption keys are provisioned automatically."

  BOT_TOKEN="$(validated_required "Telegram Bot Token (from @BotFather)" "${BOT_TOKEN:-}" validate_bot_token "Expected a valid BotFather token (e.g. 123456789:ABCdef...)." true)"
  ADMIN_IDS="$(validated_required "Admin Telegram User ID(s) (comma-separated)" "${ADMIN_IDS:-}" validate_admin_ids "Use comma-separated numeric Telegram user IDs (e.g. 123456789)." false)"

  DEFAULT_LOCALE="${DEFAULT_LOCALE:-fa}"
  if [[ "$NON_INTERACTIVE" == false ]]; then
    DEFAULT_LOCALE="$(prompt_default "Default language (fa/en)" "$DEFAULT_LOCALE")"
  fi
  validate_locale "$DEFAULT_LOCALE" || die "Default locale must be fa or en."

  # Optional Support URL or @username shorthand
  SUPPORT_URL="${SUPPORT_URL:-}"
  if [[ -z "$SUPPORT_URL" && "$NON_INTERACTIVE" == false ]]; then
    SUPPORT_URL="$(prompt_default "Support URL or @username (optional, Enter to skip)" "")"
  fi
  if [[ "$SUPPORT_URL" =~ ^@([A-Za-z0-9_]{3,32})$ ]]; then
    SUPPORT_URL="https://t.me/${BASH_REMATCH[1]}"
  fi
  if [[ -n "$SUPPORT_URL" ]]; then
    validate_https_url_with_path "$SUPPORT_URL" || die "SUPPORT_URL must be a valid HTTPS URL (e.g. https://t.me/support)."
  fi

  # Optional legacy single-panel bootstrap (panels are managed in-bot via /admin -> Panels)
  REBECCA_API_URL="${REBECCA_API_URL:-}"
  if [[ -n "$REBECCA_API_URL" ]]; then
    REBECCA_API_URL="${REBECCA_API_URL%/}"
    validate_https_url "$REBECCA_API_URL" ||
      die "REBECCA_API_URL must be a clean HTTPS origin without a path."
  fi
  REBECCA_API_KEY="${REBECCA_API_KEY:-}"
  REBECCA_ADMIN_USERNAME="${REBECCA_ADMIN_USERNAME:-admin}"
  REBECCA_ADMIN_PASSWORD="${REBECCA_ADMIN_PASSWORD:-}"
  REBECCA_SERVICE_ID="${REBECCA_SERVICE_ID:-1}"
  validate_service_id "$REBECCA_SERVICE_ID" ||
    die "REBECCA_SERVICE_ID must be between 1 and 2147483647."

  # Automatic database & cryptographic secret provisioning
  DB_USER="${DB_USER:-rsbot_$safe_instance}"
  validate_identifier "$DB_USER" || die "Invalid PostgreSQL username: $DB_USER"

  DB_NAME="${DB_NAME:-rsbot_$safe_instance}"
  validate_identifier "$DB_NAME" || die "Invalid PostgreSQL database name: $DB_NAME"

  DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 24)}"
  validate_database_password "$DB_PASSWORD" ||
    die "DB_PASSWORD must use 12–128 URI-safe characters (letters, digits, ., _, ~, -)."

  PANEL_CREDENTIALS_KEY="${PANEL_CREDENTIALS_KEY:-$(openssl rand -hex 32)}"
  validate_panel_credentials_key "$PANEL_CREDENTIALS_KEY" ||
    die "PANEL_CREDENTIALS_KEY must use 32–512 safe visible characters."

  ADMIN_SESSION_SECRET="${ADMIN_SESSION_SECRET:-$(openssl rand -hex 32)}"
  (( ${#ADMIN_SESSION_SECRET} >= 32 )) ||
    die "ADMIN_SESSION_SECRET must contain at least 32 characters."

  HEALTH_CHECK_PORT="${HEALTH_CHECK_PORT:-3001}"
  validate_port "$HEALTH_CHECK_PORT" || die "Invalid HEALTH_CHECK_PORT."

  # Webhook & Delivery configuration
  BOT_DELIVERY_MODE="${BOT_DELIVERY_MODE:-polling}"
  WEBHOOK_URL="${WEBHOOK_URL:-}"
  WEBHOOK_SECRET_TOKEN="${WEBHOOK_SECRET_TOKEN:-}"
  WEBHOOK_PORT="${WEBHOOK_PORT:-3000}"
  WEBHOOK_PATH="${WEBHOOK_PATH:-/webhook}"
  WEBHOOK_BIND_HOST="${WEBHOOK_BIND_HOST:-127.0.0.1}"

  if [[ -z "${WEBHOOK_HOST_PORT:-}" ]]; then
    if [[ "$INSTANCE_NAME" == "main" && ! " ${used_host_ports[*]} " =~ " 3000 " ]] && ! is_port_in_use 3000; then
      WEBHOOK_HOST_PORT="3000"
    else
      WEBHOOK_HOST_PORT="$(find_next_safe_port 3000 2 "${used_host_ports[@]}")"
    fi
  fi

  # WebApp configuration with multi-instance host port assignment
  WEBAPP_PORT="${WEBAPP_PORT:-3002}"
  WEBAPP_BIND_HOST="${WEBAPP_BIND_HOST:-127.0.0.1}"
  WEBAPP_HOST="${WEBAPP_HOST:-0.0.0.0}"
  WEBAPP_URL="${WEBAPP_URL:-}"

  if [[ -z "${WEBAPP_HOST_PORT:-}" ]]; then
    local webapp_port_excludes=("${used_host_ports[@]}" "$WEBHOOK_HOST_PORT")
    if [[ "$INSTANCE_NAME" == "main" && ! " ${webapp_port_excludes[*]} " =~ " 3002 " ]] && ! is_port_in_use 3002; then
      WEBAPP_HOST_PORT="3002"
    else
      WEBAPP_HOST_PORT="$(find_next_safe_port 3002 1 "${webapp_port_excludes[@]}")"
    fi
  fi

  if [[ "$NON_INTERACTIVE" == false ]]; then
    WEBAPP_URL="$(prompt_default "Mini App HTTPS URL (optional, Enter to skip or set later in /admin)" "$WEBAPP_URL")"
    WEBAPP_URL="${WEBAPP_URL%/}"
    if [[ -n "$WEBAPP_URL" ]]; then
      validate_https_url "$WEBAPP_URL" || die "WEBAPP_URL must be a valid HTTPS origin (e.g. https://shop.example.com)."
    fi

    local default_mode_idx="1"
    [[ "$BOT_DELIVERY_MODE" == "webhook" ]] && default_mode_idx="2"
    local delivery_choice=""
    delivery_choice="$(prompt_default "Telegram delivery: 1) Long Polling (recommended)  2) Webhook" "$default_mode_idx")"
    case "$delivery_choice" in
      1|polling)
        BOT_DELIVERY_MODE="polling"
        ;;
      2|webhook)
        BOT_DELIVERY_MODE="webhook"
        ;;
      *)
        warn "Unknown choice '${delivery_choice}', defaulting to Long Polling."
        BOT_DELIVERY_MODE="polling"
        ;;
    esac

    if [[ "$BOT_DELIVERY_MODE" == "webhook" ]]; then
      WEBHOOK_URL="$(validated_required "Public Webhook HTTPS URL (e.g. https://bot.example.com/webhook)" "$WEBHOOK_URL" validate_webhook_url "WEBHOOK_URL must be a valid HTTPS URL." false)"
      WEBHOOK_SECRET_TOKEN="${WEBHOOK_SECRET_TOKEN:-$(openssl rand -hex 32)}"
      validate_webhook_secret_token "$WEBHOOK_SECRET_TOKEN" || die "Invalid WEBHOOK_SECRET_TOKEN."
      if [[ "$WEBHOOK_URL" =~ ^https://[^/]+(/.*)$ ]]; then
        WEBHOOK_PATH="${BASH_REMATCH[1]}"
      else
        WEBHOOK_PATH="${WEBHOOK_PATH:-/webhook}"
      fi
      [[ "$WEBHOOK_PATH" == /* ]] || WEBHOOK_PATH="/$WEBHOOK_PATH"
    fi
  else
    WEBAPP_URL="${WEBAPP_URL%/}"
    if [[ -n "$WEBAPP_URL" ]]; then
      validate_https_url "$WEBAPP_URL" || die "WEBAPP_URL must be a valid HTTPS origin."
    fi
    if [[ "$BOT_DELIVERY_MODE" == "webhook" ]]; then
      [[ -n "$WEBHOOK_URL" ]] || die "WEBHOOK_URL is required when BOT_DELIVERY_MODE=webhook in non-interactive mode."
      validate_webhook_url "$WEBHOOK_URL" || die "WEBHOOK_URL must be a valid HTTPS URL."
      WEBHOOK_SECRET_TOKEN="${WEBHOOK_SECRET_TOKEN:-$(openssl rand -hex 32)}"
      validate_webhook_secret_token "$WEBHOOK_SECRET_TOKEN" || die "Invalid WEBHOOK_SECRET_TOKEN."
      if [[ -z "${WEBHOOK_PATH:-}" || "$WEBHOOK_PATH" == "/webhook" ]]; then
        if [[ "$WEBHOOK_URL" =~ ^https://[^/]+(/.*)$ ]]; then
          WEBHOOK_PATH="${BASH_REMATCH[1]}"
        else
          WEBHOOK_PATH="/webhook"
        fi
      fi
      [[ "$WEBHOOK_PATH" == /* ]] || WEBHOOK_PATH="/$WEBHOOK_PATH"
    fi
  fi

  validate_port "$WEBHOOK_PORT" || die "Invalid WEBHOOK_PORT: $WEBHOOK_PORT"
  validate_port "$WEBHOOK_HOST_PORT" || die "Invalid WEBHOOK_HOST_PORT: $WEBHOOK_HOST_PORT"
  validate_port "$WEBAPP_PORT" || die "Invalid WEBAPP_PORT: $WEBAPP_PORT"
  validate_port "$WEBAPP_HOST_PORT" || die "Invalid WEBAPP_HOST_PORT: $WEBAPP_HOST_PORT"

  write_env_file
  success "Configuration saved to $ENV_FILE (mode 0600)"
}

load_existing_env_defaults() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  local k val
  for k in BOT_TOKEN ADMIN_IDS PANEL_CREDENTIALS_KEY DB_USER DB_PASSWORD DB_NAME DATABASE_POOL_SIZE REBECCA_API_URL REBECCA_API_KEY REBECCA_ADMIN_USERNAME REBECCA_ADMIN_PASSWORD REBECCA_SERVICE_ID DEFAULT_LOCALE SUPPORT_URL BOT_DELIVERY_MODE WEBHOOK_URL WEBHOOK_SECRET_TOKEN WEBHOOK_PORT WEBHOOK_PATH WEBHOOK_HOST WEBHOOK_HOST_PORT WEBHOOK_BIND_HOST PORT HEALTH_CHECK_PORT REBECCA_WEBHOOK_SECRET REBECCA_WEBHOOK_PATH WEBAPP_URL WEBAPP_PORT WEBAPP_HOST WEBAPP_HOST_PORT WEBAPP_BIND_HOST ADMIN_SESSION_SECRET; do
    val="$(env_value_from_file "$file" "$k" 2>/dev/null || true)"
    if [[ -n "$val" && -z "${!k:-}" ]]; then
      printf -v "$k" '%s' "$val"
      export "$k"
    fi
  done
}

ensure_existing_env_complete() {
  local safe_instance="${INSTANCE_NAME//-/_}"
  local updated=false
  if [[ -z "${PANEL_CREDENTIALS_KEY:-}" ]]; then
    PANEL_CREDENTIALS_KEY="$(openssl rand -hex 32)"
    printf 'PANEL_CREDENTIALS_KEY=%s\n' "$PANEL_CREDENTIALS_KEY" >> "$ENV_FILE"
    updated=true
  fi
  if [[ -z "${ADMIN_SESSION_SECRET:-}" ]]; then
    ADMIN_SESSION_SECRET="$(openssl rand -hex 32)"
    printf 'ADMIN_SESSION_SECRET=%s\n' "$ADMIN_SESSION_SECRET" >> "$ENV_FILE"
    updated=true
  fi
  DB_USER="${DB_USER:-rsbot_$safe_instance}"
  DB_NAME="${DB_NAME:-rsbot_$safe_instance}"
  DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 24)}"
  DEFAULT_LOCALE="${DEFAULT_LOCALE:-fa}"
  BOT_DELIVERY_MODE="${BOT_DELIVERY_MODE:-polling}"
  WEBHOOK_PORT="${WEBHOOK_PORT:-3000}"
  WEBHOOK_HOST_PORT="${WEBHOOK_HOST_PORT:-$WEBHOOK_PORT}"
  WEBHOOK_BIND_HOST="${WEBHOOK_BIND_HOST:-127.0.0.1}"
  WEBAPP_PORT="${WEBAPP_PORT:-3002}"
  WEBAPP_HOST_PORT="${WEBAPP_HOST_PORT:-$WEBAPP_PORT}"
  WEBAPP_BIND_HOST="${WEBAPP_BIND_HOST:-127.0.0.1}"
  WEBAPP_URL="${WEBAPP_URL:-}"
  WEBHOOK_URL="${WEBHOOK_URL:-}"
  if [[ "$updated" == true ]]; then
    "${SUDO[@]}" chmod 600 "$ENV_FILE"
    info "Backfilled missing cryptographic secrets in existing .env."
  fi
}

write_env_file() {
  umask 077
  {
    printf 'INSTANCE_NAME=%s\n' "$INSTANCE_NAME"
    printf 'NODE_ENV=production\n'
    printf 'BOT_TOKEN=%s\n' "$BOT_TOKEN"
    printf 'ADMIN_IDS=%s\n' "${ADMIN_IDS//[[:space:]]/}"
    printf 'DB_USER=%s\n' "$DB_USER"
    printf 'DB_PASSWORD=%s\n' "$DB_PASSWORD"
    printf 'DB_NAME=%s\n' "$DB_NAME"
    [[ -n "${DATABASE_POOL_SIZE:-}" ]] && printf 'DATABASE_POOL_SIZE=%s\n' "$DATABASE_POOL_SIZE"
    printf 'PANEL_CREDENTIALS_KEY=%s\n' "$PANEL_CREDENTIALS_KEY"
    printf 'REBECCA_API_URL=%s\n' "${REBECCA_API_URL:-}"
    printf 'REBECCA_API_KEY=%s\n' "${REBECCA_API_KEY:-}"
    printf 'REBECCA_ADMIN_USERNAME=%s\n' "${REBECCA_ADMIN_USERNAME:-admin}"
    printf 'REBECCA_ADMIN_PASSWORD=%s\n' "${REBECCA_ADMIN_PASSWORD:-}"
    printf 'REBECCA_SERVICE_ID=%s\n' "${REBECCA_SERVICE_ID:-1}"
    printf 'DEFAULT_LOCALE=%s\n' "$DEFAULT_LOCALE"
    printf 'SUPPORT_URL=%s\n' "${SUPPORT_URL:-}"
    printf 'HEALTH_CHECK_PORT=%s\n' "${HEALTH_CHECK_PORT:-3001}"
    printf 'BOT_DELIVERY_MODE=%s\n' "$BOT_DELIVERY_MODE"
    printf 'WEBHOOK_URL=%s\n' "${WEBHOOK_URL:-}"
    printf 'WEBHOOK_SECRET_TOKEN=%s\n' "${WEBHOOK_SECRET_TOKEN:-}"
    printf 'WEBHOOK_PORT=%s\n' "$WEBHOOK_PORT"
    printf 'WEBHOOK_PATH=%s\n' "${WEBHOOK_PATH:-/webhook}"
    printf 'WEBHOOK_BIND_HOST=%s\n' "$WEBHOOK_BIND_HOST"
    printf 'WEBHOOK_HOST_PORT=%s\n' "$WEBHOOK_HOST_PORT"
    printf 'WEBAPP_URL=%s\n' "${WEBAPP_URL:-}"
    printf 'WEBAPP_PORT=%s\n' "$WEBAPP_PORT"
    printf 'WEBAPP_HOST=%s\n' "${WEBAPP_HOST:-0.0.0.0}"
    printf 'WEBAPP_BIND_HOST=%s\n' "$WEBAPP_BIND_HOST"
    printf 'WEBAPP_HOST_PORT=%s\n' "$WEBAPP_HOST_PORT"
    printf 'ADMIN_SESSION_SECRET=%s\n' "$ADMIN_SESSION_SECRET"
    [[ -n "${PORT:-}" ]] && printf 'PORT=%s\n' "$PORT"
    [[ -n "${REBECCA_WEBHOOK_SECRET:-}" ]] && printf 'REBECCA_WEBHOOK_SECRET=%s\n' "$REBECCA_WEBHOOK_SECRET"
    [[ -n "${REBECCA_WEBHOOK_PATH:-}" ]] && printf 'REBECCA_WEBHOOK_PATH=%s\n' "$REBECCA_WEBHOOK_PATH"
  } > "$ENV_FILE"
  "${SUDO[@]}" chown "$INSTALL_OWNER:$(id -gn "$INSTALL_OWNER")" "$ENV_FILE"
  "${SUDO[@]}" chmod 600 "$ENV_FILE"
}

banner

# Fast-path delegation for ./install.sh --update or ./install.sh --uninstall
if [[ "$ACTION_MODE" == "update" || "$ACTION_MODE" == "uninstall" ]]; then
  target_instance="${INSTANCE_INPUT:-main}"
  validate_instance "$target_instance" || die "Invalid instance name: $target_instance"
  if [[ -x "$INSTALL_ROOT/$target_instance/scripts/rsbot" ]]; then
    exec "$INSTALL_ROOT/$target_instance/scripts/rsbot" "$target_instance" "$ACTION_MODE"
  elif command -v rsbot >/dev/null 2>&1; then
    exec rsbot "$target_instance" "$ACTION_MODE"
  else
    die "Instance '$target_instance' is not installed at $INSTALL_ROOT/$target_instance."
  fi
fi

load_os_release /etc/os-release
if [[ -n "$OS_ID" && "$OS_ID" != "ubuntu" && "$OS_ID" != "debian" ]]; then
  warn "Recommended OS is Ubuntu 22.04/24.04 LTS or Debian 12+; detected ${OS_PRETTY_NAME:-unknown}."
fi

step "1/5" "Checking system prerequisites"
for command_name in curl git openssl tar; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    info "Installing curl, git, openssl, tar, and ca-certificates..."
    "${SUDO[@]}" apt-get update -qq
    "${SUDO[@]}" apt-get install -y -qq curl git openssl tar ca-certificates
    break
  fi
done
success "System tools verified"

step "2/5" "Verifying Docker Engine & Compose v2"
if ! command -v docker >/dev/null 2>&1; then
  install_docker_engine
fi
if ! "${DOCKER[@]}" compose version >/dev/null 2>&1; then
  info "Installing Docker Compose v2 plugin..."
  "${SUDO[@]}" apt-get update -qq
  if ! "${SUDO[@]}" apt-get install -y -qq docker-compose-plugin; then
    "${SUDO[@]}" apt-get install -y -qq docker-compose-v2
  fi
fi
if [[ "$INSTALL_OWNER" != "root" ]]; then
  if ! id -nG "$INSTALL_OWNER" | grep -qw "docker"; then
    "${SUDO[@]}" usermod -aG docker "$INSTALL_OWNER" 2>/dev/null || true
  fi
fi
success "Docker & Compose are ready"

INSTANCE_NAME="$(resolve_instance_name)"
readonly INSTANCE_NAME
readonly INSTALL_DIR="$INSTALL_ROOT/$INSTANCE_NAME"
readonly ENV_FILE="$INSTALL_DIR/.env"

step "3/5" "Preparing instance workspace ($INSTANCE_NAME)"
info "Directory: $INSTALL_DIR"
"${SUDO[@]}" mkdir -p "$INSTALL_ROOT"
"${SUDO[@]}" chown "$INSTALL_OWNER:$(id -gn "$INSTALL_OWNER")" "$INSTALL_ROOT"

if [[ -e "$INSTALL_DIR" && ! -d "$INSTALL_DIR/.git" ]]; then
  die "$INSTALL_DIR exists but is not a Git checkout. Move it or choose another instance name."
fi

if [[ -d "$INSTALL_DIR/.git" ]]; then
  info "Existing repository found for '$INSTANCE_NAME'; pulling latest changes..."
  run_as_owner git -C "$INSTALL_DIR" -c safe.directory="$INSTALL_DIR" pull --ff-only >/dev/null 2>&1 ||
    warn "Could not fast-forward repository; continuing with current working tree."
else
  info "Cloning RebeccaSellBot source..."
  clone_repository
fi
cd "$INSTALL_DIR"
success "Source repository ready"

CONFIGURE_ENV=true
if [[ -f "$ENV_FILE" ]]; then
  # Pre-load existing .env so keeping configuration or partial overrides never leaves unbound variables
  load_existing_env_defaults "$ENV_FILE"

  if [[ "$ASSUME_YES" == true ]]; then
    env_backup="$ENV_FILE.backup.$(date +%Y%m%d_%H%M%S)"
    "${SUDO[@]}" cp "$ENV_FILE" "$env_backup"
    "${SUDO[@]}" chmod 600 "$env_backup"
    info "Backed up existing .env to $(basename "$env_backup")"
    CONFIGURE_ENV=true
  elif [[ "$NON_INTERACTIVE" == true ]]; then
    die "An existing configuration exists at $ENV_FILE. Pass --yes to overwrite it in --non-interactive mode."
  else
    replace_env="$(prompt_default "Existing .env found for '$INSTANCE_NAME'. Reconfigure it? (y/N)" "N")"
    if [[ "$replace_env" =~ ^[Yy]$ ]]; then
      env_backup="$ENV_FILE.backup.$(date +%Y%m%d_%H%M%S)"
      "${SUDO[@]}" cp "$ENV_FILE" "$env_backup"
      "${SUDO[@]}" chmod 600 "$env_backup"
      info "Backed up existing .env to $(basename "$env_backup")"
      CONFIGURE_ENV=true
    else
      ensure_existing_env_complete
      info "Keeping existing .env configuration."
      CONFIGURE_ENV=false
    fi
  fi
fi

if [[ "$CONFIGURE_ENV" == true ]]; then
  configure_environment
fi

step "4/5" "Installing rsbot CLI"
"${SUDO[@]}" install -d -m 0755 /usr/local/bin
"${SUDO[@]}" install -m 0755 "$INSTALL_DIR/scripts/rsbot" /usr/local/bin/rsbot
success "Installed /usr/local/bin/rsbot"

step "5/5" "Building containers & launching stack"
"${DOCKER[@]}" network inspect rsbot_mesh >/dev/null 2>&1 || "${DOCKER[@]}" network create rsbot_mesh >/dev/null 2>&1 || true
"${DOCKER[@]}" volume inspect rsbot_registry >/dev/null 2>&1 || "${DOCKER[@]}" volume create rsbot_registry >/dev/null 2>&1 || true
if [[ -n "$("${DOCKER[@]}" ps -q -f name=nodexia-caddy-1 2>/dev/null || true)" ]]; then
  "${DOCKER[@]}" network connect rsbot_mesh nodexia-caddy-1 >/dev/null 2>&1 || true
fi

info "Building application image..."
dc build bot
info "Starting PostgreSQL 16 and waiting for readiness..."
dc up -d --wait db

if [[ -n "$BACKUP_INPUT" && -f "$BACKUP_WORKSPACE/database.dump" ]]; then
  info "Validating database snapshot from backup archive..."
  if ! validate_database_dump "$BACKUP_WORKSPACE/database.dump"; then
    die "The database dump inside '$BACKUP_INPUT' failed PostgreSQL validation."
  fi
  info "Restoring database snapshot into '$INSTANCE_NAME'..."
  restore_database_dump "$BACKUP_WORKSPACE/database.dump" "$DB_USER" "$DB_NAME"
  success "Database snapshot restored"

  "${SUDO[@]}" mkdir -p "$INSTALL_ROOT/backups/$INSTANCE_NAME"
  "${SUDO[@]}" chown "$INSTALL_OWNER:$(id -gn "$INSTALL_OWNER")" "$INSTALL_ROOT/backups/$INSTANCE_NAME" 2>/dev/null || true
  "${SUDO[@]}" chmod 700 "$INSTALL_ROOT/backups/$INSTANCE_NAME" 2>/dev/null || true
  dest_backup="$INSTALL_ROOT/backups/$INSTANCE_NAME/migrated_$(basename "$BACKUP_INPUT")"
  "${SUDO[@]}" cp "$BACKUP_INPUT" "$dest_backup" 2>/dev/null || true
  "${SUDO[@]}" chown "$INSTALL_OWNER:$(id -gn "$INSTALL_OWNER")" "$dest_backup" 2>/dev/null || true
  "${SUDO[@]}" chmod 600 "$dest_backup" 2>/dev/null || true
fi

info "Applying Drizzle database migrations..."
dc run --rm --no-deps bot npm run db:migrate

info "Starting bot container and verifying /readyz health check..."
if ! dc up -d --wait; then
  warn "Bot container failed health verification. Showing recent diagnostics:"
  dc ps || true
  dc logs --tail=150 bot db || true
  die "Startup failed. Check logs with: rsbot $INSTANCE_NAME logs -f"
fi
success "Stack is online and healthy"

printf '\n%s  ────────────────────────────────────────────────────────────%s\n' "$GREEN" "$RESET"
printf '  %s✔ RebeccaSellBot Deployed Successfully%s\n' "$BOLD$GREEN" "$RESET"
printf '%s  ────────────────────────────────────────────────────────────%s\n' "$GREEN" "$RESET"
printf '  %-16s %s%s%s\n' "Instance:" "$BOLD" "$INSTANCE_NAME" "$RESET"
printf '  %-16s %s\n' "Directory:" "$INSTALL_DIR"
printf '  %-16s %s\n' "Delivery Mode:" "$BOT_DELIVERY_MODE"
printf '  %-16s 127.0.0.1:%s%s\n' "Mini App Port:" "$WEBAPP_HOST_PORT" "${WEBAPP_URL:+ ($WEBAPP_URL)}"
if [[ "$BOT_DELIVERY_MODE" == "webhook" ]]; then
  printf '  %-16s 127.0.0.1:%s%s\n' "Webhook Port:" "$WEBHOOK_HOST_PORT" "${WEBHOOK_URL:+ ($WEBHOOK_URL)}"
fi
printf '\n  %sQuick Commands:%s\n' "$BOLD" "$RESET"
printf '    %srsbot status%s            Container status & health\n' "$CYAN" "$RESET"
printf '    %srsbot verify%s            Deep 6-stage stack diagnostics\n' "$CYAN" "$RESET"
printf '    %srsbot logs -f%s           Follow live service logs\n' "$CYAN" "$RESET"
printf '    %srsbot update%s            Pull, rebuild, migrate, and restart\n' "$CYAN" "$RESET"
printf '    %srsbot backup%s            Create encrypted-ready .tar.gz snapshot\n' "$CYAN" "$RESET"
printf '\n  %sNext Step:%s Send %s/admin%s to your bot in Telegram → %sPanels%s to connect Rebecca.\n\n' \
  "$BOLD" "$RESET" "$CYAN" "$RESET" "$BOLD" "$RESET"
