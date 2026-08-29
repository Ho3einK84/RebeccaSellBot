# RebeccaSellBot UI/UX Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement urgent and important UI/UX improvements across RebeccaSellBot (visual progress bars, dynamic top-up presets, in-checkout promo management, wallet transaction history, referral statistics, and dashboard polish) while keeping subscription URLs as standard clickable web links.

**Architecture:**

- Visual components: Add `renderProgressBar` to `designSystem.ts` and integrate it into subscription cards and home dashboard notices.
- Domain services: Extend `WalletService` with paginated user transaction querying (`listTransactionsForUser`) and `ReferralService` with user referral analytics (`getReferralStats`).
- Telegram UI layer: Add wallet statement view/keyboard, in-checkout promo manipulation actions, dynamic top-up presets in `topupConversation`, and synchronized bilingual catalogs (`TranslationCatalog.fa.ts` & `TranslationCatalog.en.ts`).

**Tech Stack:** TypeScript, Node.js (v24), grammY, Drizzle ORM, PostgreSQL, Vitest.

**Spec:** User request specifying urgent & important UI/UX items, retaining web subscription links, excluding app deep-links and config renaming.

## Global Constraints

- Preserve standard spaces over ZWNJ in Persian texts ("بسته ها", "سرویس ها").
- RTL stability: No visible Persian line should start with raw English text or machine IDs without a leading emoji or Persian label.
- Machine IDs and codes must remain raw code spans (`\`${id}\``); localize only human numbers and quantities.
- Translation Catalog Parity: Every translation key in `TranslationCatalog.fa.ts` must have a synchronized match in `TranslationCatalog.en.ts`.
- Subscription URLs MUST remain standard Markdown HTTPS links `[url](url)` (NOT inline code), as confirmed by user.
- All tasks must pass `npm run verify` (`architecture:check`, `typecheck`, `lint`, `format:check`, `vitest`, `build`).

---

### Task 1: Visual Progress Bars & Home Dashboard Polish

**Files:**

- Modify: `src/telegram/designSystem.ts`
- Modify: `src/telegram/keyboards/homeDashboard.ts`
- Modify: `src/telegram/features/subscriptions/routes.ts`
- Test: `tests/telegram/uiDesignSystem.test.ts`
- Test: `tests/telegram/homeDashboard.test.ts`

**Interfaces:**

- Produces: `renderProgressBar(used: number, total: number, options?: { barLength?: number; theme?: 'traffic' | 'time' }): string`

- [ ] **Step 1: Write unit tests for `renderProgressBar`**

Add tests in `tests/telegram/uiDesignSystem.test.ts` for 0%, 50%, 100%, and overflow cases.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/telegram/uiDesignSystem.test.ts`
Expected: FAIL (renderProgressBar not defined).

- [ ] **Step 3: Implement `renderProgressBar` in `src/telegram/designSystem.ts`**

Add helper:

```typescript
export function renderProgressBar(
  used: number,
  total: number,
  options: { barLength?: number; theme?: 'traffic' | 'time' } = {}
): string {
  const { barLength = 8, theme = 'traffic' } = options;
  if (!Number.isFinite(total) || total <= 0) return '';
  const ratio = Math.max(0, Math.min(1, used / total));
  const percent = Math.round(ratio * 100);
  const filledCount = Math.round(ratio * barLength);
  const emptyCount = barLength - filledCount;
  const fillIcon = theme === 'time' ? '🟪' : percent > 85 ? '🟥' : percent > 60 ? '🟨' : '🟩';
  const emptyIcon = '⬜️';
  return `[${fillIcon.repeat(filledCount)}${emptyIcon.repeat(emptyCount)}] ${percent}%`;
}
```

- [ ] **Step 4: Update `homeDashboard.ts` to handle expired services and multi-expiring warnings**

In `src/telegram/keyboards/homeDashboard.ts`:

- If `activeCount === 0` but `configs.length > 0`, show `home_has_expired_services_hint` instead of `home_no_active_services_hint`.
- If multiple configs are near expiry, summarize the count or list up to 2 items.

- [ ] **Step 5: Integrate progress bars into `buildSubscriptionCard` in `src/telegram/features/subscriptions/routes.ts`**

In `buildSubscriptionSnapshot` and `buildSubscriptionCard`:

- When total bytes and remaining bytes are known, compute used bytes and render traffic progress bar.
- When total duration days and remaining days are known, compute elapsed days and render time progress bar.

- [ ] **Step 6: Run tests and verify they pass**

Run: `npx vitest run tests/telegram/uiDesignSystem.test.ts tests/telegram/homeDashboard.test.ts`
Expected: PASS.

---

### Task 2: Action Keyboards Icon Polish & Subscription Links Integrity

**Files:**

- Modify: `src/telegram/features/subscriptions/routes.ts`
- Modify: `src/domain/services/TranslationCatalog.fa.ts`
- Modify: `src/domain/services/TranslationCatalog.en.ts`
- Test: `tests/telegram/subscriptionActions.test.ts`

**Interfaces:**

- Consumes: `buildSubscriptionActionKeyboard`
- Produces: Polished keyboard with distinct emojis for refresh (`⚡`) vs renew (`🔄`) and validated HTTPS Markdown subscription links.

- [ ] **Step 1: Write test verifying distinct action buttons and standard HTTPS link formatting**

Add tests in `tests/telegram/subscriptionActions.test.ts` asserting button text distinctions and link rendering.

- [ ] **Step 2: Update `buildSubscriptionActionKeyboard` and translation keys**

Update:

- `subscription_refresh_button`: `⚡ بروزرسانی وضعیت` / `⚡ Refresh Status`
- `renewal_button`: `🔄 تمدید سرویس` / `🔄 Renew Service`
- Verify subscription URL output retains `formatSubscriptionLink` Markdown link format `[🔗 لینک اشتراک](url)`.

- [ ] **Step 3: Run test and verify it passes**

Run: `npx vitest run tests/telegram/subscriptionActions.test.ts`
Expected: PASS.

---

### Task 3: Dynamic Top-up Presets & Card Number Formatting

**Files:**

- Modify: `src/telegram/conversations/adminConversations/wallet.ts`
- Modify: `src/domain/services/TranslationCatalog.fa.ts`
- Modify: `src/domain/services/TranslationCatalog.en.ts`
- Test: `tests/telegram/topupConversation.test.ts`

**Interfaces:**

- Consumes: `topup_min_amount`, `topup_max_amount`, `card_number`, `card_holder`
- Produces: Dynamic preset keyboard scaling from `min` to `max` without hardcoded invalid buttons, formatted 4x4 card number with clear label.

- [ ] **Step 1: Write unit tests for dynamic preset generation**

Write tests covering minimum 10,000, 50,000, and 100,000 thresholds ensuring generated buttons always fall within `[min, max]`.

- [ ] **Step 2: Implement dynamic preset generator in `wallet.ts`**

Generate 4 logical ascending presets based on `minimum` and `maximum` settings:

```typescript
function buildTopupPresets(min: number, max: number): number[] {
  const base = Math.max(10_000, min);
  const presets = [base, base * 2, base * 5, base * 10].filter((v) => v >= min && v <= max);
  return presets.length > 0 ? presets : [min];
}
```

Format card number with clean 4-digit groups (e.g. `6037 9918 1234 5678`) in code block.

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run tests/telegram/topupConversation.test.ts`
Expected: PASS.

---

### Task 4: In-Checkout Promo Code Management & Flow Restoration

**Files:**

- Modify: `src/telegram/keyboards/mainMenu.ts`
- Modify: `src/telegram/features/subscriptions/routes.ts`
- Modify: `src/telegram/conversations/userConversations.ts`
- Modify: `src/telegram/promoSelection.ts`
- Test: `tests/telegram/checkoutPromoFlow.test.ts`

**Interfaces:**

- Consumes: `PurchaseCheckout`, `getPendingPromoPricing`, `clearPendingPromo`
- Produces: Checkout screens with interactive `[ 🎟️ وارد کردن کد تخفیف ]` / `[ ✖️ حذف کد تخفیف ]` buttons and seamless return to the pending checkout review screen.

- [ ] **Step 1: Write test for checkout promo application and cancellation**

Write test verifying that clicking promo button on checkout screen triggers `promoConversation` and redirects back to the checkout review screen.

- [ ] **Step 2: Add promo buttons to `buildPurchaseCheckoutScreen` and `buildRenewalCheckoutScreen`**

In `mainMenu.ts` and `subscriptions/routes.ts`:

- Include `[ 🎟️ کد تخفیف ]` or `[ ✖️ حذف کد تخفیف ]` row in the confirmation keyboard before the primary confirm button.
- Add handler `checkout:promo:<checkoutId>` and `checkout:clear_promo:<checkoutId>`.

- [ ] **Step 3: Update `promoConversation` in `userConversations.ts`**

Support `ctx.session.promoReturnDestination = 'checkout'` so that entering a valid code re-renders the active checkout screen with the newly discounted price quote.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/telegram/checkoutPromoFlow.test.ts`
Expected: PASS.

---

### Task 5: Wallet Transaction History / Statement

**Files:**

- Modify: `src/domain/services/WalletService.ts`
- Modify: `src/telegram/keyboards/mainMenu.ts`
- Modify: `src/telegram/features/baseRoutes.ts`
- Modify: `src/domain/services/TranslationCatalog.fa.ts`
- Modify: `src/domain/services/TranslationCatalog.en.ts`
- Test: `tests/domain/WalletStatement.test.ts`
- Test: `tests/telegram/walletStatementUi.test.ts`

**Interfaces:**

- Produces: `WalletService.listTransactionsForUser(telegramId: number, page?: number, pageSize?: number)`
- Produces: Telegram route `wallet:history:page:<n>` with paginated transaction cards.

- [ ] **Step 1: Write unit tests for `WalletService.listTransactionsForUser`**

Write test verifying paginated transaction queries, order by `created_at DESC`, and correct total count.

- [ ] **Step 2: Implement `listTransactionsForUser` in `WalletService.ts`**

```typescript
async listTransactionsForUser(
  telegramId: number,
  page = 1,
  pageSize = 5
): Promise<{ transactions: WalletTransactionRecord[]; total: number; totalPages: number; page: number }> {
  const offset = (page - 1) * pageSize;
  const [countRes] = await getDb()
    .select({ count: sql<number>`count(*)` })
    .from(walletTransactions)
    .where(eq(walletTransactions.telegramId, telegramId));
  const total = Number(countRes?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const rows = await getDb()
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.telegramId, telegramId))
    .orderBy(desc(walletTransactions.createdAt))
    .limit(pageSize)
    .offset((safePage - 1) * pageSize);
  return { transactions: rows, total, totalPages, page: safePage };
}
```

- [ ] **Step 3: Add `[ 📜 سوابق تراکنش‌ها ]` button in `walletMenu` (`mainMenu.ts`) and route handler in `baseRoutes.ts`**

Render a clean statement screen showing:

- Transaction type badge (➕ شارژ، ➖ خرید، 🎁 پاداش دعوت، 💸 کش‌بک، ↩️ بازگشت وجه، 👥 انتقال)
- Formatted amount with `+` or `-` and localized Toman currency.
- Persian/English localized date and time.
- Balance after transaction.
- Pagination controls.

- [ ] **Step 4: Run tests and verify they pass**

Run: `npx vitest run tests/domain/WalletStatement.test.ts tests/telegram/walletStatementUi.test.ts`
Expected: PASS.

---

### Task 6: Referral Dashboard & Performance Analytics

**Files:**

- Modify: `src/domain/services/ReferralService.ts`
- Modify: `src/telegram/keyboards/mainMenu.ts`
- Modify: `src/domain/services/TranslationCatalog.fa.ts`
- Modify: `src/domain/services/TranslationCatalog.en.ts`
- Test: `tests/domain/ReferralStats.test.ts`

**Interfaces:**

- Produces: `ReferralService.getReferralStats(telegramId: number)`
- Produces: Referral dashboard screen in `mainMenu.ts` displaying total invited users, active buyers, total referral bonus, and total cashback earned.

- [ ] **Step 1: Write unit tests for `ReferralService.getReferralStats`**

Write test verifying calculation of total invited users, active buyers count, sum of referral bonus transactions, and sum of cashback transactions.

- [ ] **Step 2: Implement `getReferralStats` in `ReferralService.ts`**

```typescript
async getReferralStats(telegramId: number): Promise<{
  totalInvited: number;
  activeBuyers: number;
  totalReferralBonus: number;
  totalCashback: number;
}> {
  const db = getDb();
  const [invitedRes] = await db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(eq(users.referrerId, telegramId));
  const totalInvited = Number(invitedRes?.count ?? 0);

  const [activeBuyersRes] = await db
    .select({ count: sql<number>`count(distinct ${users.telegramId})` })
    .from(users)
    .innerJoin(walletTransactions, eq(users.telegramId, walletTransactions.telegramId))
    .where(and(eq(users.referrerId, telegramId), eq(walletTransactions.type, 'purchase')));
  const activeBuyers = Number(activeBuyersRes?.count ?? 0);

  const [bonusRes] = await db
    .select({ sum: sql<number>`COALESCE(sum(${walletTransactions.amount}), 0)` })
    .from(walletTransactions)
    .where(and(eq(walletTransactions.telegramId, telegramId), eq(walletTransactions.type, 'referral_bonus')));
  const totalReferralBonus = Number(bonusRes?.sum ?? 0);

  const [cashbackRes] = await db
    .select({ sum: sql<number>`COALESCE(sum(${walletTransactions.amount}), 0)` })
    .from(walletTransactions)
    .where(and(eq(walletTransactions.telegramId, telegramId), eq(walletTransactions.type, 'cashback')));
  const totalCashback = Number(cashbackRes?.sum ?? 0);

  return { totalInvited, activeBuyers, totalReferralBonus, totalCashback };
}
```

- [ ] **Step 3: Update `menu_referral` in `mainMenu.ts` to display the analytics section**

Render sections:

- Referral Link
- Reward Terms (Bonus per invite, cashback percent)
- Performance Stats (Total invited, active buyers, total earned)

- [ ] **Step 4: Run tests and verify they pass**

Run: `npx vitest run tests/domain/ReferralStats.test.ts`
Expected: PASS.

---

### Task 7: Translation Catalog Parity & Full Verification

**Files:**

- Modify: `src/domain/services/TranslationCatalog.fa.ts`
- Modify: `src/domain/services/TranslationCatalog.en.ts`
- Test: `tests/domain/TranslationCatalogParity.test.ts`

- [ ] **Step 1: Synchronize all new keys across FA and EN catalogs**

Verify all keys:

- `home_has_expired_services_hint`
- `wallet_history_button`, `wallet_history_title`, `wallet_history_empty`, `wallet_history_page_footer`
- `tx_type_topup`, `tx_type_purchase`, `tx_type_refund`, `tx_type_admin_adjustment`, `tx_type_promo`, `tx_type_referral_bonus`, `tx_type_cashback`, `tx_type_transfer_sent`, `tx_type_transfer_received`
- `referral_stats_section`, `referral_total_invited_label`, `referral_active_buyers_label`, `referral_total_earned_label`
- `checkout_add_promo_button`, `checkout_remove_promo_button`

- [ ] **Step 2: Run catalog parity tests**

Run: `npx vitest run tests/domain/TranslationCatalog.test.ts`
Expected: PASS.

- [ ] **Step 3: Run complete verification pipeline**

Run: `npm run verify`
Expected: PASS (`architecture:check`, `typecheck`, `lint`, `format:check`, `vitest`, `build` all 100% green).
