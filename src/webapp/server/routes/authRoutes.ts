import type { FastifyInstance } from 'fastify';
import { validateTelegramInitData } from '../auth.js';
import type { AdminService } from '../../../domain/services/AdminService.js';
import type { UserService } from '../../../domain/services/UserService.js';
import type { TranslationService } from '../../../domain/services/TranslationService.js';
import { authGuard } from '../middleware/adminGuard.js';

interface ValidateRequestBody {
  initData: string;
}

interface LocaleRequestBody {
  locale: 'fa' | 'en';
}

export function registerAuthRoutes(
  app: FastifyInstance,
  options: {
    botToken: string;
    botUsername?: string;
    adminService: AdminService;
    userService: UserService;
    translationService: TranslationService;
    secureCookies?: boolean;
  }
): void {
  // Expose the bot username for the non-Telegram guard screen CTA.
  // Outside Telegram there is no initDataUnsafe, so the WebApp cannot derive
  // the bot username from the Telegram context — the backend is the source of truth.
  app.get('/api/auth/bot-info', async (_req, reply) => {
    return reply.send({
      username: options.botUsername,
    });
  });

  app.post<{ Body: ValidateRequestBody }>(
    '/api/auth/telegram-validate',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
      schema: {
        body: {
          type: 'object',
          required: ['initData'],
          properties: {
            initData: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const { initData } = request.body;

      const validated = validateTelegramInitData(initData, options.botToken);
      if (!validated) {
        return reply.code(401).send({ error: 'Invalid or expired Telegram authorization data' });
      }

      const telegramId = validated.user.id;
      const isAdmin = options.adminService.isAdmin(telegramId);
      const role: 'admin' | 'user' = isAdmin ? 'admin' : 'user';

      const token = app.jwt.sign({ telegramId, role }, { expiresIn: '12h' });

      reply.setCookie('session', token, {
        path: '/',
        httpOnly: true,
        secure: options.secureCookies ?? process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 12 * 3600,
      });

      const userLocale = await options.userService.getLocale(telegramId);
      const defaultLocale = options.translationService.getDefaultLocale();
      const locale = userLocale ?? defaultLocale;
      const languageSelectionEnabled = options.translationService.getSettingBool(
        'language_selection_enabled',
        true
      );

      return reply.code(200).send({
        role,
        user: validated.user,
        locale,
        languageSelectionEnabled,
      });
    }
  );

  app.post<{ Body: LocaleRequestBody }>(
    '/api/user/locale',
    {
      preHandler: authGuard,
      schema: {
        body: {
          type: 'object',
          required: ['locale'],
          properties: {
            locale: { type: 'string', enum: ['fa', 'en'] },
          },
        },
      },
    },
    async (request, reply) => {
      const languageSelectionEnabled = options.translationService.getSettingBool(
        'language_selection_enabled',
        true
      );

      if (!languageSelectionEnabled) {
        return reply.code(403).send({ error: 'Language selection is disabled' });
      }

      const { locale } = request.body;
      const telegramId = request.userSession?.telegramId;
      if (!telegramId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      await options.userService.updateLocale(telegramId, locale);

      return reply.code(200).send({
        success: true,
        locale,
      });
    }
  );
}
