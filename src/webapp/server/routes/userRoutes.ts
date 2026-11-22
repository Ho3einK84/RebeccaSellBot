import type { FastifyInstance } from 'fastify';
import { authGuard } from '../middleware/adminGuard.js';
import { createUserAccessGuard } from '../middleware/userGuard.js';
import { ContactVerificationService } from '../../../domain/services/ContactVerificationService.js';
import { normalizeSupportUsername } from '../../../domain/services/SupportDestination.js';
import { createUserRateLimits, type UserRoutesOptions } from './user/shared.js';
import { registerUserProfileRoutes } from './user/profileRoutes.js';
import { registerUserConfigRoutes } from './user/configRoutes.js';
import { registerUserShopRoutes } from './user/shopRoutes.js';
import { registerUserWalletRoutes } from './user/walletRoutes.js';

export { normalizeSupportUsername };
export type { UserRoutesOptions };

export function registerUserRoutes(app: FastifyInstance, options: UserRoutesOptions): void {
  const contactVerificationService =
    options.contactVerificationService ??
    new ContactVerificationService({
      translationService: options.translationService,
    });
  const limits = createUserRateLimits();
  const userAccessGuard = createUserAccessGuard({
    userService: options.userService,
    translationService: options.translationService,
    adminService: options.adminService,
    adminIds: options.adminIds,
    supportUrl: options.supportUrl,
  });

  app.register(async (userScope) => {
    userScope.addHook('preHandler', authGuard);
    userScope.addHook('preHandler', userAccessGuard);

    registerUserProfileRoutes(userScope, options, limits, contactVerificationService);
    registerUserConfigRoutes(userScope, options, limits);
    registerUserShopRoutes(userScope, options, limits, contactVerificationService);
    registerUserWalletRoutes(userScope, options, limits);
  });
}
