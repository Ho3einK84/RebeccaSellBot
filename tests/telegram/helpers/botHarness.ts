import { Bot, session, type Context } from 'grammy';
import type { Update } from 'grammy/types';
import { vi } from 'vitest';
import { safeFormattingTransformer } from '../../../src/telegram/rendering.js';
import type { BotServices, MenuContext, SessionData } from '../../../src/telegram/types.js';
import { cleanChatUiMiddleware, uiMessageTrackingTransformer } from '../../../src/telegram/ui.js';

export interface RecordedApiCall {
  method: string;
  payload: Record<string, unknown>;
}

export interface ApiErrorRule {
  method: string;
  description: string;
  status?: number;
  errorCode?: number;
  once?: boolean;
  match?: (payload: Record<string, unknown>) => boolean;
}

export interface TranslationMockOptions {
  locale?: 'fa' | 'en';
  settings?: Record<string, string>;
  overrides?: Record<string, unknown>;
}

export function createMockTranslationService(options: TranslationMockOptions = {}) {
  const defaultLocale = options.locale ?? 'fa';
  const settings = new Map<string, string>(Object.entries(options.settings ?? {}));

  const stub = {
    resolveLocale: vi.fn((locale?: string | null) =>
      locale?.toLowerCase().startsWith('en') ? 'en' : defaultLocale
    ),
    getDefaultLocale: vi.fn(() => defaultLocale),
    setDefaultLocale: vi.fn(async () => undefined),
    get: vi.fn((key: string, _locale?: string, vars?: Record<string, unknown>) => {
      if (!vars || Object.keys(vars).length === 0) return key;
      const serialized = Object.entries(vars)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(',');
      return `${key}[${serialized}]`;
    }),
    getSetting: vi.fn((key: string, fallback = '') => settings.get(key) ?? fallback),
    getSettingBool: vi.fn((key: string, fallback = false) => {
      const val = settings.get(key);
      if (val === undefined) return fallback;
      return val === 'true' || val === '1';
    }),
    getSettingNum: vi.fn((key: string, fallback = 0) => {
      const val = settings.get(key);
      if (val === undefined) return fallback;
      const parsed = Number(val);
      return Number.isFinite(parsed) ? parsed : fallback;
    }),
    getStoredSetting: vi.fn((key: string) => settings.get(key) ?? null),
    updateSetting: vi.fn(async (key: string, value: string) => {
      settings.set(key, value);
    }),
    deleteSetting: vi.fn(async (key: string) => {
      settings.delete(key);
    }),
    getTranslationKeys: vi.fn(() => [] as string[]),
    getCustomizedKeys: vi.fn(() => [] as Array<{ key: string; fa?: string; en?: string }>),
    searchTranslations: vi.fn(() => [] as string[]),
    ...options.overrides,
  };

  return stub;
}

export type ServiceOverrides = {
  [K in keyof BotServices]?: BotServices[K] extends (...args: never[]) => unknown
    ? BotServices[K]
    : BotServices[K] extends object
      ? Partial<Record<keyof BotServices[K] | string, unknown>>
      : BotServices[K];
};

export function createMockServices(overrides: ServiceOverrides = {}): BotServices {
  const adminIds = overrides.adminIds ?? [1];
  const translationService = createMockTranslationService({
    overrides: overrides.translationService as Record<string, unknown> | undefined,
  });

  const defaults: Record<string, unknown> = {
    adminIds,
    isAdmin: vi.fn((telegramId: number) => adminIds.includes(telegramId)),
    botUsername: overrides.botUsername ?? 'rebecca_test_bot',
    supportUrl: overrides.supportUrl,
    webAppUrl: overrides.webAppUrl,
    webAppPort: overrides.webAppPort,
    webAppHostPort: overrides.webAppHostPort,
    translationService,
    userService: {
      exists: vi.fn().mockResolvedValue(true),
      getLocale: vi.fn().mockResolvedValue('fa'),
      setLocale: vi.fn().mockResolvedValue(undefined),
      isBanned: vi.fn().mockResolvedValue(false),
      getUserByTelegramId: vi.fn().mockResolvedValue(null),
      ...(overrides.userService as object),
    },
    walletService: {
      getOrCreateUser: vi.fn().mockResolvedValue({
        telegramId: 100,
        locale: 'fa',
        localeManual: false,
        isBanned: false,
        balance: 0,
        reservedBalance: 0,
        totalSpend: 0,
      }),
      getBalance: vi.fn().mockResolvedValue(0),
      getAvailableBalance: vi.fn().mockResolvedValue(0),
      getStatement: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      submitTopupReceipt: vi.fn().mockResolvedValue('rcpt-1'),
      ...(overrides.walletService as object),
    },
    configService: {
      listConfigs: vi.fn().mockResolvedValue([]),
      getConfigById: vi.fn().mockResolvedValue(null),
      extractSubUrl: vi.fn(() => null),
      formatDurationFromDays: vi.fn((days: number) => `${days}d`),
      deleteConfig: vi.fn().mockResolvedValue({ success: true }),
      ...(overrides.configService as object),
    },
    pricingService: {
      getPackages: vi.fn(() => []),
      getPackageById: vi.fn(() => null),
      getCustomPriceQuote: vi.fn(() => ({ pricePerGb: 5000, totalPrice: 50000 })),
      getCustomVolumeTarget: vi.fn(() => ({ panelId: 'p1', serviceId: 1 })),
      ...(overrides.pricingService as object),
    },
    packageCategoryService: {
      listCategories: vi.fn().mockResolvedValue([]),
      getCategoryById: vi.fn().mockResolvedValue(null),
      ...(overrides.packageCategoryService as object),
    },
    paymentService: {
      listPaymentMethods: vi.fn().mockResolvedValue([]),
      getActiveCard: vi.fn().mockResolvedValue(null),
      ...(overrides.paymentService as object),
    },
    purchaseCheckoutService: {
      purchasePackage: vi.fn(),
      purchaseCustomVolume: vi.fn(),
      renewConfig: vi.fn(),
      ...(overrides.purchaseCheckoutService as object),
    },
    promoService: {
      validateCode: vi.fn(),
      listPromos: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      ...(overrides.promoService as object),
    },
    referralService: {
      getStats: vi.fn().mockResolvedValue({ referredCount: 0, totalBonus: 0, code: 'ref_100' }),
      ...(overrides.referralService as object),
    },
    trialService: {
      isEligible: vi.fn().mockResolvedValue({ eligible: true }),
      ...(overrides.trialService as object),
    },
    panelRegistry: {
      listPanels: vi.fn().mockResolvedValue([]),
      getPanel: vi.fn().mockResolvedValue(null),
      ...(overrides.panelRegistry as object),
    },
    adminService: {
      listAdmins: vi.fn().mockResolvedValue([]),
      getDashboardStats: vi.fn().mockResolvedValue({}),
      ...(overrides.adminService as object),
    },
    refundService: {
      listReceipts: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      ...(overrides.refundService as object),
    },
    configTransferService: {
      transferConfig: vi.fn(),
      ...(overrides.configTransferService as object),
    },
    configReconciliationService: {
      listOpenIssues: vi.fn().mockResolvedValue([]),
      ...(overrides.configReconciliationService as object),
    },
    broadcastService: {
      sendBroadcast: vi.fn(),
      ...(overrides.broadcastService as object),
    },
    backupService: {
      createAndSendBackup: vi.fn(),
      ...(overrides.backupService as object),
    },
    luckyWheelService: {
      getStatus: vi.fn().mockResolvedValue({
        enabled: true,
        canSpin: true,
        dailyLimit: 1,
        spinsToday: 0,
        minPrize: 1000,
        maxPrize: 5000,
      }),
      spin: vi.fn(),
      ...(overrides.luckyWheelService as object),
    },
  };

  for (const [k, v] of Object.entries(overrides)) {
    if (
      k !== 'translationService' &&
      k !== 'userService' &&
      k !== 'walletService' &&
      k !== 'configService' &&
      k !== 'pricingService' &&
      k !== 'packageCategoryService' &&
      k !== 'paymentService' &&
      k !== 'purchaseCheckoutService' &&
      k !== 'promoService' &&
      k !== 'referralService' &&
      k !== 'trialService' &&
      k !== 'panelRegistry' &&
      k !== 'adminService' &&
      k !== 'refundService' &&
      k !== 'configTransferService' &&
      k !== 'configReconciliationService' &&
      k !== 'broadcastService' &&
      k !== 'backupService' &&
      k !== 'luckyWheelService'
    ) {
      defaults[k] = v;
    }
  }

  return defaults as unknown as BotServices;
}

export interface BotHarnessOptions {
  services?: BotServices;
  defaultLocale?: 'fa' | 'en';
  withCleanChatUi?: boolean;
  withSafeFormatting?: boolean;
  withUiTracking?: boolean;
  initialSession?: Record<string, SessionData>;
  onError?: (err: unknown) => void;
}

export function createBotHarness(options: BotHarnessOptions = {}) {
  const services = options.services ?? createMockServices();
  const apiCalls: RecordedApiCall[] = [];
  const errorRules: ApiErrorRule[] = [];
  const sessionMap = new Map<string, SessionData>(
    Object.entries(options.initialSession ?? {}).map(([k, v]) => [k, { ...v }])
  );

  let nextMessageId = 100;
  let nextUpdateId = 1;

  const customFetch = vi.fn(async (url: unknown, init?: { body?: unknown }) => {
    const method = String(url).split('/').pop() ?? 'unknown';
    let payload: Record<string, unknown> = {};
    if (typeof init?.body === 'string') {
      payload = JSON.parse(init.body) as Record<string, unknown>;
    }
    apiCalls.push({ method, payload });

    const errorIdx = errorRules.findIndex(
      (rule) => rule.method === method && (!rule.match || rule.match(payload))
    );
    if (errorIdx >= 0) {
      const rule = errorRules[errorIdx]!;
      if (rule.once !== false) {
        errorRules.splice(errorIdx, 1);
      }
      const status = rule.status ?? 400;
      return {
        ok: false,
        status,
        json: async () => ({
          ok: false,
          error_code: rule.errorCode ?? status,
          description: rule.description,
        }),
      };
    }

    if (
      method === 'sendMessage' ||
      method === 'sendPhoto' ||
      method === 'sendDocument' ||
      method === 'copyMessage'
    ) {
      const msg = {
        message_id: ++nextMessageId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: payload.chat_id ?? 100, type: 'private' },
        text: payload.text ?? undefined,
        caption: payload.caption ?? undefined,
      };
      return { ok: true, status: 200, json: async () => ({ ok: true, result: msg }) };
    }

    if (method === 'editMessageText' || method === 'editMessageCaption') {
      const msg = {
        message_id: payload.message_id ?? nextMessageId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: payload.chat_id ?? 100, type: 'private' },
        text: payload.text ?? undefined,
        caption: payload.caption ?? undefined,
      };
      return { ok: true, status: 200, json: async () => ({ ok: true, result: msg }) };
    }

    if (method === 'getMe') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: bot.botInfo,
        }),
      };
    }

    return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
  });

  const bot = new Bot<MenuContext>('123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11', {
    client: { fetch: customFetch as unknown as typeof fetch },
  });

  bot.botInfo = {
    id: 123456,
    is_bot: true,
    first_name: 'TestBot',
    username: services.botUsername ?? 'rebecca_test_bot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
  };

  if (options.withSafeFormatting !== false) {
    bot.api.config.use(safeFormattingTransformer());
  }
  if (options.withUiTracking !== false) {
    bot.api.config.use(uiMessageTrackingTransformer());
  }

  bot.catch((err) => {
    if (options.onError) {
      options.onError(err);
      return;
    }
    throw err.error;
  });

  bot.use(async (ctx, next) => {
    ctx.services = services;
    ctx.userLocale = options.defaultLocale ?? 'fa';
    return next();
  });

  bot.use(
    session<SessionData, Context>({
      initial: () => ({}),
      storage: {
        read: (key) => sessionMap.get(key),
        write: (key, value) => {
          sessionMap.set(key, value);
        },
        delete: (key) => {
          sessionMap.delete(key);
        },
      },
      getSessionKey: (ctx) => (ctx.chat && ctx.from ? `${ctx.chat.id}:${ctx.from.id}` : undefined),
    })
  );

  if (options.withCleanChatUi !== false) {
    bot.use(cleanChatUiMiddleware());
  }

  async function sendText(
    text: string,
    opts: {
      userId?: number;
      chatId?: number;
      chatType?: 'private' | 'group';
      username?: string;
    } = {}
  ) {
    const userId = opts.userId ?? 100;
    const chatId = opts.chatId ?? userId;
    const chatType = opts.chatType ?? 'private';
    const entities = text.startsWith('/')
      ? [{ offset: 0, length: text.split(/\s/u)[0]!.length, type: 'bot_command' as const }]
      : undefined;

    const update: Update = {
      update_id: nextUpdateId++,
      message: {
        message_id: ++nextMessageId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: chatType },
        from: {
          id: userId,
          is_bot: false,
          first_name: 'User',
          username: opts.username ?? 'user',
        },
        text,
        ...(entities ? { entities } : {}),
      } as unknown as NonNullable<Update['message']>,
    };
    await bot.handleUpdate(update);
  }

  async function sendPhoto(
    fileId: string,
    opts: { userId?: number; chatId?: number; caption?: string } = {}
  ) {
    const userId = opts.userId ?? 100;
    const chatId = opts.chatId ?? userId;
    const update: Update = {
      update_id: nextUpdateId++,
      message: {
        message_id: ++nextMessageId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private' },
        from: { id: userId, is_bot: false, first_name: 'User', username: 'user' },
        photo: [{ file_id: fileId, file_unique_id: fileId, width: 100, height: 100 }],
        caption: opts.caption,
      } as unknown as NonNullable<Update['message']>,
    };
    await bot.handleUpdate(update);
  }

  async function sendCallback(
    data: string,
    opts: {
      userId?: number;
      chatId?: number;
      chatType?: 'private' | 'group';
      messageId?: number;
      isCaptionMessage?: boolean;
      username?: string;
    } = {}
  ) {
    const userId = opts.userId ?? 100;
    const chatId = opts.chatId ?? userId;
    const chatType = opts.chatType ?? 'private';
    const messageId = opts.messageId ?? nextMessageId;
    const update: Update = {
      update_id: nextUpdateId++,
      callback_query: {
        id: `cb-${nextUpdateId}`,
        from: {
          id: userId,
          is_bot: false,
          first_name: 'User',
          username: opts.username ?? 'user',
        },
        chat_instance: 'ci-1',
        data,
        message: {
          message_id: messageId,
          date: Math.floor(Date.now() / 1000),
          chat: { id: chatId, type: chatType },
          ...(opts.isCaptionMessage
            ? { caption: 'Previous caption' }
            : { text: 'Previous screen' }),
        },
      } as unknown as NonNullable<Update['callback_query']>,
    };
    await bot.handleUpdate(update);
  }

  return {
    bot,
    services,
    apiCalls,
    customFetch,
    callsFor(method: string) {
      return apiCalls.filter((c) => c.method === method);
    },
    clearCalls() {
      apiCalls.length = 0;
    },
    pushApiError(rule: ApiErrorRule) {
      errorRules.push(rule);
    },
    getSession(userId = 100, chatId = userId): SessionData | undefined {
      return sessionMap.get(`${chatId}:${userId}`);
    },
    setSession(userId: number, value: SessionData, chatId = userId) {
      sessionMap.set(`${chatId}:${userId}`, value);
    },
    sendText,
    sendPhoto,
    sendCallback,
  };
}

export function extractCallbackDataList(replyMarkup: unknown): string[] {
  if (!replyMarkup || typeof replyMarkup !== 'object') return [];
  const kb = replyMarkup as { inline_keyboard?: Array<Array<{ callback_data?: string }>> };
  const rows = kb.inline_keyboard ?? [];
  return rows.flatMap((row) =>
    row.flatMap((btn) => (btn.callback_data ? [btn.callback_data] : []))
  );
}
