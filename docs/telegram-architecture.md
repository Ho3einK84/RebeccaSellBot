# Telegram architecture

RebeccaSellBot treats Telegram as a thin delivery layer over domain services. Telegram handlers do not access Drizzle, PostgreSQL, or the Rebecca REST client directly.

## Route ownership

- `features/admin/promoRoutes.ts` owns promo listing, searching, detail, toggle, edit, and confirmed deletion.
- `features/admin/userRoutes.ts` owns paginated user discovery, profiles, wallet entry points, ban confirmation, subscriptions, audit history, and direct messaging.
- `features/admin/receiptRoutes.ts` owns the paginated pending queue, idempotent approve/reject confirmation, batch approval, and user notifications.
- `features/subscriptions/routes.ts` owns customer subscription cards, pagination, renewal, panel refresh, enable/disable, link revocation, QR generation, and confirmed deletion.
- Conversations collect validated multi-step input. Financial or panel mutation remains in domain services.

## Callback contract

Telegram limits callback data to 64 UTF-8 bytes. New callbacks use short namespaces and stable internal identifiers:

- `promo:*:<uuid>`
- `admin:user:*:<telegramId>`
- `receipt:*:<receiptId>`
- `renew:*:<userConfigId>`
- `config:*:<userConfigId>`

`callbackData()` validates both characters and byte length. Human promo codes, Rebecca usernames, and package IDs are not embedded in new callback data. Package selection uses a bounded array index and resolves the current package server-side. A final callback handler acknowledges stale buttons so Telegram never leaves a spinner running indefinitely.

## Screen and navigation rules

- Resource lists are paginated and use inline selection; admins do not type an existing resource name to manage it.
- Detail actions edit the current message where practical.
- Destructive actions require an explicit confirmation screen.
- Multiple subscription or receipt cards contain only resource actions. Exactly one navigation message is sent after the page.
- Dynamic Markdown is escaped. If Telegram still rejects template markup, the API transformer retries the same content safely as plain text.

## Financial and receipt rules

- Purchase and renewal buttons display a quote before entering the purchase saga.
- The wallet service reserves funds, performs the Rebecca operation, verifies the panel result, and commits or compensates.
- Custom traffic purchase and renewal use `custom_default_days`; Telegram does not prompt for duration.
- Receipt submission validates the configured amount range, previews the submission, and serializes by wallet owner so only one receipt can remain pending.
- Approval, rejection, balance changes, user control, direct messages, and broadcasts write audit records where applicable.

## Deployment

Run migrations before starting the updated bot. Migration `0003_telegram_admin_foundation.sql` backfills a stable UUID for every existing promo code, so buttons render correctly for both old and new codes.

The release gate is:

```sh
npm run verify
```

It checks architecture, TypeScript, lint, formatting, Vitest, and the production build.
