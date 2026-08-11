# Changelog

All notable changes to RebeccaSellBot are documented here.

## [0.3.0] - 2026-08-11

### Added

- Automated Persian catalog microcopy and ZWNJ standard verification suite (`tests/domain/TranslationCatalog.test.ts`).
- Full bilingual key parity validation across 1,011 catalog entries in Persian and English.

### Fixed

- Sweep and eliminate all defensive string literal fallbacks (`t(ctx, 'key') !== 'key' ? ... : 'literal'`) across `src/telegram/`.
- Correct 79 Persian microcopy instances missing ZWNJ (نیمفاصله `\u200c`) in compound words, plurals, and suffixes (`می‌توانید`, `سرویس‌های`, `اشتراک‌های`, `پنل‌ها`, `گروه‌های`, `پیش‌نمایش`, `امکان‌پذیر`, `بسته‌های`, `حساب‌های`, `یک‌بار`, `معرفی‌شده`).
- Modernize formal verb forms in Persian catalog (replace `میباشد`/`می‌باشد` with `است`, replace `نموده` with direct action verbs).
- Standardize all action button labels across customer and admin views to concise, 2-4 word phrasing.

### Changed

- Hardened 2-step confirmation flows for all financial and destructive actions (receipt decision, balance alteration, user ban/unban, subscription revocation/refund).
- Verified Telegram callback data encoding limits (≤64 bytes) across all dynamic keyboards.

## [0.2.0] - 2026-08-08

### Security

- Preserve wallet reservations when a dispatched Rebecca mutation has an uncertain response instead of treating every origin-down error as definitely unapplied.
- Correlate newly-created Rebecca users to their exact purchase/trial intent with ownership markers before reconciliation binds them to a customer.
- Keep Git credentials and common private-key files out of Docker build contexts and store installer PAT credentials outside the repository.
- Add database status/range checks and JavaScript safe-integer guards for financial aggregates.
- Replace the installer's `curl | sudo sh` Docker bootstrap with Docker's signed official APT repository.

### Fixed

- Restore unlimited renewals with an explicit `data_limit: null` during compensation.
- Keep partially-applied renewals pending when traffic reset succeeded but the subsequent update is unresolved.
- Reject `REBECCA_API_URL` values that already contain a pathname, query, fragment, or credentials.
- Paginate subscription lifecycle synchronization across all local configurations.

### Changed

- Add GitHub Actions CI for `npm run verify`.
- Relax Node/npm engine declarations to compatible major-version ranges while retaining a reproducible package-manager version.
- Remove the obsolete TypeScript-ESLint peer-dependency alias/symlink workaround and `legacy-peer-deps` setting now that the locked packages accept TypeScript 6.

### Maintenance

- Make feature-specific admin routes canonical and remove duplicate receipt/user callback handlers from `bot.ts`; legacy buttons now refresh into the feature routes' confirmation flows.
- Split admin conversations, translation catalogs, and wallet contracts/helpers behind their existing stable entry points without changing service/conversation bodies.
- Add regression coverage proving legacy receipt approval and ban-toggle callbacks require confirmation instead of mutating state immediately.

### Operations

- Migration `0005_data_integrity_hardening.sql` uses `NOT VALID` constraints so existing legacy rows do not block deployment; audit and validate those constraints after cleanup.
- A project `LICENSE` is intentionally not added until the repository owner selects the license.
