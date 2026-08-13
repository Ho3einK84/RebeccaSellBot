/**
 * Canonical context types for the bot.
 *
 * All keyboard and conversation files import from here — no local re-definitions.
 */
import type { Context, SessionFlavor } from 'grammy';
import type { Conversation, ConversationFlavor } from '@grammyjs/conversations';
import type { MenuFlavor } from '@grammyjs/menu';
import type { WalletService } from '../domain/services/WalletService.js';
import type { ConfigService } from '../domain/services/ConfigService.js';
import type { PricingService } from '../domain/services/PricingService.js';
import type { PromoService } from '../domain/services/PromoService.js';
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

export type UiMessageRole = 'screen' | 'prompt' | 'artifact' | 'notification';

export interface SessionData {
  /** A validated code to be consumed atomically by the next purchase saga. */
  pendingPromo?: {
    code: string;
    type: PurchasePromoType;
    value: number;
    selectedAt: number;
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
  renewConfigId?: string;
  /** Package terms awaiting the user's explicit auto-renew confirmation. */
  pendingAutoRenew?: { configId: string; packageId: string; price: number };
  adminPanelId?: string;
  adminPanelAction?: 'add' | 'name' | 'url' | 'add_service' | 'await_add_key' | 'await_api_key';
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
  [key: string]: unknown;
}

export type BotServices = {
  walletService: WalletService;
  configService: ConfigService;
  pricingService: PricingService;
  purchaseCheckoutService: PurchaseCheckoutService;
  promoService: PromoService;
  trialService: TrialService;
  translationService: TranslationService;
  panelRegistry: RebeccaPanelRegistry;
  userService: UserService;
  adminService: AdminService;
  refundService: RefundService;
  configTransferService: ConfigTransferService;
  configReconciliationService: ConfigReconciliationService;
  broadcastService: BroadcastService;
  /** Optional Telegram-compatible support destination rendered as a URL button. */
  supportUrl?: string;
  /** Telegram IDs authorized to use the administrative dashboard. */
  adminIds: number[];
  /** Sole authorization source for Telegram administrative operations. */
  isAdmin: (telegramId: number) => boolean;
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
