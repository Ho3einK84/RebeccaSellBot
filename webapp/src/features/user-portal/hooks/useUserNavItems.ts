import { LayoutDashboard, Wifi, ShoppingBag, Wallet, Users } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import type { BottomNavItem } from '@/shared/components/layout/BottomNav.js';
import type { UserTabType } from '@/shared/types/userPortal.js';

/**
 * Single source of truth for the user-portal tab list — shared by the mobile
 * `BetaBottomNav` and the desktop `DesktopNav` so the two rails can never drift.
 */
export function useUserNavItems(options?: {
  configsCount?: number;
  hasPendingReceipt?: boolean;
}): BottomNavItem<UserTabType>[] {
  const { t } = useLanguage();
  const configsCount = options?.configsCount ?? 0;

  return [
    { id: 'dashboard', label: t('user.tabs.dashboard'), icon: LayoutDashboard },
    {
      id: 'services',
      label: t('user.tabs.services'),
      icon: Wifi,
      count: configsCount > 0 ? configsCount : undefined,
    },
    { id: 'shop', label: t('user.tabs.shop'), icon: ShoppingBag },
    {
      id: 'wallet',
      label: t('user.tabs.wallet'),
      icon: Wallet,
      dot: options?.hasPendingReceipt,
    },
    { id: 'referral', label: t('user.tabs.referral'), icon: Users },
  ];
}
