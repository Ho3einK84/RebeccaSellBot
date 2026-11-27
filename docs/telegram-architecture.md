# RebeccaSellBot — Telegram Delivery Layer & UI Architecture

> **Last synced with version:** `v0.4.0`

RebeccaSellBot treats Telegram strictly as an **ephemeral delivery and interaction layer**. Handlers, conversations, and keyboards under [`src/telegram/`](../src/telegram/) never query PostgreSQL directly or instantiate panel HTTP clients; every operation flows through typed domain services injected on `ctx.services`.

---

## 1. Update Pipeline (`src/telegram/botRuntime.ts`)

```text
Incoming Telegram Update
  │
  ├─► 1. Outbound API Transformers
  │      ├─ apiThrottler()                 (Telegram flood-limit queueing)
  │      ├─ safeFormattingTransformer()    (Auto-fallback on Markdown parse errors)
  │      └─ uiMessageTrackingTransformer() (AsyncLocalStorage message role tracking)
  │
  ├─► 2. Context & Security Guards
  │      ├─ Service Injection              (Attaches BotServices to ctx.services)
  │      ├─ Private Chat Gate              (Blocks non-private chats from user/financial flows)
  │      ├─ Registration Policy Gate       (Enforces open / invite_only / closed for new users)
  │      ├─ User Upsert & Locale Sync      (Caches ban status in WeakMap; resolves fa/en locale)
  │      ├─ Admin Callback Firewall        (Blocks non-admins from adm:* and legacy admin callbacks)
  │      ├─ PostgresSessionAdapter         (Hydrates session from grammy_sessions)
  │      ├─ cleanChatUiMiddleware()        (Sweeps stale screens/prompts; protects artifacts)
  │      ├─ Ban Guard                      (Drops updates from banned users)
  │      ├─ Maintenance Guard              (Shows maintenance notice when bot_enabled = false)
  │      └─ Forced Channel Join Guard      (Verifies required channels for global/scoped actions)
  │
  ├─► 3. Non-Blocking Pre-Conversation Layer
  │      ├─ Early `ui:dismiss` Handler     (1-tap popover close even during active inputs/wizards)
  │      └─ registerAdminInputMiddleware() (Postgres-backed `session.adminInput`, 5m TTL, auto-clears on nav)
  │
  ├─► 4. Conversation Engine (@grammyjs/conversations)
  │      ├─ conversationContextMiddleware  (Re-hydrates services & locale on replay)
  │      └─ Registered User & Admin Conversations
  │
  ├─► 5. Rate Limit & Cooldown Guards      (rateLimitMiddleware w/ next-expiry pruning + actionCooldown)
  │
  └─► 6. Stateless Admin & Feature Routers
         ├─ admin/* (`adm:*` router)       (Command Center, Sales/Settings/Messaging Hubs, Gateways, Forced Join, Texts)
         ├─ coreRoutes & baseRoutes        (/start incl. ref_* & topup_<amt>, /admin, /lang, trial, native contact)
         ├─ paymentOrderRoutes             (Automated ForApp & NOWPayments orders, status check, manual fallback)
         ├─ purchaseRoutes & configRoutes  (Group-priced storefront, flash sales, VIP credit checkout, custom volume)
         ├─ subscriptions/routes           (Live status, personal labels, QR popover, client links, sub rotation)
         ├─ luckyWheelRoutes               (Daily spin & prize ledger, gated by group allow_lucky_wheel)
         └─ features/admin/*               (Receipts/voiding, users & groups, panels, orphans, promos, broadcasts, bulk gifts)
```

---

## 2. Clean-Chat UI & Unified Design System (`src/telegram/ui.ts` & `designSystem.ts`)

To prevent chat clutter while guaranteeing zero loss of payment or subscription records, every outbound message is tagged with one of four roles via `AsyncLocalStorage`:

| Role               | Lifecycle Policy                                                                                   | Examples                                                                                     |
| :----------------- | :------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------- |
| **`screen`**       | Edited in-place via `renderScreen` (`editMessageText`) or replaced on navigation.                  | Home dashboard, storefront catalog, stateless `adm:*` screens.                               |
| **`prompt`**       | Automatically deleted once the owning input or conversation step completes or cancels.             | "Enter custom GB", "Send receipt photo", "Share contact", `adminInput` prompts.              |
| **`artifact`**     | **Immutable & Permanent (`rememberArtifactMessage`):** Never deleted or overwritten by UI cleanup. | Subscription links, QR codes, receipt push alerts, bulk promo code batches, test broadcasts. |
| **`notification`** | Durable asynchronous alerts tracked separately from interactive screen navigation.                 | Low quota alerts, first-use nudges, expired-cleanup warnings, void notices.                  |

### UX Invariants

- **Unified Design System (`buildUserScreen` & `buildAdminScreen`):** Both user and admin screens share the same minimal RTL-safe layout (no Persian-breaking italic wrappers, Markdown-escaped `buildBreadcrumb`, inline `AdminScreenNotice` feedback banners, and vertically stacked destructive confirmation keyboards).
- **Single-Tap Popover Dismiss (`ui:dismiss`):** Mounted ahead of `conversations()` and `adminInput` so temporary overlays (QR popovers, outage alerts, test broadcasts) always close in one tap without disturbing the active screen or prompt.
- **Digit Normalization (`normalizeInputDigits`):** All numeric inputs (amounts, GB, days, card numbers, phone numbers, expiry dates, warn days) automatically normalize Persian (`۰–۹`) and Arabic (`٠–٩`) numerals to ASCII (`0–9`).
- **Zero Duplicate Status Emojis:** Status formatters and empty-state builders strip duplicate leading emojis and emit a single canonical badge per state (`active`, `on_hold`, `limited`, `expired`, `disabled`, `healthy`, `warning`, `error`).
- **White-Label Customer Surface & Minimal Admin Version Telemetry (`src/telegram/versionBadge.ts`):** Regular customers see zero version text or `RebeccaSellBot` branding anywhere in Telegram. Administrators see concise single-line SemVer tags (`🏷️ v0.4.0` on `main`, `🧪 v0.4.0-dev.N · <sha>` on `dev`) on Admin Home (`adm:home`), Settings (`adm:cfg`), Stats (`adm:stats`), and the admin-only `/version` screen.

---

## 3. Stateless Telegram Admin Architecture (`src/telegram/admin/`)

All day-to-day administration runs on restart-proof, stateless `adm:*` routes backed by PostgreSQL session state instead of long-lived in-memory conversation loops:

```text
src/telegram/admin/
├── adminNav.ts                 (64-byte admCb builder, bounded adminNavStack [max 8], pagination & confirm keyboards)
├── adminRouter.ts              (Stateless adm:* route registry, adm:back, adm:in:cancel, admin-aware fallback)
├── adminInput.ts               (Non-blocking session.adminInput text engine — 5m TTL, inline retry, /cancel return)
├── adminHome.ts                (1-tap Command Center adm:home, 60s cached panel health w/ 1.5s timeout,
│                                adm:stats, adm:sales hub, 8-item adm:cfg hub, adm:msg hub, minimal version tags)
├── adminCommands.ts            (BotCommandScopeChat sync for admins: /admin, /r, /u [query], /stats, /version, /cancel)
├── adminSalesRoutes.ts         (Stateless Packages & Categories + stock/per-user limits, Custom Volume, Free Trial,
│                                unified Growth & Rewards [Referral + Cashback + Lucky Wheel], Flash Discounts)
├── adminSettingsRoutes.ts      (General & Security w/ registration_mode, phone gate & cleanup preview,
│                                Payment & auto-delete hours, Bank Cards adm:bc:*, Naming/Storefront Stock & Rules,
│                                Web Mini App w/ DNS/SSL report, Auto Backup, Admins & Support)
├── adminPaymentGatewayRoutes.ts (Stateless ForApp & NOWPayments setup, API key rotation, unmatched deposit matcher)
├── adminForcedJoinRoutes.ts    (Stateless forced channel join scope & multi-channel manager w/ live test)
└── adminTextsRoutes.ts         (Stateless FA/EN Bot Texts browser, search, live preview, inline editor)
```

### Key Admin Route Families (`adm:*`)

| Route Prefix                  | Module & Capabilities                                                                                                            |
| :---------------------------- | :------------------------------------------------------------------------------------------------------------------------------- |
| `adm:home` · `adm:stats`      | 1-tap Command Center with live KPIs/alerts, cached panel health, real-time DB/panel latency stats, and minimal SemVer badge.     |
| `adm:rcpt:*`                  | Pending receipt queue (1-click approve, reject reasons, batch approve), searchable approved history & void.                      |
| `adm:usr:*` · `adm:usr:grp:*` | Paginated user list (`all`, `active_subs`, `has_balance`, `banned`), search, CRM, wallet, & group/expiry assign.                 |
| `adm:sales` · `adm:pkg:*`     | Sales Hub, Packages & Categories CRUD + stock/per-user caps, Custom Volume (`adm:cv`), Free Trial (`adm:trl`) & daily caps.      |
| `adm:grp:*`                   | Stateless User Groups CRUD (`groupRoutes.ts`): discount/rate/credit editing, custom-volume discount toggle, 1-tap feature flags. |
| `adm:prm:*` · `adm:dsc:*`     | Filterable Promo Center + single-card quick editor (`adm:prm:edit:*`); Flash Discounts w/ confirm guards.                        |
| `adm:grw` · `adm:grw:wheel`   | Unified Growth & Rewards card (Referral bonus, Cashback %, Lucky Wheel toggle & detailed odds settings).                         |
| `adm:pnl:*` · `adm:orp:*`     | Panel & service registry with pause toggles, concurrent capacity/creation/daily caps, orphan shortcut, & note-aware Assign.      |
| `adm:msg` · `adm:gift:*`      | Messaging Hub: group-filterable broadcasts (`adm:msg:jobs:<p>`), DMs, and durable Bulk Gift campaigns (`adm:gift:*`).            |
| `adm:cfg:*` · `adm:bc:*`      | 8-section Settings Hub (`registration_mode`, out-of-stock visibility, payment auto-delete, WebApp, phone gate) + Bank Cards.     |
| `adm:cfg:fj` · `adm:fj:*`     | Forced Channel Join scope selector (`off`/`all`/`trial_only`/`purchase_and_trial`) and channel manager.                          |
| `adm:pg:fa*` · `adm:pg:np*`   | Automated Payment Gateways: ForApp guide/key rotation/unmatched deposits & NOWPayments config/sandbox/test.                      |
| `adm:txt:*`                   | Stateless bilingual text catalog browser with current-value copy view, placeholder checks & live preview.                        |

### Power-Admin Quick Commands (`BotCommandScopeChat`)

On startup (`syncAdminBotCommands` in [`src/index.ts`](../src/index.ts), with lazy per-chat fallback via `ensureAdminCommandsSyncedForChat` for admins who had not yet opened a chat), RebeccaSellBot registers an admin-only command menu for each ID in `adminIds` (while regular users only see `/start`):

- `/admin` — Open the 1-tap Admin Command Center (clearing any stale transient input/secret state)
- `/r` — Jump directly to the pending receipts queue (`adm:rcpt:q:1`)
- `/u [query]` — Open a matching customer profile directly or launch user omnisearch
- `/stats` — Open live revenue, subscriber, and panel health statistics (`adm:stats`)
- `/version` — Inspect the active SemVer release, channel (`stable`/`dev`/`prerelease`), branch, commit SHA, and build timestamp
- `/cancel` — Cancel an active `adminInput` prompt and return directly to its parent screen

---

## 4. Conversations Architecture (`src/telegram/conversations/`)

Interactive customer checkouts and select multi-step creation wizards continue to use `@grammyjs/conversations`:

```text
src/telegram/conversations/
├── userConversations.ts
│   ├── buyConfigConversation            (Package selection & checkout creation)
│   ├── buyPackageCustomNameConversation (Buyer-chosen English service name prompt)
│   ├── customAmountConversation         (Custom GB/day quote with group & flash-sale pricing)
│   ├── renewConfigConversation          (Package-based renewal with quota/time rollover)
│   ├── autoRenewCustomConversation      (Auto-renewal package binding & price ceiling consent)
│   ├── editConfigLabelConversation      (Local 40-char personal subscription label editor)
│   ├── promoConversation                (Promo & gift code redemption, gated by group policy)
│   ├── transferConfigConversation       (Peer-to-peer subscription ownership transfer)
│   ├── transferBalanceConversation      (Positive-balance-only P2P wallet transfer)
│   └── verifyPhoneConversation          (requestContact flow with ReplyKeyboard cleanup on exit)
│
└── adminConversations/                  (Multi-step creation flows & legacy callback compatibility)
    ├── wallet.ts                        (topupConversation [manual/ForApp/NOWPayments] + adminSetBalance)
    ├── promos.ts                        (Single & bulk promo creation w/ durable artifact output)
    ├── messaging.ts                     (Group-filtered broadcast composer w/ artifact test & DM wizard)
    ├── lifecycle.ts                     (Admin subscription quota/expiry/service editors)
    ├── panels.ts & catalogDiscounts.ts  (Panel creation wizard & legacy discount compatibility)
    ├── texts/                           (Shared catalog classifier, placeholder metadata & live preview)
    └── settings/                        (Shared validation/catalog definitions & legacy compatibility)
```

### Zero-Secret Replay Rule

> [!CAUTION]
> `@grammyjs/conversations` serializes replay logs into `grammy_sessions`. Panel API keys and admin passwords are **never** read inside a conversation; they are captured by a dedicated one-shot handler in [`src/telegram/features/admin/panelRoutes.ts`](../src/telegram/features/admin/panelRoutes.ts) (cleared automatically on `/admin`, `/start`, or 5-minute timeout), encrypted immediately with `CredentialCipher` (`AES-256-GCM`), and the plaintext message is deleted via `ctx.deleteMessage()`.

---

## 5. Callback Data & Bilingual Localization

- **64-Byte UTF-8 Callback Guard ([`callbackData.ts`](../src/telegram/callbackData.ts)):** Enforces Telegram's 64-byte `callback_data` ceiling at construction time. Compact prefixes (`adm:*`, `buy:confirm:<id>`, `r:p:<cfg>:<idx>:<hash>`, `renew:open:<id>`, `ui:dismiss`) keep payloads safely under the limit.
- **100% Bilingual Catalog Parity & Zero Dead Keys:** Every key in [`TranslationCatalog.fa.ts`](../src/domain/services/TranslationCatalog.fa.ts) has an exact counterpart, matching `{placeholder}` set, deterministic text-editor category, and active production reference in [`TranslationCatalog.en.ts`](../src/domain/services/TranslationCatalog.en.ts), enforced on every run by [`tests/domain/TranslationService.test.ts`](../tests/domain/TranslationService.test.ts) and [`tests/telegram/adminPackageAndTextEditors.test.ts`](../tests/telegram/adminPackageAndTextEditors.test.ts).

---

## 6. Mini App ↔ Telegram Synchronization (`src/telegram/webappNotifications.ts`)

Actions triggered inside the Telegram Mini App stay synchronized with Telegram chat delivery through three bridges:

- **Permanent Chat Artifacts (`sendWebAppConfigArtifact`):** WebApp new purchases, renewals, free trial claims, and subscription URL revocations automatically send a permanent chat message with the subscription link, plan details, and a deep-link button back to the Mini App service view.
- **P2P Transfer Notices (`sendWebAppWalletTransferNotification` / `sendWebAppConfigTransferNotification`):** Recipients of Mini App wallet or service transfers receive instant localized DMs in Telegram with deep-links to open their updated wallet or service.
- **Native Contact & Deep-Link Bridges:** `bot.on('message:contact')` in [`src/telegram/features/coreRoutes.ts`](../src/telegram/features/coreRoutes.ts) handles contacts shared via Mini App `Telegram.WebApp.requestContact()` outside active conversations (strictly enforcing `contact.user_id === from.id`), while [`src/telegram/features/baseRoutes.ts`](../src/telegram/features/baseRoutes.ts) parses `?start=topup_<amount>` deep links into `session.pendingTopupIntent`. Mini App receipt uploads (`uploadReceiptMediaToTelegram`) stream binary buffers straight to Telegram via `InputFile` so zero receipt files touch local disk. See [docs/webapp-architecture.md](webapp-architecture.md) for the complete Mini App guide.
