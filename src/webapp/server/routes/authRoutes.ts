import type { FastifyInstance } from 'fastify';
import { validateTelegramInitData } from '../auth.js';
import { resolveRateLimitKey } from '../server.js';
import type { AdminService } from '../../../domain/services/AdminService.js';
import { registrationMode } from '../../../domain/services/FeatureSettings.js';
import {
  evaluateRegistrationAccess,
  resolveRegistrationBlockedCopy,
  type ReferrerLookup,
} from '../../../domain/services/RegistrationPolicy.js';
import type { UserService } from '../../../domain/services/UserService.js';
import type { WalletService } from '../../../domain/services/WalletService.js';
import type {
  SupportedLocale,
  TranslationService,
} from '../../../domain/services/TranslationService.js';
import { authGuard } from '../middleware/adminGuard.js';
import { getAppVersionInfo, toPublicAppVersion } from '../../../infra/appVersion.js';

interface ValidateRequestBody {
  initData: string;
}

interface LocaleRequestBody {
  locale: 'fa' | 'en';
}

function normalizeStartParamReferral(startParam: string | undefined): string | undefined {
  if (!startParam) return undefined;
  const trimmed = startParam.trim();
  if (!trimmed || !trimmed.startsWith('ref_') || trimmed.length > 128) return undefined;
  return trimmed;
}

function resolveObservedLocale(
  languageCode: string | undefined,
  defaultLocale: SupportedLocale
): SupportedLocale {
  if (!languageCode) return defaultLocale;
  const lower = languageCode.trim().toLowerCase();
  if (lower === 'fa' || lower.startsWith('fa-')) return 'fa';
  if (lower === 'en' || lower.startsWith('en-')) return 'en';
  return defaultLocale;
}

async function checkUserExists(
  userService: Pick<UserService, 'findProfile'> & Partial<Pick<UserService, 'exists'>>,
  telegramId: number
): Promise<boolean> {
  if (typeof userService.exists === 'function') {
    return userService.exists(telegramId);
  }
  if (typeof userService.findProfile === 'function') {
    return Boolean(await userService.findProfile(String(telegramId)));
  }
  return false;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  options: {
    botToken: string;
    botUsername?: string;
    adminService: AdminService;
    userService: UserService;
    walletService?: WalletService;
    referralService?: ReferrerLookup;
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
      appVersion: toPublicAppVersion(getAppVersionInfo()),
    });
  });

  app.post<{ Body: ValidateRequestBody }>(
    '/api/auth/telegram-validate',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          keyGenerator: resolveRateLimitKey,
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
      const defaultLocale = options.translationService.getDefaultLocale();
      const startParam = validated.rawParams.start_param?.trim() || undefined;
      const referralCode = normalizeStartParamReferral(startParam);

      const languageSelectionEnabled = options.translationService.getSettingBool(
        'language_selection_enabled',
        true
      );
      const observedLocale = languageSelectionEnabled
        ? resolveObservedLocale(validated.user.language_code, defaultLocale)
        : defaultLocale;

      // Enforce new-user registration policy BEFORE creating a user row or issuing JWT.
      const mode =
        typeof options.translationService.getSetting === 'function'
          ? registrationMode(options.translationService)
          : 'open';
      if (!isAdmin && mode !== 'open') {
        const userExists = await checkUserExists(options.userService, telegramId);
        const access = await evaluateRegistrationAccess({
          telegramId,
          isAdmin: false,
          userExists,
          settings: options.translationService,
          referralCode,
          referralService: options.referralService,
        });
        if (!access.allowed) {
          const copy = resolveRegistrationBlockedCopy(
            options.translationService,
            observedLocale,
            access.reason
          );
          return reply.code(403).send({
            error: copy.message,
            code: access.code,
            title: copy.title,
            message: copy.message,
            locale: observedLocale,
            registrationMode: mode,
          });
        }
      }

      // Persist Telegram profile metadata & first-touch referral attribution when a user
      // enters via WebApp (e.g. direct `t.me/bot/app?startapp=ref_...` link).
      if (typeof options.walletService?.getOrCreateUser === 'function') {
        try {
          await options.walletService.getOrCreateUser(
            telegramId,
            validated.user.username ?? null,
            validated.user.first_name ?? null,
            validated.user.last_name ?? null,
            referralCode,
            resolveObservedLocale(validated.user.language_code, defaultLocale),
            referralCode ? 'webapp_referral' : 'webapp'
          );
        } catch {
          // Non-fatal: do not block WebApp auth if profile sync fails in degraded state
        }
      }

      const token = app.jwt.sign({ telegramId, role }, { expiresIn: '12h' });

      reply.setCookie('session', token, {
        path: '/',
        httpOnly: true,
        secure: options.secureCookies ?? process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 12 * 3600,
      });

      const userLocale = await options.userService.getLocale(telegramId);
      const locale = userLocale ?? defaultLocale;

      const appVersion = getAppVersionInfo();
      return reply.code(200).send({
        token,
        role,
        user: validated.user,
        locale,
        languageSelectionEnabled,
        botUsername: options.botUsername,
        appVersion: role === 'admin' ? appVersion : toPublicAppVersion(appVersion),
        ...(startParam ? { startParam } : {}),
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

      const isAdmin =
        request.userSession?.role === 'admin' || options.adminService.isAdmin(telegramId);
      const mode =
        typeof options.translationService.getSetting === 'function'
          ? registrationMode(options.translationService)
          : 'open';
      if (!isAdmin && mode !== 'open') {
        const userExists = await checkUserExists(options.userService, telegramId);
        if (!userExists) {
          const reason = mode === 'closed' ? 'closed' : 'invite_only';
          const copy = resolveRegistrationBlockedCopy(options.translationService, locale, reason);
          return reply.code(403).send({
            error: copy.message,
            code: mode === 'closed' ? 'REGISTRATION_CLOSED' : 'REGISTRATION_INVITE_ONLY',
            title: copy.title,
            message: copy.message,
            locale,
            registrationMode: mode,
          });
        }
      }

      // Ensure local user row exists before updating locale (fixes first-visit race)
      if (typeof options.walletService?.getOrCreateUser === 'function') {
        try {
          await options.walletService.getOrCreateUser(
            telegramId,
            undefined,
            undefined,
            undefined,
            undefined,
            locale,
            'webapp'
          );
        } catch {
          // Best-effort ensure; updateLocale below still runs
        }
      }

      await options.userService.updateLocale(telegramId, locale);
      options.walletService?.invalidateUserCache?.(telegramId);

      return reply.code(200).send({
        success: true,
        locale,
      });
    }
  );
}
