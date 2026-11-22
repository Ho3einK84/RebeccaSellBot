# RebeccaSellBot — Telegram Mini App Architecture (User & Admin Portal)

RebeccaSellBot ships a unified **Telegram Mini App** (`Fastify 5` backend + `React 19` / `Tailwind CSS v4` / `DaisyUI v5` / `TanStack Query` frontend) that achieves full feature parity with the Telegram bot across both customer self-service and administration.

---

## 1. Authentication, Guards & Session Lifecycle

```text
Telegram Mini App Launch (initData + optional start_param / query string)
  │
  ├─► POST /api/auth/telegram-validate (src/webapp/server/routes/authRoutes.ts)
  │      ├─ Validates Telegram initData HMAC-SHA256 signature & freshness
  │      ├─ Upserts user profile (username, first_name, last_name, locale)
  │      ├─ Persists first-touch referral code (start_param = ref_...)
  │      └─ Issues HTTP-only JWT session cookie (`ADMIN_SESSION_SECRET`)
  │
  └─► Guarded /api/user/* Requests (src/webapp/server/middleware/userGuard.ts)
         ├─ Rejects banned users with HTTP 403 `USER_BANNED`
         │    (payload embeds resolved `supportUrl`, `supportLabel`, `supportUsername`)
         └─ Enforces `bot_enabled = false` with HTTP 503 `MAINTENANCE_MODE`
              (automatically bypassed for active admins with an in-app banner)
```

- **Support Destination Resolution (`src/domain/services/SupportDestination.ts`):** Normalizes `support_destination` (`@username`, `https://t.me/...`, numeric Telegram ID `tg://user?id=...`), `SUPPORT_URL`, and primary admin fallback into a single canonical destination shared across Telegram keyboards, WebApp headers, and `403 USER_BANNED` screens.
- **Locale Sync (`POST /api/user/locale`):** Upserts the user row if absent before updating `fa` / `en` preference so first-visit language switches never fail.
- **Defensive Financial Responses (`webapp/src/shared/lib/api.ts`):** HTTP `202` responses indicating asynchronous/manual settlement (`manual_review`, `failed`, or `REFUND_OUTCOME_PENDING`) are surfaced as explicit `ApiClientError(202)` states rather than falsely treated as completed operations.

---

## 2. Modular Backend Route Map (`src/webapp/server/routes/`)

Customer routes are decomposed into five cohesive domain modules under `src/webapp/server/routes/user/` (composed by `src/webapp/server/routes/userRoutes.ts` and wired in `src/webapp/server/server.ts`):

| Module                 | Endpoints                                                                                                                                                                                                                          | Responsibilities                                                                                                                                                   |
| :--------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`shared.ts`**        | _(Internal helpers)_                                                                                                                                                                                                               | Per-route rate limiters, bilingual package/label localization (`FA \| EN` & custom IDs), masked P2P recipient previews, magic-byte receipt validation (`≤ 5 MiB`). |
| **`profileRoutes.ts`** | `GET /api/user/profile`<br>`GET /api/user/trial/status`<br>`POST /api/user/trial/claim`<br>`GET /api/user/wheel/status`<br>`POST /api/user/wheel/spin`                                                                             | Enriched profile (non-mutating card preview, `allCardsCapReached`, `activeBuyersCount`, support CTA, trial & wheel state, custom-volume tiers), Free Trial, Wheel. |
| **`configRoutes.ts`**  | `GET /api/user/configs`<br>`POST .../sync-all` · `POST .../claim`<br>`GET .../:id/usage` · `.../renewal-options` · `.../refund-quote`<br>`POST .../:id/{auto-renew,toggle-status,revoke,refresh,delete,transfer/preview,transfer}` | Full subscription lifecycle: external sub-link claim, Sync All, per-node usage + `onlineAt`, preset & custom auto-renew, link rotation, P2P transfer, self-refund. |
| **`shopRoutes.ts`**    | `GET /api/user/packages` · `GET /api/user/quote`<br>`POST /api/user/promo/{quote,redeem}`<br>`POST /api/user/checkout` · `POST /api/user/checkout/:id/confirm`                                                                     | Localized packages with flash-sale metadata & volume tiers, promo quoting/redemption, 3-phase checkout saga (`new_config`-only phone gate + Telegram artifact).    |
| **`walletRoutes.ts`**  | `GET /api/user/transactions?type=...`<br>`GET /api/user/receipts`<br>`POST /api/user/topup/{prepare,receipt}`<br>`POST /api/user/wallet/transfer/{preview,transfer}`                                                               | Category-filtered ledger (`all`, `topup`, `purchase`, `rewards`, `transfer`), daily-cap card prep, Telegram-hosted receipt upload (`8 MiB` JSON limit), P2P send.  |

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
│   ├── lib/{api.ts,deepLinks.ts,queryKeys.ts,transactionFormatters.ts}
│   ├── hooks/useTelegramContactVerification.ts  (Native Telegram.WebApp.requestContact + polling)
│   ├── i18n/locales/{fa.ts,en.ts}               (100% key-parity bilingual catalog)
│   └── types/{api.ts,telegram.ts,userPortal.ts}
└── features/
    ├── admin/                                   (Admin CRM, receipts/voiding, packages, panels, broadcasts)
    └── user-portal/
        ├── UserPortal.tsx                       (Deep-link router, MaintenanceScreen, Admin bypass, Ban CTA)
        ├── tabs/
        │   ├── DashboardTab.tsx                 (KPIs, attention alerts, Free Trial banner, quick actions)
        │   ├── ServicesTab.tsx                  (Sync All, Claim Sub-Link, live traffic/expiry cards)
        │   ├── ShopTab.tsx                      (Flash-sale countdowns, categories, custom GB tier table)
        │   ├── WalletTab.tsx                    (2-step card top-up & receipt upload, P2P, filters, receipts)
        │   └── ReferralTab.tsx                  (Rewards Hub: interactive Lucky Wheel + 4-metric referral/cashback)
        └── components/
            ├── LuckyWheelSection.tsx            (8-slice SVG wheel, haptic ticks, live cooldown, history)
            ├── FreeTrialSection.tsx             (Eligible banner + QR/SmartConnect delivery modal)
            ├── SmartConnectButtons.tsx          (1-tap import: v2rayNG, Hiddify, Streisand, Happ, Clash)
            ├── ServiceManagementModal.tsx       (Per-node usage, onlineAt, revoke, renew, transfer, delete)
            ├── AutoRenewModal.tsx               (Preset packages + custom GB/day auto-renew tabs)
            ├── CheckoutModal.tsx                (Discount/promo preview, custom name, native contact gate)
            ├── ClaimSubLinkModal.tsx            (Import/claim external Rebecca subscription link)
            ├── ConfigTransferModal.tsx          (Exact-match recipient preview & P2P service transfer)
            ├── ConfigDeleteRefundModal.tsx      (Refund quote inspection, 202 pending handling, delete)
            └── WalletTransferModal.tsx          (Exact-match recipient preview & P2P wallet transfer)
```
