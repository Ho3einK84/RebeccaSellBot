# RebeccaSellBot — Deployment & Operations Guide

This guide covers production installation, multi-instance management with `rsbot`, reverse proxy integration (Caddy On-Demand TLS mesh and Nginx), and transactional disaster recovery.

---

## 1. Prerequisites

- **OS:** Ubuntu 22.04 LTS or 24.04 LTS (recommended)
- **Runtime:** Docker Engine 24+ and Docker Compose v2 (installed automatically by `install.sh` if absent)
- **Resources:** 1 GB RAM minimum (2 GB recommended), 10 GB free disk
- **Network:**
  - **Long Polling (Default):** Zero inbound ports or domains required.
  - **Webhook / Mini App:** Ports `80` and `443` open for HTTPS reverse proxy (Caddy or Nginx).

---

## 2. Installation

### Option A: Interactive Setup (Recommended)

```bash
git clone https://github.com/Ho3einK84/RebeccaSellBot.git
cd RebeccaSellBot
./install.sh
```

The installer validates dependencies, prompts for `BOT_TOKEN` and `ADMIN_IDS`, generates `PANEL_CREDENTIALS_KEY` (`AES-256-GCM`), provisions the instance under `/opt/RebeccaSellBot/<instance>`, runs Drizzle migrations, and installs `/usr/local/bin/rsbot`.

### Option B: Unattended Provisioning

```bash
cat << 'EOF' > /root/rsbot.env
BOT_TOKEN=123456789:AAExampleTelegramBotTokenHere
ADMIN_IDS=123456789
DB_USER=rsbot_main
DB_PASSWORD=ChooseAStrong16CharPassword
DB_NAME=rsbot_main
DEFAULT_LOCALE=fa
BOT_DELIVERY_MODE=polling
EOF
chmod 0600 /root/rsbot.env

curl -fsSL https://raw.githubusercontent.com/Ho3einK84/RebeccaSellBot/main/install.sh \
  | sudo bash -s -- --instance main --env-file /root/rsbot.env --non-interactive --yes
```

#### `install.sh` Options

| Flag                      | Description                                                          | Default                 |
| :------------------------ | :------------------------------------------------------------------- | :---------------------- |
| `--instance <name>`       | Instance identifier (`[a-z0-9][a-z0-9_-]{0,31}`).                    | `main`                  |
| `--from-backup <path>`    | Bootstrap and restore directly from a `.tar.gz` backup bundle.       | —                       |
| `--env-file <path>`       | Pre-populated `KEY=value` environment file.                          | —                       |
| `--repository <url>`      | Git repository URL (HTTPS or SSH).                                   | Official repo           |
| `--access-method <m>`     | Repository auth mode: `public`, `ssh`, or `pat`.                     | `public`                |
| `--ssh-key <path>`        | Private SSH deploy key path (when `--access-method ssh`).            | —                       |
| `--webhook`               | Enable Telegram Webhook delivery mode.                               | Polling                 |
| `--webhook-url <url>`     | Public HTTPS URL for Telegram webhook updates.                       | —                       |
| `--webhook-secret <tok>`  | `X-Telegram-Bot-Api-Secret-Token` value.                             | Auto-generated          |
| `--webhook-port <port>`   | Internal container webhook port.                                     | `3000`                  |
| `--webhook-host-port <p>` | Host published webhook port for reverse proxy.                       | Auto-resolved (`3000`+) |
| `--webapp-url <url>`      | Public HTTPS URL for the Telegram Mini App.                          | —                       |
| `--webapp-port <port>`    | Internal container Fastify port.                                     | `3002`                  |
| `--webapp-host-port <p>`  | Host published Mini App port.                                        | Auto-resolved (`3002`+) |
| `--webapp-bind-host <ip>` | Host IP bound by published Mini App port.                            | `127.0.0.1`             |
| `--admin-session-secret`  | 32+ char secret for Mini App admin JWT cookies.                      | Auto-generated          |
| `--non-interactive`       | Never prompt; exit non-zero if required inputs are missing.          | `false`                 |
| `--yes`                   | Overwrite existing instance `.env` without interactive confirmation. | `false`                 |

---

## 3. Multi-Instance Management (`rsbot`)

All installed instances under `/opt/RebeccaSellBot/<instance>` are managed through `/usr/local/bin/rsbot`:

| Command                            | Action                                                                                                              |
| :--------------------------------- | :------------------------------------------------------------------------------------------------------------------ |
| `rsbot list`                       | List all instances, running state, published ports, delivery mode, and WebApp URL.                                  |
| `rsbot <name> up`                  | Ensure mesh resources, build/start containers, and wait for health checks.                                          |
| `rsbot <name> down`                | Stop containers while preserving PostgreSQL volumes and `.env`.                                                     |
| `rsbot <name> restart`             | Restart instance containers and verify readiness.                                                                   |
| `rsbot <name> status`              | Display container states and health status.                                                                         |
| `rsbot <name> verify`              | Deep diagnostics: `.env` permissions (`0600`), port collisions, PostgreSQL readiness, and `/readyz` HTTP 200 probe. |
| `rsbot <name> logs [-f]`           | View or follow (`-f`) container logs.                                                                               |
| `rsbot <name> update`              | Pull latest Git commits, rebuild container image, apply SQL migrations, and verify `/readyz`.                       |
| `rsbot <name> backup`              | Create a compressed `0600` backup bundle in `/opt/RebeccaSellBot/backups/<name>/`.                                  |
| `rsbot <name> backups`             | List available backup archives with timestamps and sizes.                                                           |
| `rsbot <name> prune-backups [N]`   | Retain the newest `N` backups (default: `14`) and remove older archives.                                            |
| `rsbot <name> restore <file> [-y]` | Validate and restore a `.tar.gz` bundle (or legacy `.dump`) with automatic pre-restore rollback protection.         |
| `rsbot <name> uninstall`           | Permanently remove the instance directory, containers, and database volume.                                         |

---

## 4. Reverse Proxy & Multi-Instance Mesh

### Automated Caddy Mesh (On-Demand TLS)

RebeccaSellBot includes a zero-touch domain mesh for single or multi-instance Mini App deployments:

1. Each instance writes its domain registration JSON into the shared Docker volume `rsbot_registry` (`/app/data/registry/`).
2. Caddy queries `http://main_bot:3002/api/caddy-check?domain=<domain>` before issuing certificates.
3. Incoming HTTPS traffic is routed to `main_bot:3002`, which serves local requests or proxies peer domains across the `rsbot_mesh` Docker network.

```bash
cp /opt/RebeccaSellBot/main/deploy/caddy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
```

### Static Reverse Proxy (Manual Alternative)

If you prefer static host-port routing without mesh proxying:

```caddy
# Mini App (WEBAPP_HOST_PORT=3002)
app.example.com {
    reverse_proxy 127.0.0.1:3002
    encode zstd gzip
}

# Optional Telegram Webhook (WEBHOOK_HOST_PORT=3000)
bot.example.com {
    reverse_proxy 127.0.0.1:3000
    encode zstd gzip
}
```

---

## 5. Backup & Disaster Recovery

### Backup Bundle Layout (`.tar.gz`, mode `0600`)

Every archive created by `rsbot <instance> backup` (or the automated in-bot backup job) contains:

- `database.dump` — PostgreSQL custom-format dump (`pg_dump -Fc --no-owner --no-privileges`)
- `.env` — Instance environment configuration (when `backup_include_env = true`)
- `docker-compose.yml` — Instance Compose definition
- `manifest.txt` — Format version (`format_version=1`), instance name, UTC timestamp, and Git commit SHA

### Transactional Restore Flow

Running `rsbot <instance> restore <bundle.tar.gz> -y`:

1. **Archive Security Check:** Rejects archives containing symlinks, special device nodes, absolute paths, or `..` traversal, and verifies `manifest.txt` + `database.dump`.
2. **Pre-Restore Safety Snapshot:** Automatically creates a `pre_restore_<instance>_<timestamp>.tar.gz` bundle before modifying any state.
3. **Single-Transaction Restore:** Restores `database.dump` inside a single PostgreSQL transaction (with automatic GUC compatibility fallback across PG versions), applies pending Drizzle migrations, and verifies `/readyz`.
4. **Automatic Rollback:** If migration or health verification fails, the pre-restore snapshot is automatically restored.
