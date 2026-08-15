# Telegram architecture

RebeccaSellBot treats Telegram as a delivery layer. Handlers render screens and call domain
services; they do not query PostgreSQL or call Rebecca directly. The executable architecture
check in `scripts/check-architecture.mjs` enforces this boundary.

## Update lifecycle

`src/telegram/botRuntime.ts` composes middleware in this order:

1. Telegram API throttling, safe Markdown fallback, and message-role tracking.
2. Service injection, private-chat enforcement, locale persistence, and admin authorization.
3. PostgreSQL-backed grammY sessions and tracked-screen cleanup.
4. Ban enforcement, conversations, rate limiting, menus, and callback routes.

Sessions use a chat-and-user key. Secrets such as Rebecca API credentials are passed directly to
domain services and are never stored in conversation replay state.

## Screen roles

`src/telegram/ui.ts` is the preferred screen boundary:

- **Screen** messages are replaceable application views. `renderUiScreen` edits the current
  callback message when safe and falls back to a new tracked message.
- **Prompt** messages collect short-lived conversation input and are cleaned after the flow.
- **Artifact** messages are durable output such as subscription links, QR images, and successful
  trial details. Navigation never edits or removes them as ordinary screens.

All common screens use the compact builders in `designSystem.ts`. User-controlled Markdown values
must pass through the helpers in `rendering.ts` or the localized template helper `tm`.

## Navigation and callbacks

Current navigation uses `nav:*` destinations plus explicit feature callbacks. Back and Cancel
buttons return to a known parent screen; conversation Cancel is forwarded to the outer context so
the destination can be rendered consistently.

Callback payloads are constructed with `callbackData` and must remain within Telegram's 64-byte
limit. Financial and destructive confirmations use compact immutable IDs or explicit desired
state. Legacy toggle/index callbacks refresh the current screen instead of replaying an ambiguous
mutation.

## Settings Center

The Admin Settings Center lives under
`src/telegram/conversations/adminConversations/settings/`. Its modules separate the typed catalog,
validation, presentation, navigation, conversation orchestration, and package manager. Persisted
setting keys remain backward-compatible; specialized package and naming flows keep their domain
invariants and rollback behavior.
