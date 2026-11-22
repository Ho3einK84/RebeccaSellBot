import type { UserTabType } from '@/shared/types/userPortal.js';

export interface DeepLinkTarget {
  tab?: UserTabType;
  configId?: string;
  focusWheel?: boolean;
  openTrial?: boolean;
}

const VALID_TABS = new Set<UserTabType>(['dashboard', 'services', 'shop', 'wallet', 'referral']);

/**
 * Parses Telegram Mini App `start_param` (e.g. `tab_wheel`, `tab_trial`, `cfg_uc_123`)
 * and URL query parameters (`?tab=services&config=uc_123`) into a structured navigation target.
 */
export function parseWebAppDeepLink(
  startParam?: string | null,
  search?: string | null
): DeepLinkTarget {
  const result: DeepLinkTarget = {};

  const rawStart = (startParam || '').trim();
  if (rawStart) {
    const lower = rawStart.toLowerCase();
    if (lower === 'tab_wheel' || lower === 'wheel' || lower === 'lucky_wheel') {
      result.tab = 'referral';
      result.focusWheel = true;
    } else if (lower === 'tab_trial' || lower === 'trial') {
      result.tab = 'dashboard';
      result.openTrial = true;
    } else if (lower === 'tab_rewards' || lower === 'rewards' || lower === 'tab_referral') {
      result.tab = 'referral';
    } else if (lower === 'tab_shop' || lower === 'shop') {
      result.tab = 'shop';
    } else if (lower === 'tab_wallet' || lower === 'wallet' || lower === 'topup') {
      result.tab = 'wallet';
    } else if (lower === 'tab_services' || lower === 'services') {
      result.tab = 'services';
    } else if (rawStart.startsWith('cfg_')) {
      const cfgId = rawStart.slice(4).trim();
      if (cfgId) {
        result.tab = 'services';
        result.configId = cfgId;
      }
    }
  }

  if (search) {
    try {
      const params = new URLSearchParams(search);
      const qTab = params.get('tab')?.trim().toLowerCase();
      if (qTab === 'wheel' || qTab === 'rewards') {
        result.tab = 'referral';
        if (qTab === 'wheel') result.focusWheel = true;
      } else if (qTab === 'trial') {
        result.tab = 'dashboard';
        result.openTrial = true;
      } else if (qTab && VALID_TABS.has(qTab as UserTabType)) {
        result.tab = qTab as UserTabType;
      }
      const qConfig = params.get('config')?.trim();
      if (qConfig) {
        result.tab = 'services';
        result.configId = qConfig;
      }
    } catch {
      // Ignore malformed search strings
    }
  }

  return result;
}

export interface ClientConnectLink {
  id: 'happ' | 'v2rayng' | 'hiddify' | 'streisand' | 'v2box' | 'browser';
  name: string;
  url: string;
  recommended: boolean;
  platformTag: 'ios' | 'android' | 'desktop' | 'all';
}

/**
 * Generates platform-aware one-tap VPN client import links for a subscription URL.
 * Uses `window.Telegram.WebApp.platform` to surface the best apps first.
 */
export function buildClientConnectLinks(
  subUrl: string,
  platform?: string,
  configUsername?: string
): ClientConnectLink[] {
  const cleanUrl = subUrl.trim();
  if (!cleanUrl) return [];

  const encoded = encodeURIComponent(cleanUrl);
  const label = encodeURIComponent(configUsername || 'VPN');
  const normPlatform = (platform || '').toLowerCase();
  const isIos = normPlatform === 'ios' || normPlatform === 'macos';
  const isAndroid = normPlatform === 'android';

  const links: ClientConnectLink[] = [
    {
      id: 'happ',
      name: 'Happ',
      url: `happ://add/${cleanUrl}`,
      recommended: isIos || isAndroid,
      platformTag: 'all',
    },
    {
      id: 'v2rayng',
      name: 'v2rayNG',
      url: `v2rayng://install-config?url=${encoded}`,
      recommended: isAndroid,
      platformTag: 'android',
    },
    {
      id: 'hiddify',
      name: 'Hiddify',
      url: `hiddify://import/${cleanUrl}#${label}`,
      recommended: !isIos && !isAndroid,
      platformTag: 'all',
    },
    {
      id: 'streisand',
      name: 'Streisand',
      url: `streisand://import/${cleanUrl}`,
      recommended: isIos,
      platformTag: 'ios',
    },
    {
      id: 'v2box',
      name: 'V2Box',
      url: `v2box://install-sub?url=${encoded}&name=${label}`,
      recommended: isIos,
      platformTag: 'ios',
    },
    {
      id: 'browser',
      name: 'Sub Page',
      url: cleanUrl,
      recommended: false,
      platformTag: 'all',
    },
  ];

  // Prioritize recommended apps for the detected platform
  return links.sort((a, b) => Number(b.recommended) - Number(a.recommended));
}
