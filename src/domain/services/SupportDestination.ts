/**
 * Pure support-destination parser shared between Telegram bot menus and WebApp API routes.
 *
 * Supports:
 * - `@username`, `username`, `https://t.me/username`, `telegram.me/username`
 * - Numeric Telegram user IDs (`123456789` -> `tg://user?id=123456789`)
 * - Full HTTPS/tg URLs (e.g. `SUPPORT_URL`)
 * - Fallback to the first configured admin ID
 */

export interface ResolvedSupportDestination {
  url: string;
  username: string;
  label: string;
  isConfigured: boolean;
  kind: 'username' | 'telegram_id' | 'url' | 'none';
}

export function normalizeSupportUsername(raw: string | undefined | null): string {
  if (!raw) return '';
  let str = raw.trim();
  if (!str) return '';
  // Numeric Telegram IDs are not usernames
  if (/^[1-9]\d{4,16}$/u.test(str)) return '';
  str = str.replace(/^https?:\/\//i, '');
  str = str.replace(/^(?:www\.)?(?:t\.me|telegram\.me)\//i, '');
  str = str.replace(/^@+/, '');
  str = str.split('?')[0].split('#')[0];
  str = str.split('/')[0].trim();
  if (/^[1-9]\d{4,16}$/u.test(str)) return '';
  return str;
}

export function resolveSupportDestination(params: {
  rawDestination?: string | null;
  supportUrl?: string | null;
  fallbackAdminId?: number | null;
}): ResolvedSupportDestination {
  const dest = params.rawDestination?.trim() ?? '';
  if (dest) {
    if (/^[1-9]\d{4,16}$/u.test(dest)) {
      return {
        url: `tg://user?id=${dest}`,
        username: '',
        label: dest,
        isConfigured: true,
        kind: 'telegram_id',
      };
    }

    const tgUserMatch = /^tg:\/\/user\?id=([1-9]\d{4,16})$/iu.exec(dest);
    if (tgUserMatch) {
      return {
        url: `tg://user?id=${tgUserMatch[1]}`,
        username: '',
        label: tgUserMatch[1]!,
        isConfigured: true,
        kind: 'telegram_id',
      };
    }

    const tgLinkMatch =
      /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/([a-zA-Z0-9_]{3,32})(?:[/?#].*)?$/iu.exec(
        dest
      );
    if (tgLinkMatch) {
      const username = tgLinkMatch[1]!;
      return {
        url: `https://t.me/${username}`,
        username,
        label: `@${username}`,
        isConfigured: true,
        kind: 'username',
      };
    }

    if (/^https?:\/\//iu.test(dest)) {
      try {
        const parsed = new URL(dest);
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
          return {
            url: parsed.toString(),
            username: '',
            label: parsed.hostname,
            isConfigured: true,
            kind: 'url',
          };
        }
      } catch {
        // Fall through
      }
    }

    const stripped = dest.replace(/^@+/u, '').trim();
    if (/^[a-zA-Z][a-zA-Z0-9_]{2,31}$/u.test(stripped)) {
      return {
        url: `https://t.me/${stripped}`,
        username: stripped,
        label: `@${stripped}`,
        isConfigured: true,
        kind: 'username',
      };
    }

    const fallbackNormalized = normalizeSupportUsername(dest);
    if (fallbackNormalized) {
      return {
        url: `https://t.me/${fallbackNormalized}`,
        username: fallbackNormalized,
        label: `@${fallbackNormalized}`,
        isConfigured: true,
        kind: 'username',
      };
    }
  }

  const configuredUrl = params.supportUrl?.trim() ?? '';
  if (configuredUrl) {
    const normalizedFromUrl = normalizeSupportUsername(configuredUrl);
    if (
      /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\//iu.test(configuredUrl) &&
      normalizedFromUrl
    ) {
      return {
        url: `https://t.me/${normalizedFromUrl}`,
        username: normalizedFromUrl,
        label: `@${normalizedFromUrl}`,
        isConfigured: true,
        kind: 'username',
      };
    }
    if (/^(?:https?:|tg:)/iu.test(configuredUrl)) {
      return {
        url: configuredUrl,
        username: '',
        label: configuredUrl,
        isConfigured: true,
        kind: 'url',
      };
    }
  }

  const adminId = params.fallbackAdminId;
  if (typeof adminId === 'number' && Number.isSafeInteger(adminId) && adminId > 0) {
    return {
      url: `tg://user?id=${adminId}`,
      username: '',
      label: String(adminId),
      isConfigured: true,
      kind: 'telegram_id',
    };
  }

  return {
    url: '',
    username: '',
    label: '',
    isConfigured: false,
    kind: 'none',
  };
}
