# ✦ RebeccaSellBot

Telegram callback, navigation, rendering, and module boundaries are documented in [docs/telegram-architecture.md](docs/telegram-architecture.md).

<p align="center">
  <strong>A secure Telegram storefront for Rebecca Panel VPN subscriptions.</strong>
  <br />
  Sell, renew, manage, and support subscriptions without leaving Telegram.
</p>

<p align="center">
  <a href="https://github.com/Ho3einK84/RebeccaSellBot"><img src="https://img.shields.io/badge/release-0.1.0-7c3aed?style=flat-square" alt="Release 0.1.0" /></a>
  <img src="https://img.shields.io/badge/runtime-Node.js%2024-339933?style=flat-square" alt="Node.js 24" />
  <img src="https://img.shields.io/badge/database-PostgreSQL%2016-336791?style=flat-square" alt="PostgreSQL 16" />
  <img src="https://img.shields.io/badge/deployment-Docker-2496ED?style=flat-square" alt="Docker" />
  <img src="https://img.shields.io/badge/platform-Ubuntu%2024.04-E95420?style=flat-square" alt="Ubuntu 24.04" />
</p>

> [!IMPORTANT]
> RebeccaSellBot calls Rebecca exclusively through its HTTPS REST API. It never
> reads or writes the Rebecca database directly.

## What it does

| For customers                                                                                    | For administrators                                                                                                                               |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Buy, renew, claim, revoke, enable, disable, transfer, and safely refund unused VPN subscriptions | Manage multiple Rebecca panels/API keys, per-package services, pricing, admins, reconciliation, and a safe manual-service baseline from Telegram |
| Pay from a wallet after manual card-transfer approval                                            | Search, ban, message, and adjust user balances with an audit trail                                                                               |
| Receive low-traffic and near-expiry reminders                                                    | Create promo codes, inspect referral/cashback data, and run durable segmented/cancelable broadcasts                                              |
| Use the bot in Persian or English                                                                | Run multiple fully isolated bot instances on one server                                                                                          |

## Why it is safe to operate

```text
Telegram customer
       │
       ▼
  Wallet reserve ──► Rebecca HTTPS API ──► Wallet commit
       │                    │
       └──── failure ───────┴──► Wallet release + audit record
```

- Balances use signed integer currency units, never floating point values.
- Purchases follow a reserve → remote API call → commit/release saga.
- Reconciliation handles interruptions after a remote call.
- Referral, cashback, and promotion rewards are idempotent.
- The bot’s PostgreSQL database is private to its Docker network.
- Telegram uses outbound long polling; no bot or database port is published.

## Quick start

### Guided installation — recommended for the first server

On an Ubuntu 24.04 server, clone the repository and run the installer:

```bash
git clone https://github.com/Ho3einK84/RebeccaSellBot.git
cd RebeccaSellBot
./install.sh
```

The guided flow installs Docker if necessary, asks only for Telegram/database
bootstrap values, builds the bot, applies migrations, and starts a healthy
instance. Add Rebecca panels afterward from `/admin` → **Rebecca panels**.

### Unattended installation — one command

For repeatable deployments, create a protected plain `KEY=value` file outside
the repository, for example `/root/rsbot.env` with mode `0600`:

```dotenv
BOT_TOKEN=123456:replace_me
ADMIN_IDS=123456789
DB_USER=rsbot_bot1
DB_PASSWORD=use_a_16_character_or_longer_safe_password
DB_NAME=rsbot_bot1
DEFAULT_LOCALE=fa
```

Then launch the installer in unattended mode. It generates a database password
when `DB_PASSWORD` is omitted.

```bash
curl -fsSL https://raw.githubusercontent.com/Ho3einK84/RebeccaSellBot/main/install.sh \
  | sudo bash -s -- --instance bot1 --env-file /root/rsbot.env --non-interactive --yes
```

> [!CAUTION]
> Keep the deployment file private and delete it after a successful install if
> it is no longer needed. Do not put tokens or passwords on the command line.

### Private repository installation

The installer supports public HTTPS repositories, read-only SSH deploy keys,
and fine-grained GitHub PATs. In guided mode select the access method when
asked. In unattended mode use `RSBOT_ACCESS_METHOD=ssh` plus
`RSBOT_SSH_KEY_PATH`, or `RSBOT_ACCESS_METHOD=pat` plus `GITHUB_PAT` in the
protected deployment file.

## Installation requirements

- Ubuntu 24.04 LTS server
- A Telegram bot token from `@BotFather`
- One or more numeric Telegram administrator IDs
- A Rebecca HTTPS origin and API key when you are ready to configure a panel

Docker Engine and Docker Compose are installed automatically when missing.

## Deployment model

Each instance is installed in its own directory:

```text
/opt/RebeccaSellBot/<instance>
```

For example, `main`, `shopbot`, and `testbot` can coexist on one machine. Each
receives independent containers, Docker networks, PostgreSQL volume, `.env`
file, and Compose project name. Backups live outside the Git checkout under
`/opt/RebeccaSellBot/backups/<instance>`.

```text
                        outbound network
                    ┌─────────────────────┐
Telegram / Rebecca ◄┤  <instance>_bot     │
                    └─────────┬───────────┘
                              │
                    ┌─────────▼───────────┐
                    │ private DB network  │
                    │  <instance>_db      │
                    └─────────────────────┘
```

The internal health endpoint binds to `127.0.0.1` in the bot container and is
used only by Docker. There are no published inbound ports.

## Manage an instance with `rsbot`

The installer places the instance-aware manager at `/usr/local/bin/rsbot`.

```bash
rsbot list
rsbot main status
rsbot main logs -f
```

| Command                           | Effect                                                      |
| --------------------------------- | ----------------------------------------------------------- |
| `rsbot <instance> up`             | Build and start services, waiting for health                |
| `rsbot <instance> down`           | Stop services while preserving data                         |
| `rsbot <instance> restart`        | Restart current containers                                  |
| `rsbot <instance> status`         | Display service status                                      |
| `rsbot <instance> logs -f`        | Follow recent logs                                          |
| `rsbot <instance> update`         | Pull Git, rebuild, apply SQL migrations, and start          |
| `rsbot <instance> backup`         | Write a compressed PostgreSQL backup with mode `0600`       |
| `rsbot <instance> restore <file>` | Restore a custom-format backup after confirmation           |
| `rsbot <instance> uninstall`      | Remove only that instance and its volume after confirmation |

## Bootstrap configuration

The installer writes the selected values to the instance’s `.env` file with
mode `0600`.

| Variable                            | Purpose                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `BOT_TOKEN`                         | Telegram Bot API token                                                   |
| `ADMIN_IDS`                         | Bootstrap admin IDs used only while the database admin registry is empty |
| `INSTANCE_NAME`                     | Container, network, volume, and Compose namespace                        |
| `PANEL_CREDENTIALS_KEY`             | Stable local key used to encrypt panel credentials in PostgreSQL         |
| `REBECCA_*`                         | Optional one-time legacy single-panel import only                        |
| `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Instance-local PostgreSQL credentials                                    |
| `DEFAULT_LOCALE`                    | Initial bot locale: `fa` or `en`                                         |

> [!IMPORTANT]
> `REBECCA_API_URL` is the Rebecca API origin, not the dashboard path. If your
> panel opens at `https://panel.example.com:2087/x-dashboard/`, configure
> `REBECCA_API_URL=https://panel.example.com:2087`. Omitting `:2087` sends
> the bot to the default HTTPS port (443), which may be a different service.

After startup, add any number of panels and service IDs in Telegram. Every
package stores its own panel/service target; custom-volume purchases have an
independent target. Credentials are encrypted at rest and never shown again.

To add a panel: open `/admin` → **Rebecca panels** → **Add panel**. Afterward,
edit packages under **Settings → Pricing** and select a panel/service for each.

## Project map

| Location              | Responsibility                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `src/telegram`        | grammY handlers, conversations, menus, localization, and authorization                       |
| `src/domain/services` | Wallet, pricing, promotions, referrals, trial, user, translation, and Rebecca business logic |
| `src/infra`           | Database, Drizzle schema, API client, logger, sessions, and internal health server           |
| `src/jobs`            | Notification/reconciliation workers plus distributed job runtime                             |
| `drizzle`             | Fresh PostgreSQL migration set                                                               |
| `scripts/rsbot`       | Multi-instance lifecycle, update, backup, and restore manager                                |

## Local development

Requirements: Node.js `24.x` and PostgreSQL `16+`.

```bash
cp .env.example .env
npm ci
npm run db:migrate
npm run dev
```

Run the full quality suite before shipping a change:

```bash
npm run architecture:check
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:coverage
npm run build
```

Run the PostgreSQL integration/concurrency suite against a disposable database:

```bash
TEST_DATABASE_URL=postgres://rsbot_test:rsbot_test@127.0.0.1:5432/rsbot_test npm run test:integration
```

CI provisions PostgreSQL 16 automatically for this suite.

## Security checklist

- Use a valid HTTPS Rebecca URL; TLS verification is never disabled.
- Keep the initial `ADMIN_IDS` bootstrap list limited to trusted Telegram accounts; later admin changes are stored in PostgreSQL and managed from the bot.
- Use a read-only deploy key or fine-grained PAT with only `Contents: Read`.
- Treat the instance `.env`, `.git-credentials`, and backups as secrets.
- Back up before updating production installations.
- Never add a host port mapping for PostgreSQL or the bot health endpoint.

## Operational notes

- The bot’s admin authorization is independent of Rebecca panel admins.
- Secret values and receipt images are redacted from structured logs.
- Manual balance changes create transaction audit records.
- Restore and uninstall operations require the exact instance name as a safety
  confirmation.

---

Built for operators who want a practical, self-hosted Telegram sales bot with
clear financial controls and a small operational surface.
