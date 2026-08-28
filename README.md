# ✦ RebeccaSellBot

<p align="center">
  <strong>A resilient, multi-panel Telegram storefront for Rebecca Panel VPN subscriptions.</strong>
  <br />
  Automate sales, renewals, wallet payments, and customer support entirely inside Telegram.
</p>

<p align="center">
  <a href="https://github.com/Ho3einK84/RebeccaSellBot"><img src="https://img.shields.io/badge/release-0.1.0-7c3aed?style=flat-square" alt="Release 0.1.0" /></a>
  <img src="https://img.shields.io/badge/runtime-Node.js%2024-339933?style=flat-square" alt="Node.js 24" />
  <img src="https://img.shields.io/badge/database-PostgreSQL%2016-336791?style=flat-square" alt="PostgreSQL 16" />
  <img src="https://img.shields.io/badge/framework-grammY-0088cc?style=flat-square" alt="grammY" />
  <img src="https://img.shields.io/badge/deployment-Docker-2496ED?style=flat-square" alt="Docker" />
  <img src="https://img.shields.io/badge/platform-Ubuntu%2024.04-E95420?style=flat-square" alt="Ubuntu 24.04" />
</p>

> [!IMPORTANT]
> **Zero Database Touch:** RebeccaSellBot communicates with Rebecca panels exclusively via their official HTTPS REST APIs. It never reads from or writes to the Rebecca database directly.

Detailed Telegram delivery layer and screen rendering specifications are documented in [docs/telegram-architecture.md](docs/telegram-architecture.md).

---

## Key Capabilities

| For Customers                                                                                  | For Administrators                                                                                  |
| :--------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------- |
| 🛒 **Instant Ordering:** Purchase and renew fixed packages or custom-volume plans.             | 🌐 **Multi-Panel Fleet:** Connect multiple Rebecca panels and assign distinct services per package. |
| 💳 **Wallet & Transfers:** Top up via card-to-card receipts; transfer balance to peers.        | 🛡️ **Financial Backoffice:** Review payment receipts, adjust balances, and audit transaction logs.  |
| 📊 **Subscription Portal:** Real-time quota, expiry dates, QR codes, and sub links.            | ⚙️ **In-Bot Settings:** Manage pricing, packages, categories, card info, and trial limits directly. |
| 🔄 **Auto-Renewal & Refunds:** Automatic renewal safeguards and one-click unused-plan refunds. | 📢 **Segmented Broadcasts:** Send cancelable, throttled broadcasts by user subscription status.     |
| 🎁 **Growth Tools:** Earn referral rewards, cashback percentages, and redeem promo codes.      | 🔍 **Reconciliation Engine:** Detect and resolve orphaned subscriptions and remote state drifts.    |
| 🌐 **Bilingual UX:** Seamless Persian (FA) and English (EN) localized interfaces.              | 📦 **Multi-Instance Ready:** Run isolated bot instances with separate databases on a single server. |

---

## Safety & Financial Architecture

```text
Telegram Customer
       │
       ▼
 ┌──────────────┐
 │ Wallet       │ ──► [ Reserve Funds ]
 └──────┬───────┘
        │
        ▼
 ┌──────────────┐      Success
 │ Rebecca API  │ ────────────────► [ Commit Wallet + Award Bonuses ]
 └──────┬───────┘
        │ Failure / Timeout
        ▼
 ┌──────────────┐
 │ Compensation │ ────────────────► [ Release Reserve + Audit Record ]
 └──────────────┘
```

- **Integer Arithmetic:** All currency calculations use signed 64-bit integers in minor units (no floating-point rounding errors).
- **3-Phase Purchase Saga:** Balances are reserved prior to external API dispatch and committed only upon verified creation.
- **Idempotent Rewards:** Referral bonuses, cashback, and promo usages are bound to unique transaction references.
- **Encrypted Credentials:** Panel API keys and admin passwords are encrypted at rest using AES-256-GCM.
- **Isolated Network Model:** PostgreSQL is accessible only within a private Docker bridge network; Telegram operates via outbound long polling with zero open public ports.

---

## Quick Start

### Option A: Guided Interactive Installation (Recommended)

Run the bootstrap script on a clean **Ubuntu 24.04 LTS** server:

```bash
git clone https://github.com/Ho3einK84/RebeccaSellBot.git
cd RebeccaSellBot
./install.sh
```

The installer verifies prerequisites, installs Docker if needed, configures your instance, applies database migrations, and boots the service. Panel connections can be added afterward from `/admin` → **Rebecca panels**.

### Option B: Unattended 1-Command Deployment

For automated provisioning, create a restricted environment file (`/root/rsbot.env`, permission `0600`):

```dotenv
BOT_TOKEN=123456789:AAExampleTelegramBotTokenHere
ADMIN_IDS=123456789
DB_USER=rsbot_bot1
DB_PASSWORD=ChooseAStrong16CharPassword
DB_NAME=rsbot_bot1
DEFAULT_LOCALE=fa
```

Execute the unattended installation command:

```bash
curl -fsSL https://raw.githubusercontent.com/Ho3einK84/RebeccaSellBot/main/install.sh \
  | sudo bash -s -- --instance bot1 --env-file /root/rsbot.env --non-interactive --yes
```

### Option C: Server-to-Server Migration (`--from-backup`)

Use this mode when moving an existing RebeccaSellBot instance from one server to another, or recovering after server replacement. The target server does not need an existing installation or database volume.

#### 1. Create a backup on the source server:

```bash
rsbot main backup
# Output: /opt/RebeccaSellBot/backups/main/manual_backup_main_YYYYMMDD_HHMMSS_xxxxxx.tar.gz
```

Transfer this `.tar.gz` bundle to the new server via `scp` or `rsync`.

#### 2. Install and restore on the target server:

**Guided Interactive Migration:**

```bash
git clone https://github.com/Ho3einK84/RebeccaSellBot.git
cd RebeccaSellBot
./install.sh --from-backup /root/manual_backup_main_20260828_154208_01dfb1.tar.gz
```

**Unattended 1-Command Migration:**

```bash
curl -fsSL https://raw.githubusercontent.com/Ho3einK84/RebeccaSellBot/main/install.sh \
  | sudo bash -s -- --from-backup /root/manual_backup_main_20260828_154208_01dfb1.tar.gz --non-interactive --yes
```

**Migration with Configuration Overrides (e.g. new `BOT_TOKEN` or `ADMIN_IDS`):**

```bash
curl -fsSL https://raw.githubusercontent.com/Ho3einK84/RebeccaSellBot/main/install.sh \
  | sudo bash -s -- --from-backup /root/manual_backup_main_20260828_154208_01dfb1.tar.gz --env-file /root/overrides.env --non-interactive --yes
```

#### What the Migration Flow Does:

1. Validates the archive integrity, manifest version (`format_version=1`), and structural security (rejecting symlinks, devices, or traversal).
2. Adopts baseline secrets from the backup's `.env` (preserving `PANEL_CREDENTIALS_KEY` and PostgreSQL credentials).
3. Defaults the instance name to the backup manifest's instance (unless overridden via `--instance`).
4. Provisions Docker Engine, Git checkout, and isolated instance workspace.
5. Boots PostgreSQL, verifies custom-format dump integrity, and restores the database transactionally.
6. Runs latest Drizzle schema migrations and boots the bot container with verified health checks.

> [!IMPORTANT]
> **Key Migration Caveats:**
>
> - **Preserve `PANEL_CREDENTIALS_KEY`:** Panel API keys and passwords in PostgreSQL are encrypted with AES-256-GCM. The installer automatically imports `PANEL_CREDENTIALS_KEY` from the backup `.env` so panels remain connected without re-entering credentials.
> - **Overriding `BOT_TOKEN`:** If you wish to switch to a new Telegram bot token while migrating, provide the new token during guided prompts or in `--env-file`. Customer subscriptions and wallet balances are stored in PostgreSQL and will map seamlessly.
> - **Large Backups & Telegram Limits:** Automated in-app Telegram backups are subject to Telegram's 50 MB document size ceiling. For databases exceeding 50 MB, always generate backups with `rsbot <instance> backup` for server migrations.

---

## Managing Instances (`rsbot`)

The global CLI utility `/usr/local/bin/rsbot` simplifies multi-instance management:

```bash
rsbot list                     # List all installed instances
rsbot <name> status            # Inspect service health and container status
rsbot <name> logs -f           # Stream real-time structured logs
```

| Command                       | Description                                                                       |
| :---------------------------- | :-------------------------------------------------------------------------------- |
| `rsbot <name> up`             | Build images, apply SQL migrations, and start containers.                         |
| `rsbot <name> down`           | Gracefully stop containers while retaining all data volumes.                      |
| `rsbot <name> restart`        | Perform a zero-downtime service restart.                                          |
| `rsbot <name> update`         | Pull latest Git commits, migrate schema, rebuild, and relaunch.                   |
| `rsbot <name> backup`         | Create a compressed full backup: PostgreSQL + `.env` + Compose metadata (`0600`). |
| `rsbot <name> restore <file>` | Validate and transactionally restore a full backup with automatic rollback.       |
| `rsbot <name> uninstall`      | Safely tear down containers and delete the designated instance data.              |

### Backup and Restore Safety

`rsbot <name> backup` creates a `.tar.gz` bundle containing the PostgreSQL custom-format dump, the instance `.env`, `docker-compose.yml`, and a small manifest. The archive itself is written with permission `0600` and the database dump is validated before the bundle is finalized.

> [!WARNING]
> Backups are **compressed but not encrypted**. Because the bundle contains `.env` (including the Telegram token, database password, and panel credential encryption key), copy it only to trusted storage with appropriate access controls.

Before a restore, `rsbot` validates the archive and PostgreSQL dump, verifies that the backup belongs to the selected instance, and creates a separate `pre_restore_*.tar.gz` safety backup. Database replacement runs in a single PostgreSQL transaction. The saved `.env` is installed atomically only after the database restore succeeds, current migrations are applied, and the bot must become healthy. If any restore step fails, `rsbot` attempts to restore both the previous database and previous `.env` automatically. Legacy PostgreSQL `.dump` files remain supported, but they do not replace the current `.env`.

For safety, restoring a full bundle into an already-provisioned instance requires `DB_USER`, `DB_PASSWORD`, and `DB_NAME` in the saved `.env` to match the existing database volume. For disaster recovery onto a fresh server, provision the instance with the saved `.env` values first, then restore the bundle.

---

## Environment Variables

| Variable                | Description                                                            | Default / Example                    |
| :---------------------- | :--------------------------------------------------------------------- | :----------------------------------- |
| `BOT_TOKEN`             | Telegram Bot API token obtained from `@BotFather`.                     | _Required_                           |
| `ADMIN_IDS`             | Comma-separated initial Telegram user IDs for admin bootstrap.         | `123456789`                          |
| `DATABASE_URL`          | PostgreSQL connection string.                                          | `postgres://user:pass@db:5432/rsbot` |
| `PANEL_CREDENTIALS_KEY` | 32+ character key used to encrypt panel credentials at rest.           | Generated by installer               |
| `DEFAULT_LOCALE`        | Default language for newly registered users (`fa` or `en`).            | `fa`                                 |
| `SUPPORT_URL`           | Optional Telegram support username/link (e.g. `https://t.me/support`). | First `ADMIN_ID`                     |
| `HEALTH_CHECK_PORT`     | Internal HTTP port used by Docker for container health probes.         | `8080`                               |

---

## Development & Verification

### Local Setup

```bash
# Clone and install dependencies
git clone https://github.com/Ho3einK84/RebeccaSellBot.git
cd RebeccaSellBot
npm ci

# Configure environment & migrate database
cp .env.example .env
npm run db:migrate

# Start with live reloading
npm run dev
```

### Quality Verification Suite

Ensure code quality, typing, formatting, and architecture rules pass before committing:

```bash
npm run verify
```

The `verify` script runs the complete pipeline:

- `npm run architecture:check` — Enforces structural and API isolation rules.
- `npm run typecheck` — Strict TypeScript compiler checks.
- `npm run lint` — ESLint static analysis.
- `npm run format:check` — Prettier code style validation.
- `npm test` — Comprehensive Vitest test suite (67+ test files, 390+ unit tests).
- `npm run build` — Production TypeScript bundle compilation.

---

## Security & Operational Checklist

- [x] **HTTPS Enforcement:** Rebecca panels must expose valid TLS endpoints; insecure connections are rejected.
- [x] **Secret Redaction:** Logs automatically redact authorization tokens, card details, and sensitive receipts.
- [x] **Outbound-Only Polling:** No exposed inbound webhook ports; resilient against direct network scans.
- [x] **Non-Root Execution:** Node.js processes run under an unprivileged `node` user in production Docker containers.
- [x] **Audit Trail:** Balance alterations, card approval actions, and admin overrides are immutably logged.

---

## License

This project is licensed under the terms of the [MIT License](LICENSE).
