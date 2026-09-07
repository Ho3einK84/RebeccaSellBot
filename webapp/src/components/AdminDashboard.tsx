import React, { useState, useEffect, useMemo } from 'react';
import type { TelegramWebAppUser } from '../types/telegram.js';
import { useLanguage } from '../i18n/LanguageContext.js';
import {
  LayoutDashboard,
  Receipt,
  Users,
  Server,
  Layers,
  RotateCw,
  Globe,
  Check,
  CheckCircle2,
  X,
  XCircle,
  AlertTriangle,
  Search,
  Copy,
  Eye,
  Wallet,
  Calendar,
  CalendarDays,
  CalendarRange,
  TrendingUp,
  Activity,
  Image as ImageIcon,
  KeyRound,
  ChevronLeft,
  ChevronRight,
  Radio,
  Package,
  Ticket,
  CreditCard,
  HardDrive,
  Sparkles,
  ShieldCheck,
  Clock,
  User,
  Plus,
  Minus,
  Settings2,
} from 'lucide-react';

interface AdminDashboardProps {
  user: TelegramWebAppUser;
}

type TabType = 'overview' | 'receipts' | 'users' | 'panels' | 'coming-soon';

interface DashboardStats {
  totalUsers: number;
  totalSales: number;
  dailyRevenue: number;
  weeklyRevenue: number;
  monthlyRevenue: number;
  totalReferralBonus: number;
  totalCashback: number;
  activeSubscriptions: number;
  inactiveSubscriptions: number;
  pendingReceipts: number;
}

interface PanelHealth {
  configured: number;
  healthy: number;
}

interface TopupReceipt {
  id: string;
  telegramId: number;
  amount: number;
  status: string;
  createdAt: string;
  photoFileId?: string;
  mediaType?: string;
}

interface UserProfile {
  telegramId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  balance: number;
  totalSpend: number;
  activeSubscriptionCount: number;
  createdAt: string;
}

interface UserReportSummary {
  user: UserProfile;
  totalDeposit: number;
  totalSpend: number;
  totalRefund: number;
  totalCashback: number;
  totalReferralBonus: number;
  totalLuckyWheel: number;
  totalTransactions: number;
  activeConfigsCount: number;
  totalConfigsCount: number;
  totalOrdersCount: number;
  receiptsApprovedCount: number;
  receiptsRejectedCount: number;
  receiptsPendingCount: number;
  totalReceiptsCount: number;
  auditEventsCount: number;
}

interface UserOrder {
  id: string;
  packageName?: string;
  amount: number;
  status: string;
  createdAt: string;
}

interface UserReceiptItem {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
}

interface PanelServiceSummary {
  serviceId: number;
  name: string;
  isDefault: boolean;
}

interface PanelSummary {
  id: string;
  name: string;
  baseUrl?: string;
  enabled: boolean;
  isDefault: boolean;
  credentialConfigured: boolean;
  credentialMode: 'api_key' | 'password' | 'none';
  services: PanelServiceSummary[];
  activeConfigsCount?: number;
  healthy?: boolean;
  latencyMs?: number;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ user }) => {
  const { t, locale, languageSelectionEnabled, setLocale } = useLanguage();
  const numLocale = locale === 'fa' ? 'fa-IR' : 'en-US';

  const [activeTab, setActiveTab] = useState<TabType>('overview');

  // Overview data
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [panelHealth, setPanelHealth] = useState<PanelHealth | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  // Receipts data
  const [receipts, setReceipts] = useState<TopupReceipt[]>([]);
  const [loadingReceipts, setLoadingReceipts] = useState(false);
  const [receiptActionTarget, setReceiptActionTarget] = useState<TopupReceipt | null>(null);
  const [receiptApproveTarget, setReceiptApproveTarget] = useState<TopupReceipt | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [selectedReasonPreset, setSelectedReasonPreset] = useState<string>('');
  const [processingAction, setProcessingAction] = useState(false);
  const [photoModalUrl, setPhotoModalUrl] = useState<string | null>(null);
  const [photoModalTitle, setPhotoModalTitle] = useState<string>('');

  // Users data
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersPage, setUsersPage] = useState(1);
  const [usersTotalPages, setUsersTotalPages] = useState(1);
  const [usersTotalCount, setUsersTotalCount] = useState(0);

  // User Details Dossier
  const [selectedUserSummary, setSelectedUserSummary] = useState<UserReportSummary | null>(null);
  const [userOrders, setUserOrders] = useState<UserOrder[]>([]);
  const [userReceipts, setUserReceipts] = useState<UserReceiptItem[]>([]);
  const [inspectingUser, setInspectingUser] = useState(false);
  const [userDossierTab, setUserDossierTab] = useState<'finances' | 'orders' | 'receipts'>(
    'finances'
  );

  // Balance adjustment modal
  const [balanceModalUser, setBalanceModalUser] = useState<UserProfile | null>(null);
  const [balanceOperation, setBalanceOperation] = useState<'add' | 'deduct' | 'set'>('add');
  const [balanceAmount, setBalanceAmount] = useState<string>('');
  const [balanceReason, setBalanceReason] = useState<string>('');
  const [processingBalance, setProcessingBalance] = useState(false);

  // Panels data
  const [panels, setPanels] = useState<PanelSummary[]>([]);
  const [loadingPanels, setLoadingPanels] = useState(false);
  const [testingPanelId, setTestingPanelId] = useState<string | null>(null);

  // General Notification
  const [notification, setNotification] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const triggerHaptic = (type: 'light' | 'medium' | 'success' | 'warning' | 'error' = 'light') => {
    if (!window.Telegram?.WebApp?.HapticFeedback) return;
    if (type === 'light' || type === 'medium') {
      window.Telegram.WebApp.HapticFeedback.impactOccurred(type);
    } else {
      window.Telegram.WebApp.HapticFeedback.notificationOccurred(type);
    }
  };

  const notify = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    triggerHaptic(type === 'success' ? 'success' : 'error');
    setTimeout(() => setNotification(null), 4000);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    triggerHaptic('light');
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Load Overview Stats
  const loadStats = async () => {
    setLoadingStats(true);
    try {
      const res = await fetch('/api/admin/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats);
        setPanelHealth(data.panelHealth);
      }
    } catch {
      notify(t('notifyStatsError'), 'error');
    } finally {
      setLoadingStats(false);
    }
  };

  // Load Receipts
  const loadReceipts = async () => {
    setLoadingReceipts(true);
    try {
      const res = await fetch('/api/admin/receipts?limit=30');
      if (res.ok) {
        const data = await res.json();
        setReceipts(data.items || []);
      }
    } catch {
      notify(t('notifyReceiptsError'), 'error');
    } finally {
      setLoadingReceipts(false);
    }
  };

  // Approve / Reject Receipt
  const handleReceiptAction = async (id: string, action: 'approve' | 'reject', reason?: string) => {
    setProcessingAction(true);
    try {
      const res = await fetch(`/api/admin/receipts/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason }),
      });
      if (res.ok) {
        notify(action === 'approve' ? t('notifyReceiptApproved') : t('notifyReceiptRejected'));
        setReceiptActionTarget(null);
        setReceiptApproveTarget(null);
        setRejectionReason('');
        setSelectedReasonPreset('');
        loadReceipts();
      } else {
        const err = await res.json();
        notify(err.error || t('notifyReceiptActionFailed'), 'error');
      }
    } catch {
      notify(t('notifyNetworkError'), 'error');
    } finally {
      setProcessingAction(false);
    }
  };

  // Load Users
  const loadUsers = async (page = 1, query = searchQuery) => {
    setLoadingUsers(true);
    try {
      const url = query.trim()
        ? `/api/admin/users?search=${encodeURIComponent(query.trim())}`
        : `/api/admin/users?page=${page}&limit=12`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setUsersList(data.users || []);
        setUsersPage(data.page || 1);
        setUsersTotalPages(data.totalPages || 1);
        setUsersTotalCount(data.total || 0);
      }
    } catch {
      notify(t('notifyUsersError'), 'error');
    } finally {
      setLoadingUsers(false);
    }
  };

  // Inspect User (Full Dossier)
  const inspectUser = async (telegramId: number) => {
    setInspectingUser(true);
    triggerHaptic('light');
    try {
      const res = await fetch(`/api/admin/users/${telegramId}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedUserSummary(data.summary);
        setUserOrders(data.orders || []);
        setUserReceipts(data.receipts || []);
        setUserDossierTab('finances');
      } else {
        notify(t('notifyUserReportError'), 'error');
      }
    } catch {
      notify(t('notifyNetworkError'), 'error');
    } finally {
      setInspectingUser(false);
    }
  };

  // Adjust User Balance
  const handleAdjustBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!balanceModalUser) return;

    const numAmount = parseInt(balanceAmount, 10);
    if (isNaN(numAmount) || numAmount < 0) {
      notify('مبلغ نامعتبر است', 'error');
      return;
    }
    if (!balanceReason.trim()) {
      notify('ثبت دلیل الزامی است', 'error');
      return;
    }

    setProcessingBalance(true);
    try {
      const res = await fetch(`/api/admin/users/${balanceModalUser.telegramId}/balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: balanceOperation,
          amount: numAmount,
          reason: balanceReason.trim(),
        }),
      });

      if (res.ok) {
        const result = await res.json();
        notify(
          t('notifyBalanceSuccess', {
            balance: result.balance.toLocaleString(numLocale),
          })
        );
        setBalanceModalUser(null);
        setBalanceAmount('');
        setBalanceReason('');
        loadUsers(usersPage, searchQuery);
        if (selectedUserSummary?.user.telegramId === balanceModalUser.telegramId) {
          inspectUser(balanceModalUser.telegramId);
        }
      } else {
        const err = await res.json();
        notify(err.error || t('notifyBalanceFailed'), 'error');
      }
    } catch {
      notify(t('notifyNetworkError'), 'error');
    } finally {
      setProcessingBalance(false);
    }
  };

  // Calculated Preview of New Balance
  const previewNewBalance = useMemo(() => {
    if (!balanceModalUser) return 0;
    const cur = balanceModalUser.balance;
    const amt = parseInt(balanceAmount, 10) || 0;
    if (balanceOperation === 'add') return cur + amt;
    if (balanceOperation === 'deduct') return Math.max(0, cur - amt);
    return amt;
  }, [balanceModalUser, balanceOperation, balanceAmount]);

  // Load Panels
  const loadPanels = async () => {
    setLoadingPanels(true);
    try {
      const res = await fetch('/api/admin/panels');
      if (res.ok) {
        const data = await res.json();
        setPanels(data.panels || []);
      }
    } catch {
      notify(t('notifyPanelsError'), 'error');
    } finally {
      setLoadingPanels(false);
    }
  };

  // Test individual panel connection on-demand
  const testPanelConnection = async (panelId: string) => {
    setTestingPanelId(panelId);
    triggerHaptic('light');
    try {
      const res = await fetch(`/api/admin/panels/${panelId}/test`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.healthy) {
        notify(t('notifyPanelTestSuccess', { ms: data.latencyMs ?? 0 }), 'success');
        setPanels((prev) =>
          prev.map((p) =>
            p.id === panelId ? { ...p, healthy: true, latencyMs: data.latencyMs } : p
          )
        );
      } else {
        notify(data.error || t('notifyPanelTestFailed'), 'error');
        setPanels((prev) => prev.map((p) => (p.id === panelId ? { ...p, healthy: false } : p)));
      }
    } catch {
      notify(t('notifyNetworkError'), 'error');
    } finally {
      setTestingPanelId(null);
    }
  };

  useEffect(() => {
    if (activeTab === 'overview') loadStats();
    if (activeTab === 'receipts') loadReceipts();
    if (activeTab === 'users') loadUsers(1, searchQuery);
    if (activeTab === 'panels') loadPanels();
  }, [activeTab]);

  const switchTab = (tab: TabType) => {
    triggerHaptic('light');
    setActiveTab(tab);
  };

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-100 mobile-safe-bottom">
      <div className="max-w-6xl mx-auto p-3 sm:p-5">
        {/* Header Bar */}
        <header className="glass-panel p-4 mb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold text-white m-0">{t('adminTitle')}</h1>
                <span className="badge badge-warning badge-sm text-[11px] font-medium">
                  {t('betaBadge')}
                </span>
              </div>
              <p className="text-xs text-slate-400 m-0 mt-0.5">
                {t('adminWelcome', { name: user.first_name, id: user.id })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center">
            {languageSelectionEnabled && (
              <button
                className="btn btn-ghost btn-sm text-xs gap-1.5 border border-white/10 hover:bg-white/10 text-slate-300"
                onClick={async () => {
                  const next = locale === 'fa' ? 'en' : 'fa';
                  const ok = await setLocale(next);
                  if (ok) {
                    notify(t('langChangeSuccess'));
                  }
                }}
              >
                <Globe className="w-3.5 h-3.5" />
                <span>{t('switchLang')}</span>
              </button>
            )}

            <button
              className="btn btn-ghost btn-sm text-xs gap-1.5 border border-white/10 hover:bg-white/10 text-slate-300"
              onClick={() => {
                triggerHaptic('light');
                if (activeTab === 'overview') loadStats();
                if (activeTab === 'receipts') loadReceipts();
                if (activeTab === 'users') loadUsers(usersPage, searchQuery);
                if (activeTab === 'panels') loadPanels();
              }}
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t('refresh')}</span>
            </button>
          </div>
        </header>

        {/* Notifications */}
        {notification && (
          <div
            className={`p-3.5 mb-4 rounded-xl text-xs sm:text-sm font-medium flex items-center gap-2 transition-all ${
              notification.type === 'success'
                ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
            }`}
          >
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
            )}
            <span>{notification.message}</span>
          </div>
        )}

        {/* Desktop Navigation Tabs */}
        <nav className="hidden md:flex gap-2 mb-5 overflow-x-auto pb-1">
          <button
            className={`btn btn-sm text-xs gap-2 font-medium ${
              activeTab === 'overview'
                ? 'btn-primary text-white shadow-lg shadow-indigo-600/30'
                : 'btn-ghost text-slate-300 border border-white/10 hover:bg-white/5'
            }`}
            onClick={() => switchTab('overview')}
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>{t('tabOverview')}</span>
          </button>

          <button
            className={`btn btn-sm text-xs gap-2 font-medium relative ${
              activeTab === 'receipts'
                ? 'btn-primary text-white shadow-lg shadow-indigo-600/30'
                : 'btn-ghost text-slate-300 border border-white/10 hover:bg-white/5'
            }`}
            onClick={() => switchTab('receipts')}
          >
            <Receipt className="w-4 h-4" />
            <span>{t('tabReceipts')}</span>
            {receipts.length > 0 && (
              <span className="badge badge-warning badge-xs px-1.5 py-0.5 text-[10px] font-bold">
                {receipts.length}
              </span>
            )}
          </button>

          <button
            className={`btn btn-sm text-xs gap-2 font-medium ${
              activeTab === 'users'
                ? 'btn-primary text-white shadow-lg shadow-indigo-600/30'
                : 'btn-ghost text-slate-300 border border-white/10 hover:bg-white/5'
            }`}
            onClick={() => switchTab('users')}
          >
            <Users className="w-4 h-4" />
            <span>{t('tabUsers')}</span>
          </button>

          <button
            className={`btn btn-sm text-xs gap-2 font-medium ${
              activeTab === 'panels'
                ? 'btn-primary text-white shadow-lg shadow-indigo-600/30'
                : 'btn-ghost text-slate-300 border border-white/10 hover:bg-white/5'
            }`}
            onClick={() => switchTab('panels')}
          >
            <Server className="w-4 h-4" />
            <span>{t('tabPanels')}</span>
          </button>

          <button
            className={`btn btn-sm text-xs gap-2 font-medium ${
              activeTab === 'coming-soon'
                ? 'btn-primary text-white shadow-lg shadow-indigo-600/30'
                : 'btn-ghost text-slate-300 border border-white/10 hover:bg-white/5'
            }`}
            onClick={() => switchTab('coming-soon')}
          >
            <Layers className="w-4 h-4" />
            <span>{t('tabComingSoon')}</span>
          </button>
        </nav>

        {/* Tab 1: Overview */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {loadingStats && (
              <div className="flex items-center justify-center p-8 gap-3 text-slate-400">
                <RotateCw className="w-5 h-5 animate-spin text-indigo-400" />
                <span className="text-sm">{t('statsLoading')}</span>
              </div>
            )}

            {stats && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {/* Pending Receipts */}
                <div
                  className="glass-panel p-4 flex items-center justify-between cursor-pointer hover:border-amber-500/40 transition-all"
                  onClick={() => switchTab('receipts')}
                >
                  <div className="space-y-1">
                    <span className="text-xs text-slate-400">{t('statPendingReceipts')}</span>
                    <div className="text-xl font-bold text-amber-400">
                      {stats.pendingReceipts.toLocaleString(numLocale)}
                    </div>
                    <span className="text-[11px] text-slate-500 block">
                      {t('statPendingReceiptsSub')}
                    </span>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                    <Clock className="w-5 h-5" />
                  </div>
                </div>

                {/* Total Users */}
                <div
                  className="glass-panel p-4 flex items-center justify-between cursor-pointer hover:border-indigo-500/40 transition-all"
                  onClick={() => switchTab('users')}
                >
                  <div className="space-y-1">
                    <span className="text-xs text-slate-400">{t('statTotalUsers')}</span>
                    <div className="text-xl font-bold text-white">
                      {stats.totalUsers.toLocaleString(numLocale)}
                    </div>
                    <span className="text-[11px] text-slate-500 block">
                      {t('statTotalUsersSub')}
                    </span>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                    <Users className="w-5 h-5" />
                  </div>
                </div>

                {/* Total Sales */}
                <div className="glass-panel p-4 flex items-center justify-between">
                  <div className="space-y-1">
                    <span className="text-xs text-slate-400">{t('statTotalSales')}</span>
                    <div className="text-xl font-bold text-emerald-400">
                      {stats.totalSales.toLocaleString(numLocale)}{' '}
                      <span className="text-xs font-normal text-slate-400">{t('currency')}</span>
                    </div>
                    <span className="text-[11px] text-slate-500 block">
                      {t('statTotalSalesSub')}
                    </span>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                    <TrendingUp className="w-5 h-5" />
                  </div>
                </div>

                {/* Daily Revenue */}
                <div className="glass-panel p-4 flex items-center justify-between">
                  <div className="space-y-1">
                    <span className="text-xs text-slate-400">{t('statDailyRevenue')}</span>
                    <div className="text-lg font-bold text-white">
                      {stats.dailyRevenue.toLocaleString(numLocale)}{' '}
                      <span className="text-xs font-normal text-slate-400">{t('currency')}</span>
                    </div>
                    <span className="text-[11px] text-slate-500 block">
                      {t('statDailyRevenueSub')}
                    </span>
                  </div>
                  <div className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-indigo-300">
                    <Calendar className="w-4 h-4" />
                  </div>
                </div>

                {/* Weekly Revenue */}
                <div className="glass-panel p-4 flex items-center justify-between">
                  <div className="space-y-1">
                    <span className="text-xs text-slate-400">{t('statWeeklyRevenue')}</span>
                    <div className="text-lg font-bold text-white">
                      {stats.weeklyRevenue.toLocaleString(numLocale)}{' '}
                      <span className="text-xs font-normal text-slate-400">{t('currency')}</span>
                    </div>
                    <span className="text-[11px] text-slate-500 block">
                      {t('statWeeklyRevenueSub')}
                    </span>
                  </div>
                  <div className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-indigo-300">
                    <CalendarDays className="w-4 h-4" />
                  </div>
                </div>

                {/* Monthly Revenue */}
                <div className="glass-panel p-4 flex items-center justify-between">
                  <div className="space-y-1">
                    <span className="text-xs text-slate-400">{t('statMonthlyRevenue')}</span>
                    <div className="text-lg font-bold text-white">
                      {stats.monthlyRevenue.toLocaleString(numLocale)}{' '}
                      <span className="text-xs font-normal text-slate-400">{t('currency')}</span>
                    </div>
                    <span className="text-[11px] text-slate-500 block">
                      {t('statMonthlyRevenueSub')}
                    </span>
                  </div>
                  <div className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-indigo-300">
                    <CalendarRange className="w-4 h-4" />
                  </div>
                </div>

                {/* Active Subs */}
                <div className="glass-panel p-4 flex items-center justify-between">
                  <div className="space-y-1">
                    <span className="text-xs text-slate-400">{t('statActiveSubs')}</span>
                    <div className="text-lg font-bold text-emerald-400">
                      {stats.activeSubscriptions.toLocaleString(numLocale)}
                    </div>
                    <span className="text-[11px] text-slate-500 block">
                      {t('statActiveSubsSub')}
                    </span>
                  </div>
                  <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                </div>

                {/* Inactive Subs */}
                <div className="glass-panel p-4 flex items-center justify-between">
                  <div className="space-y-1">
                    <span className="text-xs text-slate-400">{t('statInactiveSubs')}</span>
                    <div className="text-lg font-bold text-slate-400">
                      {stats.inactiveSubscriptions.toLocaleString(numLocale)}
                    </div>
                    <span className="text-[11px] text-slate-500 block">
                      {t('statInactiveSubsSub')}
                    </span>
                  </div>
                  <div className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-slate-400">
                    <XCircle className="w-4 h-4" />
                  </div>
                </div>

                {/* Panels Health Summary */}
                {panelHealth && (
                  <div
                    className="glass-panel p-4 flex items-center justify-between cursor-pointer hover:border-indigo-500/40 transition-all"
                    onClick={() => switchTab('panels')}
                  >
                    <div className="space-y-1">
                      <span className="text-xs text-slate-400">{t('panelHealthTitle')}</span>
                      <div
                        className={`text-lg font-bold ${
                          panelHealth.healthy === panelHealth.configured
                            ? 'text-emerald-400'
                            : 'text-rose-400'
                        }`}
                      >
                        {panelHealth.healthy === panelHealth.configured
                          ? t('panelHealthOk')
                          : t('panelHealthError')}
                      </div>
                      <span className="text-[11px] text-slate-500 block">
                        {t('panelHealthSub', {
                          healthy: panelHealth.healthy,
                          configured: panelHealth.configured,
                        })}
                      </span>
                    </div>
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                        panelHealth.healthy === panelHealth.configured
                          ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                          : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
                      }`}
                    >
                      <Activity className="w-4 h-4" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Receipts Queue */}
        {activeTab === 'receipts' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-indigo-400" />
                <h2 className="text-base font-bold text-white m-0">{t('receiptsQueueTitle')}</h2>
              </div>
              <span className="badge badge-outline badge-sm text-xs">
                {receipts.length} {t('all')}
              </span>
            </div>

            {loadingReceipts && (
              <div className="flex items-center justify-center p-8 gap-3 text-slate-400">
                <RotateCw className="w-5 h-5 animate-spin text-indigo-400" />
                <span className="text-sm">{t('receiptsLoading')}</span>
              </div>
            )}

            {!loadingReceipts && receipts.length === 0 && (
              <div className="glass-panel p-8 text-center flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-slate-800/80 border border-white/10 flex items-center justify-center text-slate-400">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                </div>
                <p className="text-sm text-slate-400 m-0">{t('receiptsEmpty')}</p>
              </div>
            )}

            {!loadingReceipts && receipts.length > 0 && (
              <div className="grid grid-cols-1 gap-3">
                {receipts.map((rec) => (
                  <div
                    key={rec.id}
                    className="glass-panel p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:border-indigo-500/30 transition-all"
                  >
                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-base font-bold text-emerald-400 font-mono">
                          {rec.amount.toLocaleString(numLocale)} {t('currency')}
                        </span>
                        <span className="badge badge-warning badge-sm text-[10px]">
                          {rec.status}
                        </span>
                        {rec.photoFileId && (
                          <button
                            className="badge badge-ghost badge-sm text-[11px] gap-1 hover:bg-white/10 cursor-pointer text-indigo-300"
                            onClick={() => {
                              setPhotoModalUrl(`/api/admin/receipts/${rec.id}/photo`);
                              setPhotoModalTitle(`رسید ${rec.id}`);
                            }}
                          >
                            <ImageIcon className="w-3 h-3" />
                            <span>{t('receiptViewPhoto')}</span>
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-xs text-slate-300 flex-wrap">
                        <span className="flex items-center gap-1">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          <button
                            className="underline hover:text-indigo-300 text-slate-300 font-mono"
                            onClick={() => {
                              switchTab('users');
                              inspectUser(rec.telegramId);
                            }}
                          >
                            {rec.telegramId}
                          </button>
                        </span>
                        <span className="text-slate-500">·</span>
                        <span className="font-mono text-slate-400 text-[11px]">ID: {rec.id}</span>
                      </div>

                      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                        <Clock className="w-3 h-3" />
                        <span>{new Date(rec.createdAt).toLocaleString(numLocale)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto self-end">
                      <button
                        className="btn btn-success btn-sm flex-1 sm:flex-none gap-1 text-xs text-white shadow-md shadow-emerald-500/20"
                        disabled={processingAction}
                        onClick={() => setReceiptApproveTarget(rec)}
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{t('receiptApprove')}</span>
                      </button>

                      <button
                        className="btn btn-error btn-sm flex-1 sm:flex-none gap-1 text-xs text-white shadow-md shadow-rose-500/20"
                        disabled={processingAction}
                        onClick={() => {
                          setReceiptActionTarget(rec);
                          setRejectionReason('');
                          setSelectedReasonPreset('');
                        }}
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>{t('receiptReject')}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Users Management */}
        {activeTab === 'users' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-400" />
                <h2 className="text-base font-bold text-white m-0">{t('usersTitle')}</h2>
              </div>
              <span className="text-xs text-slate-400">
                {t('usersTotalCount', { count: usersTotalCount.toLocaleString(numLocale) })}
              </span>
            </div>

            {/* Search Bar */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  className="input input-bordered w-full text-xs sm:text-sm bg-slate-900/60 border-white/10 pr-9 rtl:pr-9 rtl:pl-9"
                  placeholder={t('usersSearchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') loadUsers(1, searchQuery);
                  }}
                />
                <Search className="w-4 h-4 text-slate-400 absolute right-3 rtl:right-auto rtl:left-3 top-3.5 pointer-events-none" />
                {searchQuery && (
                  <button
                    className="absolute left-3 rtl:left-auto rtl:right-3 top-3 text-slate-400 hover:text-white"
                    onClick={() => {
                      setSearchQuery('');
                      loadUsers(1, '');
                    }}
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <button
                className="btn btn-primary btn-sm h-10 px-4 text-xs gap-1.5 text-white shadow-md shadow-indigo-600/30"
                onClick={() => loadUsers(1, searchQuery)}
              >
                <Search className="w-3.5 h-3.5" />
                <span>{t('usersSearchBtn')}</span>
              </button>
            </div>

            {loadingUsers && (
              <div className="flex items-center justify-center p-8 gap-3 text-slate-400">
                <RotateCw className="w-5 h-5 animate-spin text-indigo-400" />
                <span className="text-sm">{t('usersSearching')}</span>
              </div>
            )}

            {!loadingUsers && usersList.length === 0 && (
              <div className="glass-panel p-8 text-center text-slate-400 text-sm">
                {t('usersNotFound')}
              </div>
            )}

            {/* Mobile Cards View (< md) */}
            {!loadingUsers && usersList.length > 0 && (
              <div className="grid grid-cols-1 gap-3 md:hidden">
                {usersList.map((u) => (
                  <div
                    key={u.telegramId}
                    className="glass-panel p-4 space-y-3 hover:border-indigo-500/30 transition-all"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white font-bold text-sm shadow-md">
                          {(u.firstName?.[0] || u.username?.[0] || 'U').toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold text-sm text-white">
                            {[u.firstName, u.lastName].filter(Boolean).join(' ') || '—'}
                          </div>
                          <div className="text-xs text-indigo-300 font-mono">
                            {u.username ? `@${u.username}` : t('noUsername')}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        <span className="text-sm font-bold text-emerald-400 font-mono">
                          {u.balance.toLocaleString(numLocale)} {t('currency')}
                        </span>
                        <span
                          className={`badge badge-sm text-[10px] ${
                            u.activeSubscriptionCount > 0 ? 'badge-success' : 'badge-ghost'
                          }`}
                        >
                          {t('activeSubsCount', { count: u.activeSubscriptionCount })}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-white/5 text-xs">
                      <button
                        className="flex items-center gap-1.5 text-slate-400 hover:text-white font-mono"
                        onClick={() =>
                          copyToClipboard(String(u.telegramId), `user-${u.telegramId}`)
                        }
                      >
                        <Copy className="w-3 h-3" />
                        <span>{u.telegramId}</span>
                        {copiedId === `user-${u.telegramId}` && (
                          <span className="text-[10px] text-emerald-400 font-sans">
                            {t('copied')}
                          </span>
                        )}
                      </button>

                      <div className="flex items-center gap-1.5">
                        <button
                          className="btn btn-ghost btn-xs gap-1 border border-white/10 text-slate-300 hover:bg-white/10"
                          disabled={inspectingUser}
                          onClick={() => inspectUser(u.telegramId)}
                        >
                          {inspectingUser ? (
                            <RotateCw className="w-3 h-3 animate-spin" />
                          ) : (
                            <Eye className="w-3 h-3" />
                          )}
                          <span>{t('btnDetails')}</span>
                        </button>
                        <button
                          className="btn btn-primary btn-xs gap-1 text-white shadow-sm"
                          onClick={() => setBalanceModalUser(u)}
                        >
                          <Wallet className="w-3 h-3" />
                          <span>{t('btnChangeBalance')}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Desktop Table View (>= md) */}
            {!loadingUsers && usersList.length > 0 && (
              <div className="hidden md:block glass-panel overflow-x-auto">
                <table className="table table-zebra w-full text-xs">
                  <thead className="text-slate-400 border-b border-white/10">
                    <tr>
                      <th>{t('colId')}</th>
                      <th>{t('colUsername')}</th>
                      <th>{t('colName')}</th>
                      <th>{t('colBalance')}</th>
                      <th>{t('colActiveSubs')}</th>
                      <th className="text-center">{t('colActions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usersList.map((u) => (
                      <tr key={u.telegramId} className="hover:bg-white/5">
                        <td className="font-mono">
                          <button
                            className="flex items-center gap-1.5 hover:text-indigo-300"
                            onClick={() =>
                              copyToClipboard(String(u.telegramId), `table-user-${u.telegramId}`)
                            }
                          >
                            <span>{u.telegramId}</span>
                            <Copy className="w-3 h-3 text-slate-500" />
                          </button>
                        </td>
                        <td className="text-indigo-300 font-mono">
                          {u.username ? `@${u.username}` : '—'}
                        </td>
                        <td>{[u.firstName, u.lastName].filter(Boolean).join(' ') || '—'}</td>
                        <td className="font-bold text-emerald-400 font-mono">
                          {u.balance.toLocaleString(numLocale)} {t('currency')}
                        </td>
                        <td>
                          <span
                            className={`badge badge-sm text-[10px] ${
                              u.activeSubscriptionCount > 0 ? 'badge-success' : 'badge-ghost'
                            }`}
                          >
                            {t('activeSubsCount', { count: u.activeSubscriptionCount })}
                          </span>
                        </td>
                        <td>
                          <div className="flex items-center justify-center gap-2">
                            <button
                              className="btn btn-ghost btn-xs gap-1 border border-white/10 text-slate-300 hover:bg-white/10"
                              disabled={inspectingUser}
                              onClick={() => inspectUser(u.telegramId)}
                            >
                              {inspectingUser ? (
                                <RotateCw className="w-3 h-3 animate-spin" />
                              ) : (
                                <Eye className="w-3 h-3" />
                              )}
                              <span>{t('btnDetails')}</span>
                            </button>
                            <button
                              className="btn btn-primary btn-xs gap-1 text-white shadow-sm"
                              onClick={() => setBalanceModalUser(u)}
                            >
                              <Wallet className="w-3 h-3" />
                              <span>{t('btnChangeBalance')}</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls */}
            {!loadingUsers && usersTotalPages > 1 && (
              <div className="flex items-center justify-between p-2 glass-panel">
                <button
                  className="btn btn-ghost btn-sm text-xs gap-1 text-slate-300"
                  disabled={usersPage <= 1}
                  onClick={() => loadUsers(usersPage - 1, searchQuery)}
                >
                  <ChevronRight className="w-4 h-4 rtl:rotate-0 rotate-180" />
                  <span>{t('paginationPrev')}</span>
                </button>

                <span className="text-xs text-slate-400 font-medium">
                  {t('paginationPage', {
                    page: usersPage.toLocaleString(numLocale),
                    totalPages: usersTotalPages.toLocaleString(numLocale),
                  })}
                </span>

                <button
                  className="btn btn-ghost btn-sm text-xs gap-1 text-slate-300"
                  disabled={usersPage >= usersTotalPages}
                  onClick={() => loadUsers(usersPage + 1, searchQuery)}
                >
                  <span>{t('paginationNext')}</span>
                  <ChevronLeft className="w-4 h-4 rtl:rotate-0 rotate-180" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Panels Fleet Status */}
        {activeTab === 'panels' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Server className="w-5 h-5 text-indigo-400" />
                <h2 className="text-base font-bold text-white m-0">{t('panelsFleetTitle')}</h2>
              </div>
              <button
                className="btn btn-ghost btn-xs text-xs gap-1 border border-white/10 text-slate-300 hover:bg-white/10"
                onClick={loadPanels}
              >
                <RotateCw className="w-3 h-3" />
                <span>{t('refresh')}</span>
              </button>
            </div>

            {loadingPanels && (
              <div className="flex items-center justify-center p-8 gap-3 text-slate-400">
                <RotateCw className="w-5 h-5 animate-spin text-indigo-400" />
                <span className="text-sm">{t('panelsLoading')}</span>
              </div>
            )}

            {/* Fleet Status Card */}
            {!loadingPanels && panels.length > 0 && (
              <div className="glass-panel p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-indigo-500/20">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      panels.every((p) => p.healthy !== false)
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    <Activity className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white m-0">
                      {panels.every((p) => p.healthy !== false)
                        ? t('panelFleetStatusOk')
                        : t('panelFleetStatusWarning')}
                    </h3>
                    <p className="text-xs text-slate-400 m-0 mt-0.5">
                      {panels.filter((p) => p.healthy !== false).length} از {panels.length} پنل فعال
                      و پاسخگو
                    </p>
                  </div>
                </div>
              </div>
            )}

            {!loadingPanels && panels.length === 0 && (
              <div className="glass-panel p-8 text-center text-slate-400 text-sm">
                {t('panelsEmpty')}
              </div>
            )}

            {/* Panels List */}
            {!loadingPanels && panels.length > 0 && (
              <div className="grid grid-cols-1 gap-4">
                {panels.map((p) => (
                  <div
                    key={p.id}
                    className="glass-panel p-4 sm:p-5 space-y-4 hover:border-indigo-500/30 transition-all"
                  >
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-3 h-3 rounded-full ${
                              p.healthy !== false ? 'bg-emerald-500 status-pulse' : 'bg-rose-500'
                            }`}
                          />
                          <h3 className="text-base font-bold text-white m-0">{p.name}</h3>
                        </div>

                        {p.isDefault && (
                          <span className="badge badge-warning badge-sm text-[10px]">
                            {t('panelDefault')}
                          </span>
                        )}

                        <span
                          className={`badge badge-sm text-[10px] ${
                            p.healthy !== false ? 'badge-success' : 'badge-error'
                          }`}
                        >
                          {p.healthy !== false ? t('panelOnline') : t('panelOffline')}
                        </span>

                        {p.latencyMs !== undefined && (
                          <span className="badge badge-ghost badge-sm text-[10px] font-mono text-indigo-300">
                            {t('panelLatency', { ms: p.latencyMs })}
                          </span>
                        )}
                      </div>

                      <button
                        className="btn btn-ghost btn-sm text-xs gap-1.5 border border-white/10 hover:bg-white/10 text-slate-300"
                        disabled={testingPanelId === p.id}
                        onClick={() => testPanelConnection(p.id)}
                      >
                        <RotateCw
                          className={`w-3.5 h-3.5 ${testingPanelId === p.id ? 'animate-spin text-indigo-400' : ''}`}
                        />
                        <span>
                          {testingPanelId === p.id ? t('panelTesting') : t('panelTestBtn')}
                        </span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      {p.baseUrl && (
                        <div className="bg-slate-900/40 p-2.5 rounded-lg border border-white/5 space-y-1">
                          <span className="text-slate-400 block">{t('panelAddress')}</span>
                          <code className="text-slate-200 break-all font-mono text-[11px]">
                            {p.baseUrl}
                          </code>
                        </div>
                      )}

                      <div className="bg-slate-900/40 p-2.5 rounded-lg border border-white/5 space-y-1">
                        <span className="text-slate-400 block">{t('panelAuthMode')}</span>
                        <div className="flex items-center gap-1.5 font-mono text-slate-200">
                          <KeyRound className="w-3.5 h-3.5 text-indigo-400" />
                          <span>{p.credentialMode}</span>
                          <span className="text-slate-500">·</span>
                          <span className="text-emerald-400">
                            {t('panelConfigsCount', {
                              count: (p.activeConfigsCount ?? 0).toLocaleString(numLocale),
                            })}
                          </span>
                        </div>
                      </div>
                    </div>

                    {p.services.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <span className="text-xs text-slate-400 font-medium block">
                          {t('panelConnectedServices')}
                        </span>
                        <div className="flex gap-2 flex-wrap">
                          {p.services.map((s) => (
                            <span
                              key={s.serviceId}
                              className="badge badge-ghost text-xs py-1 px-2.5 bg-white/5 border border-white/10 text-slate-300"
                            >
                              {s.name} (ID: {s.serviceId}){' '}
                              {s.isDefault ? `· ${t('panelDefaultService')}` : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 5: Other Modules (Coming Soon) */}
        {activeTab === 'coming-soon' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-bold text-white m-0">{t('modulesTitle')}</h2>
              <p className="text-xs text-slate-400 m-0 mt-1">{t('modulesDesc')}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="glass-panel p-4 space-y-2 border-dashed border-white/15 relative overflow-hidden">
                <span className="badge badge-warning badge-sm text-[10px] absolute top-3 left-3 rtl:left-auto rtl:right-3">
                  {t('tagComingSoon')}
                </span>
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <Radio className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-bold text-white m-0">{t('modBroadcast')}</h3>
                <p className="text-xs text-slate-400 m-0">{t('modBroadcastSub')}</p>
              </div>

              <div className="glass-panel p-4 space-y-2 border-dashed border-white/15 relative overflow-hidden">
                <span className="badge badge-warning badge-sm text-[10px] absolute top-3 left-3 rtl:left-auto rtl:right-3">
                  {t('tagComingSoon')}
                </span>
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <Package className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-bold text-white m-0">{t('modPlans')}</h3>
                <p className="text-xs text-slate-400 m-0">{t('modPlansSub')}</p>
              </div>

              <div className="glass-panel p-4 space-y-2 border-dashed border-white/15 relative overflow-hidden">
                <span className="badge badge-warning badge-sm text-[10px] absolute top-3 left-3 rtl:left-auto rtl:right-3">
                  {t('tagComingSoon')}
                </span>
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <Ticket className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-bold text-white m-0">{t('modPromo')}</h3>
                <p className="text-xs text-slate-400 m-0">{t('modPromoSub')}</p>
              </div>

              <div className="glass-panel p-4 space-y-2 border-dashed border-white/15 relative overflow-hidden">
                <span className="badge badge-warning badge-sm text-[10px] absolute top-3 left-3 rtl:left-auto rtl:right-3">
                  {t('tagComingSoon')}
                </span>
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <CreditCard className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-bold text-white m-0">{t('modGateways')}</h3>
                <p className="text-xs text-slate-400 m-0">{t('modGatewaysSub')}</p>
              </div>

              <div className="glass-panel p-4 space-y-2 border-dashed border-white/15 relative overflow-hidden">
                <span className="badge badge-warning badge-sm text-[10px] absolute top-3 left-3 rtl:left-auto rtl:right-3">
                  {t('tagComingSoon')}
                </span>
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <HardDrive className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-bold text-white m-0">{t('modBackups')}</h3>
                <p className="text-xs text-slate-400 m-0">{t('modBackupsSub')}</p>
              </div>

              <div className="glass-panel p-4 space-y-2 border-dashed border-white/15 relative overflow-hidden">
                <span className="badge badge-warning badge-sm text-[10px] absolute top-3 left-3 rtl:left-auto rtl:right-3">
                  {t('tagComingSoon')}
                </span>
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <Sparkles className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-bold text-white m-0">{t('modWheel')}</h3>
                <p className="text-xs text-slate-400 m-0">{t('modWheelSub')}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Bottom Navigation Bar (DaisyUI btm-nav) */}
      <div className="btm-nav btm-nav-md md:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur-xl border-t border-white/10 shadow-2xl">
        <button
          className={`${activeTab === 'overview' ? 'active text-indigo-400' : 'text-slate-400'}`}
          onClick={() => switchTab('overview')}
        >
          <LayoutDashboard className="w-5 h-5" />
          <span className="btm-nav-label text-[10px] font-medium">{t('tabOverview')}</span>
        </button>

        <button
          className={`relative ${activeTab === 'receipts' ? 'active text-indigo-400' : 'text-slate-400'}`}
          onClick={() => switchTab('receipts')}
        >
          <Receipt className="w-5 h-5" />
          <span className="btm-nav-label text-[10px] font-medium">{t('tabReceipts')}</span>
          {receipts.length > 0 && (
            <span className="badge badge-warning badge-xs absolute top-1 right-1/4 text-[9px] font-bold">
              {receipts.length}
            </span>
          )}
        </button>

        <button
          className={`${activeTab === 'users' ? 'active text-indigo-400' : 'text-slate-400'}`}
          onClick={() => switchTab('users')}
        >
          <Users className="w-5 h-5" />
          <span className="btm-nav-label text-[10px] font-medium">{t('tabUsers')}</span>
        </button>

        <button
          className={`${activeTab === 'panels' ? 'active text-indigo-400' : 'text-slate-400'}`}
          onClick={() => switchTab('panels')}
        >
          <Server className="w-5 h-5" />
          <span className="btm-nav-label text-[10px] font-medium">{t('tabPanels')}</span>
        </button>

        <button
          className={`${activeTab === 'coming-soon' ? 'active text-indigo-400' : 'text-slate-400'}`}
          onClick={() => switchTab('coming-soon')}
        >
          <Layers className="w-5 h-5" />
          <span className="btm-nav-label text-[10px] font-medium">{t('tabComingSoon')}</span>
        </button>
      </div>

      {/* MODAL 1: Receipt Photo Lightbox */}
      {photoModalUrl && (
        <div className="modal modal-open">
          <div className="modal-box max-w-lg bg-slate-900 border border-white/10 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-indigo-400" />
                <span>{photoModalTitle}</span>
              </h3>
              <button
                className="btn btn-ghost btn-circle btn-xs text-slate-400 hover:text-white"
                onClick={() => setPhotoModalUrl(null)}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="rounded-xl overflow-hidden bg-black/50 border border-white/10 flex items-center justify-center min-h-[260px] max-h-[70vh]">
              <img
                src={photoModalUrl}
                alt="Receipt proof"
                className="max-h-[65vh] w-auto object-contain mx-auto"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                  notify(t('receiptNoPhoto'), 'error');
                }}
              />
            </div>
            <div className="modal-action mt-4">
              <button
                className="btn btn-ghost btn-sm text-xs border border-white/10 text-slate-300"
                onClick={() => setPhotoModalUrl(null)}
              >
                {t('close')}
              </button>
            </div>
          </div>
          <div className="modal-backdrop bg-black/70" onClick={() => setPhotoModalUrl(null)} />
        </div>
      )}

      {/* MODAL 2: Approve Receipt Confirmation */}
      {receiptApproveTarget && (
        <div className="modal modal-open">
          <div className="modal-box max-w-sm bg-slate-900 border border-white/10 p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-base text-white m-0">
                {t('receiptApproveConfirmTitle')}
              </h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed m-0">
              {t('receiptApproveConfirmBody', {
                amount: receiptApproveTarget.amount.toLocaleString(numLocale),
              })}
            </p>

            <div className="bg-slate-800/60 p-3 rounded-xl border border-white/5 text-xs space-y-1 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">شناسه کاربر:</span>
                <span>{receiptApproveTarget.telegramId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">کد رسید:</span>
                <span>{receiptApproveTarget.id}</span>
              </div>
            </div>

            <div className="modal-action mt-4 flex gap-2">
              <button
                className="btn btn-ghost btn-sm flex-1 text-xs border border-white/10 text-slate-300"
                onClick={() => setReceiptApproveTarget(null)}
              >
                {t('cancel')}
              </button>
              <button
                className="btn btn-success btn-sm flex-1 text-xs text-white shadow-lg shadow-emerald-500/20"
                disabled={processingAction}
                onClick={() => handleReceiptAction(receiptApproveTarget.id, 'approve')}
              >
                {processingAction ? (
                  <RotateCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                <span>{t('receiptApproveConfirmBtn')}</span>
              </button>
            </div>
          </div>
          <div
            className="modal-backdrop bg-black/70"
            onClick={() => setReceiptApproveTarget(null)}
          />
        </div>
      )}

      {/* MODAL 3: Reject Receipt Modal with Quick Presets */}
      {receiptActionTarget && (
        <div className="modal modal-open">
          <div className="modal-box max-w-md bg-slate-900 border border-white/10 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <XCircle className="w-5 h-5 text-rose-400" />
                <span>{t('modalRejectTitle')}</span>
              </h3>
              <button
                className="btn btn-ghost btn-circle btn-xs text-slate-400 hover:text-white"
                onClick={() => setReceiptActionTarget(null)}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400 m-0">
              {t('modalRejectConfirm', {
                id: receiptActionTarget.id,
                userId: receiptActionTarget.telegramId,
              })}
            </p>

            {/* Presets Chips */}
            <div className="space-y-1.5">
              <label className="text-xs text-slate-300 font-medium block">
                {t('modalRejectReasonLabel')}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { key: 'unclear', label: t('reasonPresetUnclear') },
                  { key: 'not_received', label: t('reasonPresetNotReceived') },
                  { key: 'duplicate', label: t('reasonPresetDuplicate') },
                  { key: 'mismatch', label: t('reasonPresetMismatch') },
                  { key: 'other', label: t('reasonPresetOther') },
                ].map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    className={`badge badge-sm py-2 px-2.5 text-[11px] cursor-pointer transition-all ${
                      selectedReasonPreset === preset.key
                        ? 'badge-error text-white font-medium'
                        : 'badge-ghost bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10'
                    }`}
                    onClick={() => {
                      setSelectedReasonPreset(preset.key);
                      setRejectionReason(preset.label);
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              className="textarea textarea-bordered w-full text-xs bg-slate-800/60 border-white/10 text-white"
              rows={2}
              placeholder={t('modalRejectReasonPlaceholder')}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
            />

            <div className="modal-action mt-4 flex gap-2">
              <button
                className="btn btn-ghost btn-sm flex-1 text-xs border border-white/10 text-slate-300"
                onClick={() => setReceiptActionTarget(null)}
              >
                {t('cancel')}
              </button>
              <button
                className="btn btn-error btn-sm flex-1 text-xs text-white shadow-lg shadow-rose-500/20"
                disabled={processingAction}
                onClick={() =>
                  handleReceiptAction(receiptActionTarget.id, 'reject', rejectionReason)
                }
              >
                {processingAction ? (
                  <RotateCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <X className="w-3.5 h-3.5" />
                )}
                <span>
                  {processingAction ? t('modalRejectSubmitting') : t('modalRejectSubmit')}
                </span>
              </button>
            </div>
          </div>
          <div
            className="modal-backdrop bg-black/70"
            onClick={() => setReceiptActionTarget(null)}
          />
        </div>
      )}

      {/* MODAL 4: User Dossier & Details */}
      {selectedUserSummary && (
        <div className="modal modal-open">
          <div className="modal-box max-w-2xl bg-slate-900 border border-white/10 p-5 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white font-bold text-base shadow-lg">
                  {(
                    selectedUserSummary.user.firstName?.[0] ||
                    selectedUserSummary.user.username?.[0] ||
                    'U'
                  ).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-base font-bold text-white m-0">
                    {[selectedUserSummary.user.firstName, selectedUserSummary.user.lastName]
                      .filter(Boolean)
                      .join(' ') || 'کاربر سیستم'}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                    <span className="text-indigo-300 font-mono">
                      {selectedUserSummary.user.username
                        ? `@${selectedUserSummary.user.username}`
                        : t('noUsername')}
                    </span>
                    <span>·</span>
                    <button
                      className="font-mono hover:text-white flex items-center gap-1"
                      onClick={() =>
                        copyToClipboard(String(selectedUserSummary.user.telegramId), 'dossier-id')
                      }
                    >
                      <span>{selectedUserSummary.user.telegramId}</span>
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>

              <button
                className="btn btn-ghost btn-circle btn-xs text-slate-400 hover:text-white"
                onClick={() => setSelectedUserSummary(null)}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Dossier Tabs */}
            <div className="flex gap-2 border-b border-white/5 pb-2">
              <button
                className={`btn btn-xs ${userDossierTab === 'finances' ? 'btn-primary text-white' : 'btn-ghost text-slate-400'}`}
                onClick={() => setUserDossierTab('finances')}
              >
                {t('userTabFinances')}
              </button>
              <button
                className={`btn btn-xs ${userDossierTab === 'orders' ? 'btn-primary text-white' : 'btn-ghost text-slate-400'}`}
                onClick={() => setUserDossierTab('orders')}
              >
                {t('userTabOrders')} ({userOrders.length})
              </button>
              <button
                className={`btn btn-xs ${userDossierTab === 'receipts' ? 'btn-primary text-white' : 'btn-ghost text-slate-400'}`}
                onClick={() => setUserDossierTab('receipts')}
              >
                {t('userTabReceipts')} ({userReceipts.length})
              </button>
            </div>

            {/* Sub-tab 1: Finances Grid */}
            {userDossierTab === 'finances' && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <div className="bg-slate-800/50 p-3 rounded-xl border border-white/5">
                  <span className="text-[11px] text-slate-400 block">{t('userCurBalance')}</span>
                  <div className="text-sm sm:text-base font-bold text-emerald-400 font-mono mt-1">
                    {selectedUserSummary.user.balance.toLocaleString(numLocale)} {t('currency')}
                  </div>
                </div>

                <div className="bg-slate-800/50 p-3 rounded-xl border border-white/5">
                  <span className="text-[11px] text-slate-400 block">{t('userTotalDeposit')}</span>
                  <div className="text-sm sm:text-base font-bold text-white font-mono mt-1">
                    {selectedUserSummary.totalDeposit.toLocaleString(numLocale)} {t('currency')}
                  </div>
                </div>

                <div className="bg-slate-800/50 p-3 rounded-xl border border-white/5">
                  <span className="text-[11px] text-slate-400 block">{t('userTotalSpend')}</span>
                  <div className="text-sm sm:text-base font-bold text-white font-mono mt-1">
                    {selectedUserSummary.totalSpend.toLocaleString(numLocale)} {t('currency')}
                  </div>
                </div>

                <div className="bg-slate-800/50 p-3 rounded-xl border border-white/5">
                  <span className="text-[11px] text-slate-400 block">{t('userActiveConfigs')}</span>
                  <div className="text-sm sm:text-base font-bold text-indigo-400 font-mono mt-1">
                    {selectedUserSummary.activeConfigsCount.toLocaleString(numLocale)}
                  </div>
                </div>

                <div className="bg-slate-800/50 p-3 rounded-xl border border-white/5">
                  <span className="text-[11px] text-slate-400 block">
                    {t('userApprovedReceipts')}
                  </span>
                  <div className="text-sm sm:text-base font-bold text-emerald-400 font-mono mt-1">
                    {selectedUserSummary.receiptsApprovedCount.toLocaleString(numLocale)}
                  </div>
                </div>

                <div className="bg-slate-800/50 p-3 rounded-xl border border-white/5">
                  <span className="text-[11px] text-slate-400 block">{t('userAuditEvents')}</span>
                  <div className="text-sm sm:text-base font-bold text-slate-300 font-mono mt-1">
                    {selectedUserSummary.auditEventsCount.toLocaleString(numLocale)}
                  </div>
                </div>
              </div>
            )}

            {/* Sub-tab 2: Orders List */}
            {userDossierTab === 'orders' && (
              <div className="space-y-2">
                {userOrders.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-4">{t('noOrders')}</p>
                ) : (
                  userOrders.map((order) => (
                    <div
                      key={order.id}
                      className="bg-slate-800/40 p-3 rounded-xl border border-white/5 flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="font-semibold text-white">
                          {order.packageName || 'سرویس اشتراک'}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">ID: {order.id}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-bold text-emerald-400">
                          {order.amount.toLocaleString(numLocale)} {t('currency')}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {new Date(order.createdAt).toLocaleDateString(numLocale)}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Sub-tab 3: Receipts List */}
            {userDossierTab === 'receipts' && (
              <div className="space-y-2">
                {userReceipts.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-4">{t('noReceipts')}</p>
                ) : (
                  userReceipts.map((rec) => (
                    <div
                      key={rec.id}
                      className="bg-slate-800/40 p-3 rounded-xl border border-white/5 flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="font-semibold font-mono text-white">
                          {rec.amount.toLocaleString(numLocale)} {t('currency')}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">ID: {rec.id}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`badge badge-xs text-[10px] ${
                            rec.status === 'approved'
                              ? 'badge-success'
                              : rec.status === 'rejected'
                                ? 'badge-error'
                                : 'badge-warning'
                          }`}
                        >
                          {rec.status}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {new Date(rec.createdAt).toLocaleDateString(numLocale)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Action Bar */}
            <div className="modal-action flex justify-between items-center pt-2 border-t border-white/5">
              <button
                className="btn btn-primary btn-sm gap-1.5 text-xs text-white"
                onClick={() => {
                  setBalanceModalUser(selectedUserSummary.user);
                }}
              >
                <Wallet className="w-3.5 h-3.5" />
                <span>{t('btnChangeBalance')}</span>
              </button>

              <button
                className="btn btn-ghost btn-sm text-xs border border-white/10 text-slate-300"
                onClick={() => setSelectedUserSummary(null)}
              >
                {t('btnCloseReport')}
              </button>
            </div>
          </div>
          <div
            className="modal-backdrop bg-black/70"
            onClick={() => setSelectedUserSummary(null)}
          />
        </div>
      )}

      {/* MODAL 5: Balance Adjustment with Segmented Ops & Quick Amounts */}
      {balanceModalUser && (
        <div className="modal modal-open">
          <div className="modal-box max-w-md bg-slate-900 border border-white/10 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <Wallet className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-base text-white m-0">{t('modalBalanceTitle')}</h3>
              </div>
              <button
                className="btn btn-ghost btn-circle btn-xs text-slate-400 hover:text-white"
                onClick={() => setBalanceModalUser(null)}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAdjustBalance} className="space-y-4">
              {/* User Balance Info Card */}
              <div className="bg-slate-800/60 p-3 rounded-xl border border-white/5 flex items-center justify-between text-xs">
                <span className="text-slate-400">{t('balanceCurLabel')}</span>
                <span className="font-bold text-white font-mono text-sm">
                  {balanceModalUser.balance.toLocaleString(numLocale)} {t('currency')}
                </span>
              </div>

              {/* Segmented Operation Selector */}
              <div className="grid grid-cols-3 gap-1 bg-slate-800/40 p-1 rounded-xl border border-white/5 text-xs">
                <button
                  type="button"
                  className={`btn btn-xs h-8 border-none ${
                    balanceOperation === 'add'
                      ? 'bg-emerald-600 text-white font-bold shadow'
                      : 'btn-ghost text-slate-300 hover:bg-white/5'
                  }`}
                  onClick={() => setBalanceOperation('add')}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t('modalBalanceOpAdd')}</span>
                </button>

                <button
                  type="button"
                  className={`btn btn-xs h-8 border-none ${
                    balanceOperation === 'deduct'
                      ? 'bg-rose-600 text-white font-bold shadow'
                      : 'btn-ghost text-slate-300 hover:bg-white/5'
                  }`}
                  onClick={() => setBalanceOperation('deduct')}
                >
                  <Minus className="w-3.5 h-3.5" />
                  <span>{t('modalBalanceOpDeduct')}</span>
                </button>

                <button
                  type="button"
                  className={`btn btn-xs h-8 border-none ${
                    balanceOperation === 'set'
                      ? 'bg-indigo-600 text-white font-bold shadow'
                      : 'btn-ghost text-slate-300 hover:bg-white/5'
                  }`}
                  onClick={() => setBalanceOperation('set')}
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  <span>{t('modalBalanceOpSet')}</span>
                </button>
              </div>

              {/* Amount Input */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 font-medium block">
                  {t('modalBalanceAmountLabel')}
                </label>
                <input
                  type="number"
                  min="0"
                  required
                  className="input input-bordered w-full text-sm bg-slate-800/60 border-white/10 font-mono text-white"
                  placeholder={t('modalBalanceAmountPlaceholder')}
                  value={balanceAmount}
                  onChange={(e) => setBalanceAmount(e.target.value)}
                />

                {/* Quick Amount Chips */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {[50000, 100000, 200000, 500000, 1000000].map((quickAmt) => (
                    <button
                      key={quickAmt}
                      type="button"
                      className="badge badge-ghost badge-sm py-1.5 px-2 text-[10px] font-mono cursor-pointer hover:bg-indigo-600 hover:text-white transition-all"
                      onClick={() => setBalanceAmount(String(quickAmt))}
                    >
                      +{(quickAmt / 1000).toLocaleString(numLocale)}k
                    </button>
                  ))}
                </div>
              </div>

              {/* Calculated Balance Preview */}
              {balanceAmount && (
                <div className="bg-indigo-500/10 border border-indigo-500/20 p-2.5 rounded-xl flex items-center justify-between text-xs">
                  <span className="text-indigo-300">{t('balancePreviewLabel')}</span>
                  <span className="font-bold text-white font-mono text-sm">
                    {previewNewBalance.toLocaleString(numLocale)} {t('currency')}
                  </span>
                </div>
              )}

              {/* Reason Input & Quick Chips */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 font-medium block">
                  {t('modalBalanceReasonLabel')}
                </label>
                <input
                  type="text"
                  required
                  className="input input-bordered w-full text-xs bg-slate-800/60 border-white/10 text-white"
                  placeholder={t('modalBalanceReasonPlaceholder')}
                  value={balanceReason}
                  onChange={(e) => setBalanceReason(e.target.value)}
                />

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {[
                    t('quickReasonCard'),
                    t('quickReasonCompensation'),
                    t('quickReasonAdjustment'),
                  ].map((quickReason) => (
                    <button
                      key={quickReason}
                      type="button"
                      className="badge badge-ghost badge-sm py-1.5 px-2 text-[10px] cursor-pointer hover:bg-white/10 transition-all text-slate-300"
                      onClick={() => setBalanceReason(quickReason)}
                    >
                      {quickReason}
                    </button>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="modal-action mt-4 flex gap-2">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm flex-1 text-xs border border-white/10 text-slate-300"
                  onClick={() => setBalanceModalUser(null)}
                >
                  {t('cancel')}
                </button>

                <button
                  type="submit"
                  className="btn btn-primary btn-sm flex-1 text-xs text-white shadow-lg shadow-indigo-600/30"
                  disabled={processingBalance}
                >
                  {processingBalance ? (
                    <RotateCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {processingBalance ? t('modalBalanceSubmitting') : t('modalBalanceSubmit')}
                  </span>
                </button>
              </div>
            </form>
          </div>
          <div className="modal-backdrop bg-black/70" onClick={() => setBalanceModalUser(null)} />
        </div>
      )}
    </div>
  );
};
