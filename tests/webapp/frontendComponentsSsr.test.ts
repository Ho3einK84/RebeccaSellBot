import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LayoutDashboard, Receipt, Users } from 'lucide-react';
import { Providers } from '../../webapp/src/app/providers.js';
import { Button } from '../../webapp/src/shared/components/ui/Button.js';
import { Card } from '../../webapp/src/shared/components/ui/Card.js';
import { Switch } from '../../webapp/src/shared/components/ui/Switch.js';
import { AlertBanner } from '../../webapp/src/shared/components/ui/AlertBanner.js';
import { SegmentedControl } from '../../webapp/src/shared/components/ui/SegmentedControl.js';
import { StatCard } from '../../webapp/src/shared/components/ui/StatCard.js';
import { BottomNav } from '../../webapp/src/shared/components/layout/BottomNav.js';
import { DesktopNav } from '../../webapp/src/shared/components/layout/DesktopNav.js';
import { AuthLoadingScreen } from '../../webapp/src/features/auth/components/AuthLoadingScreen.js';
import { AuthErrorScreen } from '../../webapp/src/features/auth/components/AuthErrorScreen.js';
import { UserPortalHeader } from '../../webapp/src/features/user-portal/components/UserPortalHeader.js';
import { DashboardTab } from '../../webapp/src/features/user-portal/tabs/DashboardTab.js';
import { ServicesTab } from '../../webapp/src/features/user-portal/tabs/ServicesTab.js';
import { ShopTab } from '../../webapp/src/features/user-portal/tabs/ShopTab.js';
import { WalletTab } from '../../webapp/src/features/user-portal/tabs/WalletTab.js';
import { ReferralTab } from '../../webapp/src/features/user-portal/tabs/ReferralTab.js';
import { AdminHeader } from '../../webapp/src/features/admin/components/AdminHeader.js';
import { OverviewAnalytics } from '../../webapp/src/features/admin/overview/components/OverviewAnalytics.js';
import { HealthBanner } from '../../webapp/src/features/admin/overview/components/HealthBanner.js';
import { ModulesTab } from '../../webapp/src/features/admin/modules/ModulesTab.js';
import type { TelegramWebAppUser } from '../../webapp/src/shared/types/telegram.js';
import type {
  UserConfigRecord,
  UserPackageItem,
  UserPortalProfile,
  UserPortalSettings,
  UserTransactionRecord,
} from '../../webapp/src/shared/types/userPortal.js';
import type { DashboardStats } from '../../webapp/src/shared/types/admin.js';

function renderWithProviders(element: React.ReactElement, locale: 'fa' | 'en' = 'fa'): string {
  return renderToStaticMarkup(React.createElement(Providers, { initialLocale: locale }, element));
}

const sampleTelegramUser: TelegramWebAppUser = {
  id: 100200300,
  first_name: 'Reza',
  last_name: 'Karimi',
  username: 'reza_dev',
};

const sampleProfile: UserPortalProfile = {
  telegramId: 100200300,
  firstName: 'Reza',
  lastName: 'Karimi',
  username: 'reza_dev',
  balance: 450_000,
  availableBalance: 450_000,
  reservedBalance: 0,
  referralCode: 'REF_REZA_99',
  referredUserCount: 4,
  referralBonusEarned: 120_000,
};

const sampleSettings: UserPortalSettings = {
  currency: 'تومان',
  botUsername: '@rebecca_test_bot',
  supportUsername: '@rebecca_support',
  supportEnabled: true,
  cardNumber: '6037997911112222',
  cardHolder: 'Reza Test',
  topupMinAmount: 50_000,
  topupMaxAmount: 5_000_000,
  customVolume: {
    enabled: true,
    minGb: 10,
    maxGb: 200,
    pricePerGb: 4_000,
    pricePerDay: 0,
    defaultDays: 30,
  },
};

const sampleConfigs: UserConfigRecord[] = [
  {
    id: 'cfg-1',
    configUsername: 'u100200_vpn1',
    panelStatus: 'active',
    panelDataLimit: 50 * 1024 * 1024 * 1024,
    panelUsedTraffic: 12 * 1024 * 1024 * 1024,
    panelExpire: Math.floor(Date.now() / 1000) + 15 * 86400,
    subUrl: 'https://sub.example.com/u100200_vpn1',
    autoRenewEnabled: true,
    createdAt: '2026-11-01T10:00:00.000Z',
  },
];

const samplePackages: UserPackageItem[] = [
  {
    id: 'pkg-50',
    name: 'بسته ۵۰ گیگابایت',
    gbAmount: 50,
    durationDays: 30,
    price: 180_000,
    enabled: true,
  },
];

const sampleTransactions: UserTransactionRecord[] = [
  {
    id: 'tx-1',
    type: 'topup',
    amount: 500_000,
    balanceAfter: 500_000,
    description: 'Top-up receipt approved by admin 1',
    createdAt: '2026-11-10T08:00:00.000Z',
  },
];

const sampleStats: DashboardStats = {
  totalUsers: 420,
  totalSales: 12_500_000,
  dailyRevenue: 450_000,
  weeklyRevenue: 3_100_000,
  monthlyRevenue: 11_200_000,
  totalReferralBonus: 320_000,
  totalCashback: 180_000,
  activeSubscriptions: 260,
  inactiveSubscriptions: 40,
  pendingReceipts: 3,
};

describe('Webapp Unified Design System & Portal SSR Smoke Tests', () => {
  it('renders shared UI & navigation primitives cleanly across fa and en locales', () => {
    const html = renderWithProviders(
      React.createElement(
        'div',
        null,
        React.createElement(Button, { variant: 'tonal', size: 'sm' }, 'Tonal'),
        React.createElement(Card, { tone: 'warn', padding: 'md' }, 'Card Body'),
        React.createElement(Switch, {
          checked: true,
          onChange: () => undefined,
          ariaLabel: 'Toggle',
        }),
        React.createElement(AlertBanner, { tone: 'danger' }, 'Error Notice'),
        React.createElement(SegmentedControl<'a' | 'b'>, {
          options: [
            { id: 'a', label: 'Alpha', count: '2', tone: 'brand' },
            { id: 'b', label: 'BetaTab', tone: 'warn' },
          ],
          value: 'a',
          onChange: () => undefined,
        }),
        React.createElement(StatCard, {
          label: 'Revenue',
          value: '1,200',
          tone: 'ok',
          onClick: () => undefined,
        }),
        React.createElement(BottomNav<'overview' | 'receipts' | 'users'>, {
          items: [
            { id: 'overview', label: 'Overview', icon: LayoutDashboard },
            { id: 'receipts', label: 'Receipts', icon: Receipt, count: 3 },
            { id: 'users', label: 'Users', icon: Users },
          ],
          activeId: 'overview',
          onSelect: () => undefined,
          ariaLabel: 'Nav',
        }),
        React.createElement(DesktopNav<'overview' | 'receipts'>, {
          items: [
            { id: 'overview', label: 'Overview', icon: LayoutDashboard },
            { id: 'receipts', label: 'Receipts', icon: Receipt, count: 3, badgeTone: 'warn' },
          ],
          activeId: 'overview',
          onSelect: () => undefined,
          ariaLabel: 'Desktop Nav',
        })
      ),
      'en'
    );

    expect(html).toContain('Tonal');
    expect(html).toContain('bg-warn-soft');
    expect(html).toContain('role="switch"');
    expect(html).toContain('Error Notice');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('safe-bottom');
  });

  it('renders Auth loading and error screens cleanly without overflow classes', () => {
    const loadingHtml = renderWithProviders(React.createElement(AuthLoadingScreen), 'fa');
    const errorHtml = renderWithProviders(
      React.createElement(AuthErrorScreen, { error: 'Unauthorized' }),
      'en'
    );

    expect(loadingHtml).toContain('safe-top');
    expect(loadingHtml).not.toContain('w-screen');
    expect(errorHtml).toContain('Unauthorized');
    expect(errorHtml).not.toContain('w-screen');
  });

  it('renders User Portal headers and all 5 tabs in FA and EN with zero Beta/Preview remnants', () => {
    for (const locale of ['fa', 'en'] as const) {
      const userSurfaceHtml = renderWithProviders(
        React.createElement(
          'div',
          null,
          React.createElement(UserPortalHeader, {
            user: sampleTelegramUser,
            onRefresh: () => undefined,
            isAdminView: true,
            onSwitchToAdmin: () => undefined,
            balance: 450_000,
            currency: sampleSettings.currency,
          }),
          React.createElement(DashboardTab, {
            profile: sampleProfile,
            settings: sampleSettings,
            configs: sampleConfigs,
            transactions: sampleTransactions,
            onSwitchTab: () => undefined,
            onOpenService: () => undefined,
          }),
          React.createElement(ServicesTab, {
            configs: sampleConfigs,
            botUsername: sampleSettings.botUsername,
            onOpenQr: () => undefined,
            onGoToShop: () => undefined,
            onNotify: () => undefined,
          }),
          React.createElement(ShopTab, {
            packages: samplePackages,
            currency: sampleSettings.currency,
            customVolumeSettings: sampleSettings.customVolume,
            botUsername: sampleSettings.botUsername,
            onSelectPackage: () => undefined,
          }),
          React.createElement(WalletTab, {
            profile: sampleProfile,
            settings: sampleSettings,
            transactions: sampleTransactions,
            onNotify: () => undefined,
          }),
          React.createElement(ReferralTab, {
            profile: sampleProfile,
            settings: sampleSettings,
            onNotify: () => undefined,
          })
        ),
        locale
      );

      expect(userSurfaceHtml).toContain('u100200_vpn1');
      expect(userSurfaceHtml).toContain('REF_REZA_99');
      expect(userSurfaceHtml).toContain('https://t.me/rebecca_test_bot?start=REF_REZA_99');
      // Zero Beta/Preview remnants on the production User Portal surface
      expect(userSurfaceHtml).not.toMatch(/بتا|پیش‌نمایش|\bBeta\b|\bPreview\b/i);
    }
  });

  it('renders Admin Console header, RTL-aligned OverviewAnalytics, HealthBanner, and ModulesTab cleanly', () => {
    const adminFaHtml = renderWithProviders(
      React.createElement(
        'div',
        null,
        React.createElement(AdminHeader, {
          user: sampleTelegramUser,
          onRefresh: () => undefined,
          onClose: () => undefined,
          onSwitchToUserPortal: () => undefined,
        }),
        React.createElement(HealthBanner, {
          panelHealth: { configured: 2, healthy: 2 },
          onSwitchToPanels: () => undefined,
        }),
        React.createElement(OverviewAnalytics, { stats: sampleStats }),
        React.createElement(ModulesTab, { onSwitchTab: () => undefined })
      ),
      'fa'
    );

    expect(adminFaHtml).toContain('نمای کاربری');
    expect(adminFaHtml).not.toContain('نسخه آزمایشی');
    expect(adminFaHtml).toContain('dir="ltr"');
    expect(adminFaHtml).toContain('۸۷٪');
    expect(adminFaHtml).toContain('سرویس تست رایگان');
  });
});
