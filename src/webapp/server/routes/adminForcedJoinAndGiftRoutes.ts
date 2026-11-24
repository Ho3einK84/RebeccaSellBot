/**
 * Admin Forced Channel Join & Bulk Gift Campaign REST API routes.
 */
import type { FastifyInstance } from 'fastify';
import { adminGuardWithCheck } from '../middleware/adminGuard.js';
import type { AdminService } from '../../../domain/services/AdminService.js';
import {
  BulkGiftError,
  MAX_BULK_GIFT_DAYS,
  MAX_BULK_GIFT_GB,
  MAX_BULK_GIFT_MESSAGE_LENGTH,
  normalizeBulkGiftStatuses,
  parseBulkGiftStatusesJson,
  type BulkGiftJob,
  type BulkGiftService,
} from '../../../domain/services/BulkGiftService.js';
import {
  FORCED_JOIN_SCOPES,
  ForcedJoinError,
  MAX_FORCED_JOIN_CHANNELS,
  type ForcedJoinScope,
  type ForcedJoinService,
} from '../../../domain/services/ForcedJoinService.js';
import type { RebeccaPanelRegistry } from '../../../domain/services/RebeccaPanelRegistry.js';
import type { UserService } from '../../../domain/services/UserService.js';

export interface AdminForcedJoinAndGiftRoutesOptions {
  forcedJoinService?: ForcedJoinService;
  bulkGiftService?: BulkGiftService;
  panelRegistry?: RebeccaPanelRegistry;
  userService: UserService;
  adminService?: Pick<AdminService, 'isAdmin'> & { adminIds?: number[] };
}

function serializeBulkGiftJob(job: BulkGiftJob) {
  return {
    id: job.id,
    actorTelegramId: job.actorTelegramId,
    giftGb: job.giftGb,
    giftDays: job.giftDays,
    targetStatuses: parseBulkGiftStatusesJson(job.targetStatuses),
    panelId: job.panelId,
    serviceId: job.serviceId,
    notifyMessage: job.notifyMessage,
    status: job.status,
    totalCount: job.totalCount,
    appliedCount: job.appliedCount,
    skippedCount: job.skippedCount,
    failedCount: job.failedCount,
    createdAt: job.createdAt instanceof Date ? job.createdAt.toISOString() : String(job.createdAt),
    startedAt: job.startedAt
      ? job.startedAt instanceof Date
        ? job.startedAt.toISOString()
        : String(job.startedAt)
      : null,
    completedAt: job.completedAt
      ? job.completedAt instanceof Date
        ? job.completedAt.toISOString()
        : String(job.completedAt)
      : null,
    updatedAt: job.updatedAt instanceof Date ? job.updatedAt.toISOString() : String(job.updatedAt),
  };
}

function mapForcedJoinErrorStatus(code: ForcedJoinError['code']): number {
  if (code === 'CHANNEL_NOT_FOUND') return 404;
  if (code === 'DUPLICATE_CHANNEL') return 409;
  return 400;
}

export function registerAdminForcedJoinAndGiftRoutes(
  app: FastifyInstance,
  options: AdminForcedJoinAndGiftRoutesOptions
): void {
  app.register(async (adminScope) => {
    adminScope.addHook('preHandler', (request, reply) =>
      adminGuardWithCheck(
        request,
        reply,
        options.adminService ? (id) => options.adminService!.isAdmin(id) : undefined
      )
    );

    // -------------------------------------------------------------------------
    // Forced Join Management
    // -------------------------------------------------------------------------

    // GET /api/admin/forced-join
    adminScope.get('/api/admin/forced-join', async (_request, reply) => {
      if (!options.forcedJoinService) {
        return reply.code(503).send({ error: 'Forced join service unavailable' });
      }
      const config = options.forcedJoinService.getConfig();
      return reply.code(200).send({
        ...config,
        scopes: [...FORCED_JOIN_SCOPES],
        maxChannels: MAX_FORCED_JOIN_CHANNELS,
      });
    });

    // PUT /api/admin/forced-join/scope
    adminScope.put<{ Body: { scope?: string } }>(
      '/api/admin/forced-join/scope',
      async (request, reply) => {
        if (!options.forcedJoinService) {
          return reply.code(503).send({ error: 'Forced join service unavailable' });
        }
        const rawScope = typeof request.body?.scope === 'string' ? request.body.scope.trim() : '';
        try {
          const scope = await options.forcedJoinService.setScope(rawScope as ForcedJoinScope);
          await options.userService.recordAdminAction?.({
            actorTelegramId: request.userSession!.telegramId,
            action: 'admin_update_forced_join_scope',
            entityType: 'forced_join',
            entityId: 'scope',
            metadata: { scope },
          });
          return reply.code(200).send({
            success: true,
            ...options.forcedJoinService.getConfig(),
            maxChannels: MAX_FORCED_JOIN_CHANNELS,
          });
        } catch (err) {
          if (err instanceof ForcedJoinError) {
            return reply
              .code(mapForcedJoinErrorStatus(err.code))
              .send({ error: err.message, code: err.code });
          }
          throw err;
        }
      }
    );

    // POST /api/admin/forced-join/channels
    adminScope.post<{
      Body: {
        channelId?: string;
        title?: string;
        inviteLink?: string | null;
        enabled?: boolean;
      };
    }>('/api/admin/forced-join/channels', async (request, reply) => {
      if (!options.forcedJoinService) {
        return reply.code(503).send({ error: 'Forced join service unavailable' });
      }
      try {
        const channel = await options.forcedJoinService.addChannel({
          channelId: typeof request.body?.channelId === 'string' ? request.body.channelId : '',
          title: typeof request.body?.title === 'string' ? request.body.title : '',
          inviteLink: request.body?.inviteLink ?? null,
          enabled: request.body?.enabled,
        });
        await options.userService.recordAdminAction?.({
          actorTelegramId: request.userSession!.telegramId,
          action: 'admin_add_forced_join_channel',
          entityType: 'forced_join',
          entityId: channel.id,
          metadata: { channelId: channel.channelId, title: channel.title },
        });
        return reply.code(201).send({
          success: true,
          channel,
          ...options.forcedJoinService.getConfig(),
          maxChannels: MAX_FORCED_JOIN_CHANNELS,
        });
      } catch (err) {
        if (err instanceof ForcedJoinError) {
          return reply
            .code(mapForcedJoinErrorStatus(err.code))
            .send({ error: err.message, code: err.code });
        }
        throw err;
      }
    });

    // PATCH /api/admin/forced-join/channels/:id
    adminScope.patch<{
      Params: { id: string };
      Body: {
        channelId?: string;
        title?: string;
        inviteLink?: string | null;
        enabled?: boolean;
      };
    }>('/api/admin/forced-join/channels/:id', async (request, reply) => {
      if (!options.forcedJoinService) {
        return reply.code(503).send({ error: 'Forced join service unavailable' });
      }
      try {
        const channel = await options.forcedJoinService.updateChannel(request.params.id, {
          ...(request.body?.channelId !== undefined ? { channelId: request.body.channelId } : {}),
          ...(request.body?.title !== undefined ? { title: request.body.title } : {}),
          ...(request.body?.inviteLink !== undefined
            ? { inviteLink: request.body.inviteLink }
            : {}),
          ...(request.body?.enabled !== undefined ? { enabled: request.body.enabled } : {}),
        });
        await options.userService.recordAdminAction?.({
          actorTelegramId: request.userSession!.telegramId,
          action: 'admin_update_forced_join_channel',
          entityType: 'forced_join',
          entityId: channel.id,
          metadata: {
            channelId: channel.channelId,
            title: channel.title,
            enabled: channel.enabled,
          },
        });
        return reply.code(200).send({
          success: true,
          channel,
          ...options.forcedJoinService.getConfig(),
          maxChannels: MAX_FORCED_JOIN_CHANNELS,
        });
      } catch (err) {
        if (err instanceof ForcedJoinError) {
          return reply
            .code(mapForcedJoinErrorStatus(err.code))
            .send({ error: err.message, code: err.code });
        }
        throw err;
      }
    });

    // POST /api/admin/forced-join/channels/:id/toggle
    adminScope.post<{
      Params: { id: string };
      Body?: { enabled?: boolean };
    }>('/api/admin/forced-join/channels/:id/toggle', async (request, reply) => {
      if (!options.forcedJoinService) {
        return reply.code(503).send({ error: 'Forced join service unavailable' });
      }
      try {
        const channel = await options.forcedJoinService.toggleChannel(
          request.params.id,
          typeof request.body?.enabled === 'boolean' ? request.body.enabled : undefined
        );
        await options.userService.recordAdminAction?.({
          actorTelegramId: request.userSession!.telegramId,
          action: 'admin_toggle_forced_join_channel',
          entityType: 'forced_join',
          entityId: channel.id,
          metadata: { enabled: channel.enabled },
        });
        return reply.code(200).send({
          success: true,
          channel,
          ...options.forcedJoinService.getConfig(),
          maxChannels: MAX_FORCED_JOIN_CHANNELS,
        });
      } catch (err) {
        if (err instanceof ForcedJoinError) {
          return reply
            .code(mapForcedJoinErrorStatus(err.code))
            .send({ error: err.message, code: err.code });
        }
        throw err;
      }
    });

    // DELETE /api/admin/forced-join/channels/:id
    adminScope.delete<{ Params: { id: string } }>(
      '/api/admin/forced-join/channels/:id',
      async (request, reply) => {
        if (!options.forcedJoinService) {
          return reply.code(503).send({ error: 'Forced join service unavailable' });
        }
        const removed = await options.forcedJoinService.deleteChannel(request.params.id);
        if (!removed) {
          return reply.code(404).send({ error: 'Channel not found', code: 'CHANNEL_NOT_FOUND' });
        }
        await options.userService.recordAdminAction?.({
          actorTelegramId: request.userSession!.telegramId,
          action: 'admin_delete_forced_join_channel',
          entityType: 'forced_join',
          entityId: request.params.id,
        });
        return reply.code(200).send({
          success: true,
          ...options.forcedJoinService.getConfig(),
          maxChannels: MAX_FORCED_JOIN_CHANNELS,
        });
      }
    );

    // POST /api/admin/forced-join/test
    adminScope.post<{ Body: { channelId?: string } }>(
      '/api/admin/forced-join/test',
      async (request, reply) => {
        if (!options.forcedJoinService) {
          return reply.code(503).send({ error: 'Forced join service unavailable' });
        }
        const channelId = typeof request.body?.channelId === 'string' ? request.body.channelId : '';
        const result = await options.forcedJoinService.testChannelAccess(channelId);
        return reply.code(200).send(result);
      }
    );

    // -------------------------------------------------------------------------
    // Bulk Gift Campaigns
    // -------------------------------------------------------------------------

    // GET /api/admin/bulk-gift/jobs
    adminScope.get<{ Querystring: { page?: string; limit?: string } }>(
      '/api/admin/bulk-gift/jobs',
      async (request, reply) => {
        if (!options.bulkGiftService) {
          return reply.code(503).send({ error: 'Bulk gift service unavailable' });
        }
        const rawPage = Number(request.query.page);
        const rawLimit = Number(request.query.limit);
        const page = Number.isSafeInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
        const limit = Number.isSafeInteger(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, 20) : 10;

        const list = await options.bulkGiftService.listRecentJobs(page, limit);
        const panels = (options.panelRegistry?.listPanels?.() ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          enabled: p.enabled,
          services: p.services.map((s) => ({
            serviceId: s.serviceId,
            name: s.name,
            isDefault: s.isDefault,
          })),
        }));

        return reply.code(200).send({
          items: list.items.map(serializeBulkGiftJob),
          total: list.total,
          page: list.page,
          totalPages: list.totalPages,
          activeCount: list.activeCount,
          panels,
          limits: {
            maxGb: MAX_BULK_GIFT_GB,
            maxDays: MAX_BULK_GIFT_DAYS,
            maxMessageLength: MAX_BULK_GIFT_MESSAGE_LENGTH,
          },
        });
      }
    );

    // GET /api/admin/bulk-gift/jobs/:id
    adminScope.get<{ Params: { id: string } }>(
      '/api/admin/bulk-gift/jobs/:id',
      async (request, reply) => {
        if (!options.bulkGiftService) {
          return reply.code(503).send({ error: 'Bulk gift service unavailable' });
        }
        const job = await options.bulkGiftService.getJob(request.params.id);
        if (!job) {
          return reply.code(404).send({ error: 'Bulk gift campaign not found', code: 'NOT_FOUND' });
        }
        return reply.code(200).send({ job: serializeBulkGiftJob(job) });
      }
    );

    // POST /api/admin/bulk-gift/preview
    adminScope.post<{
      Body: {
        targetStatuses?: string[];
        panelId?: string | null;
        serviceId?: number | null;
      };
    }>('/api/admin/bulk-gift/preview', async (request, reply) => {
      if (!options.bulkGiftService) {
        return reply.code(503).send({ error: 'Bulk gift service unavailable' });
      }
      try {
        const statuses = normalizeBulkGiftStatuses(request.body?.targetStatuses ?? ['active']);
        const preview = await options.bulkGiftService.previewTargets({
          targetStatuses: statuses,
          panelId: request.body?.panelId ?? null,
          serviceId:
            request.body?.serviceId !== undefined && request.body?.serviceId !== null
              ? Number(request.body.serviceId)
              : null,
        });
        return reply.code(200).send(preview);
      } catch (err) {
        if (err instanceof BulkGiftError) {
          return reply.code(400).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    });

    // POST /api/admin/bulk-gift/jobs
    adminScope.post<{
      Body: {
        giftGb?: number;
        giftDays?: number;
        targetStatuses?: string[];
        panelId?: string | null;
        serviceId?: number | null;
        notifyMessage?: string | null;
      };
    }>('/api/admin/bulk-gift/jobs', async (request, reply) => {
      if (!options.bulkGiftService) {
        return reply.code(503).send({ error: 'Bulk gift service unavailable' });
      }
      try {
        const statuses = normalizeBulkGiftStatuses(request.body?.targetStatuses ?? ['active']);
        const panelId = request.body?.panelId ?? null;
        const serviceId =
          request.body?.serviceId !== undefined && request.body?.serviceId !== null
            ? Number(request.body.serviceId)
            : null;
        const preview = await options.bulkGiftService.previewTargets({
          targetStatuses: statuses,
          panelId,
          serviceId,
        });
        if (preview.configCount === 0) {
          return reply.code(400).send({
            error: 'No matching services found for the selected audience',
            code: 'EMPTY_AUDIENCE',
          });
        }

        const job = await options.bulkGiftService.createJob({
          actorTelegramId: request.userSession!.telegramId,
          giftGb: Number(request.body?.giftGb ?? 0),
          giftDays: Number(request.body?.giftDays ?? 0),
          targetStatuses: statuses,
          panelId,
          serviceId,
          notifyMessage: request.body?.notifyMessage ?? null,
        });
        return reply.code(201).send({
          success: true,
          job: serializeBulkGiftJob(job),
        });
      } catch (err) {
        if (err instanceof BulkGiftError) {
          return reply.code(400).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    });

    // POST /api/admin/bulk-gift/jobs/:id/cancel
    adminScope.post<{ Params: { id: string } }>(
      '/api/admin/bulk-gift/jobs/:id/cancel',
      async (request, reply) => {
        if (!options.bulkGiftService) {
          return reply.code(503).send({ error: 'Bulk gift service unavailable' });
        }
        const existing = await options.bulkGiftService.getJob(request.params.id);
        if (!existing) {
          return reply.code(404).send({ error: 'Bulk gift campaign not found', code: 'NOT_FOUND' });
        }
        const requested = await options.bulkGiftService.requestCancel(
          request.params.id,
          request.userSession!.telegramId
        );
        const updated = (await options.bulkGiftService.getJob(request.params.id)) ?? existing;
        return reply.code(200).send({
          success: true,
          requested,
          job: serializeBulkGiftJob(updated),
        });
      }
    );
  });
}
