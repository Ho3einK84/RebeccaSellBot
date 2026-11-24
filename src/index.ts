import { loadConfig } from './infra/config.js';
import { initLogger, logger } from './infra/logger.js';
import { initDatabase, closeDatabase } from './infra/db.js';
import { autoMigrate } from './infra/migrate.js';
import { RebeccaPanelRegistry } from './domain/services/RebeccaPanelRegistry.js';
import { PurchaseCheckoutService } from './domain/services/PurchaseCheckoutService.js';
import { TranslationService } from './domain/services/TranslationService.js';
import { WalletService } from './domain/services/WalletService.js';
import { ConfigService } from './domain/services/ConfigService.js';
import { PricingService } from './domain/services/PricingService.js';
import { PromoService } from './domain/services/PromoService.js';
import { ReferralService } from './domain/services/ReferralService.js';
import { TrialService } from './domain/services/TrialService.js';
import { UserService } from './domain/services/UserService.js';
import { AdminService } from './domain/services/AdminService.js';
import { RefundService } from './domain/services/RefundService.js';
import { ConfigTransferService } from './domain/services/ConfigTransferService.js';
import { ConfigReconciliationService } from './domain/services/ConfigReconciliationService.js';
import { BroadcastService } from './domain/services/BroadcastService.js';
import { PackageCategoryService } from './domain/services/PackageCategoryService.js';
import { PaymentService } from './domain/services/PaymentService.js';
import { AutomatedPaymentService } from './domain/services/AutomatedPaymentService.js';
import { BackupService } from './domain/services/BackupService.js';
import { LuckyWheelService } from './domain/services/LuckyWheelService.js';
import { CatalogDiscountService } from './domain/services/CatalogDiscountService.js';
import { ContactVerificationService } from './domain/services/ContactVerificationService.js';
import { ForcedJoinService } from './domain/services/ForcedJoinService.js';
import { BulkGiftService } from './domain/services/BulkGiftService.js';
import { ScheduledMessageDeletionService } from './domain/services/ScheduledMessageDeletionService.js';
import { DomainRegistryService } from './domain/services/DomainRegistryService.js';
import {
  normalizeDomainInput,
  verifyDomainSslAndReachability,
} from './domain/services/domainVerification.js';
import {
  initializeBot,
  setupBot,
  startBot,
  startWebhookServer,
  registerWebhook,
  type WebhookServerHandle,
} from './telegram/bot.js';
import { syncAdminBotCommands } from './telegram/admin/adminCommands.js';
import { InputFile } from 'grammy';
import type { BotServices } from './telegram/types.js';
import { startWebAppServer, type WebAppServerHandle } from './webapp/server/server.js';
import type http from 'node:http';
import { RebeccaWebhookService } from './domain/services/RebeccaWebhookService.js';
import {
  markHealthFailed,
  markHealthReady,
  markHealthStopping,
  setHealthPhase,
  startHealthCheckServer,
  stopHealthCheckServer,
  registerHealthCheckFallbackHandler,
} from './infra/healthcheck.js';
import { startNotifierCron, stopNotifierCron } from './jobs/notifier.js';
import { startReconciliationCron, stopReconciliationCron } from './jobs/reconciler.js';
import { startTrialCleanupCron, stopTrialCleanupCron } from './jobs/trialCleanup.js';
import { startAutoRenewalCron, stopAutoRenewalCron } from './jobs/autoRenewal.js';
import { startBroadcastWorker, stopBroadcastWorker } from './jobs/broadcast.js';
import { startBulkGiftWorker, stopBulkGiftWorker } from './jobs/bulkGift.js';
import { startBackupCron, stopBackupCron } from './jobs/backup.js';
import { startFirstUseNudgeJob, stopFirstUseNudgeJob } from './jobs/firstUseNudge.js';
import {
  startExpiredConfigCleanupJob,
  stopExpiredConfigCleanupJob,
} from './jobs/expiredConfigCleanup.js';
import {
  startForAppFallbackNudgeJob,
  stopForAppFallbackNudgeJob,
} from './jobs/forappFallbackNudge.js';
import {
  startScheduledMessageDeletionJob,
  stopScheduledMessageDeletionJob,
} from './jobs/scheduledMessageDeletion.js';
import { jobRunner } from './jobs/workerRuntime.js';

const WORKER_SHUTDOWN_TIMEOUT_MS = 30_000;
const REBECCA_WEBHOOK_MAX_BYTES = 1024 * 1024;
let activeWebhookHandle: WebhookServerHandle | null = null;
let activeWebAppHandle: WebAppServerHandle | null = null;
let activeBot: ReturnType<typeof setupBot> | null = null;
let shuttingDown = false;

export interface RebeccaWebhookTarget {
  handleWebhook(
    payload: unknown,
    secretHeader: string | string[] | undefined
  ): Promise<{ statusCode: number }>;
}

export interface StartupWebAppState {
  webAppUrl: string | undefined;
  shouldRegisterMesh: boolean;
}

/** Resolve startup WebApp URL and whether the instance belongs in the mesh registry. */
export function resolveStartupWebAppState(
  envWebAppUrl: string | undefined,
  storedWebAppEnabled: boolean,
  storedWebAppUrl: string
): StartupWebAppState {
  const normalizedEnvUrl = envWebAppUrl?.trim();
  const normalizedStoredUrl = storedWebAppUrl.trim();
  if (normalizedEnvUrl) {
    return { webAppUrl: normalizedEnvUrl, shouldRegisterMesh: true };
  }
  if (storedWebAppEnabled && normalizedStoredUrl) {
    return { webAppUrl: normalizedStoredUrl, shouldRegisterMesh: true };
  }
  return { webAppUrl: undefined, shouldRegisterMesh: false };
}

/**
 * Create the HTTP fallback handler for Rebecca panel webhook notifications.
 * Enforces exact path matching, POST method, 1 MiB UTF-8 byte ceiling, and
 * separates JSON parse errors (400) from downstream service errors (500).
 */
export function createRebeccaWebhookRequestHandler(
  rebeccaWebhookService: RebeccaWebhookTarget,
  webhookPath?: string
): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<boolean> {
  const targetPath = (webhookPath || '/api/rebecca-webhook').replace(/\/+$/, '') || '/';

  return async (req, res) => {
    const rawUrl = req.url ?? '/';
    const pathname = rawUrl.split('?')[0].replace(/\/+$/, '') || '/';

    // Exact match only: a suffix match would let `/evil/api/rebecca-webhook`
    // reach the event processor (user DMs + reconciliation scan = spam/DoS).
    if (pathname !== targetPath) {
      return false;
    }

    if (req.method !== 'POST') {
      if (!res.headersSent) {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed');
      }
      return true;
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    try {
      for await (const chunk of req) {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : (chunk as Buffer);
        totalBytes += buf.byteLength;
        if (totalBytes > REBECCA_WEBHOOK_MAX_BYTES) {
          req.destroy();
          if (!res.headersSent) {
            res.writeHead(413, { 'Content-Type': 'text/plain' });
            res.end('Payload Too Large');
          }
          return true;
        }
        chunks.push(buf);
      }
    } catch {
      if (!res.headersSent) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
      return true;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      if (!res.headersSent) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
      return true;
    }

    try {
      const secretHeader = req.headers['x-webhook-secret'];
      const result = await rebeccaWebhookService.handleWebhook(parsed, secretHeader);
      if (!res.headersSent) {
        res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      }
    } catch (err) {
      logger.error({ err }, 'Unhandled error while processing Rebecca webhook');
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      }
    }
    return true;
  };
}

export interface DynamicWebAppDeps {
  startServer: () => Promise<WebAppServerHandle>;
  persistEnabledState: (url: string) => Promise<void>;
  registerDomain: () => void;
  unregisterDomain: () => void;
  getRuntimeUrl: () => string | undefined;
  setRuntimeUrl: (url: string | undefined) => void;
  getExistingHandle: () => WebAppServerHandle | null;
  setHandle: (handle: WebAppServerHandle | null) => void;
  probeSsl: (url: string, timeoutMs: number) => Promise<{ ok: boolean }>;
}

/**
 * Start the WebApp server before mutating mesh registry or persisted settings,
 * rolling back runtime/server/mesh state if any activation step fails.
 */
export async function activateDynamicWebApp(
  normalizedUrl: string,
  deps: DynamicWebAppDeps
): Promise<{ success: true; sslActive: boolean; normalizedUrl: string }> {
  const previousUrl = deps.getRuntimeUrl();
  const hadExistingHandle = deps.getExistingHandle() !== null;
  let startedHandle: WebAppServerHandle | null = null;
  let domainRegistered = false;

  const rollback = async () => {
    if (domainRegistered) {
      try {
        deps.unregisterDomain();
      } catch {
        // best-effort rollback
      }
    }
    deps.setRuntimeUrl(previousUrl);
    if (startedHandle) {
      deps.setHandle(null);
      await startedHandle.close().catch(() => {});
    }
  };

  if (!hadExistingHandle) {
    startedHandle = await deps.startServer();
    deps.setHandle(startedHandle);
  }

  try {
    deps.setRuntimeUrl(normalizedUrl);
    deps.registerDomain();
    domainRegistered = true;
    await deps.persistEnabledState(normalizedUrl);
  } catch (err) {
    await rollback();
    throw err;
  }

  let sslActive: boolean;
  try {
    const probeRes = await deps.probeSsl(normalizedUrl, 10000);
    sslActive = probeRes.ok;
  } catch {
    sslActive = false;
  }

  return { success: true, sslActive, normalizedUrl };
}

function stopScheduledWorkers(): void {
  stopReconciliationCron();
  stopNotifierCron();
  stopTrialCleanupCron();
  stopAutoRenewalCron();
  stopBroadcastWorker();
  stopBulkGiftWorker();
  stopBackupCron();
  stopFirstUseNudgeJob();
  stopExpiredConfigCleanupJob();
  stopForAppFallbackNudgeJob();
  stopScheduledMessageDeletionJob();
}

async function drainWorkers(): Promise<void> {
  const drained = await jobRunner.waitForIdle(WORKER_SHUTDOWN_TIMEOUT_MS);
  if (!drained) {
    logger.warn(
      { activeJobs: jobRunner.activeJobNames(), timeoutMs: WORKER_SHUTDOWN_TIMEOUT_MS },
      'Timed out waiting for background workers during shutdown'
    );
  }
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  markHealthStopping();
  logger.info({ signal }, 'Shutting down gracefully...');
  let exitCode = 0;
  stopScheduledWorkers();

  if (activeWebAppHandle) {
    await activeWebAppHandle.close().catch((err) => {
      exitCode = 1;
      logger.error({ err }, 'Failed to close Web App server during shutdown');
    });
    activeWebAppHandle = null;
  }

  if (activeWebhookHandle) {
    await activeWebhookHandle.close().catch((err) => {
      exitCode = 1;
      logger.error({ err }, 'Failed to close webhook server during shutdown');
    });
    activeWebhookHandle = null;
  }

  if (activeBot?.isRunning()) {
    await activeBot.stop().catch((err) => {
      exitCode = 1;
      logger.error({ err }, 'Failed to stop Telegram polling during shutdown');
    });
  }
  await drainWorkers().catch((err) => {
    exitCode = 1;
    logger.error({ err }, 'Failed to drain background workers during shutdown');
  });
  await stopHealthCheckServer().catch((err) => {
    exitCode = 1;
    logger.error({ err }, 'Failed to close health check server during shutdown');
  });
  await closeDatabase().catch((err) => {
    exitCode = 1;
    logger.error({ err }, 'Failed to close database during shutdown');
  });
  process.exit(exitCode);
}

async function main() {
  initLogger();
  logger.info('Starting RebeccaSellBot...');

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  const config = loadConfig();
  const healthCheckHost =
    config.BOT_DELIVERY_MODE === 'webhook' && config.WEBHOOK_PORT === config.HEALTH_CHECK_PORT
      ? config.WEBHOOK_HOST
      : '127.0.0.1';
  await startHealthCheckServer(config.HEALTH_CHECK_PORT, healthCheckHost);

  setHealthPhase('database_migrations');
  const { db } = initDatabase(config.DATABASE_URL, config.DATABASE_POOL_SIZE);
  await autoMigrate(db);

  setHealthPhase('services_initialization');
  const translationService = new TranslationService({ defaultLocale: config.DEFAULT_LOCALE });
  await translationService.ensureDefaultSettings();
  if (!config.PANEL_CREDENTIALS_KEY) {
    logger.warn(
      'PANEL_CREDENTIALS_KEY is unset; the bot token is being used as a legacy credential key fallback'
    );
  }
  const panelRegistry = new RebeccaPanelRegistry(
    {
      ...(config.REBECCA_API_URL ? { baseUrl: config.REBECCA_API_URL } : {}),
      ...(config.REBECCA_API_KEY ? { apiKey: config.REBECCA_API_KEY } : {}),
      ...(config.REBECCA_ADMIN_USERNAME ? { adminUsername: config.REBECCA_ADMIN_USERNAME } : {}),
      ...(config.REBECCA_ADMIN_PASSWORD ? { adminPassword: config.REBECCA_ADMIN_PASSWORD } : {}),
      serviceId: config.REBECCA_SERVICE_ID,
    },
    config.PANEL_CREDENTIALS_KEY ?? config.BOT_TOKEN
  );
  await panelRegistry.initialize(translationService);

  const referralService = new ReferralService(translationService);
  const promoService = new PromoService();
  const walletService = new WalletService(
    panelRegistry,
    translationService,
    referralService,
    promoService
  );
  referralService.registerInvalidationHook((telegramId) =>
    walletService.invalidateUserCache(telegramId)
  );
  const configService = new ConfigService(panelRegistry, translationService);
  const pricingService = new PricingService(translationService);
  const purchaseCheckoutService = new PurchaseCheckoutService(panelRegistry);
  const trialService = new TrialService(panelRegistry, translationService);
  const userService = new UserService();
  userService.registerInvalidationHook((telegramId) =>
    walletService.invalidateUserCache(telegramId)
  );
  const adminService = new AdminService();
  await adminService.initialize(config.ADMIN_IDS);
  const refundService = new RefundService(panelRegistry, translationService);
  refundService.registerInvalidationHook((telegramId) =>
    walletService.invalidateUserCache(telegramId)
  );
  const configTransferService = new ConfigTransferService(panelRegistry);
  const configReconciliationService = new ConfigReconciliationService(panelRegistry);
  const broadcastService = new BroadcastService();
  const packageCategoryService = new PackageCategoryService(translationService);
  const paymentService = new PaymentService(translationService, walletService);
  let currentWebAppUrl: string | undefined;
  const automatedPaymentService = new AutomatedPaymentService({
    translationService,
    paymentService,
    walletService,
    credentialSecret: config.PANEL_CREDENTIALS_KEY ?? config.BOT_TOKEN,
    resolvePublicBaseUrl: () =>
      currentWebAppUrl ||
      translationService.getSetting('webapp_url', '').trim() ||
      config.WEBAPP_URL ||
      config.WEBHOOK_URL,
  });
  const backupService = new BackupService(translationService, {
    databaseUrl: config.DATABASE_URL,
    instanceName: config.INSTANCE_NAME,
    createDocumentInput: (filePath, fileName) => new InputFile(filePath, fileName),
  });
  const luckyWheelService = new LuckyWheelService(translationService);
  luckyWheelService.registerInvalidationHook((telegramId) =>
    walletService.invalidateUserCache(telegramId)
  );
  const catalogDiscountService = new CatalogDiscountService();
  const contactVerificationService = new ContactVerificationService({
    translationService,
    botToken: config.BOT_TOKEN,
  });
  const bulkGiftService = new BulkGiftService(panelRegistry);
  const scheduledMessageDeletionService = new ScheduledMessageDeletionService();
  const botApiRef: { current?: BotServices['botApi'] } = {};
  const forcedJoinService = new ForcedJoinService({
    translationService,
    isAdmin: (telegramId) => adminService.isAdmin(telegramId),
    getAdapter: () =>
      botApiRef.current
        ? {
            getChatMember: (chatId, userId) => botApiRef.current!.getChatMember(chatId, userId),
            getMe: () => botApiRef.current!.getMe(),
            getChat: async (chatId) => {
              const chat = await botApiRef.current!.getChat(chatId);
              return {
                id: chat.id,
                title: 'title' in chat ? chat.title : undefined,
                username: 'username' in chat ? chat.username : undefined,
                invite_link: 'invite_link' in chat ? chat.invite_link : undefined,
              };
            },
          }
        : undefined,
  });

  const domainRegistryService = new DomainRegistryService(config.REGISTRY_DIR);

  const storedWebAppEnabled = translationService.getSettingBool('webapp_enabled', false);
  const storedWebAppUrl = translationService.getSetting('webapp_url').trim();
  const startupWebApp = resolveStartupWebAppState(
    config.WEBAPP_URL,
    storedWebAppEnabled,
    storedWebAppUrl
  );

  currentWebAppUrl = startupWebApp.webAppUrl;

  // On startup, register any active WebApp domain (whether from .env or DB) in the shared mesh registry
  if (startupWebApp.shouldRegisterMesh && currentWebAppUrl) {
    try {
      const parsed = new URL(currentWebAppUrl);
      domainRegistryService.register({
        instance: config.INSTANCE_NAME,
        domain: parsed.hostname,
        url: currentWebAppUrl,
        target:
          config.WEBAPP_TARGET_URL || `http://${config.INSTANCE_NAME}_bot:${config.WEBAPP_PORT}`,
        hostPort: config.WEBAPP_HOST_PORT,
      });
    } catch {
      // ignore invalid URL format on boot
    }
  }

  const enableWebApp = async (
    inputUrl: string
  ): Promise<{ success: boolean; error?: string; sslActive?: boolean; normalizedUrl?: string }> => {
    const normalized = normalizeDomainInput(inputUrl);
    if (!normalized.valid) {
      return { success: false, error: normalized.error || 'Invalid domain or URL format' };
    }

    try {
      return await activateDynamicWebApp(normalized.url, {
        startServer: () => startWebAppServer(config, services),
        persistEnabledState: (url) =>
          translationService.updateSettings({
            webapp_url: url,
            webapp_enabled: 'true',
          }),
        registerDomain: () =>
          domainRegistryService.register({
            instance: config.INSTANCE_NAME,
            domain: normalized.hostname,
            url: normalized.url,
            target:
              config.WEBAPP_TARGET_URL ||
              `http://${config.INSTANCE_NAME}_bot:${config.WEBAPP_PORT}`,
            hostPort: config.WEBAPP_HOST_PORT,
          }),
        unregisterDomain: () => domainRegistryService.unregister(config.INSTANCE_NAME),
        getRuntimeUrl: () => currentWebAppUrl,
        setRuntimeUrl: (url) => {
          currentWebAppUrl = url;
          services.webAppUrl = url;
        },
        getExistingHandle: () => activeWebAppHandle,
        setHandle: (handle) => {
          activeWebAppHandle = handle;
        },
        probeSsl: (url, timeoutMs) => verifyDomainSslAndReachability(url, timeoutMs),
      });
    } catch (err) {
      logger.error({ err }, 'Failed to dynamically enable WebApp');
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to start WebApp server',
      };
    }
  };

  const disableWebApp = async (): Promise<void> => {
    domainRegistryService.unregister(config.INSTANCE_NAME);
    await translationService.updateSetting('webapp_enabled', 'false');
    currentWebAppUrl = undefined;
    services.webAppUrl = undefined;
    if (activeWebAppHandle) {
      const handle = activeWebAppHandle;
      activeWebAppHandle = null;
      await handle.close().catch((err) => {
        logger.error({ err }, 'Error closing WebApp server on disable');
      });
    }
  };

  const isWebAppRunning = (): boolean => {
    return activeWebAppHandle !== null;
  };

  const services: BotServices = {
    walletService,
    configService,
    pricingService,
    packageCategoryService,
    paymentService,
    automatedPaymentService,
    purchaseCheckoutService,
    promoService,
    referralService,
    trialService,
    translationService,
    panelRegistry,
    userService,
    adminService,
    refundService,
    configTransferService,
    configReconciliationService,
    broadcastService,
    backupService,
    luckyWheelService,
    catalogDiscountService,
    contactVerificationService,
    forcedJoinService,
    bulkGiftService,
    scheduledMessageDeletionService,
    supportUrl: config.SUPPORT_URL,
    webAppUrl: currentWebAppUrl,
    webAppPort: config.WEBAPP_HOST_PORT ?? config.WEBAPP_PORT,
    webAppHostPort: config.WEBAPP_HOST_PORT,
    domainRegistryService,
    enableWebApp,
    disableWebApp,
    isWebAppRunning,
    adminIds: adminService.adminIds,
    isAdmin: (telegramId: number) => adminService.isAdmin(telegramId),
  };

  setHealthPhase('telegram_initialization');
  const bot = setupBot(config, services);
  activeBot = bot;
  await initializeBot(bot);
  void syncAdminBotCommands(bot, services);

  // Expose the resolved bot username and bot API to services for WebApp notifications
  services.botUsername = bot.botInfo.username;
  services.botApi = bot.api;
  botApiRef.current = bot.api;

  startNotifierCron(panelRegistry, translationService, bot.api);
  startReconciliationCron(panelRegistry, {
    promoService,
    referralService,
    trialService,
    refundService,
    configReconciliationService,
    purchaseCheckoutService,
  });
  startTrialCleanupCron(panelRegistry, configService);
  startAutoRenewalCron(panelRegistry, walletService, pricingService, translationService, bot.api);
  startBroadcastWorker(broadcastService, bot.api);
  startBulkGiftWorker({
    bulkGiftService,
    telegramApi: bot.api,
    userService,
    configService,
    translationService,
  });
  startBackupCron(backupService, bot.api);
  startFirstUseNudgeJob({
    panels: panelRegistry,
    translationService,
    telegramApi: bot.api,
    supportUrl: config.SUPPORT_URL,
  });
  startExpiredConfigCleanupJob({
    panels: panelRegistry,
    configService,
    translationService,
    telegramApi: bot.api,
  });
  startForAppFallbackNudgeJob({
    translationService,
    telegramApi: bot.api,
    scheduledMessageDeletionService,
  });
  startScheduledMessageDeletionJob({
    service: scheduledMessageDeletionService,
    telegramApi: bot.api,
  });

  const rebeccaWebhookService = new RebeccaWebhookService({
    panels: panelRegistry,
    translationService,
    telegramApi: {
      sendMessage: (chatId, text, options) => {
        const parseMode =
          options?.parse_mode === 'HTML' ||
          options?.parse_mode === 'MarkdownV2' ||
          options?.parse_mode === 'Markdown'
            ? options.parse_mode
            : undefined;
        return bot.api.sendMessage(chatId, text, {
          ...(parseMode ? { parse_mode: parseMode } : {}),
          ...(options?.reply_markup ? { reply_markup: options.reply_markup } : {}),
        });
      },
    },
    walletService,
    pricingService,
    configReconciliationService,
    secret: config.REBECCA_WEBHOOK_SECRET,
  });

  const handleRebeccaWebhookRequest = createRebeccaWebhookRequestHandler(
    rebeccaWebhookService,
    config.REBECCA_WEBHOOK_PATH
  );

  registerHealthCheckFallbackHandler(handleRebeccaWebhookRequest);

  let pollingTask: Promise<void> | null = null;

  if (currentWebAppUrl) {
    activeWebAppHandle = await startWebAppServer(config, services);
  }

  if (config.BOT_DELIVERY_MODE === 'webhook') {
    activeWebhookHandle = await startWebhookServer(bot, config, handleRebeccaWebhookRequest);
    await registerWebhook(bot, config);
    logger.info(
      { url: config.WEBHOOK_URL, port: config.WEBHOOK_PORT },
      'RebeccaSellBot running in webhook mode'
    );
  } else {
    pollingTask = startBot(bot);
    logger.info('RebeccaSellBot running in long-polling mode');
  }

  markHealthReady();

  // A full Rebecca counter scan can take seconds on a large or degraded panel.
  // It must not delay Telegram responsiveness. ConfigService still enforces a
  // target-specific sync before generating the first name on an unsynchronised
  // panel, so moving this warm-up off the startup critical path does not weaken
  // username-collision safety.
  void jobRunner
    .run('config-counter-warmup', async () => {
      await configService.syncCounters();
    })
    .catch((err) => {
      logger.warn({ err }, 'Background counter warm-up failed; will sync on-demand per panel');
    });

  if (pollingTask) {
    await pollingTask;
  }
}

if (!process.env.VITEST) {
  main().catch(async (err) => {
    markHealthFailed(err);
    logger.fatal({ err }, 'Fatal error on application startup or delivery lifecycle');
    stopScheduledWorkers();
    if (activeWebAppHandle) {
      await activeWebAppHandle.close().catch((closeErr) => {
        logger.error({ err: closeErr }, 'Failed to close Web App server after fatal error');
      });
    }
    if (activeWebhookHandle) {
      await activeWebhookHandle.close().catch((closeErr) => {
        logger.error({ err: closeErr }, 'Failed to close webhook server after fatal error');
      });
    }
    if (activeBot?.isRunning()) {
      await activeBot.stop().catch((stopErr) => {
        logger.error({ err: stopErr }, 'Failed to stop Telegram bot after fatal error');
      });
    }
    await drainWorkers().catch((drainErr) => {
      logger.error({ err: drainErr }, 'Failed to drain workers after fatal error');
    });
    await stopHealthCheckServer().catch((healthErr) => {
      logger.error({ err: healthErr }, 'Failed to close health server after fatal error');
    });
    await closeDatabase().catch((closeErr) => {
      logger.error({ err: closeErr }, 'Failed to close database after fatal error');
    });
    process.exit(1);
  });
}
