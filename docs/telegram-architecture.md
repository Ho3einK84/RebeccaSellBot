# Telegram Delivery Layer & UI Architecture

This document provides a comprehensive architectural specification for the Telegram subsystem in **RebeccaSellBot**. For the complete end-to-end system architecture (including financial sagas, database schema, and background jobs), see [docs/architecture.md](architecture.md).

RebeccaSellBot treats Telegram strictly as an **ephemeral delivery and interaction layer**. Telegram handlers, conversations, and keyboards never query the database directly or dispatch direct HTTP requests to Rebecca panels. All business operations are mediated through typed domain services and saga orchestrators.

---

## 1. Architectural Boundaries & Invariants

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        Telegram Bot API                                │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Outbound Long Polling (bot.start())
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       Delivery Layer (grammY)                          │
│                                                                        │
│   Middlewares ──► UI Engine (ui.ts) ──► Handlers & Conversations       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Strictly invokes Domain Services
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Domain Service Layer                            │
│                                                                        │
│   WalletService   ConfigService   PricingService   RebeccaService      │
│   TrialService    RefundService   BroadcastService PromoService        │
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │                                │
                    ▼                                ▼
┌──────────────────────────────────────┐   ┌─────────────────────────────┐
│       Infrastructure Layer           │   │    Rebecca Panel Fleet      │
│  Drizzle ORM ──► PostgreSQL (Docker) │   │  HTTPS REST API (Encrypted) │
└──────────────────────────────────────┘   └─────────────────────────────┘
```

### Core Architecture Rules

1. **No Direct DB Access from Telegram:** Files under `src/telegram/` must never import from `src/infra/db.js` or `src/infra/schema.js`. All state mutations and queries route through domain services (e.g., `WalletService`, `ConfigService`).
2. **No Direct HTTP / API Client Access:** Telegram code must never instantiate `RebeccaApiClient` or perform raw `fetch()` calls. All panel interactions go through `RebeccaService` or the `RebeccaPanelRegistry`.
3. **Outbound Long Polling Only:** The bot starts exclusively with `bot.start()` (long polling). Inbound webhook endpoints are strictly forbidden, eliminating public attack vectors.
4. **Automated Enforcement:** The architectural test script [`scripts/check-architecture.mjs`](../scripts/check-architecture.mjs) runs during CI and pre-commit verification to statically enforce these import boundaries and conventions.

---

## 2. Update Lifecycle & Middleware Pipeline

Every incoming update passes through a carefully ordered pipeline in `src/telegram/botRuntime.ts`:

```text
Incoming Update
   │
   ├─► 1. API Transformers
   │      ├─ apiThrottler()                 (Enforces Telegram API rate limits)
   │      ├─ safeFormattingTransformer()    (Recovers from Markdown entity parsing errors)
   │      └─ uiMessageTrackingTransformer() (Tracks message IDs via AsyncLocalStorage)
   │
   ├─► 2. registerAdminAlertHook()          (Pushes immediate panel outage alerts to admins)
   │
   ├─► 3. Context & Security Middlewares
   │      ├─ Service Injection              (Attaches typed domain services to ctx.services)
   │      ├─ Private Chat Enforcement       (Rejects non-private group/channel updates)
   │      ├─ Locale & User Activity Sync    (Resolves user locale and updates CRM activity)
   │      ├─ Admin Callback Firewall        (Validates admin permissions for all admin callbacks)
   │      ├─ PostgresSessionAdapter         (Hydrates session from PostgreSQL key: chatId:userId)
   │      ├─ cleanChatUiMiddleware()        (Cleans previous screens/prompts, protects artifacts)
   │      ├─ Ban Enforcement                (Silently drops updates from banned users)
   │      └─ Maintenance Mode Guard         (Blocks customer access when bot_enabled = false)
   │
   ├─► 4. Conversations Container
   │      ├─ conversationContextMiddleware  (Re-injects services and locale into conversation ctx)
   │      └─ 20+ Registered Conversations   (User checkouts, admin settings, topups, broadcasts)
   │
   ├─► 5. Rate Limiting Middleware          (Protects plain text input and prevents flood spam)
   │
   └─► 6. Feature Routes & Handlers
          ├─ Core & Base Routes             (/start, /admin, /help, /lang, navigation)
          ├─ Purchase & Checkout Routes     (Package browsing, checkout confirmation, promo input)
          ├─ Subscription Management        (Config details, QR codes, sub links, auto-renew, refund)
          ├─ Gamification Routes            (Lucky wheel daily spins, rewards, cooldown checks)
          └─ Admin Backoffice Routes        (Receipts, users, panels, maintenance, broadcasts)
```

---

## 3. UI Engine & Screen Management (`ui.ts`)

RebeccaSellBot provides an app-like, clean chat experience where the bot chat does not fill up with stale menus and conversational clutter.

### Message Roles

Every message sent by the bot is classified into one of four distinct roles:

| Role               | Purpose                                                                           | Lifecycle Behavior                                                                                               |
| :----------------- | :-------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| **`screen`**       | Interactive menu or view.                                                         | Replaced in-place via `renderUiScreen` (using `editMessageText`), or deleted when transitioning to a new screen. |
| **`prompt`**       | Ephemeral conversational request (e.g. "Enter amount").                           | Automatically deleted once the conversation finishes or cancels.                                                 |
| **`artifact`**     | High-value output (e.g. VPN subscription link, QR code image, trial credentials). | **Durable:** Protected against deletion or mutation by screen navigation.                                        |
| **`notification`** | Automated alerts (low-traffic warning, expiry reminder, auto-renewal report).     | Durable, tracked separately from interactive screens.                                                            |

### Message Tracking with AsyncLocalStorage

`uiMessageTrackingTransformer()` wraps grammY's outbound API methods (`sendMessage`, `sendPhoto`, `sendDocument`, etc.) in an `AsyncLocalStorage` store (`uiTracking`). When a route or conversation sends a message, its `message_id` is automatically recorded into the user's PostgreSQL session under the appropriate role without manual bookkeeping.

### Smart Screen Rendering (`renderUiScreen`)

```typescript
export async function renderUiScreen(
  ctx: MenuContext,
  text: string,
  options: RenderUiScreenOptions = {}
): Promise<RenderUiScreenResult>;
```

1. **In-Place Editing:** If invoked from a callback query on an editable `screen` message (and not an `artifact`), `editMessageText` is used.
2. **Idempotent Handling:** If the screen content has not changed, Telegram's `message is not modified` error is caught and safely treated as a successful no-op.
3. **Fallback to New Message:** If the message is missing, unmodifiable, or a photo/media message, it sends a fresh tracked screen message and marks the old one for cleanup.

---

## 4. Design System & Presentation (`designSystem.ts` & `rendering.ts`)

To maintain visual hierarchy, clarity, and RTL/LTR consistency across Persian and English, all views are composed via functional builders.

### Screen Composition Builder (`buildScreen`)

```typescript
export function buildScreen(definition: {
  emoji: string;
  title: string;
  subtitle?: string;
  primary?: { label: string; value: string | number; emoji?: string };
  sections?: Array<{ title: string; emoji?: string; fields: ScreenField[] }>;
  footer?: string;
}): string;
```

- **Header:** Emoji + bold title + optional italic subtitle.
- **Primary Block:** High-contrast focus state (e.g. remaining quota, wallet balance).
- **Section Cards:** Formatted key-value pairs formatted with bullet indicators.
- **RTL Normalization:** Passes text through `ensurePersianLineDirection()` to prevent punctuation flipping on mixed Persian/English lines.

### Safe Markdown Formatting & Entity Protection

Telegram Legacy Markdown (`Markdown`) requires strict escaping of untrusted parameters:

- `escapeTelegramMarkdown(value)`: Escapes special characters (`_`, `*`, `[`, `` ` ``, `\`) for user input, usernames, and dynamic values.
- `sanitizeTelegramInlineCode(value)`: Strips stray backticks inside code spans to prevent broken formatting.
- `validateTelegramMarkdown(text)`: Validates balanced delimiters before saving admin-customized templates in database settings.
- `safeFormattingTransformer()`: A resilient API transformer that intercepts Telegram `can't parse entities` errors and retries the dispatch as plain text, ensuring the user is never left with an unrendered screen.

---

## 5. Callback Routing & 64-Byte Limit (`callbackData.ts`)

Telegram restricts inline button `callback_data` to **strictly 64 UTF-8 bytes**. Exceeding this causes API exceptions.

```typescript
export function callbackData(...parts: Array<string | number>): string {
  const value = parts.join(':');
  if (Buffer.byteLength(value, 'utf8') > 64) {
    throw new Error('TELEGRAM_CALLBACK_DATA_TOO_LONG');
  }
  return value;
}
```

### Callback Encoding Conventions

- **Navigation:** `nav:home`, `nav:main`, `nav:admin`
- **Checkout Confirmation:** `buy:confirm:<checkoutId>` (using a 12-char nanoid from `PurchaseCheckoutService`)
- **Config Management:** `config:view:<id>`, `config:qr:<id>`, `config:toggle:<id>`, `config:revoke:<id>`
- **Renewal Package:** `r:p:<configId>:<pkgIdx>:<catalogHash>`
- **Admin Settings:** `set:edit:<key>`, `pkg:edit:<pkgId>`, `cat:view:<catId>`
- **Dismissible Popovers:** `ui:dismiss` (destroys the active popover card without sweeping parent screen state)
- **Catch-All Handler:** A wild-card callback listener acknowledges any stale or unhandled callback queries with `ctx.answerCallbackQuery()` to prevent endless client loading spinners.

---

## 6. Conversations Engine & Admin Settings Center

Conversations represent multi-step interactive workflows powered by `@grammyjs/conversations`.

### Registered Conversations

```text
src/telegram/conversations/
├── userConversations.ts
│   ├── buyConfigConversation           (Package purchase & checkout saga)
│   ├── customAmountConversation        (Custom volume & duration quote)
│   ├── renewConfigConversation         (Package-based subscription renewal)
│   ├── autoRenewCustomConversation     (Auto-renewal setup & package binding)
│   ├── promoConversation               (Promo code application)
│   ├── transferConfigConversation      (Transfer config ownership to another user)
│   ├── transferBalanceConversation     (Peer-to-peer wallet balance transfer)
│   └── topupConversation               (Card payment receipt photo upload)
│
└── adminConversations/
    ├── settings/                       (Modular Admin Settings Center)
    │   ├── catalog.ts                  (23+ Typed setting definitions & groups)
    │   ├── validation.ts               (Type guards, bounds checking, regexes)
    │   ├── presentation.ts             (Settings screen & item formatters)
    │   ├── navigation.ts               (Settings hierarchy & breadcrumbs)
    │   ├── packageManager.ts           (Full CRUD for packages & panel bindings)
    │   ├── customVolume.ts             (Custom volume price & default days editor)
    │   ├── luckyWheel.ts               (Lucky wheel reward tiers & daily spin odds)
    │   ├── payment.ts                  (Card number, holder, and transfer rules)
    │   ├── referral.ts                 (Referral bonus & cashback percentages)
    │   ├── backup.ts                   (Automated backup intervals & delivery)
    │   └── conversation.ts             (Settings conversation orchestrator)
    ├── texts.ts                        (Customizable bot messages & localization overrides)
    ├── wallet.ts                       (Manual balance adjustments & audit logs)
    ├── promos.ts                       (Promo code creation, search & editing)
    ├── messaging.ts                    (Segmented broadcasts & direct user DMs)
    └── panels.ts                       (Interactive panel registry setup)
```

### The Zero-Secret Replay Principle

> [!CAUTION]
> Sensitive credentials (e.g. Rebecca panel API keys and admin passwords) **must never enter conversation replay state**.

Because `@grammyjs/conversations` records message histories into session storage to handle step replays, storing secrets inside conversation state would persist unencrypted credentials into session rows.

To prevent this:

1. Panel API keys and passwords are collected via a dedicated one-shot `bot.on('message:text')` route in `src/telegram/features/admin/panelRoutes.ts`.
2. The incoming message is immediately encrypted at rest using AES-256-GCM (`CredentialCipher`).
3. The user's Telegram message containing the plain text key is instantly deleted via `ctx.deleteMessage()`.

---

## 7. Bilingual Localization Pipeline (`locale.ts`)

RebeccaSellBot supports full internationalization in **Persian (fa)** and **English (en)**:

1. **Auto-Detection & Persistence:** Newly observed Telegram users have their client language code detected and saved. If the user explicitly selects a language from `/lang`, `localeManual` is set to `true`, preventing automatic client overrides.
2. **Context Resolution (`resolveContextLocale`):** Middlewares and background jobs resolve the effective locale from user records, conversation contexts, or the global default setting.
3. **Template Translation (`t` and `tm`):**
   - `t(ctx, 'key', params)`: Translates a catalog key with automatic parameter substitution and Markdown escaping.
   - `tm(ctx, 'template_key', params)`: Injects localized dynamic values into administrator-editable long-form templates.
4. **Number & Date Formatting:**
   - `localizedNumber(num, ctx)`: Formats numbers with Persian numerals in `fa` and standard digits in `en`.
   - `localizedDate(timestamp, ctx)`: Renders dates using the appropriate calendar representation.

---

## 8. Anti-Abuse, Concurrency & Security Controls

- **Action Cooldowns (`actionCooldown.ts`):** In-memory per-user sliding window locks prevent duplicate rapid button taps on financial and remote mutating actions (e.g. buying a config, claiming a trial, revoking).
- **WeakMap Ban Status Cache:** Prevents duplicate database queries for banned users during rapid update batches.
- **Purchase Checkouts Guard:** Checkouts snapshot packages and prices with expiration timestamps (`PurchaseCheckoutService`), preventing Time-of-Check to Time-of-Use (TOCTOU) exploits if an admin changes package prices while a user is on the checkout screen.
- **Private Chat Gate:** Financial and management features are strictly blocked in group chats to protect sensitive user subscriptions and balance details.
