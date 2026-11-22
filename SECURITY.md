# Security Policy

## Reporting a Vulnerability

Do not disclose suspected vulnerabilities, credentials, Rebecca subscription URLs, database dumps, or access tokens in public issues. Use **GitHub Private Vulnerability Reporting** for this repository or contact the maintainers through an established private channel with minimal synthetic reproduction steps.

Include the affected commit or version, impact assessment, prerequisites, and reproduction steps with all live tokens and URLs redacted.

---

## Cryptographic & Privacy Safeguards

- **At-Rest Panel Credential Vault (`AES-256-GCM`):** Rebecca panel API keys and admin passwords stored in `rebecca_panels` are encrypted using `CredentialCipher` with random 12-byte IVs and keys derived from `PANEL_CREDENTIALS_KEY`.
- **Zero-Secret Conversation Replay:** Admin panel secrets are captured outside `@grammyjs/conversations` replay state, encrypted immediately, and the plaintext Telegram message is deleted from chat history.
- **Privacy-Preserving Phone Verification (`HMAC-SHA256`):** When phone verification is enabled (`require_phone_for_trial` / `require_phone_for_purchase`), raw phone numbers are never stored or logged; only an `HMAC-SHA256` digest keyed from `BOT_TOKEN` is persisted in `users.phone_hash`. Both Telegram conversations and Mini App `WebApp.requestContact()` verify strict contact ownership (`contact.user_id === ctx.from.id`).
- **Receipt Fraud Fingerprinting & Zero-Disk WebApp Uploads:** Uploaded top-up receipts are fingerprinted via both Telegram `file_unique_id` and content `SHA-256` digests (`topup_receipts.file_sha256`), enabling automatic duplicate detection (`warn` or `block`) and atomic approved-receipt voiding (`topup_void`). WebApp uploads (`POST /api/user/topup/receipt`) enforce binary magic-byte verification (`JPEG`, `PNG`, `WEBP`, `PDF`, `≤ 5 MiB` decoded / `8 MiB` request body cap) and stream directly to Telegram Bot API with zero local disk storage.
- **Mini App Session, Guard & P2P Isolation:** Telegram `initData` is verified via `HMAC-SHA256` before minting HTTP-only JWT cookies (`ADMIN_SESSION_SECRET`). Centralized `userGuard` enforces `403 USER_BANNED` and `503 MAINTENANCE_MODE` (admin bypass only) on every `/api/user/*` route. P2P wallet and service transfers require exact-match recipient resolution (`UserService.findTransferRecipient`, never fuzzy matching).
- **Constant-Time Webhook Verification:** Inbound Telegram webhooks (`X-Telegram-Bot-Api-Secret-Token`) and Rebecca panel webhooks (`x-webhook-secret`) are verified using constant-time comparisons, strict path matching, and a `1 MiB` payload ceiling.

---

## Database & Operational Integrity

- **64-Bit Minor-Unit Boundaries:** PostgreSQL check constraints enforce safe-integer bounds (`-9007199254740991` to `9007199254740991`), non-negative balances (`balance >= reserved_balance`, `reserved_balance >= 0`), and valid state-machine transitions across `drizzle/0000_initial_schema.sql` through `drizzle/0012_add_topup_receipt_card_tracking.sql`.
- **Deployment Hygiene:** Keep `.env` (`chmod 0600`), deploy keys, and backup archives outside the Docker build context. Treat Rebecca subscription URLs (`sub_url`) as bearer credentials and never expose them in public logs.
