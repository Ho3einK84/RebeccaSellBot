# RebeccaSellBot — Telegram Mini App Architecture (User & Admin Portal)

> **Last synced with version:** `v0.4.0`

RebeccaSellBot ships a unified **Telegram Mini App** (`Fastify 5` backend + `React 19` / `Tailwind CSS v4` / `DaisyUI v5` / `TanStack Query` frontend) that achieves full feature parity with the Telegram bot across both customer self-service and administration.

---

## 1. Authentication, Guards & Session Lifecycle

```text
Telegram Mini App Launch (initData + optional start_param / query string)
  │
  ├─► POST /api/auth/telegram-validate (src/webapp/server/routes/authRoutes.ts)
  │      ├─ Validates Telegram initData HMAC-SHA256 signature & freshness
  │      ├─ Enforces `registration_mode` (`open` / `invite_only` / `closed`) for new users
  │      ├─ Upserts user profile (username, first_name, last_name, locale)
  │      ├─ Persists first-touch referral code (start_param = ref_...)
  │      └─ Issues HTTP-only JWT session cookie (`ADMIN_SESSION_SECRET`)
  │
  └─► Guarded /api/user/* Requests (src/webapp/server/middleware/userGuard.ts)
         ├─ Rejects banned users with HTTP 403 `USER_BANNED`
         │    (payload embeds resolved `supportUrl`, `supportLabel`, `supportUsername`)
         ├─ Enforces `bot_enabled = false` with HTTP 503 `MAINTENANCE_MODE`
         │    (automatically bypassed for active admins with an in-app banner)
         ├─ Enforces `registration_mode` with HTTP 403 `REGISTRATION_INVITE_ONLY` / `REGISTRATION_CLOSED`
         └─ Enforces `forced_join_scope = all` with HTTP 403 `CHANNEL_JOIN_REQUIRED`
              (bypassed for admins; `/api/user/forced-join/check` remains reachable)
```

- **Support Destination Resolution (`src/domain/services/SupportDestination.ts`):** Normalizes `support_destination` (`@username`, `https://t.me/...`, numeric Telegram ID `tg://user?id=...`), `SUPPORT_URL`, and primary admin fallback into a single canonical destination shared across Telegram keyboards, WebApp headers, and `403 USER_BANNED` screens.
- **Locale Sync (`POST /api/user/locale`):** Upserts the user row if absent before updating `fa` / `en` preference so first-visit language switches never fail.
- **Defensive Financial Responses (`webapp/src/shared/lib/api.ts`):** HTTP `202` responses indicating asynchronous/manual settlement (`manual_review`, `failed`, or `REFUND_OUTCOME_PENDING`) are surfaced as explicit `ApiClientError(202)` states rather than falsely treated as completed operations.

---

## 2. Modular Backend Route Map (`src/webapp/server/routes/`)

Customer routes are decomposed into five cohesive domain modules under `src/webapp/server/routes/user/` (composed by `src/webapp/server/routes/userRoutes.ts` and wired in `src/webapp/server/server.ts`):

| Module                         | Endpoints                                                                                                                                                                                                                                                  | Responsibilities                                                                                                                                                                                         |
| :----------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`user/shared.ts`**           | _(Internal helpers)_                                                                                                                                                                                                                                       | Per-route rate limiters, bilingual package/label localization (`FA \| EN` & custom IDs), masked P2P recipient previews, magic-byte receipt validation (`≤ 5 MiB`).                                       |
| **`user/profileRoutes.ts`**    | `GET /api/user/profile` · `POST /api/user/locale`<br>`GET /api/user/forced-join/check`<br>`GET /api/user/trial/status` · `POST /api/user/trial/claim`<br>`GET /api/user/wheel/status` · `POST /api/user/wheel/spin`                                        | Enriched profile (`user.group`, signed `availableBalance`, `transferableBalance`, `creditLimit`, `purchasingPower`, `debtAmount`, group feature gates, cards, support), Trial, Wheel.                    |
| **`user/configRoutes.ts`**     | `GET /api/user/configs` · `POST .../sync-all` · `POST .../claim`<br>`PATCH /api/user/configs/:id/label`<br>`GET .../:id/{usage,renewal-options,refund-quote}`<br>`POST .../:id/{auto-renew,toggle-status,revoke,refresh,delete,transfer/preview,transfer}` | Subscription lifecycle: local personal labels (`user_label`), external sub-link claim, Sync All, per-node usage, group-priced auto-renew/renewals, P2P transfer, self-refund.                            |
| **`user/shopRoutes.ts`**       | `GET /api/user/packages` · `GET /api/user/quote`<br>`POST /api/user/promo/{quote,redeem}`<br>`POST /api/user/checkout` · `POST /api/user/checkout/:id/confirm`                                                                                             | Group-priced packages & flash sales, stock/per-user availability (`outOfStock`, `lowStock`, `HTTP 409` exhaustion handling), promo quoting/redemption, and 3-phase VIP credit + inventory checkout saga. |
| **`user/walletRoutes.ts`**     | `GET /api/user/{transactions,receipts}`<br>`POST /api/user/topup/{prepare,receipt,forapp-order,nowpayments-order}`<br>`GET /api/user/topup/orders[/:id/status]` · `POST .../orders/:id/cancel`<br>`POST /api/user/wallet/transfer/{preview,transfer}`      | Category-filtered ledger, manual card prep & Telegram-hosted receipt upload, automated ForApp & NOWPayments order lifecycle, and positive-balance-only P2P transfers.                                    |
| **`authRoutes.ts` & `server`** | `GET /api/health` · `GET /api/caddy-check`<br>`GET /api/auth/bot-info` · `POST /api/auth/telegram-validate`                                                                                                                                                | Public WebApp health (`version`, `channel`), On-Demand TLS mesh check, sanitized public `appVersion` (`toPublicAppVersion`), and `initData` session auth (full `AppVersionInfo` for admins).             |
| **`paymentWebhookRoutes.ts`**  | `POST /api/webhooks/forapp`<br>`POST /api/webhooks/nowpayments`                                                                                                                                                                                            | Public rate-limited gateway webhooks authenticated via timing-safe `X-API-Key` (ForApp) and `HMAC-SHA512` `x-nowpayments-sig` (NOWPayments).                                                             |
| **`admin*Routes.ts`**          | `/api/admin/{overview,users,receipts,panels,packages,categories,pricing/custom,...}`<br>`PATCH /api/admin/panels/:id/services/:serviceId`<br>`/api/admin/groups[/:id]` · `/api/admin/{payment-gateways,forced-join,bulk-gift}/*`                           | Full Admin Portal REST APIs across CRM, user groups, receipts/voiding, packages/stock/pricing, per-panel & per-service capacity/creation caps, bank cards, payment gateways, forced join, & bulk gifts.  |

---

## 3. Bot ↔ Mini App Synchronization

Every high-value customer action in the Mini App stays synchronized with the user's Telegram chat so users never lose subscription credentials or payment records:

1. **Permanent Chat Artifacts (`src/telegram/webappNotifications.ts`):**
   - `sendWebAppConfigArtifact` delivers immutable Telegram chat messages with subscription link, specs, and deep-link return button after Mini App purchases, renewals, free trial claims, and subscription URL revocations.
   - `sendWebAppWalletTransferNotification` and `sendWebAppConfigTransferNotification` notify P2P transfer recipients directly in Telegram with deep-links to open their updated wallet or service.
2. **Zero-Disk Telegram-Hosted Receipt Uploads:**
   - `POST /api/user/topup/receipt` validates binary magic bytes (`JPEG`, `PNG`, `WEBP`, `PDF`, `≤ 5 MiB`), computes content `SHA-256`, and uploads the buffer directly via `botApi` (`InputFile`) to obtain a genuine Telegram `file_id` and `file_unique_id` (falling back to the primary admin chat if the user hasn't started the bot).
   - Submitted receipts enter the exact same duplicate-detection (`warn`/`block`), admin push notification (`sendAdminNewReceiptNotification`), and Telegram/WebApp review queue as in-bot uploads.
3. **Native Phone Verification (`WebApp.requestContact()`):**
   - `useTelegramContactVerification.ts` triggers Telegram's native contact-sharing prompt inside the Mini App and polls profile state until verified (with bot deep-link fallback).
   - Shared contacts are processed outside active conversations by `bot.on('message:contact')` in [`src/telegram/features/coreRoutes.ts`](../src/telegram/features/coreRoutes.ts), enforcing `contact.user_id === ctx.from.id` and persisting only the `HMAC-SHA256` hash.
4. **Bi-Directional Deep Links (`webapp/src/shared/lib/deepLinks.ts`):**
   - **Bot → WebApp:** Query parameters (`?tab=services&config=<id>&action=...`) and Telegram `start_param` deep-link directly to tabs, specific subscription modals, Lucky Wheel, Free Trial, or checkout flows.
   - **WebApp → Bot:** `?start=topup_<amount>` (handled in [`src/telegram/features/baseRoutes.ts`](../src/telegram/features/baseRoutes.ts)) pre-populates `session.pendingTopupIntent` when users choose fallback bot top-up.

---

## 4. Frontend Structure (`webapp/src/`)

```text
webapp/src/
├── app/App.tsx                                  (Root bootstrap, locale/theme hydration, portal routing)
├── shared/
│   ├── components/layout/                       (AppShell, responsive TopBar, compact HeaderUtilityActions capsule, Navs)
│   ├── components/ui/VersionBadge.tsx           (VersionBadge, white-label AppVersionFooter, AdminVersionCard)
│   ├── lib/{api.ts,appVersion.ts,deepLinks.ts,queryKeys.ts,transactionFormatters.ts}
│   ├── hooks/useTelegramContactVerification.ts  (Native Telegram.WebApp.requestContact + polling)
│   ├── i18n/locales/{fa.ts,en.ts}               (100% key-parity bilingual catalog)
│   └── types/{admin.ts,api.ts,telegram.ts,userPortal.ts}
└── features/
    ├── auth/                                    (initData bootstrap, AuthErrorScreen w/ registration-mode & support CTA)
    ├── admin/                                   (Responsive 2-row mobile / 1-row desktop AdminHeader, Overview w/ capacity alerts,
    │                                             CRM/Users, Receipts/voiding, Packages & stock, Panels & ManageServicesModal,
    │                                             ModulesTab w/ AdminVersionCard, UserGroupsModal, BankCardsModal,
    │                                             PaymentGatewaysModal, ForcedJoinModal, BulkGiftModal)
    └── user-portal/
        ├── UserPortal.tsx                       (Deep-link router, UserPortalHeader, MaintenanceScreen, ForcedJoinGate, Ban CTA)
        ├── tabs/
        │   ├── DashboardTab.tsx                 (KPIs, group badge, debt/credit summary, Free Trial banner, quick actions)
        │   ├── ServicesTab.tsx                  (Personal labels, Sync All, Claim Sub-Link, live traffic/expiry cards)
        │   ├── ShopTab.tsx                      (Group-priced plans, stock/low-stock badges, flash-sale countdowns, custom GB tiers)
        │   ├── WalletTab.tsx                    (ForApp/NOWPayments orders, 2-step card receipt upload, credit/debt & P2P)
        │   └── ReferralTab.tsx                  (Rewards Hub: group-gated Lucky Wheel + referral/cashback KPIs)
        └── components/
            ├── ForcedJoinGate.tsx               (Mandatory channel membership overlay w/ live re-check)
            ├── LuckyWheelSection.tsx            (8-slice SVG wheel, haptic ticks, live cooldown, history)
            ├── FreeTrialSection.tsx             (Eligible banner + QR/SmartConnect delivery modal)
            ├── SmartConnectButtons.tsx          (1-tap import: v2rayNG, Hiddify, Streisand, Happ, Clash)
            ├── ServiceManagementModal.tsx       (Personal label edit, per-node usage, onlineAt, revoke, renew, transfer, delete)
            ├── AutoRenewModal.tsx               (Preset packages + custom GB/day auto-renew tabs)
            ├── CheckoutModal.tsx                (Group & flash-sale breakdown, VIP credit/debt preview, promo & phone gate)
            ├── ClaimSubLinkModal.tsx            (Import/claim external Rebecca subscription link)
            ├── ConfigTransferModal.tsx          (Exact-match recipient preview & P2P service transfer)
            ├── ConfigDeleteRefundModal.tsx      (Refund quote inspection, 202 pending handling, delete)
            └── WalletTransferModal.tsx          (Exact-match recipient preview & positive-only `transferableBalance` P2P)
```
