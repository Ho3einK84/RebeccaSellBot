import {
  pgTable,
  text,
  uuid,
  bigint,
  integer,
  boolean,
  timestamp,
  primaryKey,
  check,
  foreignKey,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Rebecca panels are runtime-managed from Telegram. Credentials are encrypted
// before persistence; only the clean HTTPS origin and non-secret labels remain
// readable in the database. The legacy row gives existing single-panel data a
// deterministic migration target without forcing panel credentials at install.
export const rebeccaPanels = pgTable(
  'rebecca_panels',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    baseUrl: text('base_url'),
    apiKeyEncrypted: text('api_key_encrypted'),
    adminUsername: text('admin_username'),
    adminPasswordEncrypted: text('admin_password_encrypted'),
    enabled: boolean('enabled').notNull().default(false),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check('rebecca_panels_name_present', sql`length(btrim(${table.name})) BETWEEN 1 AND 80`),
    uniqueIndex('rebecca_panels_one_default')
      .on(table.isDefault)
      .where(sql`${table.isDefault} = true`),
  ]
);

export const rebeccaPanelServices = pgTable(
  'rebecca_panel_services',
  {
    panelId: text('panel_id')
      .notNull()
      .references(() => rebeccaPanels.id, { onDelete: 'cascade' }),
    serviceId: integer('service_id').notNull(),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.panelId, table.serviceId] }),
    check(
      'rebecca_panel_services_id_positive',
      sql`${table.serviceId} > 0 AND ${table.serviceId} <= 2147483647`
    ),
    check(
      'rebecca_panel_services_name_present',
      sql`length(btrim(${table.name})) BETWEEN 1 AND 80`
    ),
    uniqueIndex('rebecca_panel_services_one_default')
      .on(table.panelId)
      .where(sql`${table.isDefault} = true`),
  ]
);

// Users table (Telegram users)
export const users = pgTable(
  'users',
  {
    // Telegram IDs remain the operational primary key. A generated UUID gives
    // administrators a stable, non-guessable identifier for profile lookup.
    id: uuid('id').notNull().defaultRandom().unique(),
    telegramId: bigint('telegram_id', { mode: 'number' }).primaryKey(),
    username: text('username'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    balance: bigint('balance', { mode: 'number' }).notNull().default(0), // configured currency minor units
    reservedBalance: bigint('reserved_balance', { mode: 'number' }).notNull().default(0),
    isBanned: boolean('is_banned').notNull().default(false),
    hasUsedTrial: boolean('has_used_trial').notNull().default(false),
    // Persist the most recently observed supported Telegram locale so
    // background jobs (which do not have a Telegram update context) can send
    // localized notifications too.
    locale: text('locale').notNull().default('fa'),
    // Once a user selects a language explicitly, Telegram's app locale must
    // no longer overwrite that preference on later updates.
    localeManual: boolean('locale_manual').notNull().default(false),
    referrerId: bigint('referrer_id', { mode: 'number' }),
    referralCode: text('referral_code').notNull().unique(),
    /** Durable activity/CRM fields; monetary amounts remain integer minor units. */
    registrationSource: text('registration_source').notNull().default('telegram'),
    lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
    totalSpend: bigint('total_spend', { mode: 'number' }).notNull().default(0),
    activeSubscriptionCount: integer('active_subscription_count').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check('users_reserved_balance_nonnegative', sql`${table.reservedBalance} >= 0`),
    check('users_available_balance_nonnegative', sql`${table.balance} >= ${table.reservedBalance}`),
    check('users_locale_supported', sql`${table.locale} IN ('fa', 'en')`),
    check('users_total_spend_nonnegative', sql`${table.totalSpend} >= 0`),
    check(
      'users_telegram_id_safe_integer',
      sql`${table.telegramId} > 0 AND ${table.telegramId} <= 9007199254740991`
    ),
    check('users_balance_safe_integer', sql`${table.balance} <= 9007199254740991`),
    check('users_total_spend_safe_integer', sql`${table.totalSpend} <= 9007199254740991`),
    check(
      'users_referrer_id_safe_integer',
      sql`${table.referrerId} IS NULL OR (${table.referrerId} > 0 AND ${table.referrerId} <= 9007199254740991)`
    ),
    check(
      'users_active_subscription_count_nonnegative',
      sql`${table.activeSubscriptionCount} >= 0`
    ),
  ]
);

// Wallet Transaction Audit Log
export const walletTransactions = pgTable(
  'wallet_transactions',
  {
    id: text('id').primaryKey(), // UUID or custom unique ID (e.g. tx_...)
    telegramId: bigint('telegram_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramId),
    amount: bigint('amount', { mode: 'number' }).notNull(), // positive for credit, negative for debit
    balanceAfter: bigint('balance_after', { mode: 'number' }).notNull(),
    type: text('type').notNull(), // 'topup', 'purchase', 'refund', 'admin_adjustment', 'promo', 'referral_bonus', 'cashback', 'trial'
    referenceId: text('reference_id').unique(), // Deterministic ID for idempotency (e.g. cashback_<intentId>, ref_<intentId>)
    description: text('description').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'wallet_transactions_amount_safe_integer',
      sql`${table.amount} BETWEEN -9007199254740991 AND 9007199254740991`
    ),
    check(
      'wallet_transactions_balance_after_safe_integer',
      sql`${table.balanceAfter} BETWEEN 0 AND 9007199254740991`
    ),
    check(
      'wallet_transactions_type_supported',
      sql`${table.type} IN ('topup', 'purchase', 'refund', 'admin_adjustment', 'promo', 'referral_bonus', 'cashback', 'trial', 'transfer_sent', 'transfer_received')`
    ),
  ]
);

// Purchase Intents (Saga Pattern)
export const purchaseIntents = pgTable(
  'purchase_intents',
  {
    id: text('id').primaryKey(), // pi_...
    telegramId: bigint('telegram_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramId),
    panelId: text('panel_id')
      .notNull()
      .default('legacy')
      .references(() => rebeccaPanels.id),
    serviceId: integer('service_id').notNull().default(1),
    checkoutId: text('checkout_id'),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    type: text('type').notNull(), // 'new_config', 'renew_config'
    status: text('status').notNull(), // 'pending', 'completed', 'failed'
    configUsername: text('config_username'),
    gbAmount: integer('gb_amount'),
    durationDays: integer('duration_days'),
    // Renewal state is persisted before the remote PUT. This lets the
    // reconciliation worker distinguish a confirmed update from an operation
    // whose result is still unknown after a process/network failure.
    previousDataLimit: bigint('previous_data_limit', { mode: 'number' }),
    previousExpire: bigint('previous_expire', { mode: 'number' }),
    previousStatus: text('previous_status'),
    expectedDataLimit: bigint('expected_data_limit', { mode: 'number' }),
    expectedExpire: bigint('expected_expire', { mode: 'number' }),
    expectedStatus: text('expected_status'),
    errorMessage: text('error_message'),
    // NULL is a durable retry marker when post-commit referral/cashback
    // settlement was interrupted. The ledger remains the idempotency source.
    bonusesProcessedAt: timestamp('bonuses_processed_at'),
    // Snapshotted financial bonus terms — immutable once the intent is reserved.
    cashbackPercent: integer('cashback_percent'),
    cashbackAmount: bigint('cashback_amount', { mode: 'number' }),
    referrerTelegramId: bigint('referrer_telegram_id', { mode: 'number' }),
    referralBonusAmount: bigint('referral_bonus_amount', { mode: 'number' }),
    refundedAt: timestamp('refunded_at'),
    // A reconciler may only claim work after this foreground-operation lease
    // expires. Heartbeats prevent a slow but active Rebecca request from being
    // compensated by a concurrent recovery worker.
    operationStartedAt: timestamp('operation_started_at'),
    leaseExpiresAt: timestamp('lease_expires_at'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'purchase_intents_amount_positive_safe_integer',
      sql`${table.amount} >= 0 AND ${table.amount} <= 9007199254740991`
    ),
    check('purchase_intents_type_supported', sql`${table.type} IN ('new_config', 'renew_config')`),
    check(
      'purchase_intents_status_supported',
      sql`${table.status} IN ('pending', 'reconciliation_required', 'completed', 'failed', 'refunded')`
    ),
    check(
      'purchase_intents_gb_amount_positive',
      sql`${table.gbAmount} IS NULL OR ${table.gbAmount} > 0`
    ),
    check(
      'purchase_intents_duration_days_positive',
      sql`${table.durationDays} IS NULL OR ${table.durationDays} > 0`
    ),
    check(
      'purchase_intents_service_id_positive',
      sql`${table.serviceId} > 0 AND ${table.serviceId} <= 2147483647`
    ),
    foreignKey({
      columns: [table.panelId, table.serviceId],
      foreignColumns: [rebeccaPanelServices.panelId, rebeccaPanelServices.serviceId],
      name: 'purchase_intents_panel_service_fk',
    }),
    check(
      'purchase_intents_previous_data_limit_safe',
      sql`${table.previousDataLimit} IS NULL OR ${table.previousDataLimit} BETWEEN 0 AND 9007199254740991`
    ),
    check(
      'purchase_intents_expected_data_limit_safe',
      sql`${table.expectedDataLimit} IS NULL OR ${table.expectedDataLimit} BETWEEN 0 AND 9007199254740991`
    ),
    check(
      'purchase_intents_previous_expire_safe',
      sql`${table.previousExpire} IS NULL OR ${table.previousExpire} BETWEEN 0 AND 9007199254740991`
    ),
    check(
      'purchase_intents_expected_expire_safe',
      sql`${table.expectedExpire} IS NULL OR ${table.expectedExpire} BETWEEN 0 AND 9007199254740991`
    ),
    check(
      'purchase_intents_previous_status_supported',
      sql`${table.previousStatus} IS NULL OR ${table.previousStatus} IN ('active', 'disabled', 'on_hold')`
    ),
    check(
      'purchase_intents_expected_status_supported',
      sql`${table.expectedStatus} IS NULL OR ${table.expectedStatus} IN ('active', 'disabled', 'on_hold')`
    ),
    check(
      'purchase_intents_cashback_percent_safe',
      sql`${table.cashbackPercent} IS NULL OR (${table.cashbackPercent} >= 0 AND ${table.cashbackPercent} <= 100)`
    ),
    check(
      'purchase_intents_cashback_amount_safe',
      sql`${table.cashbackAmount} IS NULL OR (${table.cashbackAmount} >= 0 AND ${table.cashbackAmount} <= 9007199254740991)`
    ),
    check(
      'purchase_intents_referrer_id_safe',
      sql`${table.referrerTelegramId} IS NULL OR (${table.referrerTelegramId} > 0 AND ${table.referrerTelegramId} <= 9007199254740991)`
    ),
    check(
      'purchase_intents_referral_bonus_amount_safe',
      sql`${table.referralBonusAmount} IS NULL OR (${table.referralBonusAmount} >= 0 AND ${table.referralBonusAmount} <= 9007199254740991)`
    ),
    // A generated new-config name changes on every tap, so a per-config
    // uniqueness constraint does not prevent duplicate purchases. One active
    // financial intent per wallet is the race-safe re-entry guard.
    uniqueIndex('purchase_intents_one_pending_per_user')
      .on(table.telegramId)
      .where(sql`${table.status} = 'pending'`),
    index('purchase_intents_nonterminal_updated_at_idx')
      .on(table.updatedAt)
      .where(sql`${table.status} IN ('pending', 'reconciliation_required')`),
    index('purchase_intents_nonterminal_user_idx')
      .on(table.telegramId)
      .where(sql`${table.status} IN ('pending', 'reconciliation_required')`),
    index('purchase_intents_bonus_retry_idx')
      .on(table.createdAt)
      .where(sql`${table.status} = 'completed' AND ${table.bonusesProcessedAt} IS NULL`),
    uniqueIndex('purchase_intents_checkout_unique')
      .on(table.checkoutId)
      .where(sql`${table.checkoutId} IS NOT NULL`),
  ]
);

// User Configs (claimed or purchased configs bound to user)
export const userConfigs = pgTable(
  'user_configs',
  {
    id: text('id').primaryKey(),
    telegramId: bigint('telegram_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramId),
    panelId: text('panel_id')
      .notNull()
      .default('legacy')
      .references(() => rebeccaPanels.id),
    serviceId: integer('service_id').notNull().default(1),
    configUsername: text('config_username').notNull(),
    subUrl: text('sub_url'),
    isClaimed: boolean('is_claimed').notNull().default(false),
    claimedAt: timestamp('claimed_at'),
    // Cached observations from the panel. The panel remains the source of
    // truth; these fields power lifecycle reporting without a live request in
    // every Telegram interaction.
    panelStatus: text('panel_status'),
    panelDataLimit: bigint('panel_data_limit', { mode: 'number' }),
    panelUsedTraffic: bigint('panel_used_traffic', { mode: 'number' }),
    panelExpire: bigint('panel_expire', { mode: 'number' }),
    autoRenewEnabled: boolean('auto_renew_enabled').notNull().default(false),
    // Only a stable package ID is persisted. Price/quota/duration are resolved
    // from PricingService when the renewal actually runs.
    autoRenewPackageId: text('auto_renew_package_id'),
    // User-approved ceiling snapshot. Package price changes require a fresh
    // Telegram confirmation instead of silently charging the new amount.
    autoRenewPrice: bigint('auto_renew_price', { mode: 'number' }),
    remoteCreatedAt: text('remote_created_at'),
    lastSyncedAt: timestamp('last_synced_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'user_configs_panel_status_supported',
      sql`${table.panelStatus} IS NULL OR ${table.panelStatus} IN ('active', 'disabled', 'limited', 'expired', 'on_hold', 'deleted')`
    ),
    check(
      'user_configs_panel_data_limit_safe',
      sql`${table.panelDataLimit} IS NULL OR ${table.panelDataLimit} BETWEEN 0 AND 9007199254740991`
    ),
    check(
      'user_configs_panel_used_traffic_safe',
      sql`${table.panelUsedTraffic} IS NULL OR ${table.panelUsedTraffic} BETWEEN 0 AND 9007199254740991`
    ),
    check(
      'user_configs_panel_expire_safe',
      sql`${table.panelExpire} IS NULL OR ${table.panelExpire} BETWEEN 0 AND 9007199254740991`
    ),
    index('user_configs_telegram_id_idx').on(table.telegramId),
    index('user_configs_sub_url_idx').on(table.subUrl),
    uniqueIndex('user_configs_panel_username_unique').on(table.panelId, table.configUsername),
    check(
      'user_configs_service_id_positive',
      sql`${table.serviceId} > 0 AND ${table.serviceId} <= 2147483647`
    ),
    check(
      'user_configs_auto_renew_price_safe',
      sql`${table.autoRenewPrice} IS NULL OR ${table.autoRenewPrice} BETWEEN 0 AND 9007199254740991`
    ),
    foreignKey({
      columns: [table.panelId, table.serviceId],
      foreignColumns: [rebeccaPanelServices.panelId, rebeccaPanelServices.serviceId],
      name: 'user_configs_panel_service_fk',
    }),
  ]
);

// Durable, one-time purchase consent. Package, panel and price are snapshotted
// before Telegram renders the confirmation button, removing both double-tap
// charging and package-edit TOCTOU bugs.
export const purchaseCheckouts = pgTable(
  'purchase_checkouts',
  {
    id: text('id').primaryKey(),
    telegramId: bigint('telegram_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramId),
    kind: text('kind').notNull(),
    configId: text('config_id'),
    packageId: text('package_id').notNull(),
    packageName: text('package_name').notNull(),
    panelId: text('panel_id')
      .notNull()
      .references(() => rebeccaPanels.id),
    serviceId: integer('service_id').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    quotedAmount: bigint('quoted_amount', { mode: 'number' }).notNull(),
    gbAmount: integer('gb_amount').notNull(),
    durationDays: integer('duration_days').notNull(),
    promoCode: text('promo_code'),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at').notNull(),
    claimedAt: timestamp('claimed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'purchase_checkouts_kind_supported',
      sql`${table.kind} IN ('new_config', 'renew_config')`
    ),
    check(
      'purchase_checkouts_status_supported',
      sql`${table.status} IN ('pending', 'processing', 'completed', 'failed', 'expired')`
    ),
    check(
      'purchase_checkouts_amount_safe',
      sql`${table.amount} >= 0 AND ${table.amount} <= 9007199254740991`
    ),
    check(
      'purchase_checkouts_quoted_amount_safe',
      sql`${table.quotedAmount} >= 0 AND ${table.quotedAmount} <= ${table.amount}`
    ),
    check('purchase_checkouts_gb_positive', sql`${table.gbAmount} > 0`),
    check('purchase_checkouts_days_positive', sql`${table.durationDays} > 0`),
    check(
      'purchase_checkouts_service_positive',
      sql`${table.serviceId} > 0 AND ${table.serviceId} <= 2147483647`
    ),
    foreignKey({
      columns: [table.panelId, table.serviceId],
      foreignColumns: [rebeccaPanelServices.panelId, rebeccaPanelServices.serviceId],
      name: 'purchase_checkouts_panel_service_fk',
    }),
    index('purchase_checkouts_expiry_idx')
      .on(table.expiresAt)
      .where(sql`${table.status} = 'pending'`),
  ]
);

// Persistent notification state. The composite primary key lets the notifier
// atomically suppress repeat alerts per config/reason, while `conditionActive`
// is reset once the condition recovers so a later recurrence is announced.
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    telegramId: bigint('telegram_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramId),
    panelId: text('panel_id')
      .notNull()
      .default('legacy')
      .references(() => rebeccaPanels.id),
    configUsername: text('config_username').notNull(),
    notificationType: text('notification_type').notNull(), // notifier NotificationType values
    conditionActive: boolean('condition_active').notNull().default(false),
    lastSentAt: timestamp('last_sent_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'notification_deliveries_type_supported',
      sql`${table.notificationType} IN ('low_traffic', 'near_expiry', 'auto_renew_low_balance', 'auto_renew_package_missing')`
    ),
    primaryKey({
      columns: [table.telegramId, table.panelId, table.configUsername, table.notificationType],
    }),
  ]
);

// Refund deletion saga. A refund is tied to the original paid new-config intent
// and becomes idempotent through the unique source purchase reference.
export const refundIntents = pgTable(
  'refund_intents',
  {
    id: text('id').primaryKey(),
    purchaseIntentId: text('purchase_intent_id')
      .notNull()
      .references(() => purchaseIntents.id),
    telegramId: bigint('telegram_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramId),
    panelId: text('panel_id')
      .notNull()
      .default('legacy')
      .references(() => rebeccaPanels.id),
    configUsername: text('config_username').notNull(),
    grossAmount: bigint('gross_amount', { mode: 'number' }).notNull(),
    cashbackWithheld: bigint('cashback_withheld', { mode: 'number' }).notNull().default(0),
    refundAmount: bigint('refund_amount', { mode: 'number' }).notNull(),
    status: text('status').notNull().default('pending'),
    errorMessage: text('error_message'),
    operationStartedAt: timestamp('operation_started_at'),
    leaseExpiresAt: timestamp('lease_expires_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('refund_intents_purchase_unique').on(table.purchaseIntentId),
    uniqueIndex('refund_intents_one_nonterminal_per_config')
      .on(table.panelId, table.configUsername)
      .where(sql`${table.status} IN ('pending', 'reconciliation_required')`),
    index('refund_intents_reconciliation_updated_at_idx')
      .on(table.updatedAt)
      .where(sql`${table.status} IN ('pending', 'reconciliation_required')`),
    check(
      'refund_intents_gross_positive',
      sql`${table.grossAmount} >= 0 AND ${table.grossAmount} <= 9007199254740991`
    ),
    check(
      'refund_intents_cashback_safe',
      sql`${table.cashbackWithheld} >= 0 AND ${table.cashbackWithheld} <= ${table.grossAmount}`
    ),
    check(
      'refund_intents_amount_safe',
      sql`${table.refundAmount} >= 0 AND ${table.refundAmount} <= ${table.grossAmount}`
    ),
    check(
      'refund_intents_status_supported',
      sql`${table.status} IN ('pending', 'reconciliation_required', 'completed', 'failed')`
    ),
  ]
);

// Durable orphan observations generated by the reconciliation worker.
export const configReconciliationIssues = pgTable(
  'config_reconciliation_issues',
  {
    id: uuid('id').notNull().defaultRandom().primaryKey(),
    kind: text('kind').notNull(),
    panelId: text('panel_id')
      .notNull()
      .default('legacy')
      .references(() => rebeccaPanels.id),
    configUsername: text('config_username').notNull(),
    localConfigId: text('local_config_id'),
    localOwnerTelegramId: bigint('local_owner_telegram_id', { mode: 'number' }),
    // Rebecca's creation timestamp fingerprints the specific remote service
    // incarnation. Baseline/ignored rows only suppress that exact incarnation,
    // so a later service reusing the same username can be surfaced again.
    remoteCreatedAt: text('remote_created_at'),
    status: text('status').notNull().default('open'),
    firstSeenAt: timestamp('first_seen_at').notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at'),
  },
  (table) => [
    uniqueIndex('config_reconciliation_issue_unique').on(
      table.panelId,
      table.kind,
      table.configUsername
    ),
    index('config_reconciliation_open_idx')
      .on(table.lastSeenAt)
      .where(sql`${table.status} = 'open'`),
    check(
      'config_reconciliation_issue_kind_supported',
      sql`${table.kind} IN ('local_missing_remote', 'remote_unbound')`
    ),
    check(
      'config_reconciliation_issue_status_supported',
      sql`${table.status} IN ('open', 'ignored', 'resolved')`
    ),
  ]
);

// Dynamic Telegram administrators. ADMIN_IDS is used only to bootstrap this
// table when it is empty, so in-bot changes persist across restarts.
export const botAdmins = pgTable(
  'bot_admins',
  {
    telegramId: bigint('telegram_id', { mode: 'number' }).primaryKey(),
    addedBy: bigint('added_by', { mode: 'number' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'bot_admins_telegram_id_safe',
      sql`${table.telegramId} > 0 AND ${table.telegramId} <= 9007199254740991`
    ),
    check(
      'bot_admins_added_by_safe',
      sql`${table.addedBy} IS NULL OR (${table.addedBy} > 0 AND ${table.addedBy} <= 9007199254740991)`
    ),
  ]
);

// Durable segmented broadcast queue. Recipient rows snapshot the selected
// audience at queue time, making progress/cancellation restart-safe.
export const broadcastJobs = pgTable(
  'broadcast_jobs',
  {
    id: uuid('id').notNull().defaultRandom().primaryKey(),
    actorTelegramId: bigint('actor_telegram_id', { mode: 'number' }).notNull(),
    audience: text('audience').notNull(),
    message: text('message').notNull(),
    status: text('status').notNull().default('queued'),
    recipientCount: integer('recipient_count').notNull().default(0),
    sentCount: integer('sent_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'broadcast_jobs_actor_safe',
      sql`${table.actorTelegramId} > 0 AND ${table.actorTelegramId} <= 9007199254740991`
    ),
    check(
      'broadcast_jobs_audience_supported',
      sql`${table.audience} IN ('all', 'active_subscription', 'no_subscription', 'no_purchase_30d', 'no_active_subscription')`
    ),
    check(
      'broadcast_jobs_status_supported',
      sql`${table.status} IN ('queued', 'running', 'cancel_requested', 'cancelled', 'completed')`
    ),
    check(
      'broadcast_jobs_counts_safe',
      sql`${table.recipientCount} >= 0 AND ${table.sentCount} >= 0 AND ${table.failedCount} >= 0 AND ${table.sentCount} + ${table.failedCount} <= ${table.recipientCount}`
    ),
    index('broadcast_jobs_runnable_idx')
      .on(table.createdAt)
      .where(sql`${table.status} IN ('queued', 'running', 'cancel_requested')`),
  ]
);

export const broadcastRecipients = pgTable(
  'broadcast_recipients',
  {
    jobId: uuid('job_id')
      .notNull()
      .references(() => broadcastJobs.id, { onDelete: 'cascade' }),
    telegramId: bigint('telegram_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramId),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    claimedAt: timestamp('claimed_at'),
    sentAt: timestamp('sent_at'),
    lastError: text('last_error'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.telegramId] }),
    check(
      'broadcast_recipients_status_supported',
      sql`${table.status} IN ('pending', 'sending', 'sent', 'failed', 'cancelled')`
    ),
    check('broadcast_recipients_attempts_safe', sql`${table.attempts} >= 0`),
    index('broadcast_recipients_pending_idx')
      .on(table.jobId, table.telegramId)
      .where(sql`${table.status} = 'pending'`),
    index('broadcast_recipients_stale_idx')
      .on(table.claimedAt)
      .where(sql`${table.status} = 'sending'`),
  ]
);

// Free-trial saga state. A row is reserved before the remote create call so a
// Telegram ID cannot create two trials concurrently. Pending rows are retained
// for recovery if the process loses the remote response.
export const trialClaims = pgTable(
  'trial_claims',
  {
    telegramId: bigint('telegram_id', { mode: 'number' })
      .primaryKey()
      .references(() => users.telegramId),
    panelId: text('panel_id')
      .notNull()
      .default('legacy')
      .references(() => rebeccaPanels.id),
    serviceId: integer('service_id').notNull().default(1),
    configUsername: text('config_username').notNull(),
    gbAmount: integer('gb_amount').notNull(),
    durationDays: integer('duration_days').notNull(),
    status: text('status').notNull().default('pending'), // pending, compensating, review_required, completed, failed
    subUrl: text('sub_url'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check('trial_claims_gb_amount_positive', sql`${table.gbAmount} > 0`),
    check('trial_claims_duration_days_positive', sql`${table.durationDays} > 0`),
    check(
      'trial_claims_service_id_positive',
      sql`${table.serviceId} > 0 AND ${table.serviceId} <= 2147483647`
    ),
    check(
      'trial_claims_status_supported',
      sql`${table.status} IN ('pending', 'compensating', 'review_required', 'completed', 'converted', 'failed')`
    ),
    foreignKey({
      columns: [table.panelId, table.serviceId],
      foreignColumns: [rebeccaPanelServices.panelId, rebeccaPanelServices.serviceId],
      name: 'trial_claims_panel_service_fk',
    }),
    uniqueIndex('trial_claims_panel_username_unique').on(table.panelId, table.configUsername),
    index('trial_claims_recovery_idx')
      .on(table.createdAt)
      .where(sql`${table.status} IN ('pending', 'compensating')`),
  ]
);

// Settings & Translations (Dynamic K/V Cache)
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Promo Codes
export const promoCodes = pgTable(
  'promo_codes',
  {
    /** Stable callback-safe identifier; the human code remains the domain key. */
    id: uuid('id').notNull().defaultRandom().unique(),
    code: text('code').primaryKey(),
    type: text('type').notNull(), // 'discount_percent', 'discount_fixed', 'gift_credit', 'gift_gb'
    value: integer('value').notNull(), // percent or minor currency or GB
    maxUses: integer('max_uses').notNull().default(1),
    maxUsesPerUser: integer('max_uses_per_user').notNull().default(1),
    currentUses: integer('current_uses').notNull().default(0),
    minPurchaseAmount: bigint('min_purchase_amount', { mode: 'number' }).notNull().default(0),
    expiresAt: timestamp('expires_at'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'promo_codes_type_supported',
      sql`${table.type} IN ('discount_percent', 'discount_fixed', 'gift_credit', 'gift_gb')`
    ),
    check('promo_codes_value_positive', sql`${table.value} > 0`),
    check(
      'promo_codes_percent_range',
      sql`${table.type} <> 'discount_percent' OR ${table.value} BETWEEN 1 AND 100`
    ),
    check('promo_codes_max_uses_positive', sql`${table.maxUses} > 0`),
    check('promo_codes_max_uses_per_user_positive', sql`${table.maxUsesPerUser} > 0`),
    check(
      'promo_codes_current_uses_valid',
      sql`${table.currentUses} >= 0 AND ${table.currentUses} <= ${table.maxUses}`
    ),
    check(
      'promo_codes_min_purchase_safe',
      sql`${table.minPurchaseAmount} BETWEEN 0 AND 9007199254740991`
    ),
  ]
);

// Promo Code Redemptions
export const codeRedemptions = pgTable(
  'code_redemptions',
  {
    id: text('id').primaryKey(),
    code: text('code')
      .notNull()
      .references(() => promoCodes.code),
    telegramId: bigint('telegram_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramId),
    // Purchase promos are reserved with their financial intent. This lets a
    // failed or reconciled saga release the cap safely instead of burning it.
    purchaseIntentId: text('purchase_intent_id').references(() => purchaseIntents.id),
    status: text('status').notNull().default('completed'), // 'pending', 'completed'
    redeemedAt: timestamp('redeemed_at').notNull().defaultNow(),
  },
  (t) => [
    check('code_redemptions_status_supported', sql`${t.status} IN ('pending', 'completed')`),
    uniqueIndex('code_redemptions_purchase_intent_unique')
      .on(t.purchaseIntentId)
      .where(sql`${t.purchaseIntentId} IS NOT NULL`),
    index('code_redemptions_user_code_idx').on(t.code, t.telegramId),
  ]
);

/**
 * Immutable administrative event stream. It complements (rather than
 * overloads) the financial ledger, so rejected receipts and control actions
 * remain auditable even when no money moved.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    actorTelegramId: bigint('actor_telegram_id', { mode: 'number' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    targetTelegramId: bigint('target_telegram_id', { mode: 'number' }),
    metadata: text('metadata'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('audit_logs_entity_idx').on(table.entityType, table.entityId),
    index('audit_logs_target_idx').on(table.targetTelegramId),
  ]
);

// Top-up Receipts (Manual payments pending admin approval)
export const topupReceipts = pgTable(
  'topup_receipts',
  {
    id: text('id').primaryKey(),
    telegramId: bigint('telegram_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramId),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    photoFileId: text('photo_file_id').notNull(),
    mediaType: text('media_type').notNull().default('photo'),
    status: text('status').notNull().default('pending'), // 'pending', 'approved', 'rejected'
    reviewedBy: bigint('reviewed_by', { mode: 'number' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'topup_receipts_amount_positive_safe_integer',
      sql`${table.amount} > 0 AND ${table.amount} <= 9007199254740991`
    ),
    check('topup_receipts_media_type_supported', sql`${table.mediaType} IN ('photo', 'document')`),
    check(
      'topup_receipts_status_supported',
      sql`${table.status} IN ('pending', 'approved', 'rejected')`
    ),
    check(
      'topup_receipts_reviewed_by_safe_integer',
      sql`${table.reviewedBy} IS NULL OR (${table.reviewedBy} > 0 AND ${table.reviewedBy} <= 9007199254740991)`
    ),
  ]
);

// grammY Session Storage Table
export const grammySessions = pgTable('grammy_sessions', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// Counter Table for Dynamic Naming Sync
export const configCounters = pgTable(
  'config_counters',
  {
    mode: text('mode').primaryKey(), // 'prefix_number', etc.
    currentCount: integer('current_count').notNull().default(0),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [check('config_counters_nonnegative', sql`${table.currentCount} >= 0`)]
);

// Package Categories (Optional categorization for packages)
export const packageCategories = pgTable(
  'package_categories',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    displayOrder: integer('display_order').notNull().default(0),
    icon: text('icon'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check('package_categories_id_safe', sql`length(btrim(${table.id})) BETWEEN 1 AND 64`),
    check('package_categories_name_safe', sql`length(btrim(${table.name})) BETWEEN 1 AND 100`),
    check('package_categories_display_order_safe', sql`${table.displayOrder} >= 0`),
    index('package_categories_order_idx').on(table.displayOrder, table.createdAt),
  ]
);
