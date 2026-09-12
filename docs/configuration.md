# RebeccaSellBot — Configuration & Environment Reference

This document details all configuration options available in **RebeccaSellBot**, covering both environment variables (`.env`) and database-persisted settings managed in-bot via the `/admin` interface.

---

## 1. Environment Variables (`.env`)

Environment variables configure low-level runtime options, secrets, port bindings, and networking.

### Core Bot Configuration

| Variable         | Type   | Default       | Description                                                                                   |
| :--------------- | :----- | :------------ | :-------------------------------------------------------------------------------------------- |
| `NODE_ENV`       | String | `development` | Runtime environment: `production`, `development`, or `test`.                                  |
| `BOT_TOKEN`      | String | _Required_    | Telegram Bot API token obtained from `@BotFather`.                                            |
| `ADMIN_IDS`      | String | _Required_    | Comma-separated list of positive integer Telegram user IDs granted administrative privileges. |
| `DEFAULT_LOCALE` | String | `fa`          | Default language for newly observed users (`fa` for Persian, `en` for English).               |
| `SUPPORT_URL`    | String | First Admin   | Optional customer support link (e.g. `https://t.me/your_support` or external helpdesk URL).   |
| `INSTANCE_NAME`  | String | `main`        | Alphanumeric identifier for this bot instance, used in multi-instance directories and logs.   |

---

### Database Configuration

| Variable             | Type    | Default    | Description                                                                               |
| :------------------- | :------ | :--------- | :---------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | String  | _Required_ | PostgreSQL connection URI (`postgres://user:password@host:5432/dbname`).                  |
| `DATABASE_POOL_SIZE` | Integer | `20`       | Maximum number of concurrent connections in the PostgreSQL client pool (range: 1 to 100). |

---

### Security & Credential Vault

| Variable                | Type   | Default     | Description                                                                                                                      |
| :---------------------- | :----- | :---------- | :------------------------------------------------------------------------------------------------------------------------------- |
| `PANEL_CREDENTIALS_KEY` | String | _Generated_ | 32–512 character secret key used for AES-256-GCM encryption of panel credentials stored in the database. Required in production. |

---

### Legacy Bootstrap Panel Variables (Optional)

> [!NOTE]
> In RebeccaSellBot v0.2+, multiple Rebecca panels can be connected and configured interactively via `/admin` → **Rebecca panels**. The following variables are used only for legacy single-panel bootstrap on fresh installations:

| Variable                 | Type    | Default | Description                                                                   |
| :----------------------- | :------ | :------ | :---------------------------------------------------------------------------- |
| `REBECCA_API_URL`        | String  | —       | HTTPS origin of the initial Rebecca panel (e.g. `https://panel.example.com`). |
| `REBECCA_API_KEY`        | String  | —       | Initial Rebecca panel API key.                                                |
| `REBECCA_ADMIN_USERNAME` | String  | `admin` | Panel administrator username.                                                 |
| `REBECCA_ADMIN_PASSWORD` | String  | —       | Panel administrator password.                                                 |
| `REBECCA_SERVICE_ID`     | Integer | `1`     | Rebecca panel service ID.                                                     |

---

### Telegram Delivery & Webhook Mode

| Variable               | Type    | Default     | Description                                                                           |
| :--------------------- | :------ | :---------- | :------------------------------------------------------------------------------------ |
| `BOT_DELIVERY_MODE`    | String  | `polling`   | Update delivery mode: `polling` (outbound long polling) or `webhook`.                 |
| `WEBHOOK_URL`          | String  | —           | Public HTTPS URL registered with Telegram. Required when `BOT_DELIVERY_MODE=webhook`. |
| `WEBHOOK_SECRET_TOKEN` | String  | —           | 32+ char secret string verifying incoming `X-Telegram-Bot-Api-Secret-Token` headers.  |
| `WEBHOOK_PORT`         | Integer | `3000`      | Internal container port on which the Fastify webhook HTTP listener binds.             |
| `WEBHOOK_HOST_PORT`    | Integer | `3000`      | Published host port bound in Docker Compose for reverse proxy forwarding.             |
| `WEBHOOK_PATH`         | String  | `/webhook`  | Request path for incoming Telegram updates (defaults to pathname from `WEBHOOK_URL`). |
| `WEBHOOK_HOST`         | String  | `0.0.0.0`   | Internal listening interface for the webhook HTTP server.                             |
| `WEBHOOK_BIND_HOST`    | String  | `127.0.0.1` | Host IP interface to which the published webhook container port binds.                |

---

### Inbound Rebecca Panel Webhooks

| Variable                 | Type   | Default                | Description                                                                                        |
| :----------------------- | :----- | :--------------------- | :------------------------------------------------------------------------------------------------- |
| `REBECCA_WEBHOOK_SECRET` | String | —                      | Shared secret verified against incoming `x-webhook-secret` headers via timing-safe comparison.     |
| `REBECCA_WEBHOOK_PATH`   | String | `/api/rebecca-webhook` | Endpoint path where Rebecca panel push events (`user_limited`, `user_expired`, etc.) are received. |

---

### Telegram Mini App (Optional Feature)

| Variable               | Type    | Default              | Description                                                                                              |
| :--------------------- | :------ | :------------------- | :------------------------------------------------------------------------------------------------------- |
| `WEBAPP_URL`           | String  | —                    | Public HTTPS URL for the Telegram Mini App dashboard. Setting this enables the WebApp feature flag.      |
| `WEBAPP_PORT`          | Integer | `3002`               | Internal container port for the Fastify WebApp server.                                                   |
| `WEBAPP_HOST_PORT`     | Integer | `3002`               | Published host port bound in Docker Compose for WebApp reverse proxy forwarding.                         |
| `WEBAPP_HOST`          | String  | `0.0.0.0`            | Internal listening interface for the Fastify WebApp server.                                              |
| `WEBAPP_BIND_HOST`     | String  | `127.0.0.1`          | Host IP interface to which the published WebApp container port binds.                                    |
| `ADMIN_SESSION_SECRET` | String  | —                    | 32+ character secret for signing WebApp admin JWT authentication cookies.                                |
| `REGISTRY_DIR`         | String  | `/app/data/registry` | Path to shared multi-instance domain registry directory used for automated reverse proxy mesh discovery. |
| `WEBAPP_TARGET_URL`    | String  | —                    | Optional target URL override for mesh dispatching.                                                       |

---

### Health Probes & Single-Port PaaS Hosting

| Variable            | Type    | Default | Description                                                                                                                   |
| :------------------ | :------ | :------ | :---------------------------------------------------------------------------------------------------------------------------- |
| `HEALTH_CHECK_PORT` | Integer | `3001`  | Internal HTTP port for `/health`, `/healthz`, `/ready`, `/readyz` probes.                                                     |
| `PORT`              | Integer | —       | Dynamic port override injected by PaaS providers. Automatically multiplexes health checks and webhooks onto this single port. |

---

## 2. In-Bot Database Settings (`/admin` → Settings)

Unlike environment variables, database settings are stored in PostgreSQL (`settings` table) and can be modified at runtime directly from Telegram or the WebApp without restarting the bot.

### 1. General & Maintenance

- **`bot_enabled` (boolean):** Toggles public access to customer features. When set to `false`, non-admin users receive the maintenance notice.
- **`maintenance_reason` (string):** Optional custom notice explaining the ongoing maintenance or expected return time.

### 2. Pricing, Packages & Categories

- **Packages CRUD:** Create, update, or remove subscription plans with custom name, traffic limit (GB), duration (days), price (Tomans), and assigned Rebecca panel.
- **Package Categories:** Group packages into logical categories (e.g. "Standard German", "High-Speed VIP", "Gaming Ping-Optimized").
- **Custom Volume Plans:** Enable or disable flexible ordering where customers choose custom GB and duration based on per-GB and per-day base rates.

### 3. Free Trial Configurations

- **`trial_enabled` (boolean):** Enable or disable one-time free trials for new customers.
- **`trial_traffic_gb` (integer):** Traffic limit granted to trial accounts (e.g. 1 GB).
- **`trial_duration_days` (integer):** Expiry duration for trial accounts (e.g. 1 day).
- **`trial_panel_id` (string):** Target Rebecca panel dedicated to provisioning trial accounts.

### 4. Lucky Wheel Gamification

- **`lucky_wheel_enabled` (boolean):** Toggles the gamified daily spin wheel.
- **`lucky_wheel_cooldown_hours` (integer):** Minimum wait time between free spins (default: 24 hours).
- **Reward Tiers & Odds:** Configurable weighted prize tables (wallet credit, discount percentage, extra days, or "try again").

### 5. Card-to-Card Payment Rules

- **`card_number` (string):** Bank card number displayed on checkout for manual top-ups.
- **`card_holder` (string):** Name of the cardholder displayed alongside the card number.
- **`min_topup_amount` (DbNumber):** Minimum allowable wallet top-up in Tomans.
- **`max_topup_amount` (DbNumber):** Maximum allowable wallet top-up in Tomans.

### 6. Referral & Cashback Loyalty

- **`referral_bonus_toman` (DbNumber):** One-time wallet credit awarded to the inviter upon successful invitee registration.
- **`referral_cashback_percent` (integer):** Lifetime percentage of purchases awarded to the inviter whenever their referrals purchase a plan.

### 7. Automated Backups

- **`backup_interval_hours` (integer):** Interval between automated background database snapshots (e.g. 24 hours).
- **`backup_send_to_admin` (boolean):** When enabled, automatically delivers the compressed `.tar.gz` backup file directly to the primary admin in Telegram.

### 8. Telegram Mini App

- **`webapp_enabled` (boolean):** Toggles the WebApp button in the Telegram user portal.
- **`webapp_url` (string):** Domain/URL where the Mini App is served.

### 9. Dynamic Naming & Config Templates

- **`username_prefix` (string):** Prefix applied when provisioning usernames on Rebecca panels (e.g. `usr_`).
- **`config_name_template` (string):** Format string for the customer-visible subscription label.

### 10. Localization & Text Customization

- Custom Persian and English overrides for core messages, purchase confirmation dialogues, and help texts.
