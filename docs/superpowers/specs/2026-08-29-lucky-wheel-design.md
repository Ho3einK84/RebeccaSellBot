# Specification: Lucky Wheel (گردونه شانس) Subsystem & Referral Copy Polish

**Date:** 2026-08-29  
**Status:** Approved  
**Author:** Antigravity

---

## 1. Executive Summary

This specification introduces a complete **Lucky Wheel (گردونه شانس)** subsystem to RebeccaSellBot to boost user engagement, retention, and wallet gamification. It also polishes the referral dashboard copy to clearly distinguish between **Referral Bonus** (paid to referrer on first invited purchase) and **User Cashback** (refunded to buyer on every purchase).

---

## 2. Core Objectives & Requirements

1. **Referral Copy Polish (حالت اول):**
   - Update `menu_referral` and translation catalogs so that:
     - `referral_reward_label` represents `پاداش دعوت (پس از اولین خرید دوستتان)`.
     - `referral_cashback_label` represents `کش‌بک خرید (بازگشت ۵٪ از مبلغ هر خرید به کیف پول خودتان)`.
2. **Lucky Wheel Core Subsystem:**
   - **Admin Configurability:**
     - Toggle module on/off (`lucky_wheel_enabled`).
     - Dynamic prize bounds (`lucky_wheel_min_amount`, `lucky_wheel_max_amount`).
     - Base luck percentage (`lucky_wheel_base_luck_percent`, 1-100%).
     - Luck decay rate per spin (`lucky_wheel_decay_percent`, 0-100%).
     - Cooldown period in hours (`lucky_wheel_cooldown_hours`, e.g. 24h).
     - Lifetime spin cap per user (`lucky_wheel_max_spins`, e.g. 5 spins).
   - **Mathematical Diminishing Luck Model:**
     - $\text{EffectiveLuck} = \max(5\%, \text{BaseLuck} - (\text{UserSpinCount} \times \text{DecayPercent}))$
     - $\text{Prize} = \text{Min} + \left\lfloor (\text{Max} - \text{Min}) \times \text{Random}^{(100 / \text{EffectiveLuck})} \right\rfloor$
   - **Financial Ledger & Anti-Fraud Safety:**
     - Atomic DB transaction locking user row before spinning.
     - New `lucky_wheel_spins` audit table.
     - Integration with `wallet_transactions` table (`type: 'lucky_wheel'`) with deterministic idempotency reference `spin_<spinId>`.
   - **Telegram UX & Animated Interaction:**
     - Dedicated button `🎡 گردونه شانس` in the Main Menu (`mainMenu`).
     - Detailed status card with spin counter, cooldown countdown, and reward info.
     - Frame-by-frame animation feedback during spinning (`🎡 🌀 ✨ 🎁 💰 ...`) with sound/haptic feel.
     - Congratulatory winner card with direct wallet credit.

---

## 3. Architecture & Data Model

### 3.1 Database Schema (`src/infra/schema.ts` & Drizzle Migration)

```typescript
export const luckyWheelSpins = pgTable(
  'lucky_wheel_spins',
  {
    id: text('id').primaryKey(),
    telegramId: bigint('telegram_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramId, { onDelete: 'cascade' }),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    effectiveLuckPercent: integer('effective_luck_percent').notNull(),
    spinNumber: integer('spin_number').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('lucky_wheel_spins_telegram_id_idx').on(table.telegramId),
    index('lucky_wheel_spins_created_at_idx').on(table.createdAt),
    check('lucky_wheel_spins_amount_safe', sql`${table.amount} >= 0`),
  ]
);
```

### 3.2 Domain Service (`src/domain/services/LuckyWheelService.ts`)

```typescript
export interface LuckyWheelStatus {
  enabled: boolean;
  canSpin: boolean;
  reason?: 'disabled' | 'max_spins_reached' | 'cooldown_active';
  nextSpinAt?: Date;
  secondsRemaining?: number;
  totalSpins: number;
  maxSpins: number;
  minPrize: number;
  maxPrize: number;
  currentEffectiveLuck: number;
}

export interface LuckyWheelSpinResult {
  success: boolean;
  amount: number;
  balanceAfter: number;
  spinNumber: number;
  spinsRemaining: number;
  nextSpinAt?: Date;
}
```

### 3.3 Admin Settings Integration

Settings managed in `TranslationService` settings store:

- `lucky_wheel_enabled` (default: `'true'`)
- `lucky_wheel_min_amount` (default: `'1000'`)
- `lucky_wheel_max_amount` (default: `'50000'`)
- `lucky_wheel_base_luck_percent` (default: `'50'`)
- `lucky_wheel_decay_percent` (default: `'10'`)
- `lucky_wheel_cooldown_hours` (default: `'24'`)
- `lucky_wheel_max_spins` (default: `'5'`)

Accessible via Admin Menu -> Settings -> `🎡 تنظیمات گردونه شانس`.

---

## 4. Testing Strategy

1. **Domain Unit Tests (`tests/domain/LuckyWheelService.test.ts`):**
   - Verify diminishing returns math and bounds enforcement.
   - Verify cooldown enforcement and lifetime limits.
   - Verify atomic wallet crediting and transaction audit recording.
2. **UI & Interaction Tests (`tests/telegram/luckyWheelUi.test.ts`):**
   - Verify main menu button navigation.
   - Verify status screen rendering with countdown and remaining spins.
   - Verify spin animation and error handling when disabled or on cooldown.
3. **Integration Verification:**
   - Run full verification suite `npm run verify` (`architecture:check`, `typecheck`, `lint`, `format:check`, `vitest`, `build`).
