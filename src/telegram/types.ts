/**
 * Canonical context types for the bot.
 *
 * All keyboard and conversation files import from here — no local re-definitions.
 */
import type { Context, SessionFlavor, Api } from 'grammy';
import type { Conversation, ConversationFlavor } from '@grammyjs/conversations';
import type { MenuFlavor } from '@grammyjs/menu';
import type { WalletService } from '../domain/services/WalletService.js';
import type { ConfigService } from '../domain/services/ConfigService.js';
import type { PricingService } from '../domain/services/PricingService.js';
import type { PromoService } from '../domain/services/PromoService.js';
import type { ReferralService } from '../domain/services/ReferralService.js';
import type { TranslationService } from '../domain/services/TranslationService.js';
import type { TrialService } from '../domain/services/TrialService.js';
import type { RebeccaPanelRegistry } from '../domain/services/RebeccaPanelRegistry.js';
import type { PurchaseCheckoutService } from '../domain/services/PurchaseCheckoutService.js';
import type { UserService } from '../domain/services/UserService.js';
import type { PurchasePromoType } from '../domain/services/PromoService.js';
import type { SupportedLocale } from '../domain/services/TranslationService.js';
import type { AdminService } from '../domain/services/AdminService.js';
import type { RefundService } from '../domain/services/RefundService.js';
import type { ConfigTransferService } from '../domain/services/ConfigTransferService.js';
import type { ConfigReconciliationService } from '../domain/services/ConfigReconciliationService.js';
import type { BroadcastService } from '../domain/services/BroadcastService.js';
import type { PackageCategoryService } from '../domain/services/PackageCategoryService.js';
import type { PaymentService } from '../domain/services/PaymentService.js';
import type { AutomatedPaymentService } from '../domain/services/AutomatedPaymentService.js';
import type { BackupService } from '../domain/services/BackupService.js';
import type { LuckyWheelService } from '../domain/services/LuckyWheelService.js';
import type { DomainRegistryService } from '../domain/services/DomainRegistryService.js';
import type { CatalogDiscountService } from '../domain/services/CatalogDiscountService.js';
import type { ContactVerificationService } from '../domain/services/ContactVerificationService.js';
import type { ForcedJoinService } from '../domain/services/ForcedJoinService.js';
import type { BulkGiftService, BulkGiftTargetStatus } from '../domain/services/BulkGiftService.js';
import type { ScheduledMessageDeletionService } from '../domain/services/ScheduledMessageDeletionService.js';
import type { UserGroupService } from '../domain/services/UserGroupService.js';
import type { InventoryService } from '../domain/services/InventoryService.js';

export type UiMessageRole = 'screen' | 'prompt' | 'artifact' | 'notification';

export type AdminUserListFilter =
  'all' | 'active_subs' | 'has_balance' | 'negative_balance' | 'banned';
export type AdminPromoListFilter = 'all' | 'active' | 'inactive' | 'expired';

export interface AdminInputState {
  kind: string;
  payload?: Record<string, string | number | boolean | null>;
  returnRoute: string;
  createdAt: number;
}

export interface AdminTextsNavState {
  locale: SupportedLocale;
  mode: 'hub' | 'categories' | 'essential' | 'category' | 'customized' | 'search';
  categoryId?: string;
  query?: string;
  page: number;
}

export interface SessionData {
  /** A validated code to be consumed atomically by the next purchase saga. */
  pendingPromo?: {
    code: string;
    type: PurchasePromoType;
    value: number;
    minPurchaseAmount?: number;
    maxDiscountAmount?: number | null;
    selectedAt: number;
  };
  /** Screen that launched promo entry so the flow returns to the same context. */
  promoReturnDestination?: 'shop' | 'wallet';
  /** Checkout item waiting to resume with an updated quote after promo apply/clear. */
  promoCheckoutContext?:
    | { kind: 'new_config'; packageId: string; requestedUsername?: string }
    | { kind: 'renew_config'; configId: string; packageId: string };
  /** Shortfall context captured on insufficient balance to pre-suggest exact top-up amount. */
  pendingTopupIntent?: {
    kind: 'new_config' | 'renew_config';
    packageId?: string;
    configId?: string;
    configUsername?: string;
    deficitAmount: number;
    createdAt: number;
  };
  /** Automated ForApp order transitioning to manual receipt upload fallback. */
  manualFallbackOrder?: {
    orderId: string;
    amount: number;
    cardId?: string;
    cardNumber: string;
    cardHolder: string;
    bankName?: string;
    createdAt: number;
  };
  /** Bot messages that belong to the current private-chat UI screen. */
  uiMessageIds?: number[];
  /** Ephemeral prompt message IDs created during interactive step inputs. */
  promptMessageIds?: number[];
  /** Durable artifact message IDs (subscription links, QR codes, receipts) that must NOT be deleted. */
  artifactMessageIds?: number[];
  /** Promo selected by the administrator before entering an edit conversation. */
  adminPromoEditId?: string;
  /** User selected from the admin profile before entering a balance conversation. */
  adminBalanceTargetTelegramId?: number;
  /** User selected from the profile before entering direct-message flow. */
  adminDirectMessageTargetTelegramId?: number;
  transferConfigId?: string;
  transferConfigOwnerTelegramId?: number;
  orphanAssignIssueId?: string;
  adminOrphanView?: {
    filter: 'all' | 'remote' | 'local' | 'ignored';
    page: number;
    search?: string;
  };
  renewConfigId?: string;
  labelConfigId?: string;
  /** Package terms awaiting the user's explicit auto-renew confirmation. */
  pendingAutoRenew?: { configId: string; packageId: string; price: number };
  adminPanelId?: string;
  adminPanelAction?: 'add' | 'name' | 'url' | 'add_service' | 'await_add_key' | 'await_api_key';
  /** Timestamp when the admin panel secret input action was initiated. */
  adminPanelActionAt?: number;
  /** Non-secret panel fields waiting for a one-shot API-key message. */
  adminPanelDraft?: {
    name: string;
    baseUrl: string;
    serviceId: number;
    serviceName: string;
  };
  /** Exact receipt IDs captured before a destructive batch confirmation. */
  adminReceiptBatch?: { ids: string[]; page: number };
  /** One-time, idempotent quick top-up confirmation issued from an admin profile. */
  adminQuickTopup?: {
    token: string;
    targetTelegramId: number;
    amount: number;
    status: 'pending' | 'submitted';
  };
  subscriptionListPage?: number;
  activeShopCategory?: string;
  /** Package waiting for optional custom service name selection before checkout confirmation. */
  pendingCustomNamePurchase?: { packageId: string };
  /** Post-verification destination so users can smoothly continue after phone verification. */
  phoneVerifyReturnAction?: 'trial' | 'shop' | 'custom_amount' | 'main';
  /** Preserved `/start <payload>` while a user completes mandatory channel join. */
  pendingStartPayload?: string;
  /** Preserved first-touch referral code (`ref_...`) across forced-join gate. */
  pendingReferralCode?: string;
  /** Action blocked by forced channel join so verification resumes smoothly. */
  pendingForcedJoinAction?: {
    kind: 'start' | 'trial' | 'shop' | 'custom_amount' | 'home';
    payload?: string;
  };
  /** Draft state for creating a Bulk Gift campaign in Telegram admin UI. */
  bulkGiftDraft?: {
    giftGb: number;
    giftDays: number;
    statuses: BulkGiftTargetStatus[];
    panelId: string | null;
    serviceId: number | null;
    notifyMessage: string | null;
  };
  /** Return screen when exiting standalone bank cards manager conversation. */
  bankCardsReturnTo?: 'sales' | 'receipts' | 'settings';
  /** Active non-blocking admin text input session (TTL-bounded, stored in Postgres session). */
  adminInput?: AdminInputState;
  /** Bounded admin navigation breadcrumb/back stack for exact cross-link return. */
  adminNavStack?: string[];
  /** Last UI mode visited by an admin so error/expired fallbacks stay in Admin context. */
  adminLastContext?: 'admin' | 'user';
  /** Preserved Users list filter & pagination state. */
  adminUsersView?: { filter: AdminUserListFilter; page: number };
  /** Preserved Promo Center filter & pagination state. */
  adminPromoView?: { filter: AdminPromoListFilter; page: number };
  /** Preserved Panel Registry page state. */
  adminPanelView?: { page: number };
  /** Preserved Receipt approved history search query. */
  adminReceiptHistorySearch?: string;
  /** Preserved stateless Bot Texts browser state. */
  adminTextsView?: AdminTextsNavState;
  /** Transient draft for multi-step admin creations without blocking conversations. */
  adminDraft?: Record<string, unknown>;
  [key: string]: unknown;
}

export type BotServices = {
  walletService: WalletService;
  configService: ConfigService;
  pricingService: PricingService;
  packageCategoryService: PackageCategoryService;
  paymentService: PaymentService;
  /** Automated wallet payment orchestration (ForApp SMS card-to-card & NOWPayments crypto). */
  automatedPaymentService?: AutomatedPaymentService;
  purchaseCheckoutService: PurchaseCheckoutService;
  promoService: PromoService;
  referralService: ReferralService;
  trialService: TrialService;
  translationService: TranslationService;
  panelRegistry: RebeccaPanelRegistry;
  userService: UserService;
  adminService: AdminService;
  refundService: RefundService;
  configTransferService: ConfigTransferService;
  configReconciliationService: ConfigReconciliationService;
  broadcastService: BroadcastService;
  backupService: BackupService;
  luckyWheelService: LuckyWheelService;
  /** Optional timed catalog discounts / flash sales service. */
  catalogDiscountService?: CatalogDiscountService;
  /** Optional HMAC-SHA256 Telegram phone verification service. */
  contactVerificationService?: ContactVerificationService;
  /** Mandatory channel membership service (cache + fail-safe + channel CRUD). */
  forcedJoinService?: ForcedJoinService;
  /** Durable Bulk Gift campaign service (traffic GB and/or validity days). */
  bulkGiftService?: BulkGiftService;
  /** Delayed auto-deletion queue for payment & card messages. */
  scheduledMessageDeletionService?: ScheduledMessageDeletionService;
  /** User group pricing, policy & VIP negative credit limit service. */
  userGroupService?: UserGroupService;
  /** Panel, panel-service, package, custom-volume & trial inventory engine. */
  inventoryService?: InventoryService;
  /** Telegram bot username (e.g. "RebeccaSellBot") from bot.botInfo, for deep links. */
  botUsername?: string;
  /** Optional Telegram-compatible support destination rendered as a URL button. */
  supportUrl?: string;
  /** Optional public HTTPS URL for Telegram Mini App. */
  webAppUrl?: string;
  /** Port on which the local WebApp Fastify server is listening. */
  webAppPort?: number;
  /** Published host port mapped to the WebApp Fastify server for external reverse proxy routing. */
  webAppHostPort?: number;
  /** Shared multi-instance domain registry service for mesh routing. */
  domainRegistryService?: DomainRegistryService;
  /** Dynamically activate the WebApp Fastify server with the specified public HTTPS URL. */
  enableWebApp?: (
    url: string
  ) => Promise<{ success: boolean; error?: string; sslActive?: boolean; normalizedUrl?: string }>;
  /** Dynamically deactivate the WebApp and hide the launch buttons. */
  disableWebApp?: () => Promise<void>;
  /** Check whether the WebApp Fastify server is currently running. */
  isWebAppRunning?: () => boolean;
  /** Telegram IDs authorized to use the administrative dashboard. */
  adminIds: number[];
  /** Sole authorization source for Telegram administrative operations. */
  isAdmin: (telegramId: number) => boolean;
  /** Telegram bot API instance used to deliver notifications. */
  botApi?: Api;
};

/** Properties installed on both normal and conversation-created contexts. */
export type ServiceContext = Context & {
  services?: BotServices;
  /** Durable bot preference, which takes precedence over Telegram's app language. */
  userLocale?: SupportedLocale;
};

/** Context used inside conversation builders (without the conversation flavor). */
export type ConversationContext = ServiceContext;

/**
 * MenuContext — the single context type used by ALL menus and conversations.
 * Includes: session, conversation plugin, menu plugin, and injected services.
 */
export type MenuContext = ServiceContext &
  SessionFlavor<SessionData> &
  ConversationFlavor<Context> &
  MenuFlavor;

/**
 * MyConversation — typed Conversation for this bot.
 */
export type MyConversation = Conversation<MenuContext, ConversationContext>;
