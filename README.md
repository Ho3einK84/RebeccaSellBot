# ✦ RebeccaSellBot

<p align="center">
  <strong>A resilient, multi-panel Telegram storefront for Rebecca Panel VPN subscriptions.</strong>
  <br />
  Automate sales, renewals, wallet payments, customer subscriptions, and multi-panel fleets entirely inside Telegram.
</p>

<p align="center">
  <a href="https://github.com/Ho3einK84/RebeccaSellBot"><img src="https://img.shields.io/badge/release-0.1.0-7c3aed?style=flat-square" alt="Release 0.1.0" /></a>
  <img src="https://img.shields.io/badge/runtime-Node.js%2024-339933?style=flat-square" alt="Node.js 24" />
  <img src="https://img.shields.io/badge/database-PostgreSQL%2016-336791?style=flat-square" alt="PostgreSQL 16" />
  <img src="https://img.shields.io/badge/framework-grammY-0088cc?style=flat-square" alt="grammY" />
  <img src="https://img.shields.io/badge/deployment-Docker-2496ED?style=flat-square" alt="Docker" />
  <img src="https://img.shields.io/badge/platform-Ubuntu%2024.04-E95420?style=flat-square" alt="Ubuntu 24.04" />
</p>

> [!NOTE]
> **وضعیت پروژه و یادداشت توسعه:** این پروژه همچنان در دست طراحی و ساخت است و ممکن است شامل باگ‌ها، ناپایداری‌ها یا تغییرات مداوم باشد. در توسعه و کدنویسی بخش‌های مختلف این پروژه از هوش مصنوعی (AI) بهره گرفته شده و یک پروژه مبتنی بر Vibe Coding است.
>
> **Project Status & Development Notice:** This project is under active development and may contain bugs, experimental behaviors, or architectural changes. It has been built with AI assistance (Vibe Coding).

> [!IMPORTANT]
> **Zero Database Touch:** RebeccaSellBot communicates with Rebecca panels exclusively via their official HTTPS REST APIs. It never reads from or writes to the Rebecca database directly.

Detailed system architecture and Telegram delivery layer specifications are documented in [docs/architecture.md](docs/architecture.md) and [docs/telegram-architecture.md](docs/telegram-architecture.md).

---

## Key Capabilities

| For Customers                                                                                  | For Administrators                                                                                  |
| :--------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------- |
| 🛒 **Instant Ordering:** Purchase and renew fixed packages or custom-volume plans.             | 🌐 **Multi-Panel Fleet:** Connect multiple Rebecca panels and assign distinct services per package. |
| 💳 **Wallet & Transfers:** Top up via card-to-card receipts; transfer balance to peers.        | 🛡️ **Financial Backoffice:** Review payment receipts, adjust balances, and audit transaction logs.  |
| 📊 **Subscription Portal:** Real-time quota, expiry dates, QR codes, and sub links.            | ⚙️ **In-Bot Settings:** Manage pricing, packages, categories, card info, and trial limits directly. |
| 🔄 **Auto-Renewal & Refunds:** Automatic renewal safeguards and one-click unused-plan refunds. | 📢 **Segmented Broadcasts:** Send cancelable, throttled broadcasts by user subscription status.     |
| 🎰 **Growth & Gamification:** Lucky Wheel with odds tuning, referral rewards, and promo codes. | 🔍 **Reconciliation Engine:** Detect and resolve orphaned subscriptions and remote state drifts.    |
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

```bash
# 1. Create a restricted environment file (/root/rsbot.env, chmod 0600)
cat << 'EOF' > /root/rsbot.env
BOT_TOKEN=123456789:AAExampleTelegramBotTokenHere
ADMIN_IDS=123456789
DB_USER=rsbot_bot1
DB_PASSWORD=ChooseAStrong16CharPassword
DB_NAME=rsbot_bot1
DEFAULT_LOCALE=fa
EOF

# 2. Run automated installation
curl -fsSL https://raw.githubusercontent.com/Ho3einK84/RebeccaSellBot/main/install.sh \
  | sudo bash -s -- --instance bot1 --env-file /root/rsbot.env --non-interactive --yes
```

### Option C: Server-to-Server Migration (`--from-backup`)

Move an existing instance to a new server with zero data loss:

```bash
# 1. On source server: Create full backup bundle (.tar.gz)
rsbot main backup

# 2. On target server: Restore directly from backup bundle
./install.sh --from-backup /path/to/manual_backup_main_YYYYMMDD_HHMMSS_xxxxxx.tar.gz
```

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
| `HEALTH_CHECK_PORT`     | Internal HTTP port used by Docker for container health probes.         | `3001`                               |

---

## Development & Verification

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

# Run quality verification pipeline
npm run verify
```

The `verify` script runs:

- `npm run architecture:check` — Structural and API isolation rules.
- `npm run typecheck` — Strict TypeScript compiler checks.
- `npm run lint` — ESLint static analysis.
- `npm run format:check` — Prettier code style validation.
- `npm test` — Comprehensive Vitest test suite.
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
