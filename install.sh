#!/usr/bin/env bash
set -Eeuo pipefail

# RebeccaSellBot installer for Ubuntu 24.04. Guided mode collects the required
# values safely; unattended mode reads the same values from a protected file.

readonly INSTALL_ROOT="/opt/RebeccaSellBot"
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
INSTANCE_INPUT="${RSBOT_INSTANCE:-}"
REPOSITORY_INPUT="$DEFAULT_REPOSITORY_URL"
ACCESS_METHOD_INPUT="${RSBOT_ACCESS_METHOD:-}"
SSH_KEY_INPUT="${RSBOT_SSH_KEY_PATH:-}"
CONFIG_SOURCE_FILE=""
BACKUP_INPUT="${RSBOT_FROM_BACKUP:-}"
BACKUP_WORKSPACE=""
MANIFEST_INSTANCE=""

banner() {
  printf '\n%s┌────────────────────────────────────────────────────────────┐%s\n' "$PURPLE" "$RESET"
  printf '%s│%s  %sRebeccaSellBot%s  %sTelegram Storefront Deployment%s              %s│%s\n' \
    "$PURPLE" "$RESET" "$BOLD$PURPLE" "$RESET" "$DIM" "$RESET" "$PURPLE" "$RESET"
  printf '%s│%s  %sUbuntu 24.04 · Docker Engine · PostgreSQL · Multi-Instance%s   %s│%s\n' \
    "$PURPLE" "$RESET" "$DIM" "$RESET" "$PURPLE" "$RESET"
  printf '%s└────────────────────────────────────────────────────────────┘%s\n\n' "$PURPLE" "$RESET"
}

section() { printf '\n%s━━ %s%s%s\n' "$PURPLE" "$BOLD" "$*" "$RESET"; }
step() { printf '%s[%s%s%s]%s %s\n' "$DIM" "$CYAN" "$1" "$DIM" "$RESET" "$2"; }
info() { printf '%s•%s %s\n' "$CYAN" "$RESET" "$*"; }
success() { printf '%s✔%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die() { printf '%s✘%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

on_error() {
  local exit_code=$?
  printf '%s✘%s Installation stopped near line %s (exit %s).%s\n' \
    "$RED" "$RESET" "${BASH_LINENO[0]:-unknown}" "$exit_code" "$RESET" >&2
  exit "$exit_code"
}
trap on_error ERR

show_help() {
  cat <<'EOF'
RebeccaSellBot installer

Usage:
  ./install.sh [options]

Options:
  --instance <name>          Instance namespace (default: main)
  --from-backup <path>       Restore and migrate from a complete backup bundle (.tar.gz)
  --repository <url>         GitHub HTTPS or SSH repository URL
  --access-method <method>   public, ssh, or pat
  --ssh-key <path>           SSH deploy-key path (for --access-method ssh)
  --env-file <path>          Plain KEY=value deployment configuration file
  --webhook                  Enable Telegram webhook delivery mode
  --webhook-url <url>        Public Telegram webhook HTTPS URL
  --webhook-secret <token>   Webhook secret token (auto-generated if omitted)
  --webhook-port <port>      Internal container webhook port (default: 3000)
  --webhook-host-port <port> Host published port for reverse proxy (default: 3000)
  --non-interactive          Never prompt; fail if required values are absent
  --yes                      Replace an existing instance .env automatically
  -h, --help                 Show this help

For unattended installation or server migration, pass --non-interactive --yes and
provide an --env-file or --from-backup. Supported file keys are documented in
README.md. Keep sensitive files mode 0600 and remove temporary config files after installation.
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
    --non-interactive)
      NON_INTERACTIVE=true
      shift
      ;;
    --yes)
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
validate_admin_ids() { [[ "$1" =~ ^[1-9][0-9]*([[:space:]]*,[[:space:]]*[1-9][0-9]*)*$ ]]; }
validate_https_url() {
  local port
  [[ "$1" =~ ^https://[A-Za-z0-9][A-Za-z0-9.-]*(:([0-9]{1,5}))?/?$ ]] || return 1
  port="${BASH_REMATCH[2]:-}"
  [[ -z "$port" ]] || ((10#$port >= 1 && 10#$port <= 65535))
}
validate_identifier() { [[ "$1" =~ ^[a-z_][a-z0-9_]{0,62}$ ]]; }
validate_database_password() { [[ "$1" =~ ^[A-Za-z0-9._-]{16,128}$ ]]; }
validate_locale() { [[ "$1" == "fa" || "$1" == "en" ]]; }
validate_service_id() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]] || return 1
  ((${#1} < 10)) || [[ ${#1} -eq 10 && "$1" < "2147483648" ]]
}
validate_panel_credentials_key() { [[ "$1" =~ ^[A-Za-z0-9._~+=/-]{32,512}$ ]]; }
validate_webhook_url() {
  local port
  [[ "$1" =~ ^https://[A-Za-z0-9][A-Za-z0-9.-]*(:([0-9]{1,5}))?(/.*)?$ ]] || return 1
  port="${BASH_REMATCH[2]:-}"
  [[ -z "$port" ]] || ((10#$port >= 1 && 10#$port <= 65535))
}
validate_webhook_secret_token() { [[ "$1" =~ ^[A-Za-z0-9_-]{1,256}$ ]]; }
validate_port() { [[ "$1" =~ ^[1-9][0-9]{0,4}$ ]] && (( 10#$1 >= 1 && 10#$1 <= 65535 )); }

env_value_from_file() {
  local file="$1" key="$2" raw_value value cr=$'\r' sq="'"
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

  # Check with db container native pg_restore
  if dc exec -T db pg_restore --list < "$dump_file" >/dev/null 2>&1; then
    return 0
  fi

  # Fallback: check via bot container if dump format is newer than db container tools
  if dc run --rm --no-deps -T bot pg_restore --list < "$dump_file" >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

restore_database_dump() {
  local dump_file="$1" db_user="$2" db_name="$3"
  terminate_db_backends "$db_user" "$db_name"

  # Strategy 1: Direct native pg_restore inside db container
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

  # Strategy 2: If direct restore failed (e.g. dump created by newer pg_dump client with
  # unsupported format version or unrecognized PG17+ parameters like transaction_timeout),
  # render SQL via bot container, strip incompatible GUCs, and pipe into psql in a single transaction.
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

  # If both strategies failed, re-run Strategy 1 with full stderr to surface the diagnostic
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

    # Trim whitespace from key and value
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"

    # Strip surrounding matching quotes if present
    if [[ "$value" =~ ^\"(.*)\"$ ]]; then
      value="${BASH_REMATCH[1]}"
    elif [[ "$value" =~ ^$sq(.*)$sq$ ]]; then
      value="${BASH_REMATCH[1]}"
    fi

    case "$key" in
      BOT_TOKEN|ADMIN_IDS|PANEL_CREDENTIALS_KEY|REBECCA_API_URL|REBECCA_API_KEY|REBECCA_ADMIN_USERNAME|REBECCA_ADMIN_PASSWORD|REBECCA_SERVICE_ID|DB_USER|DB_PASSWORD|DB_NAME|DEFAULT_LOCALE|SUPPORT_URL|GITHUB_PAT|RSBOT_ACCESS_METHOD|RSBOT_REPOSITORY_URL|RSBOT_SSH_KEY_PATH|BOT_DELIVERY_MODE|WEBHOOK_URL|WEBHOOK_SECRET_TOKEN|WEBHOOK_PORT|WEBHOOK_PATH|WEBHOOK_HOST|WEBHOOK_HOST_PORT|WEBHOOK_BIND_HOST)
        printf -v "$key" '%s' "$value"
        export "$key"
        ;;
      *)
        die "Unsupported key '$key' in $source_file."
        ;;
    esac
  done < "$source_file"
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
    for k in BOT_TOKEN ADMIN_IDS PANEL_CREDENTIALS_KEY DB_USER DB_PASSWORD DB_NAME REBECCA_API_URL REBECCA_API_KEY REBECCA_ADMIN_USERNAME REBECCA_ADMIN_PASSWORD REBECCA_SERVICE_ID DEFAULT_LOCALE SUPPORT_URL BOT_DELIVERY_MODE WEBHOOK_URL WEBHOOK_SECRET_TOKEN WEBHOOK_PORT WEBHOOK_PATH WEBHOOK_HOST WEBHOOK_HOST_PORT WEBHOOK_BIND_HOST; do
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

prompt_required() {
  local label="$1" value=""
  while [[ -z "$value" ]]; do
    read -r -p "$label: " value
  done
  printf '%s' "$value"
}

prompt_default() {
  local label="$1" default_value="$2" value=""
  read -r -p "$label [$default_value]: " value
  printf '%s' "${value:-$default_value}"
}

prompt_secret() {
  local label="$1" value=""
  read -r -s -p "$label: " value
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
    local prompt_label="$label"
    if [[ "$secret" == true ]]; then
      local masked="[keep current value]"
      if ((${#supplied} >= 10)); then
        masked="[keep: ${supplied:0:4}...${supplied: -4}]"
      fi
      local input=""
      read -r -s -p "$label $masked: " input
      printf '\n' >&2
      printf '%s' "${input:-$supplied}"
      return
    else
      local input=""
      read -r -p "$label [$supplied]: " input
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
  "${DOCKER[@]}" compose --env-file "$ENV_FILE" -p "$INSTANCE_NAME" -f "$INSTALL_DIR/docker-compose.yml" "$@"
}

install_docker_engine() {
  [[ "${ID:-}" == "ubuntu" ]] || die "Automatic Docker installation requires Ubuntu. Install Docker Engine manually on this host."
  local codename="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}" architecture key_file
  [[ -n "$codename" ]] || die "Could not determine the Ubuntu codename for Docker's package repository."
  architecture="$(dpkg --print-architecture)"
  key_file="$(mktemp)"

  info "Configuring Docker's signed official APT repository..."
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o "$key_file"
  "${SUDO[@]}" install -m 0755 -d /etc/apt/keyrings
  "${SUDO[@]}" install -m 0644 "$key_file" /etc/apt/keyrings/docker.asc
  rm -f "$key_file"

  printf '%s\n' \
    'Types: deb' \
    'URIs: https://download.docker.com/linux/ubuntu' \
    "Suites: $codename" \
    'Components: stable' \
    "Architectures: $architecture" \
    'Signed-By: /etc/apt/keyrings/docker.asc' \
    | "${SUDO[@]}" tee /etc/apt/sources.list.d/docker.sources >/dev/null

  "${SUDO[@]}" apt-get update
  "${SUDO[@]}" apt-get install -y \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  "${SUDO[@]}" systemctl enable --now docker
  DOCKER=("${SUDO[@]}" docker)
}

clone_repository() {
  local access_method="$ACCESS_METHOD_INPUT" repository_url="$REPOSITORY_INPUT"
  local ssh_key ssh_command pat credential_file basic_auth

  if [[ -z "$access_method" ]]; then
    if [[ "$NON_INTERACTIVE" == true ]]; then
      access_method="public"
    else
      read -r -p "Repository access: 1) public HTTPS  2) SSH deploy key  3) fine-grained PAT [1]: " access_method
      case "${access_method:-1}" in
        1) access_method="public" ;;
        2) access_method="ssh" ;;
        3) access_method="pat" ;;
        *) die "Choose 1, 2, or 3 for repository access." ;;
      esac
    fi
  fi

  case "$access_method" in
    public)
      [[ "$repository_url" =~ ^https://github\.com/[^[:space:]]+\.git$ ]] ||
        die "A public repository must use a GitHub HTTPS URL ending in .git."
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
  local safe_instance
  section "Configuration"
  info "Only Telegram and database bootstrap values are required here."

  BOT_TOKEN="$(required_value "Telegram BOT_TOKEN" "${BOT_TOKEN:-}" true)"
  ADMIN_IDS="$(validated_required "Telegram ADMIN_IDS (comma-separated)" "${ADMIN_IDS:-}" validate_admin_ids "Use comma-separated numeric Telegram IDs." false)"
  # Rebecca is intentionally optional at install time. Existing deployments
  # may keep these values for one-time legacy import; new panels are managed
  # securely from the bot's administrator dashboard.
  REBECCA_API_URL="${REBECCA_API_URL:-}"
  if [[ -n "$REBECCA_API_URL" ]]; then
    validate_https_url "$REBECCA_API_URL" ||
      die "REBECCA_API_URL must be a clean HTTPS origin without a path."
    REBECCA_API_URL="${REBECCA_API_URL%/}"
  fi
  REBECCA_API_KEY="${REBECCA_API_KEY:-}"
  REBECCA_ADMIN_USERNAME="${REBECCA_ADMIN_USERNAME:-admin}"
  REBECCA_ADMIN_PASSWORD="${REBECCA_ADMIN_PASSWORD:-}"
  REBECCA_SERVICE_ID="${REBECCA_SERVICE_ID:-1}"
  validate_service_id "$REBECCA_SERVICE_ID" ||
    die "REBECCA_SERVICE_ID must be between 1 and 2147483647."

  if [[ -z "${PANEL_CREDENTIALS_KEY:-}" && -f "$ENV_FILE" ]]; then
    PANEL_CREDENTIALS_KEY="$(sed -n 's/^PANEL_CREDENTIALS_KEY=//p' "$ENV_FILE" | head -n 1)"
  fi
  PANEL_CREDENTIALS_KEY="${PANEL_CREDENTIALS_KEY:-$(openssl rand -hex 32)}"
  validate_panel_credentials_key "$PANEL_CREDENTIALS_KEY" ||
    die "PANEL_CREDENTIALS_KEY must use 32–512 safe visible characters."

  safe_instance="${INSTANCE_NAME//-/_}"
  if [[ -z "${DB_USER:-}" && -f "$ENV_FILE" ]]; then
    DB_USER="$(sed -n 's/^DB_USER=//p' "$ENV_FILE" | head -n 1)"
  fi
  if [[ -z "${DB_USER:-}" && "$NON_INTERACTIVE" == false ]]; then
    DB_USER="$(prompt_default "PostgreSQL username" "rsbot_$safe_instance")"
  fi
  DB_USER="$(validated_required "PostgreSQL username" "${DB_USER:-rsbot_$safe_instance}" validate_identifier "Use a lowercase PostgreSQL identifier." false)"

  if [[ -z "${DB_NAME:-}" && -f "$ENV_FILE" ]]; then
    DB_NAME="$(sed -n 's/^DB_NAME=//p' "$ENV_FILE" | head -n 1)"
  fi
  if [[ -z "${DB_NAME:-}" && "$NON_INTERACTIVE" == false ]]; then
    DB_NAME="$(prompt_default "PostgreSQL database name" "rsbot_$safe_instance")"
  fi
  DB_NAME="$(validated_required "PostgreSQL database name" "${DB_NAME:-rsbot_$safe_instance}" validate_identifier "Use a lowercase PostgreSQL identifier." false)"

  if [[ -z "${DB_PASSWORD:-}" && -f "$ENV_FILE" ]]; then
    DB_PASSWORD="$(sed -n 's/^DB_PASSWORD=//p' "$ENV_FILE" | head -n 1)"
  fi
  DB_PASSWORD="${DB_PASSWORD:-}"
  if [[ -z "$DB_PASSWORD" ]]; then
    if [[ "$NON_INTERACTIVE" == true ]]; then
      DB_PASSWORD="$(openssl rand -hex 24)"
    else
      DB_PASSWORD="$(prompt_secret "PostgreSQL password (leave empty to generate securely)")"
      DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 24)}"
    fi
  fi
  validate_database_password "$DB_PASSWORD" ||
    die "PostgreSQL password must use 16–128 letters, digits, dots, underscores, or hyphens."

  DEFAULT_LOCALE="${DEFAULT_LOCALE:-fa}"
  if [[ "$NON_INTERACTIVE" == false && "$DEFAULT_LOCALE" == "fa" ]]; then
    DEFAULT_LOCALE="$(prompt_default "Default locale (fa/en)" "fa")"
  fi
  validate_locale "$DEFAULT_LOCALE" || die "Default locale must be fa or en."

  SUPPORT_URL="${SUPPORT_URL:-}"
  if [[ -z "$SUPPORT_URL" && "$NON_INTERACTIVE" == false ]]; then
    SUPPORT_URL="$(prompt_default "Support URL (optional, e.g. https://t.me/your_support)" "")"
  fi
  if [[ -n "$SUPPORT_URL" ]]; then
    validate_https_url "$SUPPORT_URL" || warn "SUPPORT_URL should be a valid HTTPS URL."
  fi

  # Webhook & Delivery configuration
  if [[ -z "${BOT_DELIVERY_MODE:-}" && -f "$ENV_FILE" ]]; then
    BOT_DELIVERY_MODE="$(sed -n 's/^BOT_DELIVERY_MODE=//p' "$ENV_FILE" | head -n 1)"
  fi
  BOT_DELIVERY_MODE="${BOT_DELIVERY_MODE:-polling}"

  if [[ -z "${WEBHOOK_URL:-}" && -f "$ENV_FILE" ]]; then
    WEBHOOK_URL="$(sed -n 's/^WEBHOOK_URL=//p' "$ENV_FILE" | head -n 1)"
  fi
  WEBHOOK_URL="${WEBHOOK_URL:-}"

  if [[ -z "${WEBHOOK_SECRET_TOKEN:-}" && -f "$ENV_FILE" ]]; then
    WEBHOOK_SECRET_TOKEN="$(sed -n 's/^WEBHOOK_SECRET_TOKEN=//p' "$ENV_FILE" | head -n 1)"
  fi
  WEBHOOK_SECRET_TOKEN="${WEBHOOK_SECRET_TOKEN:-}"

  if [[ -z "${WEBHOOK_PORT:-}" && -f "$ENV_FILE" ]]; then
    WEBHOOK_PORT="$(sed -n 's/^WEBHOOK_PORT=//p' "$ENV_FILE" | head -n 1)"
  fi
  WEBHOOK_PORT="${WEBHOOK_PORT:-3000}"

  if [[ -z "${WEBHOOK_PATH:-}" && -f "$ENV_FILE" ]]; then
    WEBHOOK_PATH="$(sed -n 's/^WEBHOOK_PATH=//p' "$ENV_FILE" | head -n 1)"
  fi
  WEBHOOK_PATH="${WEBHOOK_PATH:-/webhook}"

  if [[ -z "${WEBHOOK_BIND_HOST:-}" && -f "$ENV_FILE" ]]; then
    WEBHOOK_BIND_HOST="$(sed -n 's/^WEBHOOK_BIND_HOST=//p' "$ENV_FILE" | head -n 1)"
  fi
  WEBHOOK_BIND_HOST="${WEBHOOK_BIND_HOST:-127.0.0.1}"

  if [[ -z "${WEBHOOK_HOST_PORT:-}" && -f "$ENV_FILE" ]]; then
    WEBHOOK_HOST_PORT="$(sed -n 's/^WEBHOOK_HOST_PORT=//p' "$ENV_FILE" | head -n 1)"
  fi
  WEBHOOK_HOST_PORT="${WEBHOOK_HOST_PORT:-$WEBHOOK_PORT}"

  if [[ "$NON_INTERACTIVE" == false ]]; then
    local default_mode_idx="1"
    if [[ "$BOT_DELIVERY_MODE" == "webhook" ]]; then
      default_mode_idx="2"
    fi
    info "Telegram delivery mode: Long Polling works out-of-the-box. Webhook requires a public HTTPS domain."
    read -r -p "Telegram delivery: 1) Long Polling  2) Webhook [$default_mode_idx]: " delivery_choice
    delivery_choice="${delivery_choice:-$default_mode_idx}"
    case "$delivery_choice" in
      1)
        BOT_DELIVERY_MODE="polling"
        ;;
      2)
        BOT_DELIVERY_MODE="webhook"
        ;;
      *)
        warn "Unknown choice '${delivery_choice}', defaulting to Long Polling."
        BOT_DELIVERY_MODE="polling"
        ;;
    esac

    if [[ "$BOT_DELIVERY_MODE" == "webhook" ]]; then
      WEBHOOK_URL="$(required_value "Public Webhook HTTPS URL (e.g. https://example.com/rsbot/webhook)" "$WEBHOOK_URL" false)"
      validate_webhook_url "$WEBHOOK_URL" || die "WEBHOOK_URL must be a valid HTTPS URL."

      local default_secret="${WEBHOOK_SECRET_TOKEN:-$(openssl rand -hex 32)}"
      WEBHOOK_SECRET_TOKEN="$(prompt_default "Webhook secret token (leave default for random 32-byte hex)" "$default_secret")"
      validate_webhook_secret_token "$WEBHOOK_SECRET_TOKEN" || die "Invalid secret token (use alphanumeric characters, - or _)."

      WEBHOOK_PORT="$(prompt_default "Internal webhook listening port" "${WEBHOOK_PORT:-3000}")"
      validate_port "$WEBHOOK_PORT" || die "Invalid webhook port."

      WEBHOOK_HOST_PORT="$(prompt_default "Host published port for Caddy/Nginx reverse proxy" "${WEBHOOK_HOST_PORT:-$WEBHOOK_PORT}")"
      validate_port "$WEBHOOK_HOST_PORT" || die "Invalid host port."

      local auto_path="/webhook"
      if [[ "$WEBHOOK_URL" =~ ^https://[^/]+(/.*)$ ]]; then
        auto_path="${BASH_REMATCH[1]}"
      fi
      WEBHOOK_PATH="$(prompt_default "Webhook path" "${WEBHOOK_PATH:-$auto_path}")"
      [[ "$WEBHOOK_PATH" == /* ]] || WEBHOOK_PATH="/$WEBHOOK_PATH"
    fi
  else
    if [[ "$BOT_DELIVERY_MODE" == "webhook" ]]; then
      [[ -n "$WEBHOOK_URL" ]] || die "WEBHOOK_URL is required when BOT_DELIVERY_MODE=webhook in non-interactive mode."
      validate_webhook_url "$WEBHOOK_URL" || die "WEBHOOK_URL must be a valid HTTPS URL."
      WEBHOOK_SECRET_TOKEN="${WEBHOOK_SECRET_TOKEN:-$(openssl rand -hex 32)}"
      validate_webhook_secret_token "$WEBHOOK_SECRET_TOKEN" || die "Invalid secret token."
      WEBHOOK_PORT="${WEBHOOK_PORT:-3000}"
      validate_port "$WEBHOOK_PORT" || die "Invalid webhook port."
      WEBHOOK_HOST_PORT="${WEBHOOK_HOST_PORT:-$WEBHOOK_PORT}"
      validate_port "$WEBHOOK_HOST_PORT" || die "Invalid host port."
      if [[ -z "${WEBHOOK_PATH:-}" ]]; then
        if [[ "$WEBHOOK_URL" =~ ^https://[^/]+(/.*)$ ]]; then
          WEBHOOK_PATH="${BASH_REMATCH[1]}"
        else
          WEBHOOK_PATH="/webhook"
        fi
      fi
      [[ "$WEBHOOK_PATH" == /* ]] || WEBHOOK_PATH="/$WEBHOOK_PATH"
    fi
  fi

  umask 077
  {
    printf 'INSTANCE_NAME=%s\n' "$INSTANCE_NAME"
    printf 'NODE_ENV=production\n'
    printf 'BOT_TOKEN=%s\n' "$BOT_TOKEN"
    printf 'ADMIN_IDS=%s\n' "${ADMIN_IDS//[[:space:]]/}"
    printf 'DB_USER=%s\n' "$DB_USER"
    printf 'DB_PASSWORD=%s\n' "$DB_PASSWORD"
    printf 'DB_NAME=%s\n' "$DB_NAME"
    printf 'PANEL_CREDENTIALS_KEY=%s\n' "$PANEL_CREDENTIALS_KEY"
    printf 'REBECCA_API_URL=%s\n' "$REBECCA_API_URL"
    printf 'REBECCA_API_KEY=%s\n' "$REBECCA_API_KEY"
    printf 'REBECCA_ADMIN_USERNAME=%s\n' "$REBECCA_ADMIN_USERNAME"
    printf 'REBECCA_ADMIN_PASSWORD=%s\n' "$REBECCA_ADMIN_PASSWORD"
    printf 'REBECCA_SERVICE_ID=%s\n' "$REBECCA_SERVICE_ID"
    printf 'DEFAULT_LOCALE=%s\n' "$DEFAULT_LOCALE"
    printf 'SUPPORT_URL=%s\n' "$SUPPORT_URL"
    printf 'HEALTH_CHECK_PORT=3001\n'
    printf 'BOT_DELIVERY_MODE=%s\n' "$BOT_DELIVERY_MODE"
    printf 'WEBHOOK_URL=%s\n' "$WEBHOOK_URL"
    printf 'WEBHOOK_SECRET_TOKEN=%s\n' "$WEBHOOK_SECRET_TOKEN"
    printf 'WEBHOOK_PORT=%s\n' "$WEBHOOK_PORT"
    printf 'WEBHOOK_PATH=%s\n' "$WEBHOOK_PATH"
    printf 'WEBHOOK_BIND_HOST=%s\n' "$WEBHOOK_BIND_HOST"
    printf 'WEBHOOK_HOST_PORT=%s\n' "$WEBHOOK_HOST_PORT"
  } > "$ENV_FILE"
  "${SUDO[@]}" chown "$INSTALL_OWNER:$(id -gn "$INSTALL_OWNER")" "$ENV_FILE"
  "${SUDO[@]}" chmod 600 "$ENV_FILE"
  success "Secure configuration written to $ENV_FILE"
}

banner

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  source /etc/os-release
  [[ "${ID:-}" == "ubuntu" ]] || warn "Designed for Ubuntu 24.04; detected ${PRETTY_NAME:-unknown}."
  [[ "${VERSION_ID:-}" == "24.04" ]] || warn "Ubuntu 24.04 is recommended; detected ${PRETTY_NAME:-unknown}."
fi

section "Preparing host"
step "1/5" "Checking required system tools"
for command_name in curl git openssl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    info "Installing curl, Git, OpenSSL, and CA certificates..."
    "${SUDO[@]}" apt-get update
    "${SUDO[@]}" apt-get install -y curl git openssl ca-certificates
    break
  fi
done
success "System prerequisites are ready"

step "2/5" "Configuring Docker Engine and Compose"
if ! command -v docker >/dev/null 2>&1; then
  info "Installing Docker Engine from Docker's signed official APT repository..."
  install_docker_engine
fi
if ! "${DOCKER[@]}" compose version >/dev/null 2>&1; then
  info "Installing Docker Compose plugin..."
  "${SUDO[@]}" apt-get update
  if ! "${SUDO[@]}" apt-get install -y docker-compose-plugin; then
    "${SUDO[@]}" apt-get install -y docker-compose-v2
  fi
fi
if [[ "$INSTALL_OWNER" != "root" ]]; then
  if ! id -nG "$INSTALL_OWNER" | grep -qw "docker"; then
    "${SUDO[@]}" usermod -aG docker "$INSTALL_OWNER" 2>/dev/null || true
  fi
fi
success "Docker and Compose are ready"

INSTANCE_NAME="$(resolve_instance_name)"
readonly INSTANCE_NAME
readonly INSTALL_DIR="$INSTALL_ROOT/$INSTANCE_NAME"
readonly ENV_FILE="$INSTALL_DIR/.env"

section "Instance Setup: $INSTANCE_NAME"
step "3/5" "Preparing instance directory and configuration"
info "Target: $INSTALL_DIR"
"${SUDO[@]}" mkdir -p "$INSTALL_ROOT"
"${SUDO[@]}" chown "$INSTALL_OWNER:$(id -gn "$INSTALL_OWNER")" "$INSTALL_ROOT"

if [[ -e "$INSTALL_DIR" && ! -d "$INSTALL_DIR/.git" ]]; then
  die "$INSTALL_DIR exists but is not a Git checkout. Move it or choose another instance."
fi
if [[ -d "$INSTALL_DIR/.git" ]]; then
  warn "Reusing existing instance repository '$INSTANCE_NAME'."
else
  info "Cloning RebeccaSellBot source..."
  clone_repository
fi
cd "$INSTALL_DIR"
success "Source code is ready"

if [[ -f "$ENV_FILE" ]]; then
  if [[ "$ASSUME_YES" == true ]]; then
    env_backup="$ENV_FILE.backup.$(date +%Y%m%d_%H%M%S)"
    "${SUDO[@]}" cp "$ENV_FILE" "$env_backup"
    "${SUDO[@]}" chmod 600 "$env_backup"
    info "Existing configuration backed up before replacement."
  elif [[ "$NON_INTERACTIVE" == true ]]; then
    die "An existing configuration requires --yes before unattended replacement."
  else
    read -r -p "Replace the existing instance configuration? [y/N]: " replace_env
    if [[ ! "$replace_env" =~ ^[Yy]$ ]]; then
      info "Keeping the existing .env configuration."
      CONFIGURE_ENV=false
    else
      env_backup="$ENV_FILE.backup.$(date +%Y%m%d_%H%M%S)"
      "${SUDO[@]}" cp "$ENV_FILE" "$env_backup"
      "${SUDO[@]}" chmod 600 "$env_backup"
      CONFIGURE_ENV=true
    fi
  fi
else
  CONFIGURE_ENV=true
fi

if [[ "${CONFIGURE_ENV:-true}" == true ]]; then
  configure_environment
fi

step "4/5" "Installing rsbot management CLI"
"${SUDO[@]}" install -d -m 0755 /usr/local/bin
"${SUDO[@]}" install -m 0755 "$INSTALL_DIR/scripts/rsbot" /usr/local/bin/rsbot
success "rsbot is available at /usr/local/bin/rsbot"

step "5/5" "Building services and starting database stack"
info "Building the bot image..."
dc build bot
info "Starting PostgreSQL and waiting for readiness..."
dc up -d --wait db

if [[ -n "$BACKUP_INPUT" && -f "$BACKUP_WORKSPACE/database.dump" ]]; then
  info "Validating PostgreSQL database snapshot from backup bundle..."
  if ! validate_database_dump "$BACKUP_WORKSPACE/database.dump"; then
    die "The database dump inside backup bundle '$BACKUP_INPUT' failed PostgreSQL validation."
  fi
  info "Restoring database snapshot for instance '$INSTANCE_NAME'..."
  restore_database_dump "$BACKUP_WORKSPACE/database.dump" "$DB_USER" "$DB_NAME"
  success "Database snapshot restored successfully"

  # Store migrated backup in instance backups directory
  "${SUDO[@]}" mkdir -p "$INSTALL_ROOT/backups/$INSTANCE_NAME"
  "${SUDO[@]}" chown "$INSTALL_OWNER:$(id -gn "$INSTALL_OWNER")" "$INSTALL_ROOT/backups/$INSTANCE_NAME" 2>/dev/null || true
  "${SUDO[@]}" chmod 700 "$INSTALL_ROOT/backups/$INSTANCE_NAME" 2>/dev/null || true
  dest_backup="$INSTALL_ROOT/backups/$INSTANCE_NAME/migrated_$(basename "$BACKUP_INPUT")"
  "${SUDO[@]}" cp "$BACKUP_INPUT" "$dest_backup" 2>/dev/null || true
  "${SUDO[@]}" chown "$INSTALL_OWNER:$(id -gn "$INSTALL_OWNER")" "$dest_backup" 2>/dev/null || true
  "${SUDO[@]}" chmod 600 "$dest_backup" 2>/dev/null || true
fi

info "Applying pending Drizzle migrations..."
dc run --rm --no-deps bot npm run db:migrate
info "Starting the bot and checking its internal health endpoint..."
if ! dc up -d --wait; then
  warn "The bot did not become healthy. Showing container status and recent logs."
  dc ps || true
  dc logs --tail=200 bot db || true
  die "Bot startup failed. Review the logs above, then run: rsbot $INSTANCE_NAME logs -f"
fi

printf '\n%s┌────────────────────────────────────────────────────────────┐%s\n' "$GREEN" "$RESET"
printf '%s│%s  %sDeployment successful%s                                      %s│%s\n' \
  "$GREEN" "$RESET" "$BOLD" "$RESET" "$GREEN" "$RESET"
printf '%s└────────────────────────────────────────────────────────────┘%s\n' "$GREEN" "$RESET"
printf '\n%sInstance:%s  %s\n' "$DIM" "$RESET" "$INSTANCE_NAME"
printf '%sVerify:%s    rsbot %s verify\n' "$DIM" "$RESET" "$INSTANCE_NAME"
printf '%sStatus:%s    rsbot %s status\n' "$DIM" "$RESET" "$INSTANCE_NAME"
printf '%sLogs:%s      rsbot %s logs -f\n' "$DIM" "$RESET" "$INSTANCE_NAME"
printf '%sBackup:%s    rsbot %s backup\n\n' "$DIM" "$RESET" "$INSTANCE_NAME"
printf '%sNext:%s      Open /admin → Rebecca panels in Telegram to configure panel API keys.\n\n' "$DIM" "$RESET"
