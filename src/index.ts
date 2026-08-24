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
import { BackupService } from './domain/services/BackupService.js';
import { initializeBot, setupBot, startBot } from './telegram/bot.js';
import {
  markHealthFailed,
  markHealthReady,
  markHealthStopping,
  setHealthPhase,
  startHealthCheckServer,
  stopHealthCheckServer,
} from './infra/healthcheck.js';
import { startNotifierCron, stopNotifierCron } from './jobs/notifier.js';
import { startReconciliationCron, stopReconciliationCron } from './jobs/reconciler.js';
import { startTrialCleanupCron, stopTrialCleanupCron } from './jobs/trialCleanup.js';
import { startAutoRenewalCron, stopAutoRenewalCron } from './jobs/autoRenewal.js';
import { startBroadcastWorker, stopBroadcastWorker } from './jobs/broadcast.js';
import { startBackupCron, stopBackupCron } from './jobs/backup.js';
import { jobRunner } from './jobs/workerRuntime.js';

const WORKER_SHUTDOWN_TIMEOUT_MS = 30_000;

function stopScheduledWorkers(): void {
  stopReconciliationCron();
  stopNotifierCron();
  stopTrialCleanupCron();
  stopAutoRenewalCron();
  stopBroadcastWorker();
  stopBackupCron();
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

async function main() {
  initLogger();
  logger.info('Starting RebeccaSellBot...');

  const config = loadConfig();
  await startHealthCheckServer(config.HEALTH_CHECK_PORT);

  setHealthPhase('database_migrations');
  const { db } = initDatabase(config.DATABASE_URL);
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
  const configTransferService = new ConfigTransferService(panelRegistry);
  const configReconciliationService = new ConfigReconciliationService(panelRegistry);
  const broadcastService = new BroadcastService();
  const packageCategoryService = new PackageCategoryService(translationService);
  const paymentService = new PaymentService(translationService, walletService);
  const backupService = new BackupService(translationService, {
    databaseUrl: config.DATABASE_URL,
    instanceName: config.INSTANCE_NAME,
  });

  const services = {
    walletService,
    configService,
    pricingService,
    packageCategoryService,
    paymentService,
    purchaseCheckoutService,
    promoService,
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
    supportUrl: config.SUPPORT_URL,
    adminIds: adminService.adminIds,
    isAdmin: (telegramId: number) => adminService.isAdmin(telegramId),
  };

  setHealthPhase('telegram_initialization');
  const bot = setupBot(config, services);
  await initializeBot(bot);

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
  startBackupCron(backupService, bot.api);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    markHealthStopping();
    logger.info({ signal }, 'Shutting down gracefully...');
    let exitCode = 0;
    stopScheduledWorkers();
    if (bot.isRunning()) {
      await bot.stop().catch((err) => {
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
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  const pollingTask = startBot(bot);
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

  await pollingTask;
}

main().catch(async (err) => {
  markHealthFailed(err);
  logger.fatal({ err }, 'Fatal error on application startup or long-polling');
  stopScheduledWorkers();
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
