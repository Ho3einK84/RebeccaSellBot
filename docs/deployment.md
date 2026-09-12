# RebeccaSellBot — Deployment & Operations Guide

This guide covers production deployment, multi-instance lifecycle management, reverse proxy configuration (Caddy and Nginx), zero-touch mesh routing, and disaster recovery for **RebeccaSellBot**.

For high-level system architecture, see [docs/architecture.md](architecture.md). For environment variable definitions, see [docs/configuration.md](configuration.md).

---

## 1. System Requirements & Prerequisites

- **Operating System:** Ubuntu 22.04 LTS or 24.04 LTS (recommended)
- **Container Engine:** Docker Engine 24+ and Docker Compose v2 (installed automatically by `install.sh` if absent)
- **Memory & Storage:** 1 GB RAM minimum (2 GB recommended), 10 GB free disk space
- **Network Ports:**
  - Inbound ports are **not required** when running in default Long Polling mode without Mini App.
  - Port `80` / `443` required on host only when running in Webhook mode or enabling the Telegram Mini App.

---

## 2. Installation Methods

### Option A: Guided Interactive Installation (Recommended)

Run the bootstrap script on your server:

```bash
git clone https://github.com/Ho3einK84/RebeccaSellBot.git
cd RebeccaSellBot
./install.sh
```

The interactive installer:

1. Verifies server prerequisites (Docker, Compose, Git, OpenSSL).
2. Prompts for bot token, initial admin Telegram ID, database credentials, and locale.
3. Automatically generates an AES-256-GCM encryption key (`PANEL_CREDENTIALS_KEY`).
4. Configures Docker Compose services, applies SQL migrations, and starts the container.
5. Installs the global CLI `/usr/local/bin/rsbot`.

Rebecca panels can be connected immediately afterward from Telegram via `/admin` → **Rebecca panels**.

---

### Option B: Unattended Automated Installation

For scripted setups, CI/CD pipelines, or fleet provisioning:

```bash
# 1. Create a secure environment file (chmod 0600)
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

# 2. Run non-interactive installation
curl -fsSL https://raw.githubusercontent.com/Ho3einK84/RebeccaSellBot/main/install.sh \
  | sudo bash -s -- --instance main --env-file /root/rsbot.env --non-interactive --yes
```

#### `install.sh` CLI Flags

| Flag                         | Description                                                                 | Default / Note             |
| :--------------------------- | :-------------------------------------------------------------------------- | :------------------------- |
| `--instance <name>`          | Unique instance identifier (letters, digits, underscores, dashes).          | `main`                     |
| `--from-backup <path>`       | Restore directly from a full compressed backup bundle (`.tar.gz`).          | —                          |
| `--repository <url>`         | Git repository URL (HTTPS or SSH).                                          | Official GitHub repository |
| `--access-method <method>`   | Git access method: `public`, `ssh`, or `pat`.                               | `public`                   |
| `--ssh-key <path>`           | Path to private SSH deploy key (when `--access-method ssh`).                | —                          |
| `--env-file <path>`          | Path to pre-populated deployment environment file.                          | —                          |
| `--webhook`                  | Enable Webhook delivery mode.                                               | Disabled (polling)         |
| `--webhook-url <url>`        | Public Telegram webhook HTTPS URL.                                          | —                          |
| `--webhook-secret <token>`   | Webhook secret verification token (`X-Telegram-Bot-Api-Secret-Token`).      | Auto-generated if omitted  |
| `--webhook-port <port>`      | Internal container webhook listening port.                                  | `3000`                     |
| `--webhook-host-port <port>` | Published host port for reverse proxy forwarding.                           | `3000`                     |
| `--webapp-url <url>`         | Public HTTPS URL for Telegram Mini App.                                     | —                          |
| `--webapp-port <port>`       | Internal container Fastify listening port.                                  | `3002`                     |
| `--webapp-host-port <port>`  | Published host port for Mini App reverse proxy forwarding.                  | Auto-assigned (`3002`+)    |
| `--webapp-bind-host <ip>`    | Host IP to bind container published ports to.                               | `127.0.0.1`                |
| `--admin-session-secret <s>` | Secret for signing Mini App admin JWT cookies.                              | Auto-generated if omitted  |
| `--non-interactive`          | Never prompt; fail immediately if any required parameter is missing.        | —                          |
| `--yes`                      | Automatically approve prompts and overwrite existing instance `.env` files. | —                          |
| `-h, --help`                 | Display CLI help information.                                               | —                          |

---

### Option C: Server-to-Server Migration (`--from-backup`)

Migrate an entire instance from one server to another with zero data loss:

```bash
# 1. On source server: generate a complete backup bundle
rsbot main backup
# Created: /opt/RebeccaSellBot/backups/main/manual_backup_main_20260912_170000_a1b2c3.tar.gz

# 2. Transfer the archive securely to the target server
scp /opt/RebeccaSellBot/backups/main/manual_backup_main_*.tar.gz root@new-server:/root/

# 3. On target server: bootstrap directly from the backup bundle
./install.sh --from-backup /root/manual_backup_main_*.tar.gz --non-interactive --yes
```

---

## 3. Instance Lifecycle Management (`rsbot`)

The global CLI utility `/usr/local/bin/rsbot` simplifies multi-instance management:

```bash
rsbot list
rsbot <instance> <command> [options]
```

### Complete Command Reference

| Command                          | Description                                                                              |
| :------------------------------- | :--------------------------------------------------------------------------------------- |
| `rsbot list`                     | List all installed instances, operational status, delivery modes, and bound host ports.  |
| `rsbot <name> up`                | Build images, apply pending database migrations, and boot containers.                    |
| `rsbot <name> down`              | Gracefully stop containers while preserving all database volumes and configs.            |
| `rsbot <name> restart`           | Perform a safe service restart.                                                          |
| `rsbot <name> status`            | Inspect container status, healthcheck probes, and uptime.                                |
| `rsbot <name> verify`            | Run deep system diagnostics: container health, database queries, and panel connectivity. |
| `rsbot <name> logs [-f]`         | Stream structured JSON/pretty logs (`-f` to follow).                                     |
| `rsbot <name> update`            | Pull latest Git commits, rebuild images, run Drizzle migrations, and restart service.    |
| `rsbot <name> backup`            | Create a complete compressed snapshot: PostgreSQL custom dump + `.env` + Compose info.   |
| `rsbot <name> backups`           | List all stored backup archives for this instance with timestamps and file sizes.        |
| `rsbot <name> prune-backups [N]` | Retain only the most recent `N` backup archives (default: 14) and delete older archives. |
| `rsbot <name> restore <file>`    | Safely restore a complete backup or legacy `.dump` with automatic pre-restore rollback.  |
| `rsbot <name> uninstall`         | Permanently stop containers and remove the instance directory and database volume.       |

---

## 4. Delivery Modes & Reverse Proxy Integration

RebeccaSellBot can receive Telegram updates via **Long Polling** or **Webhooks**.

### 1. Long Polling Mode (Default)

Requires no public domain name, no open ports, and zero firewall configuration:

```env
BOT_DELIVERY_MODE=polling
```

When switching from Webhook to Long Polling, RebeccaSellBot automatically calls `bot.api.deleteWebhook()` on startup to clear previous Telegram webhook registrations and avoid HTTP 409 conflict errors.

---

### 2. Webhook Mode

Designed for production environments where incoming updates are reverse-proxied over HTTPS:

```env
BOT_DELIVERY_MODE=webhook
WEBHOOK_URL=https://bot.example.com/rsbot/webhook
WEBHOOK_SECRET_TOKEN=random_32_character_secret_token_here_123456
WEBHOOK_PORT=3000
WEBHOOK_PATH=/rsbot/webhook
WEBHOOK_HOST_PORT=3000
```

#### Caddy Reverse Proxy (Webhook)

```caddy
# Standalone domain for Webhook
bot.example.com {
    reverse_proxy 127.0.0.1:3000
    encode zstd gzip
}

# Or as a dedicated subpath on an existing domain:
example.com {
    handle /rsbot/* {
        reverse_proxy 127.0.0.1:3000
    }
}
```

#### Nginx Reverse Proxy (Webhook)

```nginx
server {
    listen 443 ssl http2;
    server_name bot.example.com;

    ssl_certificate /etc/letsencrypt/live/bot.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bot.example.com/privkey.pem;

    location /rsbot/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 5. Telegram Mini App & Multi-Instance Mesh Architecture

RebeccaSellBot includes a modern Fastify + React 19 Telegram Mini App dashboard.

> [!IMPORTANT]
> **Domain Requirement for Mini Apps:** While standard bot operations work with Long Polling (no open ports or domains), enabling the Mini App (`WEBAPP_URL`) requires a public HTTPS domain. Telegram clients open Mini Apps inside an embedded webview that strictly requires an HTTPS origin.

### Automated Reverse Proxy & On-Demand TLS (Caddy Mesh)

In RebeccaSellBot v0.2+, manual Caddyfile editing per instance is **not required**. The project includes a zero-touch mesh ingress architecture:

```text
               Public HTTPS Traffic (*.yourdomain.com)
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │      Caddy Ingress     │
                    │   (On-Demand TLS Ask)  │
                    └───────────┬────────────┘
                                │ ask http://main_bot:3002/api/caddy-check
                                ▼
                    ┌────────────────────────┐
                    │   main_bot (Port 3002) │
                    │  Shared Mesh Registry  │
                    └───────────┬────────────┘
                                │
         ┌──────────────────────┼──────────────────────┐
         ▼                      ▼                      ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ Instance "main"  │  │ Instance "vip"   │  │ Instance "shop3" │
│ Local Fastify    │  │ Proxy over mesh  │  │ Proxy over mesh  │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

1. Each bot instance registers its domain and target in a shared volume (`rsbot_registry`, `/app/data/registry/`).
2. Caddy's `on_demand_tls` directive asks `main_bot:3002/api/caddy-check?domain=<domain>`.
3. If the domain is recognized across any active instance, HTTP 200 is returned and Caddy automatically provisions a Let's Encrypt certificate.
4. Catch-all traffic is routed to `main_bot:3002`, which transparently dispatches peer requests across the internal `rsbot_mesh` Docker network.

Deploy the automated Caddy configuration:

```bash
cp /opt/RebeccaSellBot/main/deploy/caddy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
```

---

### Manual / Static Reverse Proxy Alternative

If you prefer static, hardcoded reverse proxy definitions instead of automated mesh dispatching, bind each instance to a unique published host port:

- Instance `main`: `WEBAPP_HOST_PORT=3002`
- Instance `shop2`: `WEBAPP_HOST_PORT=3003`
- Instance `shop3`: `WEBAPP_HOST_PORT=3004`

#### Static Caddyfile (`deploy/caddy/Caddyfile.multi-instance.example`):

```caddy
shop1.yourdomain.com {
    reverse_proxy 127.0.0.1:3002
    encode zstd gzip
}

shop2.yourdomain.com {
    reverse_proxy 127.0.0.1:3003
    encode zstd gzip
}

shop3.yourdomain.com {
    reverse_proxy 127.0.0.1:3004
    encode zstd gzip
}
```

#### Static Nginx Configuration (Mini App):

```nginx
server {
    listen 443 ssl http2;
    server_name app.example.com;

    ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 6. Dynamic Port Sensing & PaaS Deployment (`PORT`)

When deploying RebeccaSellBot on platforms that inject a dynamic listening port (e.g. Render, Railway, fly.io, Heroku, or systemd socket activation):

- Setting the `PORT` environment variable automatically unifies the HTTP listeners.
- The single multiplexed port handles:
  1. Internal health and readiness probes (`/health`, `/healthz`, `/ready`, `/readyz`).
  2. Inbound Telegram Webhook updates (`/webhook` or custom subpaths).
  3. Inbound Rebecca Panel push webhooks (`/api/rebecca-webhook`).

---

## 7. Disaster Recovery & Backup Architecture

### Full Snapshot Composition

Running `rsbot <instance> backup` creates a single compressed archive (`.tar.gz`, permissions `0600`) containing:

1. `database.dump`: PostgreSQL custom-format binary dump generated via `pg_dump -Fc`.
2. `.env`: Instance environment configuration.
3. `docker-compose.yml`: Compose definitions.
4. `manifest.json`: Checksum metadata, PostgreSQL version, and schema migration hash.

### Transactional Restore with Automatic Rollback

Executing `rsbot <instance> restore <bundle>`:

1. **Validation:** Checks archive checksums, gzip integrity, and schema manifest compatibility.
2. **Safety Snapshot:** Creates an automatic pre-restore rollback snapshot (`pre_restore_YYYYMMDD_HHMMSS_*.tar.gz`) before touching any state.
3. **Transactional Database Restore:** Restores PostgreSQL data inside an isolated transaction.
4. **Migration Sweep:** Automatically executes any pending Drizzle database migrations.
5. **Health Verification:** Boots the restored container and tests `/health`. If the health check fails, the pre-restore snapshot is automatically restored and the rollback is logged.
