# RebeccaSellBot — Configuration Reference

This reference covers all environment variables (`.env`) validated by [`src/infra/config.ts`](../src/infra/config.ts) and all runtime database settings (`settings` table) managed in-bot via `/admin` → **Settings**.

---

## 1. Environment Variables (`.env`)

### Core Runtime

| Variable         | Type      | Default       | Description                                                                                    |
| :--------------- | :-------- | :------------ | :--------------------------------------------------------------------------------------------- |
| `NODE_ENV`       | Enum      | `development` | Runtime mode: `production`, `development`, or `test`.                                          |
| `BOT_TOKEN`      | String    | _Required_    | Telegram Bot API token from `@BotFather`.                                                      |
| `ADMIN_IDS`      | CSV Ints  | `[]`          | Comma-separated positive integer Telegram user IDs used to bootstrap `bot_admins`.             |
| `DEFAULT_LOCALE` | Enum      | `fa`          | Initial language for newly observed users (`fa` or `en`).                                      |
| `INSTANCE_NAME`  | String    | `main`        | Alphanumeric instance identifier (`[a-z0-9_-]`) for multi-instance isolation and mesh routing. |
| `SUPPORT_URL`    | HTTPS URL | —             | Optional support link override (`https://...`); defaults to the primary admin chat.            |

### Database & Encryption

| Variable                | Type    | Default            | Description                                                                            |
| :---------------------- | :------ | :----------------- | :------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | URI     | _Required_         | PostgreSQL 16 connection URI (`postgres://user:pass@host:5432/dbname`).                |
| `DATABASE_POOL_SIZE`    | Integer | `20`               | Maximum concurrent PostgreSQL pool connections (`1–100`).                              |
| `PANEL_CREDENTIALS_KEY` | Secret  | _Required in prod_ | `32–512` character key used for `AES-256-GCM` encryption of panel credentials at rest. |

### Telegram Delivery & Webhooks

| Variable               | Type      | Default     | Description                                                                                     |
| :--------------------- | :-------- | :---------- | :---------------------------------------------------------------------------------------------- |
| `BOT_DELIVERY_MODE`    | Enum      | `polling`   | `polling` (outbound long polling) or `webhook` (defaults to `webhook` if `WEBHOOK_URL` is set). |
| `WEBHOOK_URL`          | HTTPS URL | —           | Public HTTPS webhook endpoint registered with Telegram (required in `webhook` mode).            |
| `WEBHOOK_SECRET_TOKEN` | Secret    | —           | `1–256` char `[A-Za-z0-9_-]` secret verified against `X-Telegram-Bot-Api-Secret-Token`.         |
| `WEBHOOK_PORT`         | Port      | `3000`      | Internal container port for the webhook HTTP listener.                                          |
| `WEBHOOK_HOST_PORT`    | Port      | `3000`      | Published Docker Compose host port for reverse proxy forwarding.                                |
| `WEBHOOK_PATH`         | Path      | `/webhook`  | HTTP path for Telegram updates (auto-derived from `WEBHOOK_URL` pathname if omitted).           |
| `WEBHOOK_HOST`         | Host      | `0.0.0.0`   | Internal bind address for the webhook HTTP server.                                              |
| `WEBHOOK_BIND_HOST`    | IP        | `127.0.0.1` | Host interface bound by Docker Compose for `WEBHOOK_HOST_PORT`.                                 |

### Inbound Rebecca Panel Webhooks

| Variable                 | Type   | Default                | Description                                                                                                                       |
| :----------------------- | :----- | :--------------------- | :-------------------------------------------------------------------------------------------------------------------------------- |
| `REBECCA_WEBHOOK_SECRET` | Secret | —                      | Shared secret verified via constant-time comparison against `x-webhook-secret`.                                                   |
| `REBECCA_WEBHOOK_PATH`   | Path   | `/api/rebecca-webhook` | POST endpoint receiving real-time panel events (`user_limited`, `user_expired`, `user_disabled`, `user_enabled`, `user_deleted`). |

### Telegram Mini App & Multi-Instance Mesh

| Variable               | Type      | Default                        | Description                                                                                                |
| :--------------------- | :-------- | :----------------------------- | :--------------------------------------------------------------------------------------------------------- |
| `WEBAPP_URL`           | HTTPS URL | —                              | Public HTTPS origin for the Telegram Mini App. Enables the Fastify + React 19 WebApp server on boot.       |
| `ADMIN_SESSION_SECRET` | Secret    | —                              | `32+` char secret signing HTTP-only admin JWT cookies (required when `WEBAPP_URL` is set).                 |
| `WEBAPP_PORT`          | Port      | `3002`                         | Internal container port for the Fastify WebApp server.                                                     |
| `WEBAPP_HOST_PORT`     | Port      | `3002`                         | Published Docker Compose host port for Mini App traffic.                                                   |
| `WEBAPP_HOST`          | Host      | `0.0.0.0`                      | Internal bind address for the Fastify WebApp server.                                                       |
| `WEBAPP_BIND_HOST`     | IP        | `127.0.0.1`                    | Host interface bound by Docker Compose for `WEBAPP_HOST_PORT`.                                             |
| `REGISTRY_DIR`         | Path      | `/app/data/registry`           | Shared volume directory storing active instance domain mappings for Caddy On-Demand TLS and mesh proxying. |
| `WEBAPP_TARGET_URL`    | URL       | `http://<instance>_bot:<port>` | Optional upstream URL override advertised in the shared mesh registry.                                     |

### Health Checks & Legacy Single-Panel Bootstrap

| Variable                 | Type      | Default | Description                                                                                                |
| :----------------------- | :-------- | :------ | :--------------------------------------------------------------------------------------------------------- |
| `HEALTH_CHECK_PORT`      | Port      | `3001`  | Internal HTTP port serving `/health`, `/healthz`, `/ready`, `/readyz`, and fallback Rebecca webhooks.      |
| `PORT`                   | Port      | —       | Optional unified port override for single-port PaaS environments (multiplexes health checks and webhooks). |
| `REBECCA_API_URL`        | HTTPS URL | —       | _Optional legacy bootstrap:_ Initial panel HTTPS origin (use `/admin` → **Rebecca panels** instead).       |
| `REBECCA_API_KEY`        | Secret    | —       | _Optional legacy bootstrap:_ Initial panel API key.                                                        |
| `REBECCA_ADMIN_USERNAME` | String    | `admin` | _Optional legacy bootstrap:_ Initial panel admin username.                                                 |
| `REBECCA_ADMIN_PASSWORD` | Secret    | —       | _Optional legacy bootstrap:_ Initial panel admin password.                                                 |
| `REBECCA_SERVICE_ID`     | Integer   | `1`     | _Optional legacy bootstrap:_ Initial panel default service ID.                                             |

---

## 2. In-Bot Runtime Settings (`/admin` → Settings & Sales)

Runtime settings are persisted in the PostgreSQL `settings` table ([`TranslationCatalog.ts`](../src/domain/services/TranslationCatalog.ts) & [`FeatureSettings.ts`](../src/domain/services/FeatureSettings.ts)) and take effect immediately without restarting containers. All sections below are managed via stateless `/admin` hubs (`adm:cfg` and `adm:sales`).

### General & Security (`adm:cfg:gen`)

| Key                          | Default   | Description                                                                                                |
| :--------------------------- | :-------- | :--------------------------------------------------------------------------------------------------------- |
| `bot_enabled`                | `'true'`  | Enables customer access. When `'false'`, non-admin users see the maintenance screen.                       |
| `language_selection_enabled` | `'true'`  | Allows users to switch between Persian (`fa`) and English (`en`).                                          |
| `default_locale`             | `'fa'`    | Fallback locale (`'fa'` or `'en'`) for users without an explicit preference.                               |
| `require_phone_for_purchase` | `'false'` | Requires one-time `HMAC-SHA256` Telegram contact verification before paid checkouts.                       |
| `require_phone_for_trial`    | `'false'` | Requires one-time `HMAC-SHA256` Telegram contact verification before claiming a free trial.                |
| `phone_verify_iran_only`     | `'true'`  | Restricts phone verification to Iranian (`+98`) mobile numbers.                                            |
| `first_use_nudge_enabled`    | `'true'`  | Sends a one-time connection guide 24–72h after purchase if live traffic is still `0`.                      |
| `expired_cleanup_enabled`    | `'false'` | Enables automated staged cleanup of long-expired subscriptions.                                            |
| `expired_cleanup_grace_days` | `'14'`    | Days after expiration (`1–365`) before an unrenewed expired service is deleted.                            |
| `expired_cleanup_warn_days`  | `'3,1'`   | Comma-separated warning thresholds (`firstWarn,lastWarn` days before deletion; `first > last`, `< grace`). |
| `expired_cleanup_enabled_at` | `''`      | ISO timestamp auto-stamped when cleanup is toggled ON (safety floor for pre-existing expired configs).     |

### Web Mini App (`adm:cfg:web`)

| Key              | Default   | Description                                                                                                                 |
| :--------------- | :-------- | :-------------------------------------------------------------------------------------------------------------------------- |
| `webapp_enabled` | `'false'` | Managed exclusively in **Settings → Web Mini App** (`adm:cfg:web`); dynamically starts/stops Fastify and toggles WebApp UI. |
| `webapp_url`     | `''`      | Public HTTPS origin registered in the multi-instance mesh registry (includes pre-flight DNS check & dedicated SSL report).  |

### Naming & Service Rules (`adm:cfg:svc` & `adm:pkg:*`)

| Key                           | Default                              | Description                                                                                                               |
| :---------------------------- | :----------------------------------- | :------------------------------------------------------------------------------------------------------------------------ |
| `packages_json`               | 4 starter plans                      | JSON array of fixed packages managed via **Sales → Packages** (`adm:pkg:p:1`).                                            |
| `package_display_mode`        | `'specs'`                            | Storefront package button label style (`'specs'` or `'name'`).                                                            |
| `on_hold_default_enabled`     | `'false'`                            | Provisions new purchases in Rebecca `on_hold` mode (validity starts on first connection).                                 |
| `renewal_rollover_enabled`    | `'true'`                             | Carries remaining traffic quota and validity days over into renewed subscriptions.                                        |
| `low_traffic_threshold_gb`    | `'2'`                                | Remaining quota threshold (GB) that triggers an automated low-traffic notification.                                       |
| `expiry_warning_days`         | `'3'`                                | Days before expiration that triggers an automated near-expiry notification.                                               |
| `refund_window_hours`         | `'0'`                                | Hours after purchase during which an unused subscription (`0` traffic) can be self-refunded (`0` = **unlimited** window). |
| `naming_mode`                 | `'custom'`                           | Username generation strategy (`'prefix_number'`, `'prefix_random'`, `'custom'`, etc.).                                    |
| `naming_prefix`               | `'rebecca'`                          | Prefix token (`{prefix}`) injected into generated panel usernames.                                                        |
| `custom_naming_template`      | `'{prefix}_{telegram_id}_{counter}'` | Pattern for generated usernames (with 6 one-tap presets and live preview).                                                |
| `custom_service_name_enabled` | `'false'`                            | Prompts buyers to choose a custom English username (or skip for auto-generation) at checkout.                             |

### Custom-Volume Plans (`adm:cv`)

| Key                               | Default         | Description                                                                |
| :-------------------------------- | :-------------- | :------------------------------------------------------------------------- |
| `custom_volume_enabled`           | `'true'`        | Enables custom GB/duration ordering and renewal flows.                     |
| `price_per_gb`                    | `'5000'`        | Base price per GB in minor units (Tomans).                                 |
| `price_per_day`                   | `'0'`           | Optional base price per day in minor units.                                |
| `custom_default_days`             | `'30'`          | Default duration (days) applied to custom-volume plans.                    |
| `custom_min_gb` / `custom_max_gb` | `'5'` / `'500'` | Minimum and maximum selectable traffic (GB) for custom plans.              |
| `volume_pricing_tiers_json`       | `'[]'`          | Tiered per-GB pricing breakpoints JSON.                                    |
| `custom_price_overrides_json`     | `'[]'`          | Exact GB/day price override rules JSON.                                    |
| `custom_volume_target_json`       | `'{}'`          | Target Rebecca `panelId` and `serviceId` binding for custom-volume orders. |

### Payments, Multi-Card & Receipt Security (`adm:cfg:pay` & `adm:bc:*`)

| Key                                     | Default                  | Description                                                                                                      |
| :-------------------------------------- | :----------------------- | :--------------------------------------------------------------------------------------------------------------- |
| `bank_cards_json`                       | `'[]'`                   | Multi-card rotation pool managed via `adm:bc:p:1` (`[{ id, cardNumber, cardHolder, enabled, dailyCapToman }]`).  |
| `card_number`                           | `'6037997900000000'`     | Primary/fallback 16-digit bank card number for card-to-card top-ups (importable 1-tap into multi-card pool).     |
| `card_holder`                           | `'Name'`                 | Cardholder name displayed alongside `card_number`.                                                               |
| `unique_topup_amount_enabled`           | `'false'`                | Adds a small collision-free offset to card top-up amounts to disambiguate concurrent transfers.                  |
| `topup_min_amount` / `topup_max_amount` | `'10000'` / `'10000000'` | Minimum and maximum wallet top-up bounds in Tomans.                                                              |
| `receipt_duplicate_policy`              | `'warn'`                 | Action on duplicate receipt (`SHA-256` or `file_unique_id` match): `'warn'` (flag banner) or `'block'` (reject). |
| `wallet_transfer_enabled`               | `'true'`                 | Enables peer-to-peer wallet balance transfers between users.                                                     |
| `wallet_transfer_min_amount`            | `'5000'`                 | Minimum peer-to-peer balance transfer amount in Tomans.                                                          |
| `receipt_notify_enabled`                | `'true'`                 | Sends instant Telegram notifications to admins when a receipt is submitted.                                      |
| `receipt_notify_mode`                   | `'full'`                 | Admin notification format (`'full'` media card or `'simple'` compact alert).                                     |
| `receipt_notify_admins`                 | `''`                     | Optional subset of admins (selected by name/username in `adm:cfg:pay:adm`; empty = all admins).                  |

### Free Trial (`adm:trl`)

| Key             | Default  | Description                                                                                         |
| :-------------- | :------- | :-------------------------------------------------------------------------------------------------- |
| `trial_enabled` | `'true'` | Enables one-time free trial claims for new users. (Phone verification gate lives in `adm:cfg:gen`.) |
| `trial_gb`      | `'1'`    | Traffic quota (GB) allocated to trial subscriptions.                                                |
| `trial_days`    | `'3'`    | Validity duration (days) allocated to trial subscriptions.                                          |

### Growth & Rewards, Support & Backups (`adm:grw`, `adm:cfg:adm`, `adm:cfg:bak`)

| Key                                       | Default              | Description                                                                             |
| :---------------------------------------- | :------------------- | :-------------------------------------------------------------------------------------- |
| `referral_bonus_toman`                    | `'10000'`            | Fixed bonus (Tomans) credited when a referred user completes their first purchase.      |
| `cashback_percent`                        | `'5'`                | Percentage (`0–100`) of purchase amounts credited to the referrer.                      |
| `lucky_wheel_enabled`                     | `'true'`             | Enables the gamified Lucky Wheel feature (managed inside **Sales → Growth & Rewards**). |
| `lucky_wheel_min_amount` / `max_amount`   | `'1000'` / `'50000'` | Minimum and maximum wallet credit reward bounds on a winning spin.                      |
| `lucky_wheel_base_luck_percent`           | `'50'`               | Base win probability (`1–100%`) on the first spin.                                      |
| `lucky_wheel_decay_percent`               | `'10'`               | Win probability reduction (`0–100%`) per subsequent spin.                               |
| `lucky_wheel_cooldown_hours`              | `'24'`               | Hours between spins (`1–720`).                                                          |
| `lucky_wheel_max_spins`                   | `'5'`                | Maximum total spins allowed per user (`1–1000`).                                        |
| `support_enabled` / `support_destination` | `'true'` / `''`      | Toggles the support button and sets the target `@username` or `https://t.me/...` link.  |
| `backup_enabled`                          | `'false'`            | Enables scheduled PostgreSQL + `.env` snapshot delivery via Telegram.                   |
| `backup_interval_hours`                   | `'24'`               | Hours between automated backups (`1–720`).                                              |
| `backup_target_chat_id`                   | `''`                 | Destination Telegram chat ID, supergroup ID, or `@channel` for backup archives.         |
| `backup_include_env`                      | `'true'`             | Includes `.env` inside automated backup bundles.                                        |
