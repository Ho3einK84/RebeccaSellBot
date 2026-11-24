import type { FastifyInstance } from 'fastify';
import { adminGuardWithCheck } from '../middleware/adminGuard.js';
import type { AdminService } from '../../../domain/services/AdminService.js';
import type { UserGroupService } from '../../../domain/services/UserGroupService.js';

export interface AdminGroupRoutesOptions {
  userGroupService?: UserGroupService;
  adminService?: Pick<AdminService, 'isAdmin'>;
}

const VALIDATION_ERROR_CODES = new Set([
  'INVALID_GROUP_NAME',
  'INVALID_GROUP_BADGE',
  'INVALID_DISCOUNT_PERCENT',
  'INVALID_CUSTOM_PRICE',
  'INVALID_CREDIT_LIMIT',
  'INVALID_GROUP_ID',
  'INVALID_TRANSFER_TARGET',
  'TRANSFER_TARGET_NOT_FOUND',
  'INVALID_GROUP_EXPIRY',
  'INVALID_TELEGRAM_ID',
  'GROUP_NOT_FOUND',
]);

function mapGroupMutationError(
  err: unknown
): { status: number; code: string; error: string } | null {
  if (!(err instanceof Error)) return null;
  if (err.message === 'USER_NOT_FOUND') {
    return { status: 404, code: 'USER_NOT_FOUND', error: 'User not found' };
  }
  if (err.message === 'GROUP_NOT_FOUND' || err.message === 'TRANSFER_TARGET_NOT_FOUND') {
    return { status: 404, code: err.message, error: 'User group not found' };
  }
  if (VALIDATION_ERROR_CODES.has(err.message)) {
    return { status: 400, code: err.message, error: err.message };
  }
  return null;
}

export function registerAdminGroupRoutes(
  app: FastifyInstance,
  options: AdminGroupRoutesOptions
): void {
  app.register(async (adminScope) => {
    adminScope.addHook('preHandler', (request, reply) =>
      adminGuardWithCheck(
        request,
        reply,
        options.adminService ? (id) => options.adminService!.isAdmin(id) : undefined
      )
    );

    const ensureService = () => options.userGroupService;

    // GET /api/admin/groups
    adminScope.get('/api/admin/groups', async (_request, reply) => {
      const service = ensureService();
      if (!service) {
        return reply
          .code(503)
          .send({ error: 'User group service unavailable', code: 'SERVICE_UNAVAILABLE' });
      }
      const groups = await service.listGroupsWithMemberCounts();
      return reply.code(200).send({ groups });
    });

    // POST /api/admin/groups
    adminScope.post<{
      Body: {
        name?: string;
        badge?: string | null;
        isDefault?: boolean;
        discountPercent?: number;
        applyDiscountToCustomVolume?: boolean;
        customPricePerGb?: number | null;
        customPricePerDay?: number | null;
        allowCatalogDiscounts?: boolean;
        allowPromoCodes?: boolean;
        allowCashback?: boolean;
        allowLuckyWheel?: boolean;
        allowCustomServiceName?: boolean;
        creditLimit?: number;
      };
    }>('/api/admin/groups', async (request, reply) => {
      const service = ensureService();
      if (!service) {
        return reply
          .code(503)
          .send({ error: 'User group service unavailable', code: 'SERVICE_UNAVAILABLE' });
      }
      try {
        const body = request.body ?? {};
        const group = await service.createGroup(
          {
            name: body.name ?? '',
            badge: body.badge,
            isDefault: body.isDefault,
            discountPercent: body.discountPercent,
            applyDiscountToCustomVolume: body.applyDiscountToCustomVolume,
            customPricePerGb: body.customPricePerGb,
            customPricePerDay: body.customPricePerDay,
            allowCatalogDiscounts: body.allowCatalogDiscounts,
            allowPromoCodes: body.allowPromoCodes,
            allowCashback: body.allowCashback,
            allowLuckyWheel: body.allowLuckyWheel,
            allowCustomServiceName: body.allowCustomServiceName,
            creditLimit: body.creditLimit,
          },
          request.userSession?.telegramId
        );
        return reply.code(201).send({ group });
      } catch (err: unknown) {
        const mapped = mapGroupMutationError(err);
        if (mapped)
          return reply.code(mapped.status).send({ error: mapped.error, code: mapped.code });
        throw err;
      }
    });

    // PATCH /api/admin/groups/:id
    adminScope.patch<{
      Params: { id: string };
      Body: {
        name?: string;
        badge?: string | null;
        isDefault?: boolean;
        discountPercent?: number;
        applyDiscountToCustomVolume?: boolean;
        customPricePerGb?: number | null;
        customPricePerDay?: number | null;
        allowCatalogDiscounts?: boolean;
        allowPromoCodes?: boolean;
        allowCashback?: boolean;
        allowLuckyWheel?: boolean;
        allowCustomServiceName?: boolean;
        creditLimit?: number;
      };
    }>('/api/admin/groups/:id', async (request, reply) => {
      const service = ensureService();
      if (!service) {
        return reply
          .code(503)
          .send({ error: 'User group service unavailable', code: 'SERVICE_UNAVAILABLE' });
      }
      try {
        const updated = await service.updateGroup(
          request.params.id,
          request.body ?? {},
          request.userSession?.telegramId
        );
        if (!updated) {
          return reply.code(404).send({ error: 'User group not found', code: 'GROUP_NOT_FOUND' });
        }
        return reply.code(200).send({ group: updated });
      } catch (err: unknown) {
        const mapped = mapGroupMutationError(err);
        if (mapped)
          return reply.code(mapped.status).send({ error: mapped.error, code: mapped.code });
        throw err;
      }
    });

    // DELETE /api/admin/groups/:id
    adminScope.delete<{
      Params: { id: string };
      Querystring?: { transferToGroupId?: string };
      Body?: { transferToGroupId?: string | null };
    }>('/api/admin/groups/:id', async (request, reply) => {
      const service = ensureService();
      if (!service) {
        return reply
          .code(503)
          .send({ error: 'User group service unavailable', code: 'SERVICE_UNAVAILABLE' });
      }
      try {
        let transferToGroupId: string | null | undefined = request.body?.transferToGroupId;
        if (transferToGroupId === undefined && request.query?.transferToGroupId !== undefined) {
          const rawQueryTarget = request.query.transferToGroupId.trim();
          transferToGroupId =
            rawQueryTarget === '' || rawQueryTarget === '__none__' ? null : rawQueryTarget;
        }
        const result = await service.deleteGroup(request.params.id, {
          transferToGroupId,
          actorAdminId: request.userSession?.telegramId,
        });
        if (!result.deleted) {
          return reply.code(404).send({ error: 'User group not found', code: 'GROUP_NOT_FOUND' });
        }
        return reply.code(200).send({ success: true, ...result });
      } catch (err: unknown) {
        const mapped = mapGroupMutationError(err);
        if (mapped)
          return reply.code(mapped.status).send({ error: mapped.error, code: mapped.code });
        throw err;
      }
    });

    // POST /api/admin/users/:id/group
    adminScope.post<{
      Params: { id: string };
      Body?: { groupId?: string | null; expiresAt?: string | null; durationDays?: number | null };
    }>('/api/admin/users/:id/group', async (request, reply) => {
      const service = ensureService();
      if (!service) {
        return reply
          .code(503)
          .send({ error: 'User group service unavailable', code: 'SERVICE_UNAVAILABLE' });
      }
      const telegramId = Number(request.params.id);
      if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
        return reply.code(400).send({ error: 'Invalid user ID' });
      }
      const groupId = request.body?.groupId ?? null;
      let expiresAt: Date | null = null;
      if (groupId !== null) {
        if (typeof request.body?.durationDays === 'number' && request.body.durationDays > 0) {
          if (
            !Number.isSafeInteger(request.body.durationDays) ||
            request.body.durationDays > 3650
          ) {
            return reply.code(400).send({ error: 'Invalid durationDays' });
          }
          expiresAt = new Date(Date.now() + request.body.durationDays * 86_400_000);
        } else if (typeof request.body?.expiresAt === 'string' && request.body.expiresAt.trim()) {
          const parsed = new Date(request.body.expiresAt);
          if (Number.isNaN(parsed.getTime())) {
            return reply.code(400).send({ error: 'Invalid expiresAt timestamp' });
          }
          expiresAt = parsed;
        }
      }

      try {
        const effectivePolicy = await service.assignUserGroup({
          telegramId,
          groupId,
          expiresAt,
          actorAdminId: request.userSession?.telegramId,
        });
        return reply.code(200).send({
          success: true,
          groupId,
          expiresAt: expiresAt ? expiresAt.toISOString() : null,
          effectivePolicy,
        });
      } catch (err: unknown) {
        const mapped = mapGroupMutationError(err);
        if (mapped)
          return reply.code(mapped.status).send({ error: mapped.error, code: mapped.code });
        throw err;
      }
    });
  });
}
