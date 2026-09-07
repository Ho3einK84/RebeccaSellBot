import React, { useState, useEffect, useMemo } from 'react';
import type { TelegramWebAppUser } from '../types/telegram.js';
import { useLanguage } from '../i18n/LanguageContext.js';
import { useTheme } from '../theme/ThemeContext.js';
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
  Moon,
  Sun,
  LogOut,
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
  const { isDark, toggleTheme } = useTheme();
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

  const triggerHaptic = (
    type: 'light' | 'medium' | 'heavy' | 'selection' | 'success' | 'warning' | 'error' = 'light'
  ) => {
    const haptic = window.Telegram?.WebApp?.HapticFeedback;
    if (!haptic) return;
    if (type === 'selection') {
      haptic.selectionChanged();
    } else if (type === 'success' || type === 'warning' || type === 'error') {
      haptic.notificationOccurred(type);
    } else {
      haptic.impactOccurred(type);
    }
  };

  const notify = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    triggerHaptic(type === 'success' ? 'success' : 'error');
    setTimeout(() => setNotification(null), 4000);
  };

  const handleClose = () => {
    triggerHaptic('medium');
    if (window.Telegram?.WebApp?.close) {
      window.Telegram.WebApp.close();
    } else {
      window.close();
    }
  };

  // Telegram BackButton integration: closes modals first, or exits dashboard if none open
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg?.disableVerticalSwipes) {
      tg.disableVerticalSwipes();
    }

    if (tg?.BackButton) {
      tg.BackButton.show();
      const onBackClick = () => {
        if (photoModalUrl) {
          setPhotoModalUrl(null);
          return;
        }
        if (receiptApproveTarget) {
          setReceiptApproveTarget(null);
          return;
        }
        if (receiptActionTarget) {
          setReceiptActionTarget(null);
          return;
        }
        if (balanceModalUser) {
          setBalanceModalUser(null);
          return;
        }
        if (selectedUserSummary) {
          setSelectedUserSummary(null);
          return;
        }
        handleClose();
      };
      tg.BackButton.onClick(onBackClick);
      return () => {
        tg.BackButton?.offClick(onBackClick);
      };
    }
  }, [
    photoModalUrl,
    receiptApproveTarget,
    receiptActionTarget,
    balanceModalUser,
    selectedUserSummary,
  ]);

  const legacyCopy = (text: string) => {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch {
      // ignore
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {
        legacyCopy(text);
      });
    } else {
      legacyCopy(text);
    }
    setCopiedId(id);
    triggerHaptic('success');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getAvatarChar = (name?: string | null, username?: string | null): string => {
    const raw = (name || username || '').trim();
    if (!raw) return '👤';
    const clean = raw.replace(/[\u200B-\u200F\uFEFF\u00AD\u2060-\u206F\uFFF0-\uFFFF]/g, '').trim();
    if (!clean) return '👤';
    const match = clean.match(/\p{L}|\p{N}/u);
    if (match) return match[0].toUpperCase();
    const chars = Array.from(clean);
    return chars[0] || '👤';
  };

  const formatMoney = (amount: number): string => {
    const formatted = Math.round(amount).toLocaleString(numLocale);
    return formatted.replace(/['’]/g, '٬');
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
      notify(locale === 'fa' ? 'مبلغ نامعتبر است' : 'Invalid amount', 'error');
      return;
    }
    if (!balanceReason.trim()) {
      notify(locale === 'fa' ? 'ثبت دلیل الزامی است' : 'Reason is required', 'error');
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
    triggerHaptic('selection');
    setActiveTab(tab);
  };

  // Dynamic Theme Class Tokens
  const cardClass = isDark
    ? 'bg-white/[0.03] border-white/[0.08] text-slate-100 shadow-xl shadow-black/20'
    : 'bg-white border-slate-200/90 text-slate-900 shadow-2xs';

  const subCardClass = isDark
    ? 'bg-white/[0.02] border-white/[0.06] text-slate-200'
    : 'bg-slate-50/90 border-slate-200/80 text-slate-800';

  const inputClass = isDark
    ? 'bg-white/[0.04] border-white/10 text-white placeholder:text-zinc-500 focus:border-indigo-400'
    : 'bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-indigo-600';

  const modalBoxClass = isDark
    ? 'bg-[#0f1118] border-white/10 text-slate-100 shadow-2xl'
    : 'bg-white border-slate-200 text-slate-900 shadow-2xl';

  const textPrimary = isDark ? 'text-white' : 'text-slate-900';
  const textSecondary = isDark ? 'text-zinc-400' : 'text-slate-600';
  const textMuted = isDark ? 'text-zinc-500' : 'text-slate-400';

  const rawAdminName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  const adminDisplayName = rawAdminName || 'Admin';

  return (
    <div
      className={`w-full min-h-screen min-h-[100dvh] flex flex-col relative transition-colors duration-200 safe-top ${
        isDark ? 'bg-[#090a0f] text-slate-100' : 'bg-[#f8fafc] text-slate-900'
      }`}
    >
      {/* Fixed background ambient lights & grid - zero scroll lag, hardware accelerated */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0" aria-hidden="true">
        <div className="cs-orb cs-orb-1" />
        <div className="cs-orb cs-orb-2" />
        <div className="cs-orb cs-orb-3" />
        <div className="absolute inset-0 cs-grid-overlay" />
      </div>

      {/* Main Container */}
      <main className="w-full max-w-6xl mx-auto p-3 sm:p-5 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] relative z-10 flex-1 flex flex-col">
        {/* Top Header Bar */}
        <header
          className={`rounded-2xl p-3.5 sm:p-4 mb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3.5 border transition-colors ${cardClass}`}
        >
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div
              className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border transition-colors ${
                isDark
                  ? 'bg-gradient-to-tr from-indigo-600/20 to-violet-500/20 border-indigo-500/30 text-indigo-400 shadow-md shadow-indigo-950/40'
                  : 'bg-indigo-50 border-indigo-200 text-indigo-600 shadow-sm'
              }`}
            >
              <ShieldCheck className="w-6 h-6" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={`text-sm sm:text-base font-bold m-0 truncate ${textPrimary}`}>
                  {t('adminTitle')}
                </h1>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                    isDark
                      ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                      : 'bg-amber-50 border-amber-200 text-amber-800'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  <span>{t('betaBadge')}</span>
                </span>
              </div>

              <div className="flex items-center gap-2 text-xs mt-1 flex-wrap">
                <span className={textSecondary}>{locale === 'fa' ? 'خوش آمدید،' : 'Welcome,'}</span>
                <span className={`font-semibold ${textPrimary}`}>{adminDisplayName}</span>
                <span className={textMuted}>·</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(String(user.id), 'header-id')}
                  className={`inline-flex items-center gap-1 font-mono text-[11px] px-2 py-0.5 rounded-lg border transition-all active:scale-95 cursor-pointer ${
                    isDark
                      ? 'bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-white/10'
                      : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                  }`}
                  title={t('copy')}
                >
                  <span>🆔</span>
                  <span dir="ltr">{user.id}</span>
                  {copiedId === 'header-id' ? (
                    <Check className="w-3 h-3 text-emerald-500" />
                  ) : (
                    <Copy className="w-3 h-3 opacity-60" />
                  )}
                </button>
                <span className={textMuted}>·</span>
                <span
                  className={`text-[11px] font-medium px-2 py-0.5 rounded-md border ${
                    isDark
                      ? 'text-indigo-300 bg-indigo-500/10 border-indigo-500/20'
                      : 'text-indigo-700 bg-indigo-50 border-indigo-200'
                  }`}
                >
                  {t('adminRole')}
                </span>
              </div>
            </div>
          </div>

          {/* Right Utility Buttons: Theme, Language, Refresh, Exit */}
          <div className="flex items-center gap-1.5 w-full sm:w-auto justify-end pt-2 sm:pt-0 border-t border-slate-200/50 dark:border-white/5 sm:border-0">
            {/* Theme Toggle Button */}
            <button
              type="button"
              className={`inline-flex items-center justify-center w-8 h-8 rounded-full border transition-all active:scale-95 cursor-pointer ${
                isDark
                  ? 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-slate-300'
                  : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-700 shadow-sm'
              }`}
              onClick={() => {
                triggerHaptic('light');
                toggleTheme();
              }}
              aria-label={t('themeToggle')}
              title={isDark ? t('themeLight') : t('themeDark')}
            >
              {isDark ? (
                <Sun className="w-4 h-4 text-amber-300" />
              ) : (
                <Moon className="w-4 h-4 text-slate-700" />
              )}
            </button>

            {/* Language Toggle Button */}
            {languageSelectionEnabled && (
              <button
                type="button"
                className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-full border text-xs font-medium transition-all active:scale-95 cursor-pointer ${
                  isDark
                    ? 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-slate-300'
                    : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-700 shadow-sm'
                }`}
                onClick={async () => {
                  triggerHaptic('light');
                  const next = locale === 'fa' ? 'en' : 'fa';
                  const ok = await setLocale(next);
                  if (ok) {
                    notify(t('langChangeSuccess'));
                  }
                }}
                aria-label={t('switchLang')}
              >
                <Globe className="w-3.5 h-3.5 opacity-70" />
                <span>{t('switchLang')}</span>
              </button>
            )}

            {/* Refresh Button */}
            <button
              type="button"
              className={`inline-flex items-center justify-center w-8 h-8 sm:w-auto sm:px-3 h-8 rounded-full border text-xs font-medium transition-all active:scale-95 cursor-pointer ${
                isDark
                  ? 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-slate-300'
                  : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-700 shadow-sm'
              }`}
              onClick={() => {
                triggerHaptic('light');
                if (activeTab === 'overview') loadStats();
                if (activeTab === 'receipts') loadReceipts();
                if (activeTab === 'users') loadUsers(usersPage, searchQuery);
                if (activeTab === 'panels') loadPanels();
              }}
              title={t('refresh')}
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline ms-1">{t('refresh')}</span>
            </button>

            {/* Exit Button */}
            <button
              type="button"
              className={`inline-flex items-center justify-center w-8 h-8 rounded-full border transition-all active:scale-95 cursor-pointer ${
                isDark
                  ? 'bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20 text-rose-300'
                  : 'bg-rose-50 border-rose-200 hover:bg-rose-100 text-rose-700 shadow-sm'
              }`}
              onClick={handleClose}
              aria-label={t('adminExit')}
              title={t('adminExit')}
            >
              <LogOut className="w-3.5 h-3.5 rtl:rotate-180" />
            </button>
          </div>
        </header>

        {/* Global Notifications */}
        {notification && (
          <div
            className={`p-3.5 mb-4 rounded-xl text-xs sm:text-sm font-medium flex items-center gap-2 transition-all ${
              notification.type === 'success'
                ? isDark
                  ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                  : 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                : isDark
                  ? 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
                  : 'bg-rose-50 border border-rose-200 text-rose-800'
            }`}
          >
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500" />
            )}
            <span>{notification.message}</span>
          </div>
        )}

        {/* Desktop Navigation Tabs (Hidden on mobile) */}
        <nav className="hidden md:flex gap-2 mb-5 overflow-x-auto pb-1">
          {[
            { id: 'overview' as const, label: t('tabOverview'), icon: LayoutDashboard },
            {
              id: 'receipts' as const,
              label: t('tabReceipts'),
              icon: Receipt,
              count: receipts.length,
            },
            { id: 'users' as const, label: t('tabUsers'), icon: Users },
            { id: 'panels' as const, label: t('tabPanels'), icon: Server },
            { id: 'coming-soon' as const, label: t('tabComingSoon'), icon: Layers },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                className={`btn btn-sm text-xs gap-2 font-semibold rounded-xl transition-all cursor-pointer ${
                  isActive
                    ? isDark
                      ? 'bg-white text-black hover:bg-zinc-200 shadow-md border-transparent'
                      : 'bg-slate-900 text-white hover:bg-slate-800 shadow-sm border-transparent'
                    : isDark
                      ? 'bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-white/[0.08]'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100 shadow-2xs'
                }`}
                onClick={() => switchTab(tab.id)}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
                {tab.count !== undefined && tab.count > 0 && (
                  <span className="badge badge-warning badge-xs px-1.5 py-0.5 text-[10px] font-bold">
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* ===================== TAB 1: OVERVIEW ===================== */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {loadingStats && (
              <div className={`flex items-center justify-center p-8 gap-3 ${textSecondary}`}>
                <RotateCw className="w-5 h-5 animate-spin text-indigo-500" />
                <span className="text-sm">{t('statsLoading')}</span>
              </div>
            )}

            {stats && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {/* Pending Receipts */}
                <div
                  className={`rounded-2xl p-4 flex items-center justify-between cursor-pointer border transition-all active:scale-[0.99] ${cardClass} hover:border-amber-500/50`}
                  onClick={() => switchTab('receipts')}
                >
                  <div className="space-y-1">
                    <span className={`text-xs block ${textSecondary}`}>
                      {t('statPendingReceipts')}
                    </span>
                    <div className="text-xl font-bold font-mono text-amber-500">
                      {stats.pendingReceipts.toLocaleString(numLocale)}
                    </div>
                    <span className={`text-[11px] block ${textMuted}`}>
                      {t('statPendingReceiptsSub')}
                    </span>
                  </div>
                  <div
                    className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${
                      isDark
                        ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                        : 'bg-amber-50 border-amber-200 text-amber-700'
                    }`}
                  >
                    <Clock className="w-5 h-5" />
                  </div>
                </div>

                {/* Total Users */}
                <div
                  className={`rounded-2xl p-4 flex items-center justify-between cursor-pointer border transition-all active:scale-[0.99] ${cardClass} hover:border-indigo-500/50`}
                  onClick={() => switchTab('users')}
                >
                  <div className="space-y-1">
                    <span className={`text-xs block ${textSecondary}`}>{t('statTotalUsers')}</span>
                    <div className={`text-xl font-bold font-mono ${textPrimary}`}>
                      {stats.totalUsers.toLocaleString(numLocale)}
                    </div>
                    <span className={`text-[11px] block ${textMuted}`}>
                      {t('statTotalUsersSub')}
                    </span>
                  </div>
                  <div
                    className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${
                      isDark
                        ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                        : 'bg-indigo-50 border-indigo-200 text-indigo-700'
                    }`}
                  >
                    <Users className="w-5 h-5" />
                  </div>
                </div>

                {/* Total Sales */}
                <div
                  className={`rounded-2xl p-4 flex items-center justify-between border ${cardClass}`}
                >
                  <div className="space-y-1">
                    <span className={`text-xs block ${textSecondary}`}>{t('statTotalSales')}</span>
                    <div
                      className={`text-xl font-bold font-mono ${
                        isDark ? 'text-emerald-400' : 'text-emerald-600'
                      }`}
                    >
                      {formatMoney(stats.totalSales)}{' '}
                      <span className={`text-xs font-normal ${textSecondary}`}>
                        {t('currency')}
                      </span>
                    </div>
                    <span className={`text-[11px] block ${textMuted}`}>
                      {t('statTotalSalesSub')}
                    </span>
                  </div>
                  <div
                    className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${
                      isDark
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    }`}
                  >
                    <TrendingUp className="w-5 h-5" />
                  </div>
                </div>

                {/* Daily Revenue */}
                <div
                  className={`rounded-2xl p-4 flex items-center justify-between border ${cardClass}`}
                >
                  <div className="space-y-1">
                    <span className={`text-xs block ${textSecondary}`}>
                      {t('statDailyRevenue')}
                    </span>
                    <div className={`text-lg font-bold font-mono ${textPrimary}`}>
                      {formatMoney(stats.dailyRevenue)}{' '}
                      <span className={`text-xs font-normal ${textSecondary}`}>
                        {t('currency')}
                      </span>
                    </div>
                    <span className={`text-[11px] block ${textMuted}`}>
                      {t('statDailyRevenueSub')}
                    </span>
                  </div>
                  <div
                    className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${
                      isDark
                        ? 'bg-white/[0.04] border-white/10 text-zinc-300'
                        : 'bg-slate-100 border-slate-200 text-slate-700'
                    }`}
                  >
                    <Calendar className="w-4 h-4" />
                  </div>
                </div>

                {/* Weekly Revenue */}
                <div
                  className={`rounded-2xl p-4 flex items-center justify-between border ${cardClass}`}
                >
                  <div className="space-y-1">
                    <span className={`text-xs block ${textSecondary}`}>
                      {t('statWeeklyRevenue')}
                    </span>
                    <div className={`text-lg font-bold font-mono ${textPrimary}`}>
                      {formatMoney(stats.weeklyRevenue)}{' '}
                      <span className={`text-xs font-normal ${textSecondary}`}>
                        {t('currency')}
                      </span>
                    </div>
                    <span className={`text-[11px] block ${textMuted}`}>
                      {t('statWeeklyRevenueSub')}
                    </span>
                  </div>
                  <div
                    className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${
                      isDark
                        ? 'bg-white/[0.04] border-white/10 text-zinc-300'
                        : 'bg-slate-100 border-slate-200 text-slate-700'
                    }`}
                  >
                    <CalendarDays className="w-4 h-4" />
                  </div>
                </div>

                {/* Monthly Revenue */}
                <div
                  className={`rounded-2xl p-4 flex items-center justify-between border ${cardClass}`}
                >
                  <div className="space-y-1">
                    <span className={`text-xs block ${textSecondary}`}>
                      {t('statMonthlyRevenue')}
                    </span>
                    <div className={`text-lg font-bold font-mono ${textPrimary}`}>
                      {formatMoney(stats.monthlyRevenue)}{' '}
                      <span className={`text-xs font-normal ${textSecondary}`}>
                        {t('currency')}
                      </span>
                    </div>
                    <span className={`text-[11px] block ${textMuted}`}>
                      {t('statMonthlyRevenueSub')}
                    </span>
                  </div>
                  <div
                    className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${
                      isDark
                        ? 'bg-white/[0.04] border-white/10 text-zinc-300'
                        : 'bg-slate-100 border-slate-200 text-slate-700'
                    }`}
                  >
                    <CalendarRange className="w-4 h-4" />
                  </div>
                </div>

                {/* Active Subs */}
                <div
                  className={`rounded-2xl p-4 flex items-center justify-between border ${cardClass}`}
                >
                  <div className="space-y-1">
                    <span className={`text-xs block ${textSecondary}`}>{t('statActiveSubs')}</span>
                    <div
                      className={`text-lg font-bold font-mono ${
                        isDark ? 'text-emerald-400' : 'text-emerald-600'
                      }`}
                    >
                      {stats.activeSubscriptions.toLocaleString(numLocale)}
                    </div>
                    <span className={`text-[11px] block ${textMuted}`}>
                      {t('statActiveSubsSub')}
                    </span>
                  </div>
                  <div
                    className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${
                      isDark
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                </div>

                {/* Inactive Subs */}
                <div
                  className={`rounded-2xl p-4 flex items-center justify-between border ${cardClass}`}
                >
                  <div className="space-y-1">
                    <span className={`text-xs block ${textSecondary}`}>
                      {t('statInactiveSubs')}
                    </span>
                    <div className={`text-lg font-bold font-mono ${textSecondary}`}>
                      {stats.inactiveSubscriptions.toLocaleString(numLocale)}
                    </div>
                    <span className={`text-[11px] block ${textMuted}`}>
                      {t('statInactiveSubsSub')}
                    </span>
                  </div>
                  <div
                    className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${
                      isDark
                        ? 'bg-white/[0.04] border-white/10 text-zinc-400'
                        : 'bg-slate-100 border-slate-200 text-slate-500'
                    }`}
                  >
                    <XCircle className="w-4 h-4" />
                  </div>
                </div>

                {/* Panels Health Summary */}
                {panelHealth && (
                  <div
                    className={`rounded-2xl p-4 flex items-center justify-between cursor-pointer border transition-all active:scale-[0.99] ${cardClass} hover:border-indigo-500/50`}
                    onClick={() => switchTab('panels')}
                  >
                    <div className="space-y-1">
                      <span className={`text-xs block ${textSecondary}`}>
                        {t('panelHealthTitle')}
                      </span>
                      <div
                        className={`text-lg font-bold ${
                          panelHealth.healthy === panelHealth.configured
                            ? isDark
                              ? 'text-emerald-400'
                              : 'text-emerald-600'
                            : isDark
                              ? 'text-rose-400'
                              : 'text-rose-600'
                        }`}
                      >
                        {panelHealth.healthy === panelHealth.configured
                          ? t('panelHealthOk')
                          : t('panelHealthError')}
                      </div>
                      <span className={`text-[11px] block ${textMuted}`}>
                        {t('panelHealthSub', {
                          healthy: panelHealth.healthy,
                          configured: panelHealth.configured,
                        })}
                      </span>
                    </div>
                    <div
                      className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${
                        panelHealth.healthy === panelHealth.configured
                          ? isDark
                            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                            : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                          : isDark
                            ? 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                            : 'bg-rose-50 border-rose-200 text-rose-700'
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

        {/* ===================== TAB 2: RECEIPTS QUEUE ===================== */}
        {activeTab === 'receipts' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-indigo-500" />
                <h2 className={`text-base font-bold m-0 ${textPrimary}`}>
                  {t('receiptsQueueTitle')}
                </h2>
              </div>
              <span
                className={`text-xs px-2.5 py-1 rounded-full border font-mono ${
                  isDark
                    ? 'bg-white/[0.04] border-white/10 text-zinc-300'
                    : 'bg-slate-100 border-slate-200 text-slate-700'
                }`}
              >
                {receipts.length} {t('all')}
              </span>
            </div>

            {loadingReceipts && (
              <div className={`flex items-center justify-center p-8 gap-3 ${textSecondary}`}>
                <RotateCw className="w-5 h-5 animate-spin text-indigo-500" />
                <span className="text-sm">{t('receiptsLoading')}</span>
              </div>
            )}

            {!loadingReceipts && receipts.length === 0 && (
              <div
                className={`rounded-2xl p-8 text-center flex flex-col items-center gap-3 border ${cardClass}`}
              >
                <div
                  className={`w-12 h-12 rounded-full border flex items-center justify-center ${
                    isDark
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-600'
                  }`}
                >
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <p className={`text-sm m-0 ${textSecondary}`}>{t('receiptsEmpty')}</p>
              </div>
            )}

            {!loadingReceipts && receipts.length > 0 && (
              <div className="grid grid-cols-1 gap-3">
                {receipts.map((rec) => (
                  <div
                    key={rec.id}
                    className={`rounded-2xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border transition-all hover:border-indigo-500/40 ${cardClass}`}
                  >
                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-base font-bold font-mono ${
                            isDark ? 'text-emerald-400' : 'text-emerald-600'
                          }`}
                        >
                          {formatMoney(rec.amount)} {t('currency')}
                        </span>
                        <span className="badge badge-warning badge-sm text-[10px] font-medium">
                          {rec.status}
                        </span>
                        {rec.photoFileId && (
                          <button
                            type="button"
                            className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full border transition-all cursor-pointer ${
                              isDark
                                ? 'bg-indigo-500/10 border-indigo-500/20 hover:bg-indigo-500/20 text-indigo-300'
                                : 'bg-indigo-50 border-indigo-200 hover:bg-indigo-100 text-indigo-700'
                            }`}
                            onClick={() => {
                              setPhotoModalUrl(`/api/admin/receipts/${rec.id}/photo`);
                              setPhotoModalTitle(
                                locale === 'fa' ? `رسید ${rec.id}` : `Receipt ${rec.id}`
                              );
                            }}
                          >
                            <ImageIcon className="w-3 h-3" />
                            <span>{t('receiptViewPhoto')}</span>
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-xs flex-wrap">
                        <span className="flex items-center gap-1">
                          <User className={`w-3.5 h-3.5 ${textMuted}`} />
                          <button
                            type="button"
                            className="underline font-mono text-indigo-500 hover:text-indigo-400 cursor-pointer"
                            onClick={() => {
                              switchTab('users');
                              inspectUser(rec.telegramId);
                            }}
                          >
                            <span dir="ltr">{rec.telegramId}</span>
                          </button>
                        </span>
                        <span className={textMuted}>·</span>
                        <span className={`font-mono text-[11px] ${textSecondary}`}>
                          ID: <span dir="ltr">{rec.id}</span>
                        </span>
                      </div>

                      <div className={`flex items-center gap-1.5 text-[11px] ${textMuted}`}>
                        <Clock className="w-3 h-3" />
                        <span>{new Date(rec.createdAt).toLocaleString(numLocale)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto self-end">
                      <button
                        type="button"
                        className="btn btn-success btn-sm flex-1 sm:flex-none gap-1 text-xs text-white shadow-sm cursor-pointer"
                        disabled={processingAction}
                        onClick={() => setReceiptApproveTarget(rec)}
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{t('receiptApprove')}</span>
                      </button>

                      <button
                        type="button"
                        className="btn btn-error btn-sm flex-1 sm:flex-none gap-1 text-xs text-white shadow-sm cursor-pointer"
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

        {/* ===================== TAB 3: USERS ===================== */}
        {activeTab === 'users' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-500" />
                <h2 className={`text-base font-bold m-0 ${textPrimary}`}>{t('usersTitle')}</h2>
              </div>
              <span className={`text-xs ${textSecondary}`}>
                {t('usersTotalCount', { count: usersTotalCount.toLocaleString(numLocale) })}
              </span>
            </div>

            {/* Search Bar */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search
                  className={`w-4 h-4 absolute start-3.5 top-3 pointer-events-none ${textMuted}`}
                />
                <input
                  type="text"
                  className={`input input-bordered w-full text-xs sm:text-sm ps-10 pe-10 rounded-xl ${inputClass}`}
                  placeholder={t('usersSearchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') loadUsers(1, searchQuery);
                  }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className={`absolute end-3 top-3 p-0.5 hover:text-white cursor-pointer ${textMuted}`}
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
                type="button"
                className="btn btn-primary btn-sm h-10 px-4 text-xs gap-1.5 text-white shadow-sm rounded-xl shrink-0 cursor-pointer"
                onClick={() => loadUsers(1, searchQuery)}
              >
                <Search className="w-3.5 h-3.5" />
                <span>{t('usersSearchBtn')}</span>
              </button>
            </div>

            {loadingUsers && (
              <div className={`flex items-center justify-center p-8 gap-3 ${textSecondary}`}>
                <RotateCw className="w-5 h-5 animate-spin text-indigo-500" />
                <span className="text-sm">{t('usersSearching')}</span>
              </div>
            )}

            {!loadingUsers && usersList.length === 0 && (
              <div className={`rounded-2xl p-8 text-center text-sm border ${cardClass}`}>
                {t('usersNotFound')}
              </div>
            )}

            {/* Mobile Cards View (< md) */}
            {!loadingUsers && usersList.length > 0 && (
              <div className="grid grid-cols-1 gap-3 md:hidden">
                {usersList.map((u) => (
                  <div
                    key={u.telegramId}
                    className={`rounded-2xl p-3.5 sm:p-4 space-y-3 border transition-all hover:border-indigo-500/40 ${cardClass}`}
                  >
                    {/* User Info Header */}
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-base shadow-sm shrink-0 border border-white/10">
                          {getAvatarChar(u.firstName, u.username)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className={`font-bold text-sm truncate ${textPrimary}`}>
                            {[u.firstName, u.lastName].filter(Boolean).join(' ') ||
                              (locale === 'fa' ? 'کاربر بدون نام' : 'Unnamed User')}
                          </div>
                          <div className="text-xs text-indigo-500 font-mono mt-0.5">
                            {u.username ? (
                              <span dir="ltr" className="inline-block unicode-isolate font-medium">
                                @{u.username}
                              </span>
                            ) : (
                              <span className={`font-sans ${textMuted}`}>{t('noUsername')}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Telegram ID Chip */}
                      <button
                        type="button"
                        className={`flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded-lg border transition-all active:scale-95 shrink-0 cursor-pointer ${
                          isDark
                            ? 'bg-white/[0.04] border-white/10 hover:border-white/20 text-zinc-300'
                            : 'bg-slate-100 border-slate-200 hover:border-slate-300 text-slate-700'
                        }`}
                        onClick={() =>
                          copyToClipboard(String(u.telegramId), `user-${u.telegramId}`)
                        }
                      >
                        <Copy className={`w-3 h-3 ${textMuted}`} />
                        <span dir="ltr">{u.telegramId}</span>
                        {copiedId === `user-${u.telegramId}` && (
                          <span className="text-[10px] text-emerald-500 font-sans font-medium">
                            {t('copied')}
                          </span>
                        )}
                      </button>
                    </div>

                    {/* Financial & Status Metrics */}
                    <div
                      className={`flex items-center justify-between py-2 px-3 rounded-xl border text-xs ${subCardClass}`}
                    >
                      <div className="flex items-center gap-1.5">
                        <Wallet
                          className={`w-3.5 h-3.5 ${
                            isDark ? 'text-emerald-400' : 'text-emerald-600'
                          }`}
                        />
                        <span
                          className={`font-bold text-sm font-mono ${
                            isDark ? 'text-emerald-400' : 'text-emerald-600'
                          }`}
                        >
                          {formatMoney(u.balance)}
                        </span>
                        <span className={`text-[11px] ${textMuted}`}>{t('currency')}</span>
                      </div>

                      <div>
                        {u.activeSubscriptionCount > 0 ? (
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${
                              isDark
                                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                                : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                            }`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 status-pulse" />
                            <span>
                              {t('activeSubsCount', { count: u.activeSubscriptionCount })}
                            </span>
                          </span>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] border ${
                              isDark
                                ? 'bg-white/5 border-white/5 text-zinc-400'
                                : 'bg-slate-100 border-slate-200 text-slate-500'
                            }`}
                          >
                            <span>{locale === 'fa' ? '۰ سرویس فعال' : '0 active'}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="grid grid-cols-2 gap-2 pt-0.5">
                      <button
                        type="button"
                        className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border text-xs font-medium transition-all active:scale-[0.98] cursor-pointer ${
                          isDark
                            ? 'bg-white/[0.04] hover:bg-white/[0.08] border-white/10 text-slate-200'
                            : 'bg-white hover:bg-slate-100 border-slate-200 text-slate-800 shadow-2xs'
                        }`}
                        disabled={inspectingUser}
                        onClick={() => inspectUser(u.telegramId)}
                      >
                        {inspectingUser ? (
                          <RotateCw className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                        ) : (
                          <Eye className={`w-3.5 h-3.5 ${textMuted}`} />
                        )}
                        <span>{t('btnDetails')}</span>
                      </button>

                      <button
                        type="button"
                        className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-semibold shadow-sm transition-all active:scale-[0.98] cursor-pointer"
                        onClick={() => setBalanceModalUser(u)}
                      >
                        <Wallet className="w-3.5 h-3.5" />
                        <span>{t('btnChangeBalance')}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Desktop Table View (>= md) */}
            {!loadingUsers && usersList.length > 0 && (
              <div className={`hidden md:block rounded-2xl overflow-x-auto border ${cardClass}`}>
                <table className="table table-zebra w-full text-xs">
                  <thead
                    className={`text-xs border-b ${
                      isDark ? 'text-zinc-400 border-white/10' : 'text-slate-500 border-slate-200'
                    }`}
                  >
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
                      <tr
                        key={u.telegramId}
                        className={`transition-colors ${
                          isDark ? 'hover:bg-white/[0.03]' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="font-mono">
                          <button
                            type="button"
                            className="flex items-center gap-1.5 hover:text-indigo-400 cursor-pointer"
                            onClick={() =>
                              copyToClipboard(String(u.telegramId), `table-user-${u.telegramId}`)
                            }
                          >
                            <span dir="ltr">{u.telegramId}</span>
                            <Copy className={`w-3 h-3 ${textMuted}`} />
                          </button>
                        </td>
                        <td className="text-indigo-500 font-mono">
                          {u.username ? (
                            <span dir="ltr" className="inline-block unicode-isolate">
                              @{u.username}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>{[u.firstName, u.lastName].filter(Boolean).join(' ') || '—'}</td>
                        <td
                          className={`font-bold font-mono ${
                            isDark ? 'text-emerald-400' : 'text-emerald-600'
                          }`}
                        >
                          {formatMoney(u.balance)} {t('currency')}
                        </td>
                        <td>
                          <span
                            className={`badge badge-sm text-[10px] ${
                              u.activeSubscriptionCount > 0
                                ? 'badge-success text-white'
                                : 'badge-ghost'
                            }`}
                          >
                            {t('activeSubsCount', { count: u.activeSubscriptionCount })}
                          </span>
                        </td>
                        <td>
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              className={`btn btn-ghost btn-xs gap-1 border rounded-lg cursor-pointer ${
                                isDark
                                  ? 'border-white/10 text-slate-300 hover:bg-white/10'
                                  : 'border-slate-200 text-slate-700 hover:bg-slate-100'
                              }`}
                              disabled={inspectingUser}
                              onClick={() => inspectUser(u.telegramId)}
                            >
                              {inspectingUser ? (
                                <RotateCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Eye className="w-3.5 h-3.5" />
                              )}
                              <span>{t('btnDetails')}</span>
                            </button>
                            <button
                              type="button"
                              className="btn btn-primary btn-xs gap-1 text-white shadow-sm rounded-lg cursor-pointer"
                              onClick={() => setBalanceModalUser(u)}
                            >
                              <Wallet className="w-3.5 h-3.5" />
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
              <div
                className={`flex items-center justify-between p-2 rounded-2xl border ${cardClass}`}
              >
                <button
                  type="button"
                  className={`btn btn-ghost btn-sm text-xs gap-1 cursor-pointer ${textSecondary}`}
                  disabled={usersPage <= 1}
                  onClick={() => loadUsers(usersPage - 1, searchQuery)}
                >
                  <ChevronRight className="w-4 h-4 rtl:rotate-0 rotate-180" />
                  <span>{t('paginationPrev')}</span>
                </button>

                <span className={`text-xs font-medium ${textSecondary}`}>
                  {t('paginationPage', {
                    page: usersPage.toLocaleString(numLocale),
                    totalPages: usersTotalPages.toLocaleString(numLocale),
                  })}
                </span>

                <button
                  type="button"
                  className={`btn btn-ghost btn-sm text-xs gap-1 cursor-pointer ${textSecondary}`}
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

        {/* ===================== TAB 4: PANELS FLEET ===================== */}
        {activeTab === 'panels' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <Server className="w-5 h-5 text-indigo-500" />
                <h2 className={`text-base font-bold m-0 ${textPrimary}`}>
                  {t('panelsFleetTitle')}
                </h2>
              </div>
              <button
                type="button"
                className={`btn btn-ghost btn-xs text-xs gap-1 border rounded-lg cursor-pointer ${
                  isDark
                    ? 'border-white/10 text-slate-300 hover:bg-white/10'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
                onClick={loadPanels}
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>{t('refresh')}</span>
              </button>
            </div>

            {loadingPanels && (
              <div className={`flex items-center justify-center p-8 gap-3 ${textSecondary}`}>
                <RotateCw className="w-5 h-5 animate-spin text-indigo-500" />
                <span className="text-sm">{t('panelsLoading')}</span>
              </div>
            )}

            {/* Fleet Status Summary Card */}
            {!loadingPanels && panels.length > 0 && (
              <div
                className={`rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border ${cardClass}`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center border shrink-0 ${
                      panels.every((p) => p.healthy !== false)
                        ? isDark
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : isDark
                          ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                          : 'bg-rose-50 text-rose-700 border-rose-200'
                    }`}
                  >
                    <Activity className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className={`text-sm font-bold m-0 ${textPrimary}`}>
                      {panels.every((p) => p.healthy !== false)
                        ? t('panelFleetStatusOk')
                        : t('panelFleetStatusWarning')}
                    </h3>
                    <p className={`text-xs m-0 mt-0.5 ${textSecondary}`}>
                      {locale === 'fa'
                        ? `${panels.filter((p) => p.healthy !== false).length} از ${panels.length} پنل فعال و پاسخگو`
                        : `${panels.filter((p) => p.healthy !== false).length} of ${panels.length} panels active`}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {!loadingPanels && panels.length === 0 && (
              <div className={`rounded-2xl p-8 text-center text-sm border ${cardClass}`}>
                {t('panelsEmpty')}
              </div>
            )}

            {/* Panels List */}
            {!loadingPanels && panels.length > 0 && (
              <div className="grid grid-cols-1 gap-4">
                {panels.map((p) => (
                  <div
                    key={p.id}
                    className={`rounded-2xl p-4 sm:p-5 space-y-4 border transition-all hover:border-indigo-500/40 ${cardClass}`}
                  >
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-3 h-3 rounded-full shrink-0 ${
                              p.healthy !== false ? 'bg-emerald-500 status-pulse' : 'bg-rose-500'
                            }`}
                          />
                          <h3 className={`text-base font-bold m-0 ${textPrimary}`}>{p.name}</h3>
                        </div>

                        {p.isDefault && (
                          <span className="badge badge-warning badge-sm text-[10px] font-medium">
                            {t('panelDefault')}
                          </span>
                        )}

                        <span
                          className={`badge badge-sm text-[10px] font-medium ${
                            p.healthy !== false
                              ? 'badge-success text-white'
                              : 'badge-error text-white'
                          }`}
                        >
                          {p.healthy !== false ? t('panelOnline') : t('panelOffline')}
                        </span>

                        {p.latencyMs !== undefined && (
                          <span
                            className={`badge badge-sm text-[10px] font-mono border ${
                              isDark
                                ? 'bg-white/[0.04] border-white/10 text-indigo-300'
                                : 'bg-indigo-50 border-indigo-200 text-indigo-700'
                            }`}
                          >
                            {t('panelLatency', { ms: p.latencyMs })}
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        className={`btn btn-ghost btn-sm text-xs gap-1.5 border rounded-xl cursor-pointer ${
                          isDark
                            ? 'border-white/10 hover:bg-white/10 text-slate-300'
                            : 'border-slate-200 hover:bg-slate-100 text-slate-700 shadow-2xs'
                        }`}
                        disabled={testingPanelId === p.id}
                        onClick={() => testPanelConnection(p.id)}
                      >
                        <RotateCw
                          className={`w-3.5 h-3.5 ${testingPanelId === p.id ? 'animate-spin text-indigo-500' : ''}`}
                        />
                        <span>
                          {testingPanelId === p.id ? t('panelTesting') : t('panelTestBtn')}
                        </span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      {p.baseUrl && (
                        <div className={`p-2.5 rounded-xl border space-y-1 ${subCardClass}`}>
                          <span className={`block ${textMuted}`}>{t('panelAddress')}</span>
                          <code className="break-all font-mono text-[11px] text-indigo-500">
                            {p.baseUrl}
                          </code>
                        </div>
                      )}

                      <div className={`p-2.5 rounded-xl border space-y-1 ${subCardClass}`}>
                        <span className={`block ${textMuted}`}>{t('panelAuthMode')}</span>
                        <div className="flex items-center gap-1.5 font-mono">
                          <KeyRound className="w-3.5 h-3.5 text-indigo-500" />
                          <span className={textPrimary}>{p.credentialMode}</span>
                          <span className={textMuted}>·</span>
                          <span
                            className={
                              isDark
                                ? 'text-emerald-400 font-semibold'
                                : 'text-emerald-600 font-semibold'
                            }
                          >
                            {t('panelConfigsCount', {
                              count: (p.activeConfigsCount ?? 0).toLocaleString(numLocale),
                            })}
                          </span>
                        </div>
                      </div>
                    </div>

                    {p.services.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <span className={`text-xs font-medium block ${textSecondary}`}>
                          {t('panelConnectedServices')}
                        </span>
                        <div className="flex gap-2 flex-wrap">
                          {p.services.map((s) => (
                            <span
                              key={s.serviceId}
                              className={`text-xs py-1 px-2.5 rounded-lg border font-mono ${
                                isDark
                                  ? 'bg-white/[0.03] border-white/10 text-zinc-300'
                                  : 'bg-slate-100 border-slate-200 text-slate-700'
                              }`}
                            >
                              <span className="font-sans">{s.name}</span> (ID: {s.serviceId}){' '}
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

        {/* ===================== TAB 5: MODULES (COMING SOON) ===================== */}
        {activeTab === 'coming-soon' && (
          <div className="space-y-4">
            <div>
              <h2 className={`text-base font-bold m-0 ${textPrimary}`}>{t('modulesTitle')}</h2>
              <p className={`text-xs m-0 mt-1 ${textSecondary}`}>{t('modulesDesc')}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                {
                  icon: Radio,
                  title: t('modBroadcast'),
                  desc: t('modBroadcastSub'),
                },
                {
                  icon: Package,
                  title: t('modPlans'),
                  desc: t('modPlansSub'),
                },
                {
                  icon: Ticket,
                  title: t('modPromo'),
                  desc: t('modPromoSub'),
                },
                {
                  icon: CreditCard,
                  title: t('modGateways'),
                  desc: t('modGatewaysSub'),
                },
                {
                  icon: HardDrive,
                  title: t('modBackups'),
                  desc: t('modBackupsSub'),
                },
                {
                  icon: Sparkles,
                  title: t('modWheel'),
                  desc: t('modWheelSub'),
                },
              ].map((mod, i) => {
                const Icon = mod.icon;
                return (
                  <div
                    key={i}
                    className={`rounded-2xl p-4 space-y-2 border-dashed border transition-all relative overflow-hidden ${
                      isDark
                        ? 'bg-white/[0.02] border-white/15'
                        : 'bg-white border-slate-300 shadow-2xs'
                    }`}
                  >
                    <span className="badge badge-warning badge-sm text-[10px] absolute top-3 left-3 rtl:left-auto rtl:right-3 font-medium">
                      {t('tagComingSoon')}
                    </span>
                    <div
                      className={`w-10 h-10 rounded-xl border flex items-center justify-center ${
                        isDark
                          ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                          : 'bg-indigo-50 border-indigo-200 text-indigo-700'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <h3 className={`text-sm font-bold m-0 ${textPrimary}`}>{mod.title}</h3>
                    <p className={`text-xs m-0 ${textSecondary}`}>{mod.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* ===================== MOBILE BOTTOM NAVIGATION BAR ===================== */}
      <nav
        aria-label="Mobile Navigation"
        className={`md:hidden fixed bottom-0 inset-x-0 z-40 backdrop-blur-2xl border-t px-1.5 pt-1.5 pb-[max(env(safe-area-inset-bottom,0px),0.5rem)] transition-colors ${
          isDark
            ? 'bg-[#090a0f]/95 border-white/[0.08] shadow-[0_-8px_30px_rgba(0,0,0,0.6)]'
            : 'bg-white/95 border-slate-200/90 shadow-[0_-8px_30px_rgba(0,0,0,0.08)]'
        }`}
      >
        <div className="grid grid-cols-5 gap-0.5 max-w-md mx-auto items-center">
          {[
            { id: 'overview' as const, label: t('tabOverview'), icon: LayoutDashboard },
            {
              id: 'receipts' as const,
              label: t('tabReceipts'),
              icon: Receipt,
              count: receipts.length,
            },
            { id: 'users' as const, label: t('tabUsers'), icon: Users },
            { id: 'panels' as const, label: t('tabPanels'), icon: Server },
            { id: 'coming-soon' as const, label: t('tabComingSoon'), icon: Layers },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  triggerHaptic('selection');
                  switchTab(tab.id);
                }}
                className={`flex flex-col items-center justify-center py-1 px-0.5 rounded-xl transition-all duration-150 relative min-w-0 select-none cursor-pointer ${
                  isActive
                    ? isDark
                      ? 'text-indigo-400 font-bold'
                      : 'text-indigo-600 font-bold'
                    : isDark
                      ? 'text-zinc-400 hover:text-zinc-200 active:scale-95'
                      : 'text-slate-500 hover:text-slate-800 active:scale-95'
                }`}
              >
                <div
                  className={`p-1.5 rounded-xl transition-all relative ${
                    isActive
                      ? isDark
                        ? 'bg-white/[0.06]'
                        : 'bg-indigo-50'
                      : 'hover:bg-black/5 dark:hover:bg-white/5'
                  }`}
                >
                  <Icon
                    className={`w-5 h-5 ${
                      isActive
                        ? isDark
                          ? 'text-indigo-400'
                          : 'text-indigo-600'
                        : isDark
                          ? 'text-zinc-400'
                          : 'text-slate-500'
                    }`}
                  />
                  {tab.count !== undefined && tab.count > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-slate-950 font-black text-[9px] flex items-center justify-center shadow-xs">
                      {tab.count}
                    </span>
                  )}
                </div>
                <span
                  className={`text-[10px] leading-tight mt-1 truncate max-w-full text-center tracking-tight ${
                    isActive
                      ? isDark
                        ? 'text-indigo-300 font-bold'
                        : 'text-indigo-600 font-bold'
                      : isDark
                        ? 'text-zinc-400 font-medium'
                        : 'text-slate-500 font-medium'
                  }`}
                >
                  {tab.label}
                </span>
                {isActive && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full mt-0.5 shadow-xs ${
                      isDark
                        ? 'bg-indigo-400 shadow-indigo-400/50'
                        : 'bg-indigo-600 shadow-indigo-600/30'
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* ===================== MODAL 1: RECEIPT PHOTO LIGHTBOX ===================== */}
      {photoModalUrl && (
        <div className="modal modal-open">
          <div className={`modal-box max-w-lg p-4 rounded-2xl border ${modalBoxClass}`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className={`font-bold text-sm flex items-center gap-2 ${textPrimary}`}>
                <ImageIcon className="w-4 h-4 text-indigo-500" />
                <span>{photoModalTitle}</span>
              </h3>
              <button
                type="button"
                className={`btn btn-ghost btn-circle btn-xs cursor-pointer ${textMuted} hover:text-white`}
                onClick={() => setPhotoModalUrl(null)}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div
              className={`rounded-xl overflow-hidden border flex items-center justify-center min-h-[260px] max-h-[70vh] ${
                isDark ? 'bg-black/50 border-white/10' : 'bg-slate-100 border-slate-200'
              }`}
            >
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
                type="button"
                className={`btn btn-ghost btn-sm text-xs border rounded-xl cursor-pointer ${
                  isDark ? 'border-white/10 text-slate-300' : 'border-slate-200 text-slate-700'
                }`}
                onClick={() => setPhotoModalUrl(null)}
              >
                {t('close')}
              </button>
            </div>
          </div>
          <div
            className="modal-backdrop bg-black/60 backdrop-blur-xs"
            onClick={() => setPhotoModalUrl(null)}
          />
        </div>
      )}

      {/* ===================== MODAL 2: APPROVE RECEIPT CONFIRMATION ===================== */}
      {receiptApproveTarget && (
        <div className="modal modal-open">
          <div className={`modal-box max-w-sm p-5 space-y-4 rounded-2xl border ${modalBoxClass}`}>
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${
                  isDark
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-600'
                }`}
              >
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <h3 className={`font-bold text-base m-0 ${textPrimary}`}>
                {t('receiptApproveConfirmTitle')}
              </h3>
            </div>

            <p className={`text-xs leading-relaxed m-0 ${textSecondary}`}>
              {t('receiptApproveConfirmBody', {
                amount: `${formatMoney(receiptApproveTarget.amount)} ${t('currency')}`,
              })}
            </p>

            <div className={`p-3 rounded-xl border text-xs space-y-1 font-mono ${subCardClass}`}>
              <div className="flex justify-between">
                <span className={`font-sans ${textMuted}`}>
                  {locale === 'fa' ? 'شناسه کاربر:' : 'User ID:'}
                </span>
                <span dir="ltr" className={textPrimary}>
                  {receiptApproveTarget.telegramId}
                </span>
              </div>
              <div className="flex justify-between">
                <span className={`font-sans ${textMuted}`}>
                  {locale === 'fa' ? 'کد رسید:' : 'Receipt ID:'}
                </span>
                <span dir="ltr" className={textPrimary}>
                  {receiptApproveTarget.id}
                </span>
              </div>
            </div>

            <div className="modal-action mt-4 flex gap-2">
              <button
                type="button"
                className={`btn btn-ghost btn-sm flex-1 text-xs border rounded-xl cursor-pointer ${
                  isDark ? 'border-white/10 text-slate-300' : 'border-slate-200 text-slate-700'
                }`}
                onClick={() => setReceiptApproveTarget(null)}
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                className="btn btn-success btn-sm flex-1 text-xs text-white shadow-sm rounded-xl cursor-pointer"
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
            className="modal-backdrop bg-black/60 backdrop-blur-xs"
            onClick={() => setReceiptApproveTarget(null)}
          />
        </div>
      )}

      {/* ===================== MODAL 3: REJECT RECEIPT MODAL ===================== */}
      {receiptActionTarget && (
        <div className="modal modal-open">
          <div className={`modal-box max-w-md p-5 space-y-4 rounded-2xl border ${modalBoxClass}`}>
            <div className="flex items-center justify-between">
              <h3 className={`font-bold text-base flex items-center gap-2 ${textPrimary}`}>
                <XCircle className="w-5 h-5 text-rose-500" />
                <span>{t('modalRejectTitle')}</span>
              </h3>
              <button
                type="button"
                className={`btn btn-ghost btn-circle btn-xs cursor-pointer ${textMuted} hover:text-white`}
                onClick={() => setReceiptActionTarget(null)}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className={`text-xs m-0 ${textSecondary}`}>
              {t('modalRejectConfirm', {
                id: receiptActionTarget.id,
                userId: receiptActionTarget.telegramId,
              })}
            </p>

            {/* Presets Chips */}
            <div className="space-y-1.5">
              <label className={`text-xs font-medium block ${textPrimary}`}>
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
                    className={`badge badge-sm py-2 px-2.5 text-[11px] cursor-pointer transition-all border ${
                      selectedReasonPreset === preset.key
                        ? 'badge-error text-white font-medium'
                        : isDark
                          ? 'bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-white/10'
                          : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
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
              className={`textarea textarea-bordered w-full text-xs rounded-xl ${inputClass}`}
              rows={2}
              placeholder={t('modalRejectReasonPlaceholder')}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
            />

            <div className="modal-action mt-4 flex gap-2">
              <button
                type="button"
                className={`btn btn-ghost btn-sm flex-1 text-xs border rounded-xl cursor-pointer ${
                  isDark ? 'border-white/10 text-slate-300' : 'border-slate-200 text-slate-700'
                }`}
                onClick={() => setReceiptActionTarget(null)}
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                className="btn btn-error btn-sm flex-1 text-xs text-white shadow-sm rounded-xl cursor-pointer"
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
            className="modal-backdrop bg-black/60 backdrop-blur-xs"
            onClick={() => setReceiptActionTarget(null)}
          />
        </div>
      )}

      {/* ===================== MODAL 4: USER DOSSIER & DETAILS ===================== */}
      {selectedUserSummary && (
        <div className="modal modal-open">
          <div
            className={`modal-box max-w-2xl p-5 space-y-4 max-h-[82dvh] overflow-y-auto rounded-2xl border ${modalBoxClass}`}
          >
            <div
              className={`flex items-center justify-between pb-3 border-b ${
                isDark ? 'border-white/10' : 'border-slate-200'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white font-bold text-base shadow-sm shrink-0">
                  {getAvatarChar(
                    selectedUserSummary.user.firstName,
                    selectedUserSummary.user.username
                  )}
                </div>
                <div>
                  <h3 className={`text-base font-bold m-0 ${textPrimary}`}>
                    {[selectedUserSummary.user.firstName, selectedUserSummary.user.lastName]
                      .filter(Boolean)
                      .join(' ') || (locale === 'fa' ? 'کاربر سیستم' : 'System User')}
                  </h3>
                  <div className={`flex items-center gap-2 text-xs mt-0.5 ${textSecondary}`}>
                    <span className="text-indigo-500 font-mono">
                      {selectedUserSummary.user.username ? (
                        <span dir="ltr" className="inline-block unicode-isolate">
                          @{selectedUserSummary.user.username}
                        </span>
                      ) : (
                        t('noUsername')
                      )}
                    </span>
                    <span>·</span>
                    <button
                      type="button"
                      className="font-mono hover:text-indigo-400 flex items-center gap-1 cursor-pointer"
                      onClick={() =>
                        copyToClipboard(String(selectedUserSummary.user.telegramId), 'dossier-id')
                      }
                    >
                      <span dir="ltr">{selectedUserSummary.user.telegramId}</span>
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>

              <button
                type="button"
                className={`btn btn-ghost btn-circle btn-xs cursor-pointer ${textMuted} hover:text-white`}
                onClick={() => setSelectedUserSummary(null)}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Dossier Tabs */}
            <div
              className={`flex gap-2 pb-2 border-b ${
                isDark ? 'border-white/5' : 'border-slate-200'
              }`}
            >
              <button
                type="button"
                className={`btn btn-xs rounded-lg cursor-pointer ${
                  userDossierTab === 'finances'
                    ? 'btn-primary text-white'
                    : isDark
                      ? 'btn-ghost text-slate-400'
                      : 'btn-ghost text-slate-600'
                }`}
                onClick={() => setUserDossierTab('finances')}
              >
                {t('userTabFinances')}
              </button>
              <button
                type="button"
                className={`btn btn-xs rounded-lg cursor-pointer ${
                  userDossierTab === 'orders'
                    ? 'btn-primary text-white'
                    : isDark
                      ? 'btn-ghost text-slate-400'
                      : 'btn-ghost text-slate-600'
                }`}
                onClick={() => setUserDossierTab('orders')}
              >
                {t('userTabOrders')} ({userOrders.length})
              </button>
              <button
                type="button"
                className={`btn btn-xs rounded-lg cursor-pointer ${
                  userDossierTab === 'receipts'
                    ? 'btn-primary text-white'
                    : isDark
                      ? 'btn-ghost text-slate-400'
                      : 'btn-ghost text-slate-600'
                }`}
                onClick={() => setUserDossierTab('receipts')}
              >
                {t('userTabReceipts')} ({userReceipts.length})
              </button>
            </div>

            {/* Sub-tab 1: Finances Grid */}
            {userDossierTab === 'finances' && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <div className={`p-3 rounded-xl border ${subCardClass}`}>
                  <span className={`text-[11px] block ${textMuted}`}>{t('userCurBalance')}</span>
                  <div
                    className={`text-sm sm:text-base font-bold font-mono mt-1 ${
                      isDark ? 'text-emerald-400' : 'text-emerald-600'
                    }`}
                  >
                    {formatMoney(selectedUserSummary.user.balance)} {t('currency')}
                  </div>
                </div>

                <div className={`p-3 rounded-xl border ${subCardClass}`}>
                  <span className={`text-[11px] block ${textMuted}`}>{t('userTotalDeposit')}</span>
                  <div className={`text-sm sm:text-base font-bold font-mono mt-1 ${textPrimary}`}>
                    {formatMoney(selectedUserSummary.totalDeposit)} {t('currency')}
                  </div>
                </div>

                <div className={`p-3 rounded-xl border ${subCardClass}`}>
                  <span className={`text-[11px] block ${textMuted}`}>{t('userTotalSpend')}</span>
                  <div className={`text-sm sm:text-base font-bold font-mono mt-1 ${textPrimary}`}>
                    {formatMoney(selectedUserSummary.totalSpend)} {t('currency')}
                  </div>
                </div>

                <div className={`p-3 rounded-xl border ${subCardClass}`}>
                  <span className={`text-[11px] block ${textMuted}`}>{t('userActiveConfigs')}</span>
                  <div className="text-sm sm:text-base font-bold text-indigo-500 font-mono mt-1">
                    {selectedUserSummary.activeConfigsCount.toLocaleString(numLocale)}
                  </div>
                </div>

                <div className={`p-3 rounded-xl border ${subCardClass}`}>
                  <span className={`text-[11px] block ${textMuted}`}>
                    {t('userApprovedReceipts')}
                  </span>
                  <div
                    className={`text-sm sm:text-base font-bold font-mono mt-1 ${
                      isDark ? 'text-emerald-400' : 'text-emerald-600'
                    }`}
                  >
                    {selectedUserSummary.receiptsApprovedCount.toLocaleString(numLocale)}
                  </div>
                </div>

                <div className={`p-3 rounded-xl border ${subCardClass}`}>
                  <span className={`text-[11px] block ${textMuted}`}>{t('userAuditEvents')}</span>
                  <div className={`text-sm sm:text-base font-bold font-mono mt-1 ${textSecondary}`}>
                    {selectedUserSummary.auditEventsCount.toLocaleString(numLocale)}
                  </div>
                </div>
              </div>
            )}

            {/* Sub-tab 2: Orders List */}
            {userDossierTab === 'orders' && (
              <div className="space-y-2">
                {userOrders.length === 0 ? (
                  <p className={`text-xs text-center py-4 ${textMuted}`}>{t('noOrders')}</p>
                ) : (
                  userOrders.map((order) => (
                    <div
                      key={order.id}
                      className={`p-3 rounded-xl border flex items-center justify-between text-xs ${subCardClass}`}
                    >
                      <div>
                        <div className={`font-semibold ${textPrimary}`}>
                          {order.packageName || (locale === 'fa' ? 'سرویس اشتراک' : 'Subscription')}
                        </div>
                        <div className={`text-[11px] font-mono ${textMuted}`}>ID: {order.id}</div>
                      </div>
                      <div className="text-right rtl:text-left">
                        <div
                          className={`font-mono font-bold ${
                            isDark ? 'text-emerald-400' : 'text-emerald-600'
                          }`}
                        >
                          {formatMoney(order.amount)} {t('currency')}
                        </div>
                        <div className={`text-[10px] ${textMuted}`}>
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
                  <p className={`text-xs text-center py-4 ${textMuted}`}>{t('noReceipts')}</p>
                ) : (
                  userReceipts.map((rec) => (
                    <div
                      key={rec.id}
                      className={`p-3 rounded-xl border flex items-center justify-between text-xs ${subCardClass}`}
                    >
                      <div>
                        <div className={`font-semibold font-mono ${textPrimary}`}>
                          {formatMoney(rec.amount)} {t('currency')}
                        </div>
                        <div className={`text-[11px] font-mono ${textMuted}`}>ID: {rec.id}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`badge badge-xs text-[10px] font-medium ${
                            rec.status === 'approved'
                              ? 'badge-success text-white'
                              : rec.status === 'rejected'
                                ? 'badge-error text-white'
                                : 'badge-warning'
                          }`}
                        >
                          {rec.status}
                        </span>
                        <span className={`text-[10px] ${textMuted}`}>
                          {new Date(rec.createdAt).toLocaleDateString(numLocale)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Action Bar */}
            <div
              className={`modal-action flex justify-between items-center pt-2 border-t ${
                isDark ? 'border-white/10' : 'border-slate-200'
              }`}
            >
              <button
                type="button"
                className="btn btn-primary btn-sm gap-1.5 text-xs text-white rounded-xl cursor-pointer"
                onClick={() => {
                  setBalanceModalUser(selectedUserSummary.user);
                }}
              >
                <Wallet className="w-3.5 h-3.5" />
                <span>{t('btnChangeBalance')}</span>
              </button>

              <button
                type="button"
                className={`btn btn-ghost btn-sm text-xs border rounded-xl cursor-pointer ${
                  isDark ? 'border-white/10 text-slate-300' : 'border-slate-200 text-slate-700'
                }`}
                onClick={() => setSelectedUserSummary(null)}
              >
                {t('btnCloseReport')}
              </button>
            </div>
          </div>
          <div
            className="modal-backdrop bg-black/60 backdrop-blur-xs"
            onClick={() => setSelectedUserSummary(null)}
          />
        </div>
      )}

      {/* ===================== MODAL 5: BALANCE ADJUSTMENT ===================== */}
      {balanceModalUser && (
        <div className="modal modal-open">
          <div className={`modal-box max-w-md p-5 space-y-4 rounded-2xl border ${modalBoxClass}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${
                    isDark
                      ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-400'
                      : 'bg-indigo-50 border-indigo-200 text-indigo-700'
                  }`}
                >
                  <Wallet className="w-5 h-5" />
                </div>
                <h3 className={`font-bold text-base m-0 ${textPrimary}`}>
                  {t('modalBalanceTitle')}
                </h3>
              </div>
              <button
                type="button"
                className={`btn btn-ghost btn-circle btn-xs cursor-pointer ${textMuted} hover:text-white`}
                onClick={() => setBalanceModalUser(null)}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAdjustBalance} className="space-y-4">
              {/* User Balance Info Card */}
              <div
                className={`p-3 rounded-xl border flex items-center justify-between text-xs ${subCardClass}`}
              >
                <span className={textSecondary}>{t('balanceCurLabel')}</span>
                <span className={`font-bold font-mono text-sm ${textPrimary}`}>
                  {formatMoney(balanceModalUser.balance)} {t('currency')}
                </span>
              </div>

              {/* Segmented Operation Selector */}
              <div
                className={`grid grid-cols-3 gap-1 p-1 rounded-xl border text-xs ${
                  isDark ? 'bg-white/[0.03] border-white/10' : 'bg-slate-100 border-slate-200'
                }`}
              >
                <button
                  type="button"
                  className={`btn btn-xs h-8 border-none rounded-lg cursor-pointer ${
                    balanceOperation === 'add'
                      ? 'bg-emerald-600 text-white font-bold shadow-xs'
                      : isDark
                        ? 'btn-ghost text-slate-300'
                        : 'btn-ghost text-slate-700'
                  }`}
                  onClick={() => setBalanceOperation('add')}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t('modalBalanceOpAdd')}</span>
                </button>

                <button
                  type="button"
                  className={`btn btn-xs h-8 border-none rounded-lg cursor-pointer ${
                    balanceOperation === 'deduct'
                      ? 'bg-rose-600 text-white font-bold shadow-xs'
                      : isDark
                        ? 'btn-ghost text-slate-300'
                        : 'btn-ghost text-slate-700'
                  }`}
                  onClick={() => setBalanceOperation('deduct')}
                >
                  <Minus className="w-3.5 h-3.5" />
                  <span>{t('modalBalanceOpDeduct')}</span>
                </button>

                <button
                  type="button"
                  className={`btn btn-xs h-8 border-none rounded-lg cursor-pointer ${
                    balanceOperation === 'set'
                      ? 'bg-indigo-600 text-white font-bold shadow-xs'
                      : isDark
                        ? 'btn-ghost text-slate-300'
                        : 'btn-ghost text-slate-700'
                  }`}
                  onClick={() => setBalanceOperation('set')}
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  <span>{t('modalBalanceOpSet')}</span>
                </button>
              </div>

              {/* Amount Input */}
              <div className="space-y-1.5">
                <label className={`text-xs font-medium block ${textPrimary}`}>
                  {t('modalBalanceAmountLabel')}
                </label>
                <input
                  type="number"
                  min="0"
                  required
                  className={`input input-bordered w-full text-sm font-mono rounded-xl ${inputClass}`}
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
                      className={`badge badge-sm py-1.5 px-2 text-[10px] font-mono cursor-pointer transition-all border ${
                        isDark
                          ? 'bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-indigo-600 hover:text-white'
                          : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-indigo-600 hover:text-white'
                      }`}
                      onClick={() => setBalanceAmount(String(quickAmt))}
                    >
                      +{(quickAmt / 1000).toLocaleString(numLocale)}k
                    </button>
                  ))}
                </div>
              </div>

              {/* Calculated Balance Preview */}
              {balanceAmount && (
                <div
                  className={`p-2.5 rounded-xl border flex items-center justify-between text-xs ${
                    isDark
                      ? 'bg-indigo-500/10 border-indigo-500/20'
                      : 'bg-indigo-50 border-indigo-200'
                  }`}
                >
                  <span className={isDark ? 'text-indigo-300' : 'text-indigo-800'}>
                    {t('balancePreviewLabel')}
                  </span>
                  <span className={`font-bold font-mono text-sm ${textPrimary}`}>
                    {formatMoney(previewNewBalance)} {t('currency')}
                  </span>
                </div>
              )}

              {/* Reason Input & Quick Chips */}
              <div className="space-y-1.5">
                <label className={`text-xs font-medium block ${textPrimary}`}>
                  {t('modalBalanceReasonLabel')}
                </label>
                <input
                  type="text"
                  required
                  className={`input input-bordered w-full text-xs rounded-xl ${inputClass}`}
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
                      className={`badge badge-sm py-1.5 px-2 text-[10px] cursor-pointer transition-all border ${
                        isDark
                          ? 'bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-white/10'
                          : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                      }`}
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
                  className={`btn btn-ghost btn-sm flex-1 text-xs border rounded-xl cursor-pointer ${
                    isDark ? 'border-white/10 text-slate-300' : 'border-slate-200 text-slate-700'
                  }`}
                  onClick={() => setBalanceModalUser(null)}
                >
                  {t('cancel')}
                </button>

                <button
                  type="submit"
                  className="btn btn-primary btn-sm flex-1 text-xs text-white shadow-sm rounded-xl cursor-pointer"
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
          <div
            className="modal-backdrop bg-black/60 backdrop-blur-xs"
            onClick={() => setBalanceModalUser(null)}
          />
        </div>
      )}
    </div>
  );
};
