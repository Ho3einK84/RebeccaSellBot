# ✦ RebeccaSellBot

<p align="center">
  <strong>Resilient, multi-panel Telegram commerce and Mini App platform for Rebecca Panel.</strong>
  <br />
  Automate sales, VIP user groups, automated top-ups, renewals, wallet accounting, flash sales, and multi-panel fleets across Telegram and Mini App.
</p>

<p align="center">
  <a href="https://github.com/Ho3einK84/RebeccaSellBot/releases"><img src="https://img.shields.io/github/v/release/Ho3einK84/RebeccaSellBot?style=flat-square&color=7c3aed" alt="Latest Release" /></a>
  <a href="https://github.com/Ho3einK84/RebeccaSellBot/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Ho3einK84/RebeccaSellBot/ci.yml?branch=main&label=CI&style=flat-square" alt="CI Status" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Ho3einK84/RebeccaSellBot?style=flat-square&color=0ea5e9" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/node-24.x-339933?style=flat-square" alt="Node.js 24" />
  <img src="https://img.shields.io/badge/postgres-16-336791?style=flat-square" alt="PostgreSQL 16" />
  <img src="https://img.shields.io/badge/telegram-grammY-0088cc?style=flat-square" alt="grammY" />
  <img src="https://img.shields.io/badge/webapp-Fastify%205%20%2B%20React%2019-111827?style=flat-square" alt="Fastify 5 + React 19" />
  <img src="https://img.shields.io/badge/docker-ready-2496ED?style=flat-square" alt="Docker" />
</p>

> [!NOTE]
> **وضعیت پروژه و یادداشت توسعه:** این پروژه همچنان در دست طراحی و ساخت است و ممکن است شامل باگ‌ها، ناپایداری‌ها یا تغییرات مداوم باشد. در توسعه و کدنویسی بخش‌های مختلف این پروژه از هوش مصنوعی (AI) بهره گرفته شده و یک پروژه مبتنی بر Vibe Coding است.
>
> **Project Status & Development Notice:** This project is under active development and may contain bugs, experimental behaviors, or architectural changes. It has been built with AI assistance (Vibe Coding).

> [!IMPORTANT]
> **Zero Database Touch:** RebeccaSellBot communicates with Rebecca panels exclusively via their official HTTPS REST APIs. It never connects to or mutates remote panel databases directly.

---

## Documentation

> **Last synced with version:** `v0.4.0`

| Document                                                    | Scope                                                                                                                      |
| :---------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------- |
| 🏛️ **[System Architecture](docs/architecture.md)**          | Layered architecture, 3-phase purchase saga with VIP credit & inventory locks, 32-table PostgreSQL schema, and 11 workers. |
| 💬 **[Telegram & UI Layer](docs/telegram-architecture.md)** | Ephemeral screen engine, stateless `adm:*` admin router, non-blocking input engine, and callback guards.                   |
| 📱 **[Mini App Architecture](docs/webapp-architecture.md)** | Unified User & Admin Mini App (`Fastify 5` + `React 19`), modular `/api/user/*` & webhook routes, and chat sync.           |
| ⚙️ **[Configuration Reference](docs/configuration.md)**     | Complete `.env` specification and runtime `/admin` database settings catalog.                                              |
| 🚀 **[Deployment & Operations](docs/deployment.md)**        | 1-command installation, `rsbot` lifecycle CLI, Caddy On-Demand TLS mesh, and transactional disaster recovery.              |
| 📋 **[Changelog](CHANGELOG.md)**                            | Official release history and version highlights following Keep a Changelog.                                                |
| 🤝 **[Contributing](CONTRIBUTING.md)**                      | `main`/`dev` branching workflow, Conventional Commits, and local verification checklist.                                   |
| 🔐 **[Security Policy](SECURITY.md)**                       | Vulnerability reporting, credential encryption, gateway webhook/upload auth, and database integrity guarantees.            |

---

## Capabilities

| Customer Experience (Telegram Bot + Mini App Parity)                                                                                                                                                                  | Administration & Backoffice                                                                                                                                                                           |
| :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🛒 **Instant Storefront & VIP Groups:** Fixed packages, stock/per-user caps, custom GB/day ordering, buyer-chosen service names, group discounts/badges, & flash sales.                                               | 🌐 **Multi-Panel Fleet & Inventory Caps:** Connect multiple Rebecca panels (`AES-256-GCM` vault), enforce panel/service capacity & creation quotas, and define VIP `user_groups`.                     |
| 💳 **Automated & Manual Top-Ups:** Automated ForApp card-to-card SMS matching, NOWPayments crypto invoices (live/manual USDT rates), 2-step manual receipts, & positive-only P2P transfers.                           | 🛡️ **Payment & Access Security:** `SHA-256` + `file_unique_id` receipt deduplication, atomic voiding, payment-message auto-delete, `open`/`invite_only`/`closed` registration, & forced channel join. |
| 🎁 **Free Trial & Interactive Lucky Wheel:** One-tap trial claiming (fractional `0.1 GB+` quotas) with QR & SmartConnect delivery plus an animated 8-slice SVG Lucky Wheel with haptics, cooldowns, and spin history. | 📊 **Telegram & Mini App CRM:** 1-tap stateless `/admin` command center (`/r`, `/u`, `/stats`, `/version`), group/expiry assignment, unmatched deposit matcher, and orphan reconciliation.            |
| 📊 **Subscription Portal & Personal Labels:** Sync All, external sub-link claim, local 40-char personal labels, per-node usage & `onlineAt`, QR codes, 1-tap SmartConnect links, & revoke.                            | 📢 **Growth, Retention & Bulk Gifts:** Group-filtered broadcasts, durable bulk GB/day gift campaigns, 24h first-use nudges, and staged expired-config cleanup with warnings.                          |
| 🔄 **Lifecycle & VIP Credit:** Start-on-first-use (`on_hold`), rollover, preset & custom auto-renewal (VIP credit-aware), P2P service transfer, self-refund quotes, & chat artifacts.                                 | 📱 **Privacy-First Phone Gate:** Optional `HMAC-SHA256` contact verification via bot or native Mini App `WebApp.requestContact()` (zero raw phone storage).                                           |
| 🌐 **Unified UX & Localization:** Full Persian (`fa`) / English (`en`) parity, Persian digit normalization, white-label WebApp version footer, bi-directional deep links, and maintenance mode.                       | 📦 **Multi-Instance & Release Telemetry:** Isolated instances with Caddy On-Demand TLS mesh routing, transactional backups, and `main`/`dev` SemVer telemetry.                                        |

---

## Financial & Operational Guarantees

```text
Checkout ──► [1. Lock User, Funds & Inventory] ──► [2. Provision on Rebecca REST API]
             (FOR UPDATE + FOR NO KEY UPDATE)                       │
                                     ┌──────────────────────────────┴─────────────────────────┐
                                  Success                                             Failure / Timeout
                                     ▼                                                        ▼
                    [3a. Commit Ledger, Stock & Bonuses]                  [3b. Release Funds, Stock & Audit Log]
```

- **64-Bit Minor-Unit Integer Accounting & VIP Credit Safety:** All monetary values use signed 64-bit safe integers (`DbNumber`, `-9007199254740991..9007199254740991`) with `reserved_balance >= 0`. VIP groups may grant a `credit_limit` for purchases/renewals (snapshotted on `purchase_intents` for safe mid-flight group changes and reconciliation), top-ups naturally settle negative balances, and P2P transfers strictly require positive real balance (`balance - reserved_balance >= amount`).
- **3-Phase Purchase, Renewal & Inventory Saga:** Wallet funds (`FOR UPDATE`), deadlock-free panel/service/package inventory reservations (`FOR NO KEY UPDATE`), effective group credit limits, and promo redemptions are reserved atomically before remote API dispatch and automatically compensated on network failure, reconciliation, or self-refund. Panel and service caps restrict only new provisioning (`new_config` & `trial`) so existing subscribers can always renew.
- **Cryptographic Fraud, Gateway & Privacy Controls:** Receipts are fingerprinted via `SHA-256` and `file_unique_id`; ForApp (`X-API-Key`) and NOWPayments (`HMAC-SHA512` IPN) webhooks use constant-time verification and `AES-256-GCM` stored secrets; verified phone numbers are stored strictly as `HMAC-SHA256` digests keyed from `BOT_TOKEN`.
- **Dual-Mode Delivery:** Outbound Long Polling by default (zero open ports required) or reverse-proxied Webhook delivery with `X-Telegram-Bot-Api-Secret-Token` validation.

---

## Quick Start

### 1. Guided 1-Command Install (Recommended)

On any **Ubuntu 22.04 / 24.04 LTS** or **Debian 12+** server:

```bash
curl -fsSL https://raw.githubusercontent.com/Ho3einK84/RebeccaSellBot/main/install.sh | sudo bash
```

Or from a local clone:

```bash
git clone https://github.com/Ho3einK84/RebeccaSellBot.git && cd RebeccaSellBot && ./install.sh
```

The installer verifies Docker & Compose v2, asks only for your **Bot Token** and **Admin ID(s)**, auto-provisions PostgreSQL 16 + `AES-256-GCM` & JWT secrets, runs Drizzle migrations, and installs `/usr/local/bin/rsbot`. Afterward, send `/admin` → **Panels** to your bot in Telegram to connect your Rebecca panel(s).

### 2. Unattended Provisioning (`--env-file`)

```bash
curl -fsSL https://raw.githubusercontent.com/Ho3einK84/RebeccaSellBot/main/install.sh \
  | sudo bash -s -- --instance main --env-file /root/rsbot.env --non-interactive --yes
```

### 3. Server Migration (`--from-backup`)

```bash
# Source server: create full snapshot (database.dump + .env + docker-compose.yml + manifest.txt)
rsbot backup

# Target server: bootstrap directly from archive
curl -fsSL https://raw.githubusercontent.com/Ho3einK84/RebeccaSellBot/main/install.sh \
  | sudo bash -s -- --from-backup /root/backup_main_YYYYMMDD_HHMMSS.tar.gz --non-interactive --yes
```

---

## Lifecycle & Multi-Instance CLI (`rsbot`)

`rsbot` automatically targets the `main` (or sole installed) instance when `<instance>` is omitted, or accepts an explicit instance name (or `all` for fleet-wide operations):

```bash
rsbot status                      # Container status (or: rsbot <instance> status)
rsbot verify                      # Deep 6-stage health, DB, & port isolation audit
rsbot env                         # Display sanitized configuration & published ports
rsbot logs -f                     # Follow live container logs
rsbot update                      # Git pull, rebuild, migrate schema, and restart
rsbot backup                      # Create compressed 0600 backup bundle (.tar.gz)
rsbot restore <file>              # Transactional restore with automatic rollback snapshot
rsbot list                        # List all installed instances, states, and ports
rsbot all update                  # Update all instances on the server sequentially
```

See [docs/deployment.md](docs/deployment.md) for the complete CLI and reverse-proxy reference.

---

## Essential Environment (`.env`)

| Variable                | Description                                                    | Default          |
| :---------------------- | :------------------------------------------------------------- | :--------------- |
| `BOT_TOKEN`             | Telegram Bot API token from `@BotFather`.                      | _Required_       |
| `ADMIN_IDS`             | Comma-separated initial admin Telegram user IDs.               | _Required_       |
| `DATABASE_URL`          | PostgreSQL 16 connection string.                               | Auto-provisioned |
| `PANEL_CREDENTIALS_KEY` | 32–512 char key for `AES-256-GCM` panel credential encryption. | Auto-generated   |
| `ADMIN_SESSION_SECRET`  | 32+ char secret for Mini App admin JWT session cookies.        | Auto-generated   |
| `DEFAULT_LOCALE`        | Default locale for new users (`fa` or `en`).                   | `fa`             |
| `BOT_DELIVERY_MODE`     | Telegram update transport (`polling` or `webhook`).            | `polling`        |
| `WEBAPP_URL`            | Public HTTPS URL enabling the Fastify + React 19 Mini App.     | —                |

See [docs/configuration.md](docs/configuration.md) for all environment variables and in-bot `/admin` settings.

---

## Development & Verification

```bash
npm ci
cp .env.example .env
npm run dev          # Start bot + watcher in development mode
npm run verify       # Parallel CI gate (scripts/verify.mjs): architecture, typecheck, lint, format, test, build
npm run verify:fast  # Fast local gate: cached static checks + changed tests only
npm run verify:cold  # Cold CI gate without incremental tool caches
```

| Script                          | Check                                                                                                           |
| :------------------------------ | :-------------------------------------------------------------------------------------------------------------- |
| `npm run architecture:check`    | Static layer isolation and import boundary verification (`scripts/check-architecture.mjs`).                     |
| `npm run typecheck`             | Parallel incremental TypeScript checks across backend (`tsconfig.json`) and Mini App (`webapp/tsconfig.json`).  |
| `npm run lint` / `format:check` | Cached ESLint 10 static analysis and Prettier formatting checks.                                                |
| `npm test` / `test:changed`     | Two-project Vitest suite (`shared` thread pool + `isolated` fork pool across domain, infra, jobs, bot, webapp). |
| `npm run build`                 | Production Vite frontend build (`dist/webapp`) + esbuild backend bundle (`dist/index.js`).                      |

---

## License

Released under the [MIT License](LICENSE).
