# ✦ RebeccaSellBot

<p align="center">
  <strong>Resilient, multi-panel Telegram commerce and subscription platform for Rebecca Panel.</strong>
  <br />
  Automate sales, renewals, wallet accounting, flash sales, and multi-panel fleets across Telegram and Mini App.
</p>

<p align="center">
  <a href="https://github.com/Ho3einK84/RebeccaSellBot"><img src="https://img.shields.io/badge/release-0.3.0-7c3aed?style=flat-square" alt="Release 0.3.0" /></a>
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

| Document                                                    | Scope                                                                                                             |
| :---------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------- |
| 🏛️ **[System Architecture](docs/architecture.md)**          | Layered architecture, 3-phase purchase saga, 24-table PostgreSQL schema, and background workers.                  |
| 💬 **[Telegram & UI Layer](docs/telegram-architecture.md)** | Ephemeral screen engine, stateless `adm:*` admin router, non-blocking input engine, and callback guards.          |
| 📱 **[Mini App Architecture](docs/webapp-architecture.md)** | Unified User & Admin Mini App (`Fastify 5` + `React 19`), modular `/api/user/*` routes, guards, and chat sync.    |
| ⚙️ **[Configuration Reference](docs/configuration.md)**     | Complete `.env` specification and runtime `/admin` database settings catalog.                                     |
| 🚀 **[Deployment & Operations](docs/deployment.md)**        | Interactive/unattended installation, `rsbot` CLI, Caddy On-Demand TLS mesh, and backups.                          |
| 🔐 **[Security Policy](SECURITY.md)**                       | Vulnerability reporting, credential encryption, Mini App upload/auth controls, and database integrity guarantees. |

---

## Capabilities

| Customer Experience (Telegram Bot + Mini App Parity)                                                                                                                                     | Administration & Backoffice                                                                                                                                            |
| :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🛒 **Instant Storefront:** Fixed packages, categorized plans, custom GB/day ordering (with tiered price tables), optional buyer-chosen service names, and live flash-sale countdowns.    | 🌐 **Multi-Panel Fleet:** Connect multiple Rebecca panels at runtime (`AES-256-GCM` vault) and bind packages to specific services.                                     |
| 🎁 **Free Trial & Interactive Lucky Wheel:** One-tap trial claiming with QR & SmartConnect delivery plus an animated 8-slice SVG Lucky Wheel with haptics, cooldowns, and spin history.  | 🛡️ **Receipt Security & Voiding:** `SHA-256` + `file_unique_id` duplicate receipt detection (`warn`/`block`), atomic receipt voiding, and multi-card rotation.         |
| 💳 **Wallet 2.0 & P2P Transfers:** Native in-app 2-step card-to-card top-ups, Telegram-hosted receipt uploads, receipt history, category filters, and exact-match P2P balance transfers. | 📊 **Telegram & Mini App CRM:** 1-tap stateless `/admin` command center (`/r`, `/u`, `/stats`), filterable dossiers, broadcast job monitor, and orphan reconciliation. |
| 📊 **Subscription Portal:** Sync All, external sub-link claim, per-node usage & `onlineAt`, QR codes, 1-tap VPN SmartConnect links (v2rayNG, Hiddify, Streisand, Happ, Clash), & revoke. | 📢 **Growth & Retention:** Throttled segmented broadcasts, 24h first-use connection nudges, and staged expired-config cleanup with renewal warnings.                   |
| 🔄 **Lifecycle & Safeguards:** Start-on-first-use (`on_hold`), quota/time rollover, preset & custom-volume auto-renewal, P2P service transfer, self-refund quotes, and chat artifacts.   | 📱 **Privacy-First Phone Gate:** Optional `HMAC-SHA256` contact verification via bot or native Mini App `WebApp.requestContact()` (zero raw phone storage).            |
| 🌐 **Unified UX & Localization:** Full Persian (`fa`) / English (`en`) parity, Persian digit normalization, bi-directional deep links, and maintenance mode with admin bypass.           | 📦 **Multi-Instance Operations:** Run isolated instances with automated Caddy On-Demand TLS mesh routing and transactional backups.                                    |

---

## Financial & Operational Guarantees

```text
Checkout ──► [1. Reserve Wallet Funds] ──► [2. Provision on Rebecca REST API]
                                                   │
                         ┌─────────────────────────┴─────────────────────────┐
                      Success                                        Failure / Timeout
                         ▼                                                   ▼
        [3a. Commit Ledger + Award Bonuses]                 [3b. Release Reserve + Audit Log]
```

- **64-Bit Minor-Unit Integer Accounting:** All monetary values use safe integers (`DbNumber`) with PostgreSQL check constraints (`balance >= reserved_balance`, `reserved_balance >= 0`).
- **3-Phase Purchase & Renewal Saga:** Funds and promo redemptions are reserved before remote API dispatch and automatically compensated on network failure or reconciliation recovery.
- **Cryptographic Fraud & Privacy Controls:** Receipts are fingerprinted via `SHA-256` and Telegram `file_unique_id`; verified phone numbers are stored strictly as `HMAC-SHA256` digests keyed from `BOT_TOKEN`.
- **Dual-Mode Delivery:** Outbound Long Polling by default (zero open ports required) or reverse-proxied Webhook delivery with `X-Telegram-Bot-Api-Secret-Token` validation.

---

## Quick Start

### 1. Guided Interactive Install (Recommended)

On a clean **Ubuntu 22.04 / 24.04 LTS** server:

```bash
git clone https://github.com/Ho3einK84/RebeccaSellBot.git
cd RebeccaSellBot
./install.sh
```

The installer verifies Docker & Compose, generates encryption keys, provisions PostgreSQL, runs migrations, and installs the `/usr/local/bin/rsbot` CLI. Connect your Rebecca panels afterward via `/admin` → **Panels**.

### 2. Unattended 1-Command Install

```bash
curl -fsSL https://raw.githubusercontent.com/Ho3einK84/RebeccaSellBot/main/install.sh \
  | sudo bash -s -- --instance main --env-file /root/rsbot.env --non-interactive --yes
```

### 3. Server-to-Server Migration (`--from-backup`)

```bash
# Source server: create full snapshot (database.dump + .env + docker-compose.yml + manifest.txt)
rsbot main backup

# Target server: bootstrap directly from archive
./install.sh --from-backup /path/to/manual_backup_main_YYYYMMDD_HHMMSS.tar.gz --non-interactive --yes
```

---

## Instance CLI (`rsbot`)

```bash
rsbot list                        # List all instances, states, ports, and delivery modes
rsbot <instance> status           # Container status and readiness probes
rsbot <instance> verify           # Deep diagnostics (containers, DB, ports, /readyz)
rsbot <instance> logs -f          # Follow structured service logs
rsbot <instance> update           # Git pull, rebuild, migrate schema, and restart
rsbot <instance> backup           # Create compressed 0600 backup bundle (.tar.gz)
rsbot <instance> restore <file>   # Transactional restore with automatic rollback snapshot
```

See [docs/deployment.md](docs/deployment.md) for the complete CLI and reverse-proxy reference.

---

## Essential Environment (`.env`)

| Variable                | Description                                                    | Default     |
| :---------------------- | :------------------------------------------------------------- | :---------- |
| `BOT_TOKEN`             | Telegram Bot API token from `@BotFather`.                      | _Required_  |
| `ADMIN_IDS`             | Comma-separated initial admin Telegram user IDs.               | `123456789` |
| `DATABASE_URL`          | PostgreSQL 16 connection string.                               | _Required_  |
| `PANEL_CREDENTIALS_KEY` | 32–512 char key for `AES-256-GCM` panel credential encryption. | Generated   |
| `DEFAULT_LOCALE`        | Default locale for new users (`fa` or `en`).                   | `fa`        |
| `BOT_DELIVERY_MODE`     | Telegram update transport (`polling` or `webhook`).            | `polling`   |
| `WEBAPP_URL`            | Public HTTPS URL enabling the Fastify + React 19 Mini App.     | —           |

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
