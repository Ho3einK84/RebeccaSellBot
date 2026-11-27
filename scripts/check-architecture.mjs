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
  'src/domain/services/InventoryService.ts',
  'src/infra/appVersion.ts',
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
const fetchAllowlist = new Set([
  'src/infra/RebeccaApiClient.ts',
  'src/infra/networkProbe.ts',
  'src/infra/telegramFiles.ts',
  'src/infra/NowPaymentsClient.ts',
  'src/infra/ExchangeRateClient.ts',
]);

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
    relativePath.startsWith('src/domain/') &&
    /\bfrom\s+['"](?:[^'"]*telegram\/|grammy(?:\/[^'"]*)?['"])/.test(source)
  ) {
    failures.push(
      `${relativePath} depends on Telegram/grammY transport directly; inject transport adapters from src/index.ts instead.`
    );
  }
  if (
    relativePath.startsWith('src/telegram/') &&
    /\bpanelRegistry\s*\.\s*getService\s*\(/.test(source)
  ) {
    failures.push(
      `${relativePath} reaches through the panel registry; use a domain-level config or panel operation instead.`
    );
  }
  const webhookAllowlist = new Set(['src/telegram/bot.ts']);
  if (
    /\b(?:setWebhook|createWebhook|webhookCallback)\b/.test(source) &&
    !webhookAllowlist.has(relativePath)
  ) {
    failures.push(
      `${relativePath} configures a webhook; webhook delivery must only be managed in src/telegram/bot.ts.`
    );
  }
}

const botSource = await readFile(path.join(repositoryRoot, 'src/telegram/bot.ts'), 'utf8');
const coreRoutesSource = await readFile(
  path.join(repositoryRoot, 'src/telegram/features/coreRoutes.ts'),
  'utf8'
);
if (!/\bbot\.start\s*\(/.test(botSource)) {
  failures.push('src/telegram/bot.ts must support long polling via bot.start().');
}
if (!/\bwebhookCallback\s*\(/.test(botSource)) {
  failures.push('src/telegram/bot.ts must support webhook delivery via webhookCallback().');
}
if (!/\bsetWebhook\s*\(/.test(botSource)) {
  failures.push('src/telegram/bot.ts must register webhook via bot.api.setWebhook().');
}
if (!/\bdeleteWebhook\s*\(/.test(botSource)) {
  failures.push('src/telegram/bot.ts must clear webhook via bot.api.deleteWebhook().');
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

const versionSyncedDocs = [
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'docs/architecture.md',
  'docs/configuration.md',
  'docs/deployment.md',
  'docs/telegram-architecture.md',
  'docs/webapp-architecture.md',
];
const pkgRaw = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
const pkgVersion = String(pkgRaw.version ?? '')
  .trim()
  .replace(/^v/iu, '')
  .split('+')[0];
const expectedDocSyncVersion = `v${pkgVersion}`;

for (const docPath of versionSyncedDocs) {
  let docSource;
  try {
    docSource = await readFile(path.join(repositoryRoot, docPath), 'utf8');
  } catch {
    failures.push(`Missing required documentation file: ${docPath}`);
    continue;
  }

  const syncMatch =
    /^\s*>\s*\*\*Last synced with version:\*\*\s*`(v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)`\s*$/mu.exec(
      docSource
    );
  if (!syncMatch) {
    failures.push(
      `${docPath} is missing "> **Last synced with version:** \`${expectedDocSyncVersion}\`".`
    );
  } else if (syncMatch[1] !== expectedDocSyncVersion) {
    failures.push(
      `${docPath} has "Last synced with version: ${syncMatch[1]}", expected "${expectedDocSyncVersion}" (from package.json). Review and update documentation before releasing.`
    );
  }
}

if (pkgVersion && !pkgVersion.includes('-')) {
  const changelogSource = await readFile(path.join(repositoryRoot, 'CHANGELOG.md'), 'utf8');
  const escapedVersion = pkgVersion.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  if (!new RegExp(`^## \\[${escapedVersion}\\](?:\\s|$)`, 'mu').test(changelogSource)) {
    failures.push(
      `CHANGELOG.md is missing release heading "## [${pkgVersion}]" for package.json version ${pkgVersion}.`
    );
  }
}

if (failures.length > 0) {
  console.error('Architecture check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Architecture check passed: layered API access, dual delivery, and docs version sync (${expectedDocSyncVersion}) are enforced.`
  );
}
