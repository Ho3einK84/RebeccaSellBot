import type { FastifyInstance } from 'fastify';
import type { Api } from 'grammy';
import { adminGuardWithCheck } from '../middleware/adminGuard.js';
import type { WalletService } from '../../../domain/services/WalletService.js';
import type { UserService } from '../../../domain/services/UserService.js';
import type { ConfigService } from '../../../domain/services/ConfigService.js';
import type { PricingService } from '../../../domain/services/PricingService.js';
import {
  detectIranianBankName,
  generateBankCardId,
  hasDuplicateCardNumber,
  isValidBankCardNumber,
  MAX_BANK_CARDS,
  normalizeCardNumber,
  PaymentService,
  type BankCardConfig,
} from '../../../domain/services/PaymentService.js';
import {
  type RebeccaPanelRegistry,
  RebeccaPanelInUseError,
} from '../../../domain/services/RebeccaPanelRegistry.js';
import {
  getCachedPanelHealth,
  invalidatePanelHealthCache,
} from '../../../domain/services/PanelHealthCache.js';
import { RebeccaOriginDownError } from '../../../domain/services/RebeccaService.js';
import type { AdminService } from '../../../domain/services/AdminService.js';
import type { TranslationService } from '../../../domain/services/TranslationService.js';
import {
  safeGetEffectiveUserPolicy,
  type UserGroupService,
} from '../../../domain/services/UserGroupService.js';
import {
  TopupVoidError,
  type AdminBalanceOperation,
} from '../../../domain/services/WalletContracts.js';
import {
  receiptDuplicatePolicy,
  uniqueTopupAmountEnabled,
} from '../../../domain/services/FeatureSettings.js';
import { validateRebeccaBaseUrl } from '../../../infra/rebeccaBaseUrl.js';
import { downloadTelegramFile } from '../../../infra/telegramFiles.js';
import {
  formatDuplicateReceiptBanner,
  sendReceiptApprovalNotification,
  sendReceiptRejectionNotification,
  sendReceiptVoidedNotification,
  sendBalanceAdjustmentNotification,
} from '../../../telegram/features/admin/adminNotifications.js';
import { formatReceiptShortId } from '../../../telegram/features/admin/receiptRoutes.js';

interface ReceiptActionBody {
  action: 'approve' | 'reject' | 'void';
  reason?: string;
  disablePurchasedConfigs?: boolean;
}

interface AdjustBalanceBody {
  operation: AdminBalanceOperation;
  amount: number;
  reason: string;
}

export function registerAdminRoutes(
  app: FastifyInstance,
  services: {
    walletService: WalletService;
    userService: UserService;
    configService?: ConfigService;
    pricingService?: PricingService;
    paymentService?: PaymentService;
    panelRegistry: RebeccaPanelRegistry;
    botToken?: string;
    adminService?: Pick<AdminService, 'isAdmin'> & { adminIds?: number[] };
    adminIds?: number[];
    botApi?: Api;
    translationService?: TranslationService;
    userGroupService?: UserGroupService;
  }
): void {
  app.register(async (adminScope) => {
    // Re-validate the admin registry on every request: a JWT signed before
    // an admin was removed must stop working immediately, not after 12h.
    adminScope.addHook('preHandler', (request, reply) =>
      adminGuardWithCheck(
        request,
        reply,
        services.adminService ? (id) => services.adminService!.isAdmin(id) : undefined
      )
    );

    // GET /api/admin/stats
    adminScope.get<{
      Querystring: { refresh?: string };
    }>('/api/admin/stats', async (request, reply) => {
      const forceRefresh = request.query?.refresh === '1' || request.query?.refresh === 'true';
      const dbStartedAt = performance.now();
      const [stats, cachedPanelHealth] = await Promise.all([
        services.walletService.getDashboardStats().catch(() => null),
        getCachedPanelHealth(services.panelRegistry, {
          timeoutMs: 2_500,
          useCache: !forceRefresh,
        }),
      ]);
      const dbLatencyMs = Math.max(0, Math.round(performance.now() - dbStartedAt));
      const panelHealth = cachedPanelHealth
        ? {
            configured: cachedPanelHealth.configured,
            healthy: cachedPanelHealth.healthy,
            allHealthy: cachedPanelHealth.allHealthy,
            latencyMs: cachedPanelHealth.latencyMs,
          }
        : { configured: 0, healthy: 0, allHealthy: false, latencyMs: 0 };

      return reply.code(200).send({
        stats,
        panelHealth,
        dbLatencyMs,
      });
    });

    // GET /api/admin/receipts
    adminScope.get<{
      Querystring: {
        page?: string;
        limit?: string;
        status?: 'pending' | 'approved' | 'rejected' | 'voided' | 'all';
        search?: string;
      };
    }>('/api/admin/receipts', async (request, reply) => {
      const page = clampPositiveInt(request.query.page, 1, 1_000_000);
      const limit = clampPositiveInt(request.query.limit, 10, 50);
      const status = request.query.status ?? 'pending';
      const search = request.query.search;
      const rawResult =
        typeof services.walletService.listTopupsPage === 'function'
          ? await services.walletService.listTopupsPage({
              page,
              pageSize: limit,
              status,
              search,
            })
          : await services.walletService.listPendingTopupsPage(page, limit);

      const ts = services.translationService;
      const defaultLocale =
        typeof ts?.getDefaultLocale === 'function' ? ts.getDefaultLocale() : 'fa';

      const enrichedItems = rawResult.items.map((item) => {
        const record = item as typeof item & {
          fileUniqueId?: string | null;
          fileSha256?: string | null;
          duplicateOfReceiptId?: string | null;
          cardId?: string | null;
          cardNumber?: string | null;
          voidedAt?: Date | string | null;
          voidedBy?: number | null;
          voidReason?: string | null;
        };
        const duplicateOfReceiptId = record.duplicateOfReceiptId ?? null;
        let duplicateWarning: string | null = null;
        if (duplicateOfReceiptId) {
          const shortId = formatReceiptShortId(duplicateOfReceiptId);
          const translated =
            ts && typeof ts.get === 'function'
              ? formatDuplicateReceiptBanner(
                  ts,
                  defaultLocale,
                  duplicateOfReceiptId,
                  formatReceiptShortId
                )
              : null;
          duplicateWarning =
            translated && translated !== 'admin_receipt_duplicate_warning'
              ? translated
              : `⚠️ هشدار رسید تکراری (مشابه رسید #${shortId})`;
        }

        const resolvedPaymentService =
          services.paymentService ??
          (ts && typeof ts.getSetting === 'function' ? new PaymentService(ts) : undefined);
        const cardSummary =
          record.cardId || record.cardNumber
            ? (resolvedPaymentService?.resolveCardDisplayLabel(
                { cardId: record.cardId, cardNumber: record.cardNumber },
                defaultLocale === 'en' ? 'en' : 'fa'
              ) ?? null)
            : null;

        return {
          ...item,
          fileUniqueId: record.fileUniqueId ?? null,
          fileSha256: record.fileSha256 ?? null,
          duplicateOfReceiptId,
          cardId: record.cardId ?? null,
          cardNumber: record.cardNumber ?? null,
          cardSummary,
          voidedAt: record.voidedAt ?? null,
          voidedBy: record.voidedBy ?? null,
          voidReason: record.voidReason ?? null,
          duplicateWarning,
        };
      });

      return reply.code(200).send({
        ...rawResult,
        items: enrichedItems,
      });
    });

    // GET /api/admin/receipts/settings
    adminScope.get('/api/admin/receipts/settings', async (_request, reply) => {
      const ts = services.translationService;
      const enabled = ts ? ts.getSettingBool('receipt_notify_enabled', true) : true;
      const mode = ts
        ? (ts.getSetting('receipt_notify_mode', 'full') as 'full' | 'simple')
        : 'full';
      const duplicatePolicy = ts ? receiptDuplicatePolicy(ts) : 'warn';
      const adminsRaw = ts ? ts.getSetting('receipt_notify_admins', '').trim() : '';
      const selectedAdmins =
        !adminsRaw || adminsRaw === 'all'
          ? []
          : adminsRaw
              .split(',')
              .map((s) => Number(s.trim()))
              .filter((n) => Number.isSafeInteger(n) && n > 0);

      const allAdmins = services.adminService?.adminIds ?? services.adminIds ?? [];
      const adminProfiles = await Promise.all(
        allAdmins.map(async (id) => {
          const profile =
            typeof services.userService.findProfile === 'function'
              ? await services.userService.findProfile(String(id)).catch(() => null)
              : null;
          return {
            telegramId: id,
            username: profile?.username ?? null,
            firstName: profile?.firstName ?? null,
            lastName: profile?.lastName ?? null,
          };
        })
      );

      return reply.code(200).send({
        enabled,
        mode,
        duplicatePolicy,
        admins: selectedAdmins,
        allAdmins,
        adminProfiles,
      });
    });

    // PUT /api/admin/receipts/settings
    adminScope.put<{
      Body: {
        enabled?: boolean;
        mode?: 'full' | 'simple';
        duplicatePolicy?: 'warn' | 'block';
        admins?: number[];
      };
    }>(
      '/api/admin/receipts/settings',
      {
        schema: {
          body: {
            type: 'object',
            properties: {
              enabled: { type: 'boolean' },
              mode: { type: 'string', enum: ['full', 'simple'] },
              duplicatePolicy: { type: 'string', enum: ['warn', 'block'] },
              admins: { type: 'array', items: { type: 'number' } },
            },
          },
        },
      },
      async (request, reply) => {
        const { enabled, mode, duplicatePolicy, admins } = request.body;
        const ts = services.translationService;
        if (!ts) {
          return reply.code(500).send({ error: 'Translation service unavailable' });
        }

        if (typeof enabled === 'boolean') {
          await ts.updateSetting('receipt_notify_enabled', String(enabled));
        }

        if (mode === 'full' || mode === 'simple') {
          await ts.updateSetting('receipt_notify_mode', mode);
        }

        if (duplicatePolicy === 'warn' || duplicatePolicy === 'block') {
          await ts.updateSetting('receipt_duplicate_policy', duplicatePolicy);
        }

        if (Array.isArray(admins)) {
          const validIds = admins.filter((id) => Number.isSafeInteger(id) && id > 0);
          const val = validIds.length === 0 ? '' : validIds.join(',');
          await ts.updateSetting('receipt_notify_admins', val);
        }

        return reply.code(200).send({ success: true });
      }
    );

    // POST /api/admin/receipts/batch-action
    adminScope.post<{
      Body: { ids: string[]; action: 'approve' };
    }>(
      '/api/admin/receipts/batch-action',
      {
        schema: {
          body: {
            type: 'object',
            required: ['ids', 'action'],
            properties: {
              ids: { type: 'array', items: { type: 'string' } },
              action: { type: 'string', enum: ['approve'] },
            },
          },
        },
      },
      async (request, reply) => {
        const { ids, action } = request.body;
        const adminId = request.userSession!.telegramId;
        const cleanedIds = Array.isArray(ids)
          ? Array.from(new Set(ids.map((v) => v.trim()).filter(Boolean)))
          : [];
        if (cleanedIds.length === 0) {
          return reply.code(400).send({ error: 'No receipt IDs provided' });
        }
        if (cleanedIds.length > 100) {
          return reply
            .code(400)
            .send({ error: 'Cannot process more than 100 receipts in a single batch' });
        }

        if (action === 'approve') {
          let approvedCount = 0;
          for (const receiptId of cleanedIds) {
            try {
              const result = await services.walletService.approveTopup(receiptId, adminId);
              if (!result) continue;
              approvedCount += 1;

              if (services.botApi && services.translationService) {
                await sendReceiptApprovalNotification(
                  services.botApi,
                  {
                    userService: services.userService,
                    translationService: services.translationService,
                  },
                  {
                    telegramId: result.telegramId,
                    amount: result.amount,
                    receiptId,
                  }
                );
              }
            } catch (err) {
              request.log.error({ err, receiptId }, 'Batch receipt approval error');
            }
          }

          return reply.code(200).send({ success: true, approvedCount });
        }

        return reply.code(400).send({ error: 'Unsupported batch action' });
      }
    );

    // GET /api/admin/receipts/:id/photo — securely proxy Telegram-hosted
    // receipt images through the backend without ever exposing BOT_TOKEN.
    adminScope.get<{
      Params: { id: string };
      Querystring: { download?: string };
    }>('/api/admin/receipts/:id/photo', async (request, reply) => {
      const { id } = request.params;
      const receipt =
        typeof services.walletService.getTopupById === 'function'
          ? await services.walletService.getTopupById(id)
          : await services.walletService.getPendingTopup(id);
      if (!receipt) {
        return reply.code(404).send({ error: 'Receipt not found' });
      }
      if (!services.botToken) {
        return reply.code(404).send({ error: 'Receipt photo unavailable' });
      }

      const downloaded = await downloadTelegramFile(services.botToken, receipt.photoFileId);
      if (!downloaded.ok) {
        return reply.code(502).send({ error: downloaded.error });
      }

      const safeId = id.replace(/[^a-zA-Z0-9._-]/g, '_');
      const disposition = request.query?.download
        ? `attachment; filename="receipt-${safeId}.jpg"`
        : `inline; filename="receipt-${safeId}.jpg"`;

      return reply
        .header('Content-Type', downloaded.contentType)
        .header('Content-Disposition', disposition)
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .send(downloaded.buffer);
    });

    // POST /api/admin/receipts/:id/action
    adminScope.post<{
      Params: { id: string };
      Body: ReceiptActionBody;
    }>(
      '/api/admin/receipts/:id/action',
      {
        schema: {
          body: {
            type: 'object',
            required: ['action'],
            properties: {
              action: { type: 'string', enum: ['approve', 'reject', 'void'] },
              reason: { type: 'string' },
              disablePurchasedConfigs: { type: 'boolean' },
            },
          },
        },
      },
      async (request, reply) => {
        const { id } = request.params;
        const { action, reason, disablePurchasedConfigs } = request.body;
        const adminId = request.userSession!.telegramId;

        if (action === 'approve') {
          try {
            const result = await services.walletService.approveTopup(id, adminId);
            if (!result) {
              return reply.code(404).send({ error: 'Receipt not found or already processed' });
            }

            if (services.botApi && services.translationService) {
              await sendReceiptApprovalNotification(
                services.botApi,
                {
                  userService: services.userService,
                  translationService: services.translationService,
                },
                {
                  telegramId: result.telegramId,
                  amount: result.amount,
                  receiptId: id,
                }
              );
            }

            return reply.code(200).send({ success: true, result });
          } catch (err: unknown) {
            if (err instanceof Error && err.message === 'USER_NOT_FOUND') {
              return reply.code(404).send({ error: 'Receipt owner not found' });
            }
            throw err;
          }
        }

        if (action === 'void') {
          try {
            const result = await services.walletService.voidApprovedTopup({
              receiptId: id,
              adminId,
              reason: reason?.trim() || undefined,
              disablePurchasedConfigs: Boolean(disablePurchasedConfigs),
              disableConfig: services.configService
                ? (username, panelId) => services.configService!.disableConfig(username, panelId)
                : undefined,
            });

            if (!result.alreadyVoided && services.botApi && services.translationService) {
              try {
                await sendReceiptVoidedNotification(
                  services.botApi,
                  {
                    userService: services.userService,
                    translationService: services.translationService,
                  },
                  {
                    telegramId: result.telegramId,
                    receiptId: id,
                    amount: result.originalAmount,
                    deductedAmount: result.deductedAmount,
                    disabledConfigsCount: result.disabledConfigs.length,
                    shortId: formatReceiptShortId(id),
                  }
                );
              } catch (notifyErr) {
                request.log.warn(
                  { err: notifyErr, receiptId: id },
                  'Failed to send receipt void notification'
                );
              }
            }

            return reply.code(200).send({ success: true, result });
          } catch (err: unknown) {
            if (err instanceof TopupVoidError) {
              if (err.reason === 'not_found') {
                return reply.code(404).send({ error: 'Receipt not found', code: 'not_found' });
              }
              return reply
                .code(400)
                .send({ error: 'Only approved receipts can be voided', code: 'not_approved' });
            }
            if (err instanceof Error && err.message === 'USER_NOT_FOUND') {
              return reply.code(404).send({ error: 'Receipt owner not found' });
            }
            throw err;
          }
        }

        if (!reason?.trim()) {
          return reply.code(400).send({ error: 'A rejection reason is required' });
        }

        const trimmedReason = reason.trim();
        let result;
        try {
          result = await services.walletService.rejectTopup(id, adminId, trimmedReason);
        } catch (err: unknown) {
          if (err instanceof Error && err.message === 'USER_NOT_FOUND') {
            return reply.code(404).send({ error: 'Receipt owner not found' });
          }
          throw err;
        }
        if (!result) {
          return reply.code(404).send({ error: 'Receipt not found or already processed' });
        }

        if (services.botApi && services.translationService) {
          try {
            await sendReceiptRejectionNotification(
              services.botApi,
              {
                userService: services.userService,
                translationService: services.translationService,
              },
              {
                telegramId: result.telegramId,
                receiptId: id,
                reason: trimmedReason,
              }
            );
          } catch (notifyErr) {
            request.log.warn(
              { err: notifyErr, receiptId: id },
              'Failed to send receipt rejection notification'
            );
          }
        }

        return reply.code(200).send({ success: true });
      }
    );

    // GET /api/admin/users
    adminScope.get<{
      Querystring: {
        search?: string;
        page?: string;
        limit?: string;
        filter?: 'all' | 'active_subs' | 'has_balance' | 'negative_balance' | 'banned';
        sort?: 'newest' | 'balance_desc' | 'subs_desc' | 'spend_desc';
      };
    }>('/api/admin/users', async (request, reply) => {
      const { search, page, limit, filter, sort } = request.query;

      const attachUserGroups = async <
        T extends {
          telegramId: number;
          groupId?: string | null;
          groupExpiresAt?: Date | null;
        },
      >(
        rows: T[]
      ) => {
        if (
          rows.length === 0 ||
          typeof services.userGroupService?.resolvePoliciesForUsers !== 'function'
        ) {
          return rows;
        }
        try {
          const policyMap = await services.userGroupService.resolvePoliciesForUsers(rows);
          return rows.map((u) => {
            const p = policyMap.get(u.telegramId);
            return {
              ...u,
              creditLimit: p?.creditLimit ?? 0,
              group: p?.groupId
                ? {
                    id: p.groupId,
                    name: p.groupName ?? '',
                    badge: p.badge,
                    isDefault: p.isDefaultGroup,
                    isAssigned: p.isAssigned,
                    expiresAt: p.expiresAt ? p.expiresAt.toISOString() : null,
                    discountPercent: p.discountPercent,
                    applyDiscountToCustomVolume: p.applyDiscountToCustomVolume,
                    creditLimit: p.creditLimit,
                  }
                : null,
            };
          });
        } catch {
          return rows;
        }
      };

      if (search?.trim()) {
        const parsedLimit = clampPositiveInt(limit, 10, 50);
        const parsedPage = clampPositiveInt(page, 1, 1_000_000);
        const needsExpandedFetch =
          (filter && filter !== 'all') || (sort && sort !== 'newest') || parsedPage > 1;
        const fetchCap = needsExpandedFetch ? 200 : parsedLimit;
        let users = await services.userService.searchProfiles(search.trim(), fetchCap);
        if (filter === 'active_subs') {
          users = users.filter((u) => u.activeSubscriptionCount > 0);
        } else if (filter === 'has_balance') {
          users = users.filter((u) => u.balance > 0);
        } else if (filter === 'negative_balance') {
          users = users.filter((u) => u.balance < 0);
        } else if (filter === 'banned') {
          users = users.filter((u) => u.isBanned);
        }
        if (sort === 'balance_desc') {
          users.sort((a, b) => b.balance - a.balance);
        } else if (sort === 'subs_desc') {
          users.sort((a, b) => b.activeSubscriptionCount - a.activeSubscriptionCount);
        } else if (sort === 'spend_desc') {
          users.sort((a, b) => b.totalSpend - a.totalSpend);
        }
        const total = users.length;
        const totalPages = Math.max(1, Math.ceil(total / parsedLimit));
        const safePage = Math.min(parsedPage, totalPages);
        const sliced = users.slice((safePage - 1) * parsedLimit, safePage * parsedLimit);
        return reply.code(200).send({
          users: await attachUserGroups(sliced),
          total,
          page: safePage,
          totalPages,
        });
      }

      const parsedPage = clampPositiveInt(page, 1, 1_000_000);
      const parsedLimit = clampPositiveInt(limit, 10, 50);
      const result = await services.userService.listUsers(parsedPage, parsedLimit, {
        filter,
        sort,
      });
      return reply.code(200).send({
        ...result,
        users: await attachUserGroups(result.users),
      });
    });

    // GET /api/admin/users/:id
    adminScope.get<{
      Params: { id: string };
    }>('/api/admin/users/:id', async (request, reply) => {
      const telegramId = Number(request.params.id);
      if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
        return reply.code(400).send({ error: 'Invalid user ID' });
      }

      const summary = await services.userService.getUserReportSummary(telegramId);
      if (!summary) {
        return reply.code(404).send({ error: 'User not found' });
      }

      const [ordersRes, receiptsRes, rawConfigs, txRes, auditRes, userPolicy] = await Promise.all([
        services.userService.listOrdersForUser(telegramId, 1, 10),
        services.userService.listReceiptsForUser(telegramId, 1, 10),
        services.configService
          ? services.configService.listConfigsForOwner(telegramId).catch(() => [])
          : Promise.resolve([]),
        services.userService
          .listTransactionsForUser(telegramId, 1, 15)
          .catch(() => ({ transactions: [] })),
        typeof services.userService.listAuditLogsForUser === 'function'
          ? services.userService.listAuditLogsForUser(telegramId, 1, 15).catch(() => ({ logs: [] }))
          : Promise.resolve({ logs: [] }),
        safeGetEffectiveUserPolicy(services.userGroupService, telegramId),
      ]);

      const isAdmin = Boolean(services.adminService?.isAdmin(telegramId));

      const configs = rawConfigs.map((cfg) => {
        const panel = services.panelRegistry.getPanel(cfg.panelId);
        return {
          id: cfg.id,
          panelId: cfg.panelId,
          panelName: panel?.name || cfg.panelId,
          serviceId: cfg.serviceId,
          configUsername: cfg.configUsername,
          userLabel: cfg.userLabel ?? null,
          subUrl: cfg.subUrl,
          panelStatus: cfg.panelStatus,
          panelDataLimit: cfg.panelDataLimit,
          panelUsedTraffic: cfg.panelUsedTraffic,
          panelExpire: cfg.panelExpire,
          panelOnHoldExpireDuration: cfg.panelOnHoldExpireDuration ?? null,
          autoRenewEnabled: cfg.autoRenewEnabled,
          isClaimed: cfg.isClaimed,
          createdAt: cfg.createdAt,
        };
      });

      return reply.code(200).send({
        summary: {
          ...summary,
          user: {
            ...summary.user,
            isAdmin,
            creditLimit: userPolicy.creditLimit,
            group: userPolicy.groupId
              ? {
                  id: userPolicy.groupId,
                  name: userPolicy.groupName ?? '',
                  badge: userPolicy.badge,
                  isDefault: userPolicy.isDefaultGroup,
                  isAssigned: userPolicy.isAssigned,
                  expiresAt: userPolicy.expiresAt ? userPolicy.expiresAt.toISOString() : null,
                  discountPercent: userPolicy.discountPercent,
                  applyDiscountToCustomVolume: userPolicy.applyDiscountToCustomVolume,
                  creditLimit: userPolicy.creditLimit,
                }
              : null,
          },
        },
        isAdmin,
        orders: ordersRes.orders,
        receipts: receiptsRes.receipts,
        configs,
        transactions: txRes.transactions,
        auditLogs: auditRes.logs,
      });
    });

    // POST /api/admin/users/:id/ban
    adminScope.post<{
      Params: { id: string };
      Body: { isBanned: boolean; reason?: string };
    }>(
      '/api/admin/users/:id/ban',
      {
        schema: {
          body: {
            type: 'object',
            required: ['isBanned'],
            properties: {
              isBanned: { type: 'boolean' },
              reason: { type: 'string' },
            },
          },
        },
      },
      async (request, reply) => {
        const telegramId = Number(request.params.id);
        if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
          return reply.code(400).send({ error: 'Invalid user ID' });
        }

        const { isBanned, reason } = request.body;
        const adminId = request.userSession!.telegramId;

        if (isBanned && services.adminService?.isAdmin(telegramId)) {
          return reply.code(403).send({
            error: 'Cannot ban an administrator',
            code: 'CANNOT_BAN_ADMIN',
          });
        }

        const updated = await services.userService.setBanned(telegramId, isBanned, adminId);
        if (!updated) {
          return reply.code(404).send({ error: 'User not found' });
        }

        if (reason?.trim()) {
          await services.userService.recordAdminAction({
            actorTelegramId: adminId,
            action: isBanned ? 'admin_ban_user_with_reason' : 'admin_unban_user_with_reason',
            entityType: 'telegram_user',
            entityId: String(telegramId),
            targetTelegramId: telegramId,
            metadata: { reason: reason.trim() },
          });
        }

        return reply.code(200).send({ success: true, isBanned });
      }
    );

    // POST /api/admin/users/:id/message
    adminScope.post<{
      Params: { id: string };
      Body: { message: string };
    }>(
      '/api/admin/users/:id/message',
      {
        schema: {
          body: {
            type: 'object',
            required: ['message'],
            properties: {
              message: { type: 'string', minLength: 1, maxLength: 3800 },
            },
          },
        },
      },
      async (request, reply) => {
        const telegramId = Number(request.params.id);
        if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
          return reply.code(400).send({ error: 'Invalid user ID' });
        }

        const trimmedMessage = request.body.message?.trim();
        if (!trimmedMessage) {
          return reply.code(400).send({ error: 'Message text is required' });
        }

        if (!services.botApi) {
          return reply.code(503).send({ error: 'Telegram bot API unavailable' });
        }

        const summary = await services.userService.getUserReportSummary(telegramId);
        if (!summary) {
          return reply.code(404).send({ error: 'User not found' });
        }

        try {
          await services.botApi.sendMessage(telegramId, trimmedMessage);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Failed to deliver Telegram message';
          return reply.code(502).send({ error: message });
        }

        const adminId = request.userSession!.telegramId;
        await services.userService.recordAdminAction({
          actorTelegramId: adminId,
          action: 'admin_direct_message',
          entityType: 'telegram_user',
          entityId: String(telegramId),
          targetTelegramId: telegramId,
          metadata: { length: trimmedMessage.length },
        });

        return reply.code(200).send({ success: true });
      }
    );

    // POST /api/admin/users/:id/configs/:configUsername/toggle
    adminScope.post<{
      Params: { id: string; configUsername: string };
      Body: { panelId?: string };
    }>('/api/admin/users/:id/configs/:configUsername/toggle', async (request, reply) => {
      const telegramId = Number(request.params.id);
      if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
        return reply.code(400).send({ error: 'Invalid user ID' });
      }
      const { configUsername } = request.params;
      const { panelId } = request.body || {};
      if (!services.configService) {
        return reply.code(501).send({ error: 'Config service not configured' });
      }

      const isOwner = await services.configService.isOwnedBy(telegramId, configUsername, panelId);
      if (!isOwner) {
        return reply.code(404).send({ error: 'Config not found or not owned by user' });
      }

      try {
        const status = await services.configService.toggleConfig(configUsername, panelId);
        const adminId = request.userSession!.telegramId;
        await services.userService.recordAdminAction({
          actorTelegramId: adminId,
          action: 'admin_toggle_user_config',
          entityType: 'user_config',
          entityId: configUsername,
          targetTelegramId: telegramId,
          metadata: { status, panelId },
        });
        return reply.code(200).send({ success: true, status });
      } catch (err: unknown) {
        if (err instanceof RebeccaOriginDownError) {
          return reply.code(503).send({ error: 'Panel unavailable', code: 'PANEL_DOWN' });
        }
        const message = err instanceof Error ? err.message : 'Failed to toggle config';
        return reply.code(400).send({ error: message });
      }
    });

    // POST /api/admin/users/:id/configs/:configUsername/reset-usage
    adminScope.post<{
      Params: { id: string; configUsername: string };
      Body: { panelId?: string };
    }>('/api/admin/users/:id/configs/:configUsername/reset-usage', async (request, reply) => {
      const telegramId = Number(request.params.id);
      if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
        return reply.code(400).send({ error: 'Invalid user ID' });
      }
      const { configUsername } = request.params;
      const { panelId } = request.body || {};
      if (!services.configService) {
        return reply.code(501).send({ error: 'Config service not configured' });
      }

      const isOwner = await services.configService.isOwnedBy(telegramId, configUsername, panelId);
      if (!isOwner) {
        return reply.code(404).send({ error: 'Config not found or not owned by user' });
      }

      try {
        await services.configService.resetUsage(configUsername, panelId);
        const adminId = request.userSession!.telegramId;
        await services.userService.recordAdminAction({
          actorTelegramId: adminId,
          action: 'admin_reset_user_config_usage',
          entityType: 'user_config',
          entityId: configUsername,
          targetTelegramId: telegramId,
          metadata: { panelId },
        });
        return reply.code(200).send({ success: true });
      } catch (err: unknown) {
        if (err instanceof RebeccaOriginDownError) {
          return reply.code(503).send({ error: 'Panel unavailable', code: 'PANEL_DOWN' });
        }
        const message = err instanceof Error ? err.message : 'Failed to reset usage';
        return reply.code(400).send({ error: message });
      }
    });

    // POST /api/admin/users/:id/configs/:configUsername/revoke
    adminScope.post<{
      Params: { id: string; configUsername: string };
      Body: { panelId?: string };
    }>('/api/admin/users/:id/configs/:configUsername/revoke', async (request, reply) => {
      const telegramId = Number(request.params.id);
      if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
        return reply.code(400).send({ error: 'Invalid user ID' });
      }
      const { configUsername } = request.params;
      const { panelId } = request.body || {};
      if (!services.configService) {
        return reply.code(501).send({ error: 'Config service not configured' });
      }

      const isOwner = await services.configService.isOwnedBy(telegramId, configUsername, panelId);
      if (!isOwner) {
        return reply.code(404).send({ error: 'Config not found or not owned by user' });
      }

      try {
        const newSubUrl = await services.configService.revokeSubscription(configUsername, panelId);
        const adminId = request.userSession!.telegramId;
        await services.userService.recordAdminAction({
          actorTelegramId: adminId,
          action: 'admin_revoke_user_config_sub_url',
          entityType: 'user_config',
          entityId: configUsername,
          targetTelegramId: telegramId,
          metadata: { panelId, newSubUrl },
        });
        return reply.code(200).send({ success: true, subUrl: newSubUrl });
      } catch (err: unknown) {
        if (err instanceof RebeccaOriginDownError) {
          return reply.code(503).send({ error: 'Panel unavailable', code: 'PANEL_DOWN' });
        }
        const message = err instanceof Error ? err.message : 'Failed to revoke subscription';
        return reply.code(400).send({ error: message });
      }
    });

    // POST /api/admin/users/:id/configs/:configUsername/sync
    adminScope.post<{
      Params: { id: string; configUsername: string };
      Body: { panelId?: string };
    }>('/api/admin/users/:id/configs/:configUsername/sync', async (request, reply) => {
      const telegramId = Number(request.params.id);
      if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
        return reply.code(400).send({ error: 'Invalid user ID' });
      }
      const { configUsername } = request.params;
      const { panelId } = request.body || {};
      if (!services.configService) {
        return reply.code(501).send({ error: 'Config service not configured' });
      }

      const config = await services.configService.getOwnedConfigByUsername(
        telegramId,
        configUsername,
        panelId
      );
      if (!config) {
        return reply.code(404).send({ error: 'Config not found or not owned by user' });
      }

      try {
        const detail = await services.configService.getRemoteConfigDetail(config);
        return reply.code(200).send({ success: true, detail });
      } catch (err: unknown) {
        if (err instanceof RebeccaOriginDownError) {
          return reply.code(503).send({ error: 'Panel unavailable', code: 'PANEL_DOWN' });
        }
        const message = err instanceof Error ? err.message : 'Failed to sync config with panel';
        return reply.code(400).send({ error: message });
      }
    });

    // POST /api/admin/users/:id/balance
    adminScope.post<{
      Params: { id: string };
      Body: AdjustBalanceBody;
    }>(
      '/api/admin/users/:id/balance',
      {
        schema: {
          body: {
            type: 'object',
            required: ['operation', 'amount', 'reason'],
            properties: {
              operation: { type: 'string', enum: ['add', 'deduct', 'set'] },
              amount: { type: 'number', minimum: 0 },
              reason: { type: 'string', minLength: 1 },
            },
          },
        },
      },
      async (request, reply) => {
        const telegramId = Number(request.params.id);
        if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
          return reply.code(400).send({ error: 'Invalid user ID' });
        }

        const { operation, amount, reason } = request.body;
        if (!reason || !reason.trim()) {
          return reply.code(400).send({ error: 'A non-empty reason is required' });
        }
        if (!Number.isSafeInteger(amount) || amount < 0) {
          return reply.code(400).send({ error: 'Amount must be a non-negative integer' });
        }

        const adminId = request.userSession!.telegramId;

        try {
          const previousBalance = await services.walletService.getBalance(telegramId);
          const newBalance = await services.walletService.adjustBalanceAdmin({
            telegramId,
            operation,
            amount,
            adminId,
            description: reason.trim(),
          });

          await services.userService.recordAdminAction({
            actorTelegramId: adminId,
            action: 'admin_balance_adjustment',
            entityType: 'user_wallet',
            entityId: String(telegramId),
            targetTelegramId: telegramId,
            metadata: {
              operation,
              amount,
              previousBalance,
              newBalance,
              reason: reason.trim(),
            },
          });

          if (services.botApi && services.translationService) {
            await sendBalanceAdjustmentNotification(
              services.botApi,
              {
                userService: services.userService,
                translationService: services.translationService,
              },
              {
                telegramId,
                newBalance,
              }
            );
          }

          return reply.code(200).send({ success: true, balance: newBalance });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Balance adjustment failed';
          return reply.code(400).send({ error: message });
        }
      }
    );

    // GET /api/admin/panels
    adminScope.get('/api/admin/panels', async (_request, reply) => {
      const panels = services.panelRegistry.listPanels();
      const customTarget = services.pricingService?.getCustomVolumeTarget();

      const enrichedPanels = await Promise.all(
        panels.map(async (panel) => {
          let activeConfigsCount = 0;
          let healthy = panel.enabled;
          let latencyMs: number | undefined;

          try {
            if (typeof services.panelRegistry.getPanelUsage === 'function') {
              const countRes = await services.panelRegistry.getPanelUsage(panel.id);
              activeConfigsCount = countRes.activeConfigsCount;
            }
          } catch {
            // default to 0
          }

          try {
            if (panel.enabled && typeof services.panelRegistry.testConnection === 'function') {
              const testRes = await withTimeout(
                services.panelRegistry.testConnection(panel.id),
                3_500
              );
              healthy = testRes.ok;
              latencyMs = testRes.latencyMs;
            } else if (panel.enabled && typeof services.panelRegistry.getService === 'function') {
              const service = services.panelRegistry.getService(panel.id);
              const start = Date.now();
              healthy = await withTimeout(service.checkHealth(), 3_500);
              latencyMs = Date.now() - start;
            } else if (!panel.enabled) {
              healthy = false;
            }
          } catch {
            healthy = false;
          }

          const packagesCount = services.pricingService
            ? services.pricingService.getPackages(panel.id, undefined, true).length
            : 0;

          const servicesWithCustom = panel.services.map((s) => ({
            ...s,
            isCustomTarget:
              customTarget?.panelId === panel.id && customTarget?.serviceId === s.serviceId,
          }));

          return {
            ...panel,
            services: servicesWithCustom,
            packagesCount,
            activeConfigsCount,
            healthy,
            latencyMs,
          };
        })
      );

      const totalPanels = enrichedPanels.length;
      const enabledPanels = enrichedPanels.filter((p) => p.enabled);
      const healthyPanels = enrichedPanels.filter((p) => p.enabled && p.healthy).length;
      const disabledPanels = enrichedPanels.filter((p) => !p.enabled).length;
      const unhealthyPanels = enrichedPanels.filter((p) => p.enabled && !p.healthy).length;
      const totalActiveConfigs = enrichedPanels.reduce(
        (acc, p) => acc + (p.activeConfigsCount ?? 0),
        0
      );
      const totalServices = enrichedPanels.reduce((acc, p) => acc + p.services.length, 0);
      const allHealthy = totalPanels > 0 && enabledPanels.length > 0 && unhealthyPanels === 0;

      return reply.code(200).send({
        panels: enrichedPanels,
        fleetSummary: {
          totalPanels,
          healthyPanels,
          disabledPanels,
          unhealthyPanels,
          totalActiveConfigs,
          totalServices,
          allHealthy,
        },
      });
    });

    // POST /api/admin/panels
    adminScope.post<{
      Body: {
        name: string;
        baseUrl: string;
        apiKey?: string;
        serviceId?: number;
        serviceName?: string;
      };
    }>('/api/admin/panels', async (request, reply) => {
      const { name, baseUrl, apiKey, serviceId, serviceName } = request.body || {};
      if (!name || typeof name !== 'string' || !name.trim() || name.trim().length > 80) {
        return reply.code(400).send({ error: 'Panel name must be between 1 and 80 characters' });
      }
      if (!baseUrl || typeof baseUrl !== 'string') {
        return reply.code(400).send({ error: 'Panel URL is required' });
      }
      let validatedUrl: string;
      try {
        validatedUrl = validateRebeccaBaseUrl(baseUrl);
      } catch (err: unknown) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : 'Invalid panel URL' });
      }
      if (apiKey !== undefined && typeof apiKey !== 'string') {
        return reply.code(400).send({ error: 'Invalid API key' });
      }
      if (serviceName !== undefined && typeof serviceName !== 'string') {
        return reply.code(400).send({ error: 'Invalid service name' });
      }
      const rawServiceId: unknown = serviceId;
      const parsedServiceId =
        rawServiceId === undefined
          ? 1
          : typeof rawServiceId === 'number' ||
              (typeof rawServiceId === 'string' && rawServiceId.trim().length > 0)
            ? Number(rawServiceId)
            : NaN;
      if (
        !Number.isSafeInteger(parsedServiceId) ||
        parsedServiceId <= 0 ||
        parsedServiceId > 2_147_483_647
      ) {
        return reply.code(400).send({ error: 'Invalid service ID' });
      }

      const adminId = request.userSession!.telegramId;
      try {
        const newPanel = await services.panelRegistry.createPanel({
          name: name.trim(),
          baseUrl: validatedUrl,
          apiKey: apiKey?.trim() || undefined,
          serviceId: parsedServiceId,
          serviceName: serviceName?.trim() || 'سرویس اصلی',
        });
        invalidatePanelHealthCache(services.panelRegistry);

        await services.userService.recordAdminAction({
          actorTelegramId: adminId,
          action: 'admin_create_panel',
          entityType: 'rebecca_panel',
          entityId: newPanel.id,
          metadata: { name: newPanel.name, baseUrl: newPanel.baseUrl },
        });

        return reply.code(201).send({ success: true, panel: newPanel });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to create panel';
        return reply.code(400).send({ error: message });
      }
    });

    // PATCH /api/admin/panels/:id
    adminScope.patch<{
      Params: { id: string };
      Body: {
        name?: string;
        baseUrl?: string;
        apiKey?: string | null;
      };
    }>('/api/admin/panels/:id', async (request, reply) => {
      const { id } = request.params;
      const { name, baseUrl, apiKey } = request.body || {};
      const changes: { name?: string; baseUrl?: string; apiKey?: string | null } = {};

      if (name !== undefined) {
        if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) {
          return reply.code(400).send({ error: 'Panel name must be between 1 and 80 characters' });
        }
        changes.name = name.trim();
      }

      if (baseUrl !== undefined) {
        if (typeof baseUrl !== 'string') {
          return reply.code(400).send({ error: 'Invalid panel URL' });
        }
        try {
          changes.baseUrl = validateRebeccaBaseUrl(baseUrl);
        } catch (err: unknown) {
          return reply
            .code(400)
            .send({ error: err instanceof Error ? err.message : 'Invalid panel URL' });
        }
      }

      if (apiKey !== undefined) {
        if (apiKey !== null && typeof apiKey !== 'string') {
          return reply.code(400).send({ error: 'Invalid API key' });
        }
        changes.apiKey = typeof apiKey === 'string' ? apiKey.trim() || null : null;
      }

      const adminId = request.userSession!.telegramId;
      try {
        await services.panelRegistry.updatePanel(id, changes);
        invalidatePanelHealthCache(services.panelRegistry);
        const auditMetadata: Record<string, unknown> = { ...changes };
        if ('apiKey' in auditMetadata) {
          auditMetadata.apiKey = changes.apiKey === null ? '[CLEARED]' : '[REDACTED]';
        }
        await services.userService.recordAdminAction({
          actorTelegramId: adminId,
          action: 'admin_update_panel',
          entityType: 'rebecca_panel',
          entityId: id,
          metadata: auditMetadata,
        });
        return reply.code(200).send({ success: true });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to update panel';
        return reply.code(400).send({ error: message });
      }
    });

    // POST /api/admin/panels/:id/toggle
    adminScope.post<{
      Params: { id: string };
      Body: { enabled: boolean };
    }>('/api/admin/panels/:id/toggle', async (request, reply) => {
      const { id } = request.params;
      const { enabled } = request.body || {};
      if (typeof enabled !== 'boolean') {
        return reply.code(400).send({ error: 'Field "enabled" must be a boolean' });
      }
      const adminId = request.userSession!.telegramId;
      try {
        await services.panelRegistry.setPanelEnabled(id, enabled);
        invalidatePanelHealthCache(services.panelRegistry);
        await services.userService.recordAdminAction({
          actorTelegramId: adminId,
          action: 'admin_toggle_panel',
          entityType: 'rebecca_panel',
          entityId: id,
          metadata: { enabled },
        });
        return reply.code(200).send({ success: true, enabled });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to toggle panel status';
        return reply.code(400).send({ error: message });
      }
    });

    // POST /api/admin/panels/:id/default
    adminScope.post<{
      Params: { id: string };
    }>('/api/admin/panels/:id/default', async (request, reply) => {
      const { id } = request.params;
      const adminId = request.userSession!.telegramId;
      try {
        await services.panelRegistry.setDefaultPanel(id);
        await services.userService.recordAdminAction({
          actorTelegramId: adminId,
          action: 'admin_set_default_panel',
          entityType: 'rebecca_panel',
          entityId: id,
        });
        return reply.code(200).send({ success: true });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to set default panel';
        return reply.code(400).send({ error: message });
      }
    });

    // DELETE /api/admin/panels/:id
    adminScope.delete<{
      Params: { id: string };
    }>('/api/admin/panels/:id', async (request, reply) => {
      const { id } = request.params;
      if (services.panelRegistry.listPanels().length <= 1) {
        return reply.code(400).send({ error: 'Cannot delete the only configured panel' });
      }
      const adminId = request.userSession!.telegramId;
      try {
        await services.panelRegistry.deletePanel(id);
        invalidatePanelHealthCache(services.panelRegistry);
        await services.userService.recordAdminAction({
          actorTelegramId: adminId,
          action: 'admin_delete_panel',
          entityType: 'rebecca_panel',
          entityId: id,
        });
        return reply.code(200).send({ success: true });
      } catch (err: unknown) {
        if (err instanceof RebeccaPanelInUseError) {
          return reply.code(400).send({ error: 'Panel is currently in use or is default panel' });
        }
        const message = err instanceof Error ? err.message : 'Failed to delete panel';
        return reply.code(400).send({ error: message });
      }
    });

    // POST /api/admin/panels/:id/test
    adminScope.post<{
      Params: { id: string };
    }>('/api/admin/panels/:id/test', async (request, reply) => {
      const { id } = request.params;
      invalidatePanelHealthCache(services.panelRegistry);
      try {
        if (typeof services.panelRegistry.testConnection === 'function') {
          const testRes = await services.panelRegistry.testConnection(id);
          return reply.code(200).send({
            success: true,
            healthy: testRes.ok,
            latencyMs: testRes.latencyMs,
          });
        }
        if (typeof services.panelRegistry.getService === 'function') {
          const service = services.panelRegistry.getService(id);
          const start = Date.now();
          const healthy = await service.checkHealth();
          const latencyMs = Date.now() - start;
          return reply.code(200).send({
            success: true,
            healthy,
            latencyMs,
          });
        }
        return reply
          .code(400)
          .send({ success: false, healthy: false, error: 'Registry service unavailable' });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Connection test failed';
        return reply.code(200).send({
          success: false,
          healthy: false,
          error: message,
        });
      }
    });

    // POST /api/admin/panels/test-all
    adminScope.post('/api/admin/panels/test-all', async (_request, reply) => {
      invalidatePanelHealthCache(services.panelRegistry);
      const panels = services.panelRegistry.listPanels();
      const results: Record<string, { healthy: boolean; latencyMs?: number; error?: string }> = {};

      await Promise.all(
        panels.map(async (panel) => {
          if (!panel.enabled) {
            results[panel.id] = { healthy: false, error: 'Panel is disabled' };
            return;
          }
          try {
            if (typeof services.panelRegistry.testConnection === 'function') {
              const testRes = await services.panelRegistry.testConnection(panel.id);
              results[panel.id] = { healthy: testRes.ok, latencyMs: testRes.latencyMs };
            } else if (typeof services.panelRegistry.getService === 'function') {
              const service = services.panelRegistry.getService(panel.id);
              const start = Date.now();
              const healthy = await service.checkHealth();
              results[panel.id] = { healthy, latencyMs: Date.now() - start };
            } else {
              results[panel.id] = { healthy: false, error: 'Test service unavailable' };
            }
          } catch (err: unknown) {
            results[panel.id] = {
              healthy: false,
              error: err instanceof Error ? err.message : 'Connection test failed',
            };
          }
        })
      );

      return reply.code(200).send({ success: true, results });
    });

    // POST /api/admin/panels/:id/services
    adminScope.post<{
      Params: { id: string };
      Body: { serviceId: number; name: string };
    }>('/api/admin/panels/:id/services', async (request, reply) => {
      const { id } = request.params;
      const { serviceId, name } = request.body || {};
      const parsedServiceId = Number(serviceId);
      if (
        !Number.isSafeInteger(parsedServiceId) ||
        parsedServiceId <= 0 ||
        parsedServiceId > 2_147_483_647
      ) {
        return reply.code(400).send({ error: 'Service ID must be a positive integer' });
      }
      if (!name || typeof name !== 'string' || !name.trim() || name.trim().length > 80) {
        return reply.code(400).send({ error: 'Service name must be between 1 and 80 characters' });
      }
      const adminId = request.userSession!.telegramId;
      try {
        await services.panelRegistry.addService(id, parsedServiceId, name.trim());
        await services.userService.recordAdminAction({
          actorTelegramId: adminId,
          action: 'admin_add_panel_service',
          entityType: 'rebecca_panel_service',
          entityId: `${id}:${parsedServiceId}`,
          metadata: { serviceId: parsedServiceId, name: name.trim() },
        });
        return reply.code(200).send({ success: true });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to add service';
        return reply.code(400).send({ error: message });
      }
    });

    // POST /api/admin/panels/:id/services/:serviceId/default
    adminScope.post<{
      Params: { id: string; serviceId: string };
    }>('/api/admin/panels/:id/services/:serviceId/default', async (request, reply) => {
      const { id, serviceId } = request.params;
      const parsedServiceId = Number(serviceId);
      if (!Number.isSafeInteger(parsedServiceId) || parsedServiceId <= 0) {
        return reply.code(400).send({ error: 'Invalid service ID' });
      }
      const adminId = request.userSession!.telegramId;
      try {
        await services.panelRegistry.setDefaultService(id, parsedServiceId);
        await services.userService.recordAdminAction({
          actorTelegramId: adminId,
          action: 'admin_set_default_panel_service',
          entityType: 'rebecca_panel_service',
          entityId: `${id}:${parsedServiceId}`,
        });
        return reply.code(200).send({ success: true });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to set default service';
        return reply.code(400).send({ error: message });
      }
    });

    // POST /api/admin/panels/:id/services/:serviceId/custom-target
    adminScope.post<{
      Params: { id: string; serviceId: string };
    }>('/api/admin/panels/:id/services/:serviceId/custom-target', async (request, reply) => {
      const { id, serviceId } = request.params;
      const parsedServiceId = Number(serviceId);
      if (!Number.isSafeInteger(parsedServiceId) || parsedServiceId <= 0) {
        return reply.code(400).send({ error: 'Invalid service ID' });
      }
      const adminId = request.userSession!.telegramId;
      try {
        await services.panelRegistry.resolveTarget(id, parsedServiceId);
        if (services.translationService) {
          await services.translationService.updateSettings({
            custom_volume_target_json: JSON.stringify({
              panelId: id,
              serviceId: parsedServiceId,
            }),
            custom_volume_panel_id: '',
            custom_volume_service_id: '',
          });
        }
        await services.userService.recordAdminAction({
          actorTelegramId: adminId,
          action: 'admin_set_custom_volume_target_service',
          entityType: 'rebecca_panel_service',
          entityId: `${id}:${parsedServiceId}`,
        });
        return reply.code(200).send({ success: true });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to set custom volume target';
        return reply.code(400).send({ error: message });
      }
    });

    // DELETE /api/admin/panels/:id/services/:serviceId
    adminScope.delete<{
      Params: { id: string; serviceId: string };
    }>('/api/admin/panels/:id/services/:serviceId', async (request, reply) => {
      const { id, serviceId } = request.params;
      const parsedServiceId = Number(serviceId);
      if (!Number.isSafeInteger(parsedServiceId) || parsedServiceId <= 0) {
        return reply.code(400).send({ error: 'Invalid service ID' });
      }
      const adminId = request.userSession!.telegramId;
      try {
        await services.panelRegistry.deleteService(id, parsedServiceId);
        await services.userService.recordAdminAction({
          actorTelegramId: adminId,
          action: 'admin_delete_panel_service',
          entityType: 'rebecca_panel_service',
          entityId: `${id}:${parsedServiceId}`,
        });
        return reply.code(200).send({ success: true });
      } catch (err: unknown) {
        if (err instanceof RebeccaPanelInUseError) {
          return reply.code(400).send({ error: 'Service is in use or is default service' });
        }
        const message = err instanceof Error ? err.message : 'Failed to delete service';
        return reply.code(400).send({ error: message });
      }
    });

    // ── Bank Cards Management API ──────────────────────────────────────────────

    const resolvePaymentService = (): PaymentService | null => {
      if (services.paymentService) return services.paymentService;
      if (services.translationService) {
        return new PaymentService(services.translationService);
      }
      return null;
    };

    const buildBankCardsPayload = async (ps: PaymentService) => {
      const ts = services.translationService;
      const defaultLocale =
        typeof ts?.getDefaultLocale === 'function' && ts.getDefaultLocale() === 'en' ? 'en' : 'fa';
      const cards = await ps.getBankCardsWithDailyUsage(new Date(), defaultLocale);
      const legacyCard = ps.getLegacyDefaultCard(defaultLocale);
      const activeCount = cards.filter((card) => card.enabled).length;
      return {
        cards,
        legacyCard,
        activeCount,
        rotationActive: activeCount >= 2,
        uniqueTopupAmountEnabled: ts ? uniqueTopupAmountEnabled(ts) : false,
        bounds: { maxCards: MAX_BANK_CARDS },
      };
    };

    // GET /api/admin/bank-cards
    adminScope.get('/api/admin/bank-cards', async (_request, reply) => {
      const ps = resolvePaymentService();
      if (!ps) {
        return reply.code(500).send({ error: 'Payment service unavailable' });
      }
      return reply.code(200).send(await buildBankCardsPayload(ps));
    });

    // POST /api/admin/bank-cards
    adminScope.post<{
      Body: {
        cardNumber: string;
        cardHolder: string;
        bankName?: string | null;
        dailyCapToman?: number | null;
        enabled?: boolean;
      };
    }>(
      '/api/admin/bank-cards',
      {
        schema: {
          body: {
            type: 'object',
            required: ['cardNumber', 'cardHolder'],
            properties: {
              cardNumber: { type: 'string', minLength: 12, maxLength: 40 },
              cardHolder: { type: 'string', minLength: 1, maxLength: 120 },
              bankName: { type: ['string', 'null'], maxLength: 60 },
              dailyCapToman: { type: ['number', 'null'] },
              enabled: { type: 'boolean' },
            },
          },
        },
      },
      async (request, reply) => {
        const ps = resolvePaymentService();
        if (!ps) return reply.code(500).send({ error: 'Payment service unavailable' });

        const existing = ps.getConfiguredBankCards();
        if (existing.length >= MAX_BANK_CARDS) {
          return reply
            .code(400)
            .send({ error: `Maximum bank cards (${MAX_BANK_CARDS}) reached`, code: 'MAX_CARDS' });
        }

        const normalizedNum = normalizeCardNumber(request.body.cardNumber);
        if (!isValidBankCardNumber(normalizedNum)) {
          return reply
            .code(400)
            .send({ error: 'Card number must contain 12-24 digits', code: 'INVALID_CARD_NUMBER' });
        }
        if (hasDuplicateCardNumber(existing, normalizedNum)) {
          return reply
            .code(409)
            .send({ error: 'Card number already exists', code: 'DUPLICATE_CARD_NUMBER' });
        }

        const holder = request.body.cardHolder.trim();
        if (!holder || holder.length > 120) {
          return reply.code(400).send({ error: 'Invalid card holder name' });
        }

        let dailyCapToman: number | null = null;
        if (request.body.dailyCapToman !== undefined && request.body.dailyCapToman !== null) {
          const cap = Math.trunc(request.body.dailyCapToman);
          if (!Number.isSafeInteger(cap) || cap < 0) {
            return reply.code(400).send({ error: 'Invalid daily cap amount' });
          }
          dailyCapToman = cap > 0 ? cap : null;
        }

        const rawBank = request.body.bankName?.trim();
        const bankName = rawBank || detectIranianBankName(normalizedNum, 'fa');

        const created: BankCardConfig = {
          id: generateBankCardId(existing),
          cardNumber: normalizedNum,
          cardHolder: holder,
          enabled: request.body.enabled ?? true,
          dailyCapToman,
          ...(bankName ? { bankName } : {}),
        };

        await ps.updateBankCards([...existing, created]);
        await services.userService.recordAdminAction({
          actorTelegramId: request.userSession!.telegramId,
          action: 'admin_add_bank_card',
          entityType: 'bank_card',
          entityId: created.id,
        });

        const payload = await buildBankCardsPayload(ps);
        const createdStatus = payload.cards.find((c) => c.id === created.id) ?? created;
        return reply.code(201).send({ card: createdStatus, ...payload });
      }
    );

    // PATCH /api/admin/bank-cards/:id
    adminScope.patch<{
      Params: { id: string };
      Body: {
        cardNumber?: string;
        cardHolder?: string;
        bankName?: string | null;
        dailyCapToman?: number | null;
        enabled?: boolean;
      };
    }>(
      '/api/admin/bank-cards/:id',
      {
        schema: {
          body: {
            type: 'object',
            properties: {
              cardNumber: { type: 'string', minLength: 12, maxLength: 40 },
              cardHolder: { type: 'string', minLength: 1, maxLength: 120 },
              bankName: { type: ['string', 'null'], maxLength: 60 },
              dailyCapToman: { type: ['number', 'null'] },
              enabled: { type: 'boolean' },
            },
          },
        },
      },
      async (request, reply) => {
        const ps = resolvePaymentService();
        if (!ps) return reply.code(500).send({ error: 'Payment service unavailable' });

        const existing = ps.getConfiguredBankCards();
        const index = existing.findIndex((c) => c.id === request.params.id);
        if (index === -1) {
          return reply.code(404).send({ error: 'Bank card not found' });
        }

        const current = existing[index]!;
        let nextNumber = current.cardNumber;
        if (request.body.cardNumber !== undefined) {
          const normalizedNum = normalizeCardNumber(request.body.cardNumber);
          if (!isValidBankCardNumber(normalizedNum)) {
            return reply.code(400).send({
              error: 'Card number must contain 12-24 digits',
              code: 'INVALID_CARD_NUMBER',
            });
          }
          if (hasDuplicateCardNumber(existing, normalizedNum, current.id)) {
            return reply
              .code(409)
              .send({ error: 'Card number already exists', code: 'DUPLICATE_CARD_NUMBER' });
          }
          nextNumber = normalizedNum;
        }

        let nextHolder = current.cardHolder;
        if (request.body.cardHolder !== undefined) {
          const trimmed = request.body.cardHolder.trim();
          if (!trimmed || trimmed.length > 120) {
            return reply.code(400).send({ error: 'Invalid card holder name' });
          }
          nextHolder = trimmed;
        }

        let nextBankName = current.bankName;
        if (request.body.bankName !== undefined) {
          const trimmed = request.body.bankName?.trim();
          nextBankName = trimmed || undefined;
        }

        let nextCap = current.dailyCapToman ?? null;
        if (request.body.dailyCapToman !== undefined) {
          if (request.body.dailyCapToman === null) {
            nextCap = null;
          } else {
            const cap = Math.trunc(request.body.dailyCapToman);
            if (!Number.isSafeInteger(cap) || cap < 0) {
              return reply.code(400).send({ error: 'Invalid daily cap amount' });
            }
            nextCap = cap > 0 ? cap : null;
          }
        }

        const nextEnabled =
          request.body.enabled !== undefined ? Boolean(request.body.enabled) : current.enabled;

        const updated: BankCardConfig = {
          id: current.id,
          cardNumber: nextNumber,
          cardHolder: nextHolder,
          enabled: nextEnabled,
          dailyCapToman: nextCap,
          ...(nextBankName ? { bankName: nextBankName } : {}),
        };

        const nextCards = existing.map((c, i) => (i === index ? updated : c));
        await ps.updateBankCards(nextCards);
        await services.userService.recordAdminAction({
          actorTelegramId: request.userSession!.telegramId,
          action: 'admin_update_bank_card',
          entityType: 'bank_card',
          entityId: current.id,
        });

        const payload = await buildBankCardsPayload(ps);
        const updatedStatus = payload.cards.find((c) => c.id === current.id) ?? updated;
        return reply.code(200).send({ card: updatedStatus, ...payload });
      }
    );

    // POST /api/admin/bank-cards/:id/toggle
    adminScope.post<{
      Params: { id: string };
      Body?: { enabled?: boolean };
    }>('/api/admin/bank-cards/:id/toggle', async (request, reply) => {
      const ps = resolvePaymentService();
      if (!ps) return reply.code(500).send({ error: 'Payment service unavailable' });

      const existing = ps.getConfiguredBankCards();
      const target = existing.find((c) => c.id === request.params.id);
      if (!target) {
        return reply.code(404).send({ error: 'Bank card not found' });
      }

      const nextEnabled =
        typeof request.body?.enabled === 'boolean' ? request.body.enabled : !target.enabled;
      const nextCards = existing.map((c) =>
        c.id === target.id ? { ...c, enabled: nextEnabled } : c
      );
      await ps.updateBankCards(nextCards);
      await services.userService.recordAdminAction({
        actorTelegramId: request.userSession!.telegramId,
        action: nextEnabled ? 'admin_enable_bank_card' : 'admin_disable_bank_card',
        entityType: 'bank_card',
        entityId: target.id,
      });

      return reply.code(200).send(await buildBankCardsPayload(ps));
    });

    // POST /api/admin/bank-cards/reorder
    adminScope.post<{
      Body: { orderedIds: string[] };
    }>(
      '/api/admin/bank-cards/reorder',
      {
        schema: {
          body: {
            type: 'object',
            required: ['orderedIds'],
            properties: {
              orderedIds: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      async (request, reply) => {
        const ps = resolvePaymentService();
        if (!ps) return reply.code(500).send({ error: 'Payment service unavailable' });

        const existing = ps.getConfiguredBankCards();
        const byId = new Map(existing.map((card) => [card.id, card]));
        const reordered: BankCardConfig[] = [];
        const seen = new Set<string>();

        for (const id of request.body.orderedIds) {
          const card = byId.get(id);
          if (card && !seen.has(id)) {
            reordered.push(card);
            seen.add(id);
          }
        }
        for (const card of existing) {
          if (!seen.has(card.id)) {
            reordered.push(card);
          }
        }

        await ps.updateBankCards(reordered);
        return reply.code(200).send(await buildBankCardsPayload(ps));
      }
    );

    // POST /api/admin/bank-cards/import-legacy
    adminScope.post('/api/admin/bank-cards/import-legacy', async (request, reply) => {
      const ps = resolvePaymentService();
      if (!ps) return reply.code(500).send({ error: 'Payment service unavailable' });

      const existing = ps.getConfiguredBankCards();
      const legacy = ps.getLegacyDefaultCard('fa');
      if (!legacy) {
        return reply.code(400).send({ error: 'No legacy default card configured' });
      }
      if (hasDuplicateCardNumber(existing, legacy.cardNumber)) {
        return reply.code(200).send(await buildBankCardsPayload(ps));
      }
      if (existing.length >= MAX_BANK_CARDS) {
        return reply.code(400).send({ error: `Maximum bank cards (${MAX_BANK_CARDS}) reached` });
      }

      const imported: BankCardConfig = {
        id: generateBankCardId(existing),
        cardNumber: legacy.cardNumber,
        cardHolder: legacy.cardHolder || '—',
        enabled: true,
        dailyCapToman: null,
        ...(legacy.bankName ? { bankName: legacy.bankName } : {}),
      };

      await ps.updateBankCards([...existing, imported]);
      await services.userService.recordAdminAction({
        actorTelegramId: request.userSession!.telegramId,
        action: 'admin_import_legacy_bank_card',
        entityType: 'bank_card',
        entityId: imported.id,
      });

      return reply.code(200).send(await buildBankCardsPayload(ps));
    });

    // PUT /api/admin/bank-cards/settings
    adminScope.put<{
      Body: {
        uniqueTopupAmountEnabled?: boolean;
        cardNumber?: string;
        cardHolder?: string;
      };
    }>(
      '/api/admin/bank-cards/settings',
      {
        schema: {
          body: {
            type: 'object',
            properties: {
              uniqueTopupAmountEnabled: { type: 'boolean' },
              cardNumber: { type: 'string', maxLength: 40 },
              cardHolder: { type: 'string', maxLength: 120 },
            },
          },
        },
      },
      async (request, reply) => {
        const ps = resolvePaymentService();
        const ts = services.translationService;
        if (!ps || !ts) return reply.code(500).send({ error: 'Payment service unavailable' });

        const updates: Record<string, string> = {};
        if (typeof request.body.uniqueTopupAmountEnabled === 'boolean') {
          updates.unique_topup_amount_enabled = String(request.body.uniqueTopupAmountEnabled);
        }
        if (request.body.cardNumber !== undefined) {
          const normalized = normalizeCardNumber(request.body.cardNumber);
          if (normalized && !isValidBankCardNumber(normalized)) {
            return reply.code(400).send({ error: 'Card number must contain 12-24 digits' });
          }
          updates.card_number = normalized;
        }
        if (request.body.cardHolder !== undefined) {
          updates.card_holder = request.body.cardHolder.trim();
        }
        if (Object.keys(updates).length > 0) {
          await ts.updateSettings(updates);
        }

        return reply.code(200).send(await buildBankCardsPayload(ps));
      }
    );

    // DELETE /api/admin/bank-cards/:id
    adminScope.delete<{
      Params: { id: string };
    }>('/api/admin/bank-cards/:id', async (request, reply) => {
      const ps = resolvePaymentService();
      if (!ps) return reply.code(500).send({ error: 'Payment service unavailable' });

      const existing = ps.getConfiguredBankCards();
      const target = existing.find((c) => c.id === request.params.id);
      if (!target) {
        return reply.code(404).send({ error: 'Bank card not found' });
      }

      const nextCards = existing.filter((c) => c.id !== target.id);
      await ps.updateBankCards(nextCards);
      await services.userService.recordAdminAction({
        actorTelegramId: request.userSession!.telegramId,
        action: 'admin_delete_bank_card',
        entityType: 'bank_card',
        entityId: target.id,
      });

      return reply.code(200).send({ deletedId: target.id, ...(await buildBankCardsPayload(ps)) });
    });
  });
}

/**
 * Clamp a raw querystring integer into [1, max]. Rejects NaN, negatives,
 * and huge values that previously caused Drizzle errors / full scans.
 */
function clampPositiveInt(raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  const truncated = Math.trunc(parsed);
  if (!Number.isSafeInteger(truncated) || truncated < 1) return fallback;
  return Math.min(truncated, max);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('PANEL_HEALTH_TIMEOUT')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
