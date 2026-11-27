# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-11-27

Adds atomic fleet, service, and package inventory controls across the Telegram Bot and Mini App, minimal SemVer release-channel telemetry (`main` / `dev`), and a redesigned responsive Mini App header architecture.

### Added

- **Panel, Service & Package Inventory Engine (`InventoryService` + Migration `0019`):** Atomic PostgreSQL reservation, commit, release, reconciliation, and refund-restoration engine supporting per-panel and per-service pause toggles (`enabled`), concurrent config capacity (`maxConfigs`), consumable new-creation quotas (`stockRemaining`), and Tehran-midnight daily creation caps (`dailyCreateLimit`) — strictly scoping panel/service caps to new provisioning (`new_config` and `trial`) so existing subscribers can always renew (`renew_config` and `autoRenewal`).
- **Package, Custom-Volume & Trial Stock Controls:** Per-package stock counters and per-user purchase limits (`package_inventory`), custom-volume and free-trial stock/daily caps, storefront sold-out visibility toggle (`shop_show_out_of_stock`), low-stock warning threshold (`shop_low_stock_threshold`), Admin Overview fleet capacity alerts, `PATCH /api/admin/panels/:id/services/:serviceId`, and `HTTP 409` concurrent stock-exhaustion handling across Bot and Mini App checkouts.
- **Minimal SemVer 2.0.0 Version & Release-Channel Telemetry:** Automated `stable` (`main`), `dev`, and `prerelease` build metadata resolution (`v0.4.0`, `v0.4.0-dev.N+<sha>`) wired across Docker, Compose, `rsbot`, `install.sh`, esbuild (`dist/build-info.json`), and Vite — surfaced minimally in admin-only `/version`, Telegram Admin Home/Settings/Stats, `/api/health`, `/readyz`, WebApp Admin Header & Build Info card, and white-label WebApp footers (with internal build metadata omitted for end users and zero Telegram user clutter).

### Changed

- **Responsive Mini App Header Architecture:** Redesigned `TopBar`, `HeaderUtilityActions`, `AdminHeader`, and `UserPortalHeader` with a compact utility capsule and dedicated mobile quick-action bar (`320px+`), eliminating RTL/LTR title truncation and action crowding across mobile and desktop viewports.
- **Inventory & Capacity UX Clarity:** Standardized concise Persian/English terminology, live usage counters, distinct panel/service limit badges, and single-line micro-hints distinguishing concurrent **Max Total Configs** from consumable **New Creation Quota** and **Daily Creation Limit**.

### Fixed

- **Zero-Deadlock Concurrent Inventory Locking:** Locked `rebecca_panels` and `rebecca_panel_services` rows with `FOR NO KEY UPDATE` instead of `FOR UPDATE` so parallel child inserts (`FOR KEY SHARE` foreign-key checks) never deadlock during concurrent checkouts, while preserving `NULL` (unlimited) stock if toggled mid-flight.
- **Responsive Display Utility Precedence (`Badge` / `IconButton`):** Prevented base `inline-flex` classes from overriding responsive `hidden md:inline-flex` and `hidden sm:inline-flex` utilities in Tailwind CSS v4 builds.
- **Self-Updating `rsbot` Release Pulls:** Updated `rsbot update` to fetch remote SemVer tags prior to building and re-exec the newly pulled `scripts/rsbot` when advancing across commits.

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

[Unreleased]: https://github.com/Ho3einK84/RebeccaSellBot/compare/v0.4.0...dev
[0.4.0]: https://github.com/Ho3einK84/RebeccaSellBot/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Ho3einK84/RebeccaSellBot/releases/tag/v0.3.0
