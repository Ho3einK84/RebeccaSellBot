# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Service, Panel & Package Inventory Limits:** Atomic `FOR NO KEY UPDATE` inventory reservation & rollback engine (`InventoryService`) supporting per-panel and per-service creation caps (`enabled`, `maxConfigs`, `stockRemaining`, `dailyCreateLimit`), per-package stock and per-user purchase limits (`package_inventory`), custom-volume stock/daily caps, sold-out visibility toggle (`shop_show_out_of_stock`), and low-stock warning threshold (`shop_low_stock_threshold`) across Telegram Bot and Mini App — while ensuring existing subscribers can always renew without being blocked by panel/service new-creation caps.
- **Standard SemVer Version & Release Channel Display (`main` / `dev`):** Automated SemVer 2.0.0 build metadata resolution across Docker/Compose/`rsbot`/Vite (`stable`, `dev`, `prerelease`), surfaced in `/version`, Telegram Admin Home/Stats/Settings, User Home/Support footers, `/api/health`, `/readyz`, WebApp Admin Header badge, Admin Settings Build Info card, and unified WebApp footers.

## [0.3.0] - 2026-11-26

First official GitHub release of **RebeccaSellBot** — delivering unified Telegram Bot & Mini App commerce, multi-panel fleet orchestration, VIP user groups, and automated payment gateways.

### Added

- **Unified Telegram Bot & Mini App (`Fastify 5` + `React 19`):** Full User Portal and Admin Command Center sharing a unified matte design system, dark/light themes, Persian (`fa`) & English (`en`) i18n parity, Persian digit normalization, and bi-directional deep links.
- **Storefront, Tariffs & VIP User Groups:** Fixed and categorized packages, tiered custom GB/day ordering, flash sales, catalog & group discounts with anti-double-discount rules, VIP credit limits, custom service naming studio, and 40-char personal service labels.
- **Automated & Manual Top-Ups:** Automated ForApp card-to-card SMS matching (`+1..+999` unique Toman rounding, 5-minute manual fallback hint), NOWPayments crypto invoices with live USDT/Toman exchange feeds (Nobitex, Wallex, TGJU) or manual rate, DB-backed daily bank card caps, 2-step manual receipts, and positive-balance-only P2P transfers.
- **Subscription Lifecycle & Engagement:** Start-on-first-use (`on_hold`), renewal rollover, preset & credit-aware custom auto-renewal, self-refund quotes, P2P service transfers, fractional sub-1 GB free trials, 8-slice SVG Lucky Wheel, referral rewards, forced channel join, registration policies (`open` / `invite_only` / `closed`), and durable bulk GB/day gift campaigns.
- **Stateless Admin Hub & Multi-Panel Fleet:** Stateless `adm:*` admin navigation, non-blocking input engine, Customer 360 user dossier, negative-balance filter, 1-click receipt queue, unmatched deposit matcher, orphan reconciliation, dual-mode bot texts editor, and multi-panel Rebecca REST fleet management with circuit-breaker resilience.
- **Deployment & Operations:** Guided 1-command `install.sh` (TTY pipe safe, `--env-file`, `--from-backup`), multi-instance `rsbot` CLI (`list`, `up`, `down`, `status`, `verify`, `env`, `logs`, `update`, `backup`, `restore`, `all`), automated Caddy On-Demand TLS mesh (`rsbot_mesh` / `rsbot_registry`), and transactional PostgreSQL 16 backup/restore with pre-restore rollback snapshots.
- **GitHub & Release Standardization:** Standardized `main` / `dev` branching model, `CHANGELOG.md`, `CONTRIBUTING.md`, GitHub release-notes categorization, and automated tag-driven GitHub Releases.

### Security

- **At-Rest Credential Vault (`AES-256-GCM`):** Encrypted storage for Rebecca panel credentials and ForApp/NOWPayments gateway secrets (`PANEL_CREDENTIALS_KEY`), with zero-secret conversation replay handling.
- **Receipt Fraud & Privacy Controls:** `SHA-256` + `file_unique_id` receipt deduplication, atomic approved-receipt voiding (`topup_void`), zero-disk WebApp magic-byte uploads, optional payment prompt auto-deletion (`payment_message_auto_delete_hours`), and `HMAC-SHA256` phone verification without storing raw phone numbers.
- **Webhook & Session Hardening:** Constant-time verification for Telegram, Rebecca, ForApp (`X-API-Key`), and NOWPayments (`HMAC-SHA512`) webhooks; `HMAC-SHA256` Mini App `initData` validation with HTTP-only JWT cookies; fail-closed CORS and per-route rate limiting.

### Engineering

- **Financial Integrity:** 64-bit safe-integer minor-unit accounting (`DbNumber`) with a 3-phase `FOR UPDATE` purchase/renewal saga and automatic failure compensation.
- **Parallel Verification Gate:** `scripts/verify.mjs` enforcing static layer boundaries (`architecture:check`), parallel incremental TypeScript checks, ESLint 10, Prettier, Vitest unit & PostgreSQL integration/concurrency suites, and esbuild + Vite production builds.

[Unreleased]: https://github.com/Ho3einK84/RebeccaSellBot/compare/v0.3.0...dev
[0.3.0]: https://github.com/Ho3einK84/RebeccaSellBot/releases/tag/v0.3.0
