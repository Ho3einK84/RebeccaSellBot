import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { console, process } = globalThis;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(repositoryRoot, 'src');
const requiredFiles = [
  'src/telegram/bot.ts',
  'src/telegram/botRuntime.ts',
  'src/telegram/features/coreRoutes.ts',
  'src/telegram/features/baseRoutes.ts',
  'src/telegram/features/purchaseRoutes.ts',
  'src/telegram/features/configRoutes.ts',
  'src/domain/services/WalletService.ts',
  'src/domain/services/WalletPurchaseSaga.ts',
  'src/domain/services/RefundService.ts',
  'src/domain/services/ConfigTransferService.ts',
  'src/domain/services/ConfigReconciliationService.ts',
  'src/domain/services/AdminService.ts',
  'src/domain/services/BroadcastService.ts',
  'src/domain/services/BackupService.ts',
  'src/domain/services/ConfigService.ts',
  'src/domain/services/RebeccaService.ts',
  'src/domain/services/RebeccaPanelRegistry.ts',
  'src/domain/services/PurchaseCheckoutService.ts',
  'src/domain/services/PricingService.ts',
  'src/domain/services/TranslationService.ts',
  'src/domain/services/PromoService.ts',
  'src/domain/services/ReferralService.ts',
  'src/domain/services/UserService.ts',
  'src/infra/RebeccaApiClient.ts',
  'src/infra/RebeccaApiSchemas.ts',
  'src/infra/db.ts',
  'src/jobs/reconciler.ts',
  'src/jobs/workerRuntime.ts',
  'src/jobs/notifier.ts',
  'src/jobs/broadcast.ts',
  'src/jobs/backup.ts',
  'src/telegram/callbackData.ts',
  'src/telegram/rendering.ts',
  'src/telegram/features/admin/promoRoutes.ts',
  'src/telegram/features/admin/receiptRoutes.ts',
  'src/telegram/features/admin/userRoutes.ts',
  'src/telegram/features/admin/maintenanceRoutes.ts',
  'src/telegram/features/admin/panelRoutes.ts',
  'src/telegram/features/admin/broadcastRoutes.ts',
  'src/telegram/features/subscriptions/routes.ts',
  'src/telegram/conversations/adminConversations/panels.ts',
];
const apiClientImportAllowlist = new Set([
  'src/domain/services/RebeccaService.ts',
  // The registry is the composition root for isolated RebeccaService clients;
  // it never performs HTTP itself.
  'src/domain/services/RebeccaPanelRegistry.ts',
]);
const fetchAllowlist = new Set(['src/infra/RebeccaApiClient.ts']);

async function listTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listTypeScriptFiles(entryPath);
      return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [];
    })
  );
  return files.flat();
}

const failures = [];
for (const file of requiredFiles) {
  try {
    await readFile(path.join(repositoryRoot, file));
  } catch {
    failures.push(`Missing required architecture component: ${file}`);
  }
}

const sourceFiles = await listTypeScriptFiles(sourceRoot);
for (const absolutePath of sourceFiles) {
  const relativePath = path.relative(repositoryRoot, absolutePath).replace(/\\/g, '/');
  const source = await readFile(absolutePath, 'utf8');

  const importsApiClient = /\bfrom\s+['"][^'"]*RebeccaApiClient(?:\.js)?['"]/.test(source);
  const constructsApiClient = /\bnew\s+RebeccaApiClient\b/.test(source);
  if ((importsApiClient || constructsApiClient) && !apiClientImportAllowlist.has(relativePath)) {
    failures.push(`${relativePath} bypasses RebeccaService by importing RebeccaApiClient.`);
  }
  if (/\bfetch\s*\(/.test(source) && !fetchAllowlist.has(relativePath)) {
    failures.push(`${relativePath} performs HTTP directly instead of using infrastructure.`);
  }
  if (
    relativePath.startsWith('src/telegram/') &&
    /\bfrom\s+['"][^'"]*infra\/(?:db|schema)(?:\.js)?['"]/.test(source)
  ) {
    failures.push(`${relativePath} accesses database infrastructure instead of a domain service.`);
  }
  if (
    relativePath.startsWith('src/telegram/') &&
    /\bpanelRegistry\s*\.\s*getService\s*\(/.test(source)
  ) {
    failures.push(
      `${relativePath} reaches through the panel registry; use a domain-level config or panel operation instead.`
    );
  }
  if (/\b(?:setWebhook|createWebhook|webhookCallback)\b/.test(source)) {
    failures.push(`${relativePath} configures a webhook; RSBot must use long polling only.`);
  }
}

const botSource = await readFile(path.join(repositoryRoot, 'src/telegram/bot.ts'), 'utf8');
const coreRoutesSource = await readFile(
  path.join(repositoryRoot, 'src/telegram/features/coreRoutes.ts'),
  'utf8'
);
if (!/\bbot\.start\s*\(/.test(botSource)) {
  failures.push('src/telegram/bot.ts must start grammY using long polling (bot.start()).');
}

const mainMenuSource = await readFile(
  path.join(repositoryRoot, 'src/telegram/keyboards/mainMenu.ts'),
  'utf8'
);
if (
  /\b(?:buy_confirm_pkg|renew_low|config_toggle|config_revoke|config_delete):/u.test(mainMenuSource)
) {
  failures.push(
    'The current user menu emits legacy username-based callbacks; use compact stable IDs instead.'
  );
}
if (!/\bbuy:confirm:\$\{\s*checkout\.id\s*\}/u.test(mainMenuSource)) {
  failures.push('Package confirmation callbacks must use durable checkout IDs.');
}

const callbackDataSource = await readFile(
  path.join(repositoryRoot, 'src/telegram/callbackData.ts'),
  'utf8'
);
const panelConversationSource = await readFile(
  path.join(repositoryRoot, 'src/telegram/conversations/adminConversations/panels.ts'),
  'utf8'
);
const panelRoutesSource = await readFile(
  path.join(repositoryRoot, 'src/telegram/features/admin/panelRoutes.ts'),
  'utf8'
);
if (/askSecret|const\s+apiKey\s*=\s*await/u.test(panelConversationSource)) {
  failures.push('Panel API keys must never enter durable Conversation replay state.');
}
if (!/bot\.on\(['"]message:text['"][\s\S]*await_api_key/u.test(panelRoutesSource)) {
  failures.push('Panel API keys require a one-shot non-conversation message handler.');
}
if (!/TELEGRAM_CALLBACK(?:_DATA)?_MAX_BYTES\s*=\s*64/u.test(callbackDataSource)) {
  failures.push('Telegram callback construction must enforce the 64-byte Bot API limit.');
}
if (!/bot\.on\(['"]callback_query:data['"]/u.test(`${botSource}\n${coreRoutesSource}`)) {
  failures.push('Telegram routes must acknowledge stale/unmatched callback queries.');
}

if (failures.length > 0) {
  console.error('Architecture check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Architecture check passed: layered API access and long polling are enforced.');
}
