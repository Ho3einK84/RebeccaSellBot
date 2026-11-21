# RebeccaSellBot — Telegram Delivery Layer & UI Architecture

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
  │      ├─ User Upsert & Locale Sync      (Caches ban status in WeakMap; resolves fa/en locale)
  │      ├─ Admin Callback Firewall        (Blocks non-admins from admin:* / trial:* admin routes)
  │      ├─ PostgresSessionAdapter         (Hydrates session from grammy_sessions)
  │      ├─ cleanChatUiMiddleware()        (Sweeps stale screens/prompts; protects artifacts)
  │      ├─ Ban Guard                      (Drops updates from banned users)
  │      └─ Maintenance Guard              (Shows maintenance notice when bot_enabled = false)
  │
  ├─► 3. Conversation Engine (@grammyjs/conversations)
  │      ├─ conversationContextMiddleware  (Re-hydrates services & locale on replay)
  │      └─ Registered User & Admin Conversations
  │
  ├─► 4. Rate Limit & Cooldown Guards      (rateLimitMiddleware + actionCooldown)
  │
  └─► 5. Feature Routers
         ├─ coreRoutes & baseRoutes        (/start, /admin, /lang, trial claims, phone gate)
         ├─ purchaseRoutes & configRoutes  (Storefront, flash-sale checkouts, custom volume)
         ├─ subscriptions/routes           (Live status, QR popover, client links, sub rotation)
         ├─ luckyWheelRoutes               (Daily spin & prize ledger)
         └─ admin/*                        (Receipts/voiding, users, panels, promos, broadcasts)
```

---

## 2. Clean-Chat UI Engine (`src/telegram/ui.ts`)

To prevent chat clutter while guaranteeing zero loss of payment or subscription records, every outbound message is tagged with one of four roles via `AsyncLocalStorage`:

| Role               | Lifecycle Policy                                                                                   | Examples                                                                    |
| :----------------- | :------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------- |
| **`screen`**       | Edited in-place via `renderUiScreen` (`editMessageText`) or replaced on navigation.                | Home dashboard, storefront catalog, admin menus.                            |
| **`prompt`**       | Automatically deleted once the owning conversation step completes or cancels.                      | "Enter custom GB", "Send receipt photo", "Share contact".                   |
| **`artifact`**     | **Immutable & Permanent (`rememberArtifactMessage`):** Never deleted or overwritten by UI cleanup. | Subscription links, QR codes, transaction receipts, trial credentials.      |
| **`notification`** | Durable asynchronous alerts tracked separately from interactive screen navigation.                 | Low quota alerts, first-use nudges, expired-cleanup warnings, void notices. |

### UX Invariants

- **Single-Tap Popover Dismiss (`ui:dismiss`):** Temporary overlays (e.g., QR code popovers or admin outage alerts) close in a single tap without sweeping the underlying screen.
- **Digit Normalization (`normalizeInputDigits`):** All numeric inputs (amounts, GB, days, card numbers, phone numbers, warn days) automatically normalize Persian (`۰–۹`) and Arabic (`٠–٩`) numerals to ASCII (`0–9`).
- **Zero Duplicate Status Emojis:** Status formatters emit a single canonical badge per state (`active`, `on_hold`, `limited`, `expired`, `disabled`).

---

## 3. Conversations Architecture (`src/telegram/conversations/`)

```text
src/telegram/conversations/
├── userConversations.ts
│   ├── buyConfigConversation            (Package selection & checkout creation)
│   ├── buyPackageCustomNameConversation (Buyer-chosen English service name prompt)
│   ├── customAmountConversation         (Custom GB/day quote with active flash-sale discount)
│   ├── renewConfigConversation          (Package-based renewal with quota/time rollover)
│   ├── autoRenewCustomConversation      (Auto-renewal package binding & price ceiling consent)
│   ├── promoConversation                (Promo & gift code redemption)
│   ├── transferConfigConversation       (Peer-to-peer subscription ownership transfer)
│   ├── transferBalanceConversation      (Peer-to-peer wallet balance transfer)
│   └── verifyPhoneConversation          (requestContact flow with contact.user_id === ctx.from.id check)
│
└── adminConversations/
    ├── wallet.ts
    │   ├── topupConversation            (Card top-up receipt upload + SHA-256 & file_unique_id hashing)
    │   └── adminSetBalanceConversation  (Admin credit/debit/set balance with audit reason)
    ├── catalogDiscounts.ts              (Timed flash-sale CRUD + 1-tap Broadcast launch)
    ├── lifecycle.ts                     (Admin subscription quota/expiry/service editors)
    ├── promos.ts                        (Single/bulk promo creation, editing & search)
    ├── messaging.ts                     (Segmented broadcasts, direct DMs, admin management)
    ├── panels.ts                        (Multi-panel registry & service synchronization)
    ├── texts.ts                         (In-bot FA/EN translation override editor)
    └── settings/                        (Modular Admin Settings Center)
        ├── catalog.ts & validation.ts   (11 typed groups: system, pricing, custom_volume, payment,
        │                                 support, trial, referral, lucky_wheel, naming, retention, backup)
        ├── packageManager.ts            (Packages & categories CRUD + panel/service binding)
        ├── payment.ts                   (Primary card, multi-card pool bank_cards_json, duplicate policy)
        ├── customVolume.ts              (Per-GB rates, tiers, bounds & target panel)
        ├── trial.ts & referral.ts       (Trial quotas/phone gate & referral/cashback rates)
        ├── luckyWheel.ts & naming.ts    (Spin odds/decay & username templates/custom naming)
        └── backup.ts & webapp.ts        (Automated backup delivery & live Mini App activation)
```

### Zero-Secret Replay Rule

> [!CAUTION]
> `@grammyjs/conversations` serializes replay logs into `grammy_sessions`. Panel API keys and admin passwords are **never** read inside a conversation; they are captured by a dedicated one-shot handler in [`src/telegram/features/admin/panelRoutes.ts`](../src/telegram/features/admin/panelRoutes.ts), encrypted immediately with `CredentialCipher` (`AES-256-GCM`), and the user's plaintext message is deleted via `ctx.deleteMessage()`.

---

## 4. Callback Data & Bilingual Localization

- **64-Byte UTF-8 Callback Guard ([`callbackData.ts`](../src/telegram/callbackData.ts)):** Enforces Telegram's 64-byte `callback_data` ceiling at construction time. Compact prefixes (`buy:confirm:<id>`, `r:p:<cfg>:<idx>:<hash>`, `renew:open:<id>`, `ui:dismiss`) keep payloads well under the limit.
- **100% Bilingual Catalog Parity:** Every key in [`TranslationCatalog.fa.ts`](../src/domain/services/TranslationCatalog.fa.ts) has an exact counterpart and matching `{placeholder}` set in [`TranslationCatalog.en.ts`](../src/domain/services/TranslationCatalog.en.ts), verified on every test run by [`tests/domain/TranslationService.test.ts`](../tests/domain/TranslationService.test.ts).
