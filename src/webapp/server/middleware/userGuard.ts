import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AdminService } from '../../../domain/services/AdminService.js';
import type { TranslationService } from '../../../domain/services/TranslationService.js';
import type { UserService } from '../../../domain/services/UserService.js';
import { resolveSupportDestination } from '../../../domain/services/SupportDestination.js';

export interface UserGuardDeps {
  userService: UserService;
  translationService?: TranslationService;
  adminService?: AdminService;
  adminIds?: number[];
  supportUrl?: string;
}

export function createUserAccessGuard(deps: UserGuardDeps) {
  const resolveSupportPayload = () => {
    const rawDestination = deps.translationService?.getSetting('support_destination', '') || '';
    const fallbackAdminId = deps.adminService?.adminIds?.[0] ?? deps.adminIds?.[0];
    const support = resolveSupportDestination({
      rawDestination,
      supportUrl: deps.supportUrl,
      fallbackAdminId,
    });
    const supportEnabled = deps.translationService?.getSettingBool('support_enabled', true) ?? true;
    return {
      supportEnabled,
      supportUrl: supportEnabled ? support.url : '',
      supportUsername: supportEnabled ? support.username : '',
      supportLabel: supportEnabled ? support.label : '',
    };
  };

  return async function userAccessGuard(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const telegramId = request.userSession?.telegramId;
    if (!telegramId) {
      await reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    // 1. Check ban status first (banned users always get 403 USER_BANNED with support info)
    if (await deps.userService.isBanned?.(telegramId)) {
      const support = resolveSupportPayload();
      await reply.code(403).send({
        error: 'User is banned',
        code: 'USER_BANNED',
        supportUrl: support.supportUrl,
        supportUsername: support.supportUsername,
        supportLabel: support.supportLabel,
        supportEnabled: support.supportEnabled,
      });
      return;
    }

    // 2. Maintenance mode check (`bot_enabled = false`) — mirrors Telegram botRuntime.ts
    // Admins bypass maintenance mode so they can still inspect/test the User Portal.
    const isAdmin =
      request.userSession?.role === 'admin' ||
      Boolean(deps.adminService?.isAdmin?.(telegramId)) ||
      Boolean(deps.adminIds?.includes(telegramId));

    if (!isAdmin && typeof deps.translationService?.getSettingBool === 'function') {
      const botEnabled = deps.translationService.getSettingBool('bot_enabled', true);
      if (!botEnabled) {
        const support = resolveSupportPayload();
        await reply.code(503).send({
          error: 'Service is currently under maintenance',
          code: 'MAINTENANCE_MODE',
          supportUrl: support.supportUrl,
          supportUsername: support.supportUsername,
          supportLabel: support.supportLabel,
          supportEnabled: support.supportEnabled,
        });
        return;
      }
    }
  };
}
