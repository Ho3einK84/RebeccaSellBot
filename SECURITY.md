# Security Policy

> **Last synced with version:** `v0.4.0`

## Reporting a Vulnerability

Do not disclose suspected vulnerabilities, credentials, Rebecca subscription URLs, database dumps, or access tokens in public issues. Use **GitHub Private Vulnerability Reporting** for this repository or contact the maintainers through an established private channel with minimal synthetic reproduction steps.

Include the affected commit or version, impact assessment, prerequisites, and reproduction steps with all live tokens and URLs redacted.

---

## Cryptographic & Privacy Safeguards

- **At-Rest Credential Vault (`AES-256-GCM`):** Rebecca panel API keys/admin passwords (`rebecca_panels`) and automated payment gateway secrets (`forapp_api_key_encrypted`, `nowpayments_api_key_encrypted`, `nowpayments_ipn_secret_encrypted` in `settings`) are encrypted using `CredentialCipher` with random 12-byte IVs and keys derived from `PANEL_CREDENTIALS_KEY`.
- **Zero-Secret Conversation Replay:** Admin panel secrets are captured outside `@grammyjs/conversations` replay state, encrypted immediately, and the plaintext Telegram message is deleted from chat history.
- **Privacy-Preserving Phone Verification (`HMAC-SHA256`):** When phone verification is enabled (`require_phone_for_trial` / `require_phone_for_purchase`), raw phone numbers are never stored or logged; only an `HMAC-SHA256` digest keyed from `BOT_TOKEN` is persisted in `users.phone_hash`. Both Telegram conversations and Mini App `WebApp.requestContact()` verify strict contact ownership (`contact.user_id === ctx.from.id`).
- **Receipt Fraud Fingerprinting, Payment Hygiene & Zero-Disk WebApp Uploads:** Uploaded top-up receipts are fingerprinted via both Telegram `file_unique_id` and content `SHA-256` digests (`topup_receipts.file_sha256`), enabling automatic duplicate detection (`warn` or `block`) and atomic approved-receipt voiding (`topup_void`). WebApp uploads (`POST /api/user/topup/receipt`) enforce binary magic-byte verification (`JPEG`, `PNG`, `WEBP`, `PDF`, `≤ 5 MiB` decoded / `8 MiB` request body cap) and stream directly to Telegram Bot API with zero local disk storage. Optional `payment_message_auto_delete_hours` (`0–48h`) automatically deletes Telegram card/payment prompts after expiry via `scheduled_message_deletions` without removing completed receipts.
- **Mini App Session, Access Guards & P2P Isolation:** Telegram `initData` is verified via `HMAC-SHA256` before minting HTTP-only JWT cookies (`ADMIN_SESSION_SECRET`). Centralized `userGuard` enforces `403 USER_BANNED`, `503 MAINTENANCE_MODE` (admin bypass), `403 REGISTRATION_INVITE_ONLY` / `403 REGISTRATION_CLOSED` (`registration_mode`), and `403 CHANNEL_JOIN_REQUIRED` (`forced_join_scope = all`) across `/api/user/*`. P2P wallet and service transfers require exact-match recipient resolution (`UserService.findTransferRecipient`, never fuzzy matching), and P2P balance transfers strictly require positive real balance (`balance - reserved_balance >= amount`) so VIP negative credit limits can never be transferred out.
- **Constant-Time Webhook Verification:** Inbound Telegram webhooks (`X-Telegram-Bot-Api-Secret-Token`), Rebecca panel webhooks (`x-webhook-secret`), ForApp deposit webhooks (`POST /api/webhooks/forapp` via `X-API-Key` + `Idempotency-Key`), and NOWPayments IPN callbacks (`POST /api/webhooks/nowpayments` via `HMAC-SHA512` `x-nowpayments-sig`) are verified using constant-time comparisons, strict path matching, and payload/rate-limit caps.

---

## Database & Operational Integrity

- **64-Bit Minor-Unit Boundaries, Credit Safety & Inventory Locks:** PostgreSQL check constraints enforce signed safe-integer bounds (`-9007199254740991` to `9007199254740991`), non-negative reservations (`reserved_balance >= 0`), `user_groups.credit_limit >= 0`, single default group uniqueness (`user_groups_one_default`), non-negative panel/service/package capacity & stock bounds, and valid state-machine transitions across `drizzle/0000_initial_schema.sql` through `drizzle/0019_service_and_package_inventory.sql`. Purchasing power (`balance - reserved_balance + effectiveCreditLimit`) is enforced under `FOR UPDATE` row locks and snapshotted onto `purchase_intents` rather than via a hard DB check against mutable group limits, while `InventoryService` locks `rebecca_panels`, `rebecca_panel_services`, and `package_inventory` rows with `FOR NO KEY UPDATE` to prevent foreign-key `FOR KEY SHARE` deadlocks during parallel checkouts.
- **Sanitized Public Telemetry:** Public and customer-facing version payloads (`toPublicAppVersion` on `/api/auth/bot-info` and `/api/health`) omit internal Git commit SHAs, dirty-tree flags, build timestamps, and repository URLs, exposing full build diagnostics strictly to authenticated administrators and local `/readyz` health probes.
- **Deployment Hygiene:** Keep `.env` (`chmod 0600`), deploy keys, and backup archives outside the Docker build context. Treat Rebecca subscription URLs (`sub_url`) as bearer credentials and never expose them in public logs.
