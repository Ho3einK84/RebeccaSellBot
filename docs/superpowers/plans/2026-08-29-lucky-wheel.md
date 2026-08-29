# Lucky Wheel (گردونه شانس) Subsystem & Referral Copy Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete gamified Lucky Wheel subsystem with diminishing returns luck algorithms, admin configuration, ledger integration, and animated Telegram UI, while polishing the referral & cashback copy.

**Architecture:** A robust domain service (`LuckyWheelService`) backed by an audit table (`lucky_wheel_spins`) and financial transactions ledger (`wallet_transactions`), controlled by admin settings and surfaced via an interactive Telegram menu with suspenseful animation.

**Tech Stack:** TypeScript, Node.js, grammY, Drizzle ORM, PostgreSQL, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-lucky-wheel-design.md`

## Global Constraints

- Integer minor-units (Toman) for all financial quantities.
- Concurrency-safe transactional row locking (`for('update')`) during wallet operations.
- RTL Arabic/Persian stability and full 1:1 translation catalog parity between `TranslationCatalog.fa.ts` and `TranslationCatalog.en.ts`.
- 100% test pass rate with zero type or lint errors before deployment.

---

### Task 1: Referral & Cashback Copy Polish (حالت اول)

**Files:**

- Modify: `src/domain/services/TranslationCatalog.fa.ts`
- Modify: `src/domain/services/TranslationCatalog.en.ts`
- Test: `tests/domain/TranslationCatalog.test.ts`

- [ ] **Step 1: Update Persian and English translation catalogs for referral and cashback labels**
- [ ] **Step 2: Run catalog test to verify 100% parity and formatting**

```bash
npx vitest run tests/domain/TranslationCatalog.test.ts
```

---

### Task 2: Database Schema & Migration for Lucky Wheel

**Files:**

- Modify: `src/infra/schema.ts`
- Create: `drizzle/0006_add_lucky_wheel.sql`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Add `luckyWheelSpins` table to `src/infra/schema.ts` and update `walletTransactions` type enum**
- [ ] **Step 2: Create migration SQL `0006_add_lucky_wheel.sql` and update journal**
- [ ] **Step 3: Run migration tests to ensure schema validity**

```bash
npx vitest run tests/infra/migrate.test.ts
```

---

### Task 3: Domain Service `LuckyWheelService`

**Files:**

- Create: `src/domain/services/LuckyWheelService.ts`
- Create: `tests/domain/LuckyWheelService.test.ts`

- [ ] **Step 1: Write failing tests for mathematical luck curve, diminishing decay, cooldown, and wallet crediting**
- [ ] **Step 2: Implement `LuckyWheelService` with `getStatus` and `spin` methods**
- [ ] **Step 3: Run domain tests and ensure all pass**

```bash
npx vitest run tests/domain/LuckyWheelService.test.ts
```

---

### Task 4: Admin Settings for Lucky Wheel

**Files:**

- Create: `src/telegram/conversations/adminConversations/settings/luckyWheel.ts`
- Modify: `src/telegram/conversations/adminConversations/settings/catalog.ts`
- Modify: `src/telegram/conversations/adminConversations/settings.ts`
- Modify: `src/domain/services/TranslationCatalog.ts`
- Modify: `src/domain/services/TranslationCatalog.fa.ts`
- Modify: `src/domain/services/TranslationCatalog.en.ts`

- [ ] **Step 1: Add setting defaults, keys, and validations for lucky wheel**
- [ ] **Step 2: Create `adminLuckyWheelSettingsConversation` screen and keyboard**
- [ ] **Step 3: Hook settings into the Admin settings menu**
- [ ] **Step 4: Run admin settings tests**

```bash
npx vitest run tests/telegram/adminSettingsConversation.test.ts
```

---

### Task 5: Lucky Wheel User Interface & Animation in Telegram

**Files:**

- Modify: `src/telegram/keyboards/mainMenu.ts`
- Create: `src/telegram/features/luckyWheelRoutes.ts`
- Modify: `src/telegram/features/coreRoutes.ts`
- Create: `tests/telegram/luckyWheelUi.test.ts`

- [ ] **Step 1: Add `🎡 گردونه شانس` button in `mainMenu`**
- [ ] **Step 2: Create status card renderer and animated suspense sequence in `luckyWheelRoutes.ts`**
- [ ] **Step 3: Register routes in `coreRoutes.ts`**
- [ ] **Step 4: Add and run UI unit tests**

```bash
npx vitest run tests/telegram/luckyWheelUi.test.ts
```

---

### Task 6: Wire Services in Runtime & Full Verification

**Files:**

- Modify: `src/telegram/types.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add `luckyWheelService: LuckyWheelService` to `BotServices` in `src/telegram/types.ts`**
- [ ] **Step 2: Instantiate `luckyWheelService` in `src/index.ts`**
- [ ] **Step 3: Run full verification pipeline**

```bash
npm run verify
```

---

### Task 7: Git Commit, Push & Remote Deployment

- [ ] **Step 1: Commit and push changes to GitHub `origin/main`**
- [ ] **Step 2: Run remote deploy command on `root@91.107.154.218`**
- [ ] **Step 3: Verify container health and log output on production host**
