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

banner() {
  printf '\n%s╔══════════════════════════════════════════════════════════════╗%s\n' "$PURPLE" "$RESET"
  printf '%s║%s  %s✦ RebeccaSellBot%s  %sTelegram storefront deployment%s             %s║%s\n' \
    "$PURPLE" "$RESET" "$BOLD$CYAN" "$RESET" "$DIM" "$RESET" "$PURPLE" "$RESET"
  printf '%s║%s  %sUbuntu 24.04 · Docker · PostgreSQL · Multi-instance%s             %s║%s\n' \
    "$PURPLE" "$RESET" "$DIM" "$RESET" "$PURPLE" "$RESET"
  printf '%s╚══════════════════════════════════════════════════════════════╝%s\n\n' "$PURPLE" "$RESET"
}

section() { printf '\n%s━━ %s%s%s\n' "$BLUE" "$BOLD" "$*" "$RESET"; }
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
  --repository <url>         GitHub HTTPS or SSH repository URL
  --access-method <method>   public, ssh, or pat
  --ssh-key <path>           SSH deploy-key path (for --access-method ssh)
  --env-file <path>          Plain KEY=value deployment configuration file
  --non-interactive          Never prompt; fail if required values are absent
  --yes                      Replace an existing instance .env automatically
  -h, --help                 Show this help

For unattended installation, pass --non-interactive --yes and provide an
--env-file. Supported file keys are documented in README.md. Keep that file
mode 0600 and remove it after installation.
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

load_config_file() {
  local source_file="$1" line key value
  [[ -f "$source_file" && -r "$source_file" ]] || die "Cannot read configuration file: $source_file"

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" == *=* ]] || die "Invalid configuration line in $source_file. Use KEY=value."
    key="${line%%=*}"
    value="${line#*=}"

    case "$key" in
      BOT_TOKEN|ADMIN_IDS|PANEL_CREDENTIALS_KEY|REBECCA_API_URL|REBECCA_API_KEY|REBECCA_ADMIN_USERNAME|REBECCA_ADMIN_PASSWORD|REBECCA_SERVICE_ID|DB_USER|DB_PASSWORD|DB_NAME|DEFAULT_LOCALE|GITHUB_PAT|RSBOT_ACCESS_METHOD|RSBOT_REPOSITORY_URL|RSBOT_SSH_KEY_PATH)
        printf -v "$key" '%s' "$value"
        export "$key"
        ;;
      *)
        die "Unsupported key '$key' in $source_file."
        ;;
    esac
  done < "$source_file"
}

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
  if [[ -n "$supplied" ]]; then
    printf '%s' "$supplied"
    return
  fi
  [[ "$NON_INTERACTIVE" == false ]] || die "$label must be supplied in --non-interactive mode."
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
  while true; do
    if [[ -z "$candidate" ]]; then
      [[ "$NON_INTERACTIVE" == false ]] || candidate="main"
      if [[ "$NON_INTERACTIVE" == false ]]; then
        candidate="$(prompt_default "Instance name" "main")"
      fi
    fi
    candidate="${candidate,,}"
    validate_instance "$candidate" && { printf '%s' "$candidate"; return; }
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
  PANEL_CREDENTIALS_KEY="${PANEL_CREDENTIALS_KEY:-$(openssl rand -hex 32)}"
  validate_panel_credentials_key "$PANEL_CREDENTIALS_KEY" ||
    die "PANEL_CREDENTIALS_KEY must use 32–512 safe visible characters."

  safe_instance="${INSTANCE_NAME//-/_}"
  if [[ -z "${DB_USER:-}" && "$NON_INTERACTIVE" == false ]]; then
    DB_USER="$(prompt_default "PostgreSQL username" "rsbot_$safe_instance")"
  fi
  DB_USER="$(validated_required "PostgreSQL username" "${DB_USER:-rsbot_$safe_instance}" validate_identifier "Use a lowercase PostgreSQL identifier." false)"
  if [[ -z "${DB_NAME:-}" && "$NON_INTERACTIVE" == false ]]; then
    DB_NAME="$(prompt_default "PostgreSQL database name" "rsbot_$safe_instance")"
  fi
  DB_NAME="$(validated_required "PostgreSQL database name" "${DB_NAME:-rsbot_$safe_instance}" validate_identifier "Use a lowercase PostgreSQL identifier." false)"

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
    printf 'HEALTH_CHECK_PORT=3001\n'
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

step "2/5" "Checking Docker Engine and Compose"
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
success "Docker and Compose are ready"

INSTANCE_NAME="$(resolve_instance_name)"
readonly INSTANCE_NAME
readonly INSTALL_DIR="$INSTALL_ROOT/$INSTANCE_NAME"
readonly ENV_FILE="$INSTALL_DIR/.env"

section "Installing instance: $INSTANCE_NAME"
step "3/5" "Preparing isolated installation directory"
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
    "${SUDO[@]}" cp "$ENV_FILE" "$ENV_FILE.backup.$(date +%Y%m%d_%H%M%S)"
    info "Existing configuration backed up before replacement."
  elif [[ "$NON_INTERACTIVE" == true ]]; then
    die "An existing configuration requires --yes before unattended replacement."
  else
    read -r -p "Replace the existing instance configuration? [y/N]: " replace_env
    if [[ ! "$replace_env" =~ ^[Yy]$ ]]; then
      info "Keeping the existing .env configuration."
      CONFIGURE_ENV=false
    else
      "${SUDO[@]}" cp "$ENV_FILE" "$ENV_FILE.backup.$(date +%Y%m%d_%H%M%S)"
      CONFIGURE_ENV=true
    fi
  fi
else
  CONFIGURE_ENV=true
fi

if [[ "${CONFIGURE_ENV:-true}" == true ]]; then
  # Reusing the encryption key is mandatory when an existing database already
  # contains panel credentials. Rotating it implicitly would make them unreadable.
  if [[ -z "${PANEL_CREDENTIALS_KEY:-}" && -f "$ENV_FILE" ]]; then
    PANEL_CREDENTIALS_KEY="$(sed -n 's/^PANEL_CREDENTIALS_KEY=//p' "$ENV_FILE" | head -n 1)"
  fi
  configure_environment
fi

step "4/5" "Installing the rsbot manager"
"${SUDO[@]}" install -m 0755 "$INSTALL_DIR/scripts/rsbot" /usr/local/bin/rsbot
success "rsbot is available at /usr/local/bin/rsbot"

step "5/5" "Building and starting services"
info "Building the bot image..."
dc build bot
info "Starting PostgreSQL and waiting for readiness..."
dc up -d --wait db
info "Applying pending Drizzle migrations..."
dc run --rm --no-deps bot npm run db:migrate
info "Starting the bot and checking its internal health endpoint..."
if ! dc up -d --wait; then
  warn "The bot did not become healthy. Showing container status and recent logs."
  dc ps || true
  dc logs --tail=200 bot db || true
  die "Bot startup failed. Review the logs above, then run: rsbot $INSTANCE_NAME logs -f"
fi

printf '\n%s╔══════════════════════════════════════════════════════════════╗%s\n' "$GREEN" "$RESET"
printf '%s║%s  %sInstallation complete%s                                              %s║%s\n' \
  "$GREEN" "$RESET" "$BOLD" "$RESET" "$GREEN" "$RESET"
printf '%s╚══════════════════════════════════════════════════════════════╝%s\n' "$GREEN" "$RESET"
printf '\n%sInstance:%s  %s\n' "$DIM" "$RESET" "$INSTANCE_NAME"
printf '%sManage:%s    rsbot %s status\n' "$DIM" "$RESET" "$INSTANCE_NAME"
printf '%sLogs:%s      rsbot %s logs -f\n' "$DIM" "$RESET" "$INSTANCE_NAME"
printf '%sBackup:%s    rsbot %s backup\n\n' "$DIM" "$RESET" "$INSTANCE_NAME"
printf '%sNext:%s      Open /admin → Rebecca panels and add your panel/API keys.\n\n' "$DIM" "$RESET"
