# Phase 0 — Full-project audit

Audit date: 2026-08-11  
Scope: all application source, all tests, Drizzle migrations, deployment tooling, and the release gate.

## Method and baseline

The audit covered every TypeScript file under `src/` and `tests/`, all eight additive Drizzle migrations, `install.sh`, `scripts/rsbot`, Docker assets, runtime configuration, and the required project documentation.

Baseline results before any code changes:

| Check                        | Result                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run architecture:check` | Pass                                                                                                                                             |
| `npm run typecheck`          | Pass                                                                                                                                             |
| `npm run lint`               | Pass                                                                                                                                             |
| `npm test`                   | Pass — 42 files, 231 tests                                                                                                                       |
| `npm run build`              | Pass                                                                                                                                             |
| `npm run verify`             | Blocked only by Prettier: 144 tracked files differ from the configured formatter output                                                          |
| `npm run test:integration`   | Not runnable here: `TEST_DATABASE_URL` is unset and Docker is unavailable                                                                        |
| `npm audit --omit=dev`       | No production dependency vulnerabilities                                                                                                         |
| `npm audit`                  | Two high-severity development-only transitive findings: `brace-expansion@5.0.8` via ESLint/minimatch and `nanoid@3.3.16` via Vitest/Vite/PostCSS |

The worktree was clean before this report. No application behavior was changed during Phase 0.

## Invariants verified

- Telegram delivery code has no direct import of Drizzle, the database schema, or `RebeccaApiClient`; the architecture check passes.
- Monetary values are validated as safe integers at service boundaries and the purchase saga uses reserve → remote mutation → commit/release/reconcile semantics.
- Purchase, renewal, referral/promo settlement, and refund flows have substantial happy-path and partial-failure coverage.
- Migration history is additive; no existing migration was modified.
- Secrets are not hard-coded. Panel credentials are encrypted at rest and deployment configuration documents the required secret.
- Persian and English catalogues have 590 matching keys each, with no missing key or placeholder-set mismatch.

The confirmation invariant is **not** currently intact; the confirmed exceptions are listed below.

## Confirmed defects

### P0/P1 — safety and callback contract

1. **Receipt approval/rejection is executed by the first tap.**
   `receipt:approve_prompt:*` and `receipt:reject_prompt:*` are the buttons rendered for pending receipts, but their handler calls `approveTopup` / `rejectTopup` immediately. A separate `_confirm` handler exists but is bypassed. This credits or rejects a customer payment without confirmation.

2. **Admin quick top-up buttons change balances on one tap.**
   `admin:user:quick_topup:<telegramId>:<amount>` directly calls `adjustBalanceAdmin`; it has no consequence screen or confirm callback.

3. **Several legal panel IDs generate callback data longer than Telegram's 64-byte limit.**
   Panel IDs permit 40 characters. At that valid length, the following current callbacks are 67–79 bytes: panel edit with `add_service`, panel delete confirmation, and all service default/custom/delete actions. Telegram will reject those buttons at send time.

4. **Other destructive/financial actions also lack a confirmation step.**
   The audit found immediate execution for panel-service deletion, package deletion in the settings conversation, and the compatibility `config_revoke:<username>` path. Enabling auto-renew also immediately grants future charging authority after a package selection. Text-override reset removes an override on a single tap. These flows need explicit, consequence-specific confirmation or safe conversion of legacy callbacks into confirmation screens.

### P1/P2 — correctness and release readiness

5. **New bindings do not immediately maintain lifecycle cache/aggregate state.**
   Normal purchase, subscription-link claim, and trial finalization insert `user_configs` without the already-known remote lifecycle fields and do not refresh `users.active_subscription_count`. The scheduled reconciliation sweep eventually repairs the cache, but an admin profile can show an incorrect active-service total immediately after one of these successful flows. Reconciled purchase recovery has the same aggregate gap.

6. **The release gate is red solely because repository formatting is stale.**
   All behavior checks pass, but `npm run verify` cannot pass until the tracked files match the committed Prettier configuration. This must be corrected without weakening the check.

### Architecture, maintainability, and auditability

7. **The design-system implementation is largely dead code.**
   `buildStatusBadge`, `buildSectionCard`, and `buildConfirmationKeyboard` have no production call sites. `buildStatusBadge` also defaults to Persian labels, so it is unsafe for English output if adopted unchanged.

8. **There is a leaky but not currently violating panel boundary.**
   Some Telegram routes obtain `RebeccaService` through `panelRegistry.getService(...).getUser(...)`. This does not import or call the raw REST client and therefore satisfies the enforced invariant, but it leaves presentation code responsible for remote lookup details. A domain-level presentation/read facade would make the boundary clearer.

9. **Some destructive/admin actions have no corresponding visible audit event.**
   Wallet changes, receipt decisions, bans, transfers, refunds, broadcasts, and reconciliation actions are audited. Direct configuration deletion/revocation and panel/promo/package administration do not consistently create audit-log entries. This weakens the promised operator audit trail.

10. **Dead legacy code remains.**
    `adminManagePromoConversation` is exported but never registered or referenced. Its delete branch is another one-step destructive path, although it is unreachable in the running bot.

### UI, localization, and clean-chat findings

11. **Bilingual catalogue structure is sound, but delivery-layer copy is not.**
    Customer dashboards, wallet/top-up cards, compact subscription cards, receipt caption updates, and status defaults contain hard-coded Persian or English fragments. English users can therefore receive Persian currency/card labels, Persian receipt outcomes, or English custom-package names.

12. **RTL helpers are not applied as a system.**
    `t`/`tm` correctly apply Persian line direction, but `formatRtlLabeledValue` is unused and direct string assembly bypasses the translation path. Mixed-direction identifiers, URLs, and user names need deliberate treatment on each screen.

13. **The intended app-like navigation is inconsistent.**
    The cleanup middleware and message tracker are sound in their basic model, but many navigation paths still send a new screen where an edit-in-place is practical. Multi-card subscription, receipt, orphan, and admin user views need a screen-by-screen decision and artifact marking review.

14. **Loading/empty/error treatment is uneven.**
    Financial issuance and QR generation provide feedback, while several panel reads, list views, and admin management actions either have no immediate progress state or render a bare/technical fallback. The final UI pass must give each network-bound action a calm state transition and each list an intentional empty state.

## Screen and message inventory

The following inventory is the Phase 3 coverage checklist. Each item includes its empty/loading/error/confirmation variants where applicable.

### Customer flow

- `/start` onboarding/home dashboard; main menu; global failure, stale-button, private-chat-only, and cancel states.
- Shop: package list, promo-active state, package quote, insufficient-balance/top-up CTA, custom-volume prompt/validation/quote, issuance progress, success, and failure.
- Wallet: dashboard, pending-receipt state, preset/custom amount selection, payment-card instructions, receipt-photo prompt, receipt confirmation, submission success/failure, and receipt approval/rejection notification.
- Promotions: code-entry prompt; gift-credit result; purchase-promo selection, expiration, invalid, and cleared states.
- Trial: trial preview, claim progress, success with subscription link, disabled/already-used/error states.
- Subscriptions: empty state, paginated compact cards, completion/navigation message, detail card, refresh, QR generation/delivery/failure, enable/disable, link-revocation confirmation/result, delete/refund quote/confirmation/result, transfer target/confirmation/result, and auto-renew selection/setting states.
- Referral, language picker/change confirmation, support, pasted-link claim outcomes, and subscription delivery artifacts.

### Admin flow

- `/admin`, grouped admin menus, system statistics, panel/database health indicators.
- Receipt queue: empty, paginated photo cards, approve/reject confirmation/result, batch confirmation/result, and recipient notification.
- Users: paginated list, search, profile, wallet adjustment, quick-credit action, ban/unban confirmation, subscriptions, audit trail, and direct-message confirmation/result.
- Broadcast: audience selection, empty audience, composition, preview/confirmation, queued status, refresh, cancellation, and delivery result.
- Promo centre: empty/list/pagination/search, detail, create/edit field prompts, save summary, activation toggle, and deletion confirmation.
- Panels: registry, empty registry, panel detail, connection test, enable/default/edit/API-key input, service add/default/custom-target/delete, panel deletion confirmation, and error states.
- Reconciliation/orphans: empty/list/pagination, scan result, baseline confirmation, assignment, local-record removal confirmation, and ignore state.
- Administrator registry: list, add, remove confirmation, and last-admin protection.
- Settings: group selection, individual setting prompts, boolean/naming controls, package manager and package fields.
- Translation editor: language, category, key search/pagination, current/default value, edit, and reset confirmation.

### Background-delivered messages

- Rebecca panel outage alert to administrators.
- Receipt decision, transfer recipient, direct admin message, and broadcast delivery.
- Low-traffic/near-expiry renewal warning.
- Auto-renewal success, insufficient-balance, and removed-package notices.

## Test gaps to close

- Regression tests for every confirmation defect, including that the initial receipt action cannot mutate state.
- Boundary tests for maximum-length panel IDs and every generated panel callback.
- Transaction-level tests that new purchase, claim, trial, and recovered purchase bindings store lifecycle state and update the aggregate immediately.
- Tests for legacy callback conversion to confirmation views.
- Exact-render tests in both locales for the redesigned dashboard, wallet/top-up card, subscription card/detail, receipt outcome, and one representative admin screen.
- A real PostgreSQL integration run once a local `TEST_DATABASE_URL` is provided; the existing integration suite is correctly conditional but was skipped in this environment.

## Product decisions to retain explicitly

- Pricing, refund-window, cashback, referral-bonus, and package changes affect real commercial terms. The implementation should improve confirmation/auditability and validation, but should not silently change their business rules.
- The panel registry currently permits an operator to disable or delete the last usable panel when another disabled row exists. Preventing that may block intentional maintenance, while allowing it can halt sales. This should be surfaced as an operator decision/warning rather than changed silently.
- The two advisory findings are development-only and production dependencies audit clean. Updating their direct toolchain parents is appropriate in Phase 5, but no blind `npm audit fix --force` should be used.

## Phase 1 implementation queue

1. Repair all missing confirmation paths and add focused regression tests.
2. Replace overlong panel callback shapes with compact, validated namespaces and tests.
3. Make successful bindings update lifecycle cache and active-service aggregates atomically where remote state is already known; cover normal and reconciled paths.
4. Apply the configured formatter, then run the complete release gate without weakening it.
