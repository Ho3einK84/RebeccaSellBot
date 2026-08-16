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

---

## Managing Instances (`rsbot`)

The global CLI utility `/usr/local/bin/rsbot` simplifies multi-instance management:

```bash
rsbot list                     # List all installed instances
rsbot <name> status            # Inspect service health and container status
rsbot <name> logs -f           # Stream real-time structured logs
```

| Command                       | Description                                                          |
| :---------------------------- | :------------------------------------------------------------------- |
| `rsbot <name> up`             | Build images, apply SQL migrations, and start containers.            |
| `rsbot <name> down`           | Gracefully stop containers while retaining all data volumes.         |
| `rsbot <name> restart`        | Perform a zero-downtime service restart.                             |
| `rsbot <name> update`         | Pull latest Git commits, migrate schema, rebuild, and relaunch.      |
| `rsbot <name> backup`         | Generate an encrypted, compressed PostgreSQL snapshot (`0600`).      |
| `rsbot <name> restore <file>` | Restore database from a backup file with interactive safety checks.  |
| `rsbot <name> uninstall`      | Safely tear down containers and delete the designated instance data. |

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
