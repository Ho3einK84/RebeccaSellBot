import React, { useState, useEffect } from 'react';
import type { TelegramWebAppUser } from '../types/telegram.js';
import { useLanguage } from '../i18n/LanguageContext.js';

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
  const [rejectionReason, setRejectionReason] = useState('');
  const [processingAction, setProcessingAction] = useState(false);

  // Users data
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUserSummary, setSelectedUserSummary] = useState<UserReportSummary | null>(null);
  const [inspectingUser, setInspectingUser] = useState(false);

  // Balance adjustment modal
  const [balanceModalUser, setBalanceModalUser] = useState<UserProfile | null>(null);
  const [balanceOperation, setBalanceOperation] = useState<'add' | 'deduct' | 'set'>('add');
  const [balanceAmount, setBalanceAmount] = useState<string>('');
  const [balanceReason, setBalanceReason] = useState<string>('');
  const [processingBalance, setProcessingBalance] = useState(false);

  // Panels data
  const [panels, setPanels] = useState<PanelSummary[]>([]);
  const [loadingPanels, setLoadingPanels] = useState(false);

  // General error / notification
  const [notification, setNotification] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);

  const notify = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

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

  const loadReceipts = async () => {
    setLoadingReceipts(true);
    try {
      const res = await fetch('/api/admin/receipts?limit=20');
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
        setRejectionReason('');
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

  const loadUsers = async (query = '') => {
    setLoadingUsers(true);
    try {
      const url = query.trim()
        ? `/api/admin/users?search=${encodeURIComponent(query.trim())}`
        : '/api/admin/users?limit=15';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setUsersList(data.users || []);
      }
    } catch {
      notify(t('notifyUsersError'), 'error');
    } finally {
      setLoadingUsers(false);
    }
  };

  const inspectUser = async (telegramId: number) => {
    setInspectingUser(true);
    try {
      const res = await fetch(`/api/admin/users/${telegramId}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedUserSummary(data.summary);
      } else {
        notify(t('notifyUserReportError'), 'error');
      }
    } catch {
      notify(t('notifyNetworkError'), 'error');
    } finally {
      setInspectingUser(false);
    }
  };

  const handleAdjustBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!balanceModalUser) return;

    const numAmount = parseInt(balanceAmount, 10);
    if (isNaN(numAmount) || numAmount < 0) {
      notify('Invalid amount', 'error');
      return;
    }
    if (!balanceReason.trim()) {
      notify('Reason is required', 'error');
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
        loadUsers(searchQuery);
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

  useEffect(() => {
    if (activeTab === 'overview') loadStats();
    if (activeTab === 'receipts') loadReceipts();
    if (activeTab === 'users') loadUsers();
    if (activeTab === 'panels') loadPanels();
  }, [activeTab]);

  return (
    <div className="admin-container">
      {/* Header */}
      <header className="glass-panel admin-header">
        <div className="admin-title-group">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0 }}>{t('adminTitle')}</h1>
            <span className="badge badge-warning" style={{ fontSize: '11px' }}>
              {t('betaBadge')}
            </span>
          </div>
          <p>{t('adminWelcome', { name: user.first_name, id: user.id })}</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {languageSelectionEnabled && (
            <button
              className="lang-toggle-btn"
              onClick={async () => {
                const next = locale === 'fa' ? 'en' : 'fa';
                const ok = await setLocale(next);
                if (ok) {
                  notify(t('langChangeSuccess'));
                }
              }}
            >
              🌐 {t('switchLang')}
            </button>
          )}
          <button
            className="btn-secondary"
            onClick={() => {
              if (activeTab === 'overview') loadStats();
              if (activeTab === 'receipts') loadReceipts();
              if (activeTab === 'users') loadUsers(searchQuery);
              if (activeTab === 'panels') loadPanels();
            }}
          >
            {t('refresh')}
          </button>
        </div>
      </header>

      {/* Notifications */}
      {notification && (
        <div
          style={{
            padding: '12px 16px',
            marginBottom: '16px',
            borderRadius: '12px',
            background:
              notification.type === 'success'
                ? 'rgba(16, 185, 129, 0.2)'
                : 'rgba(239, 68, 68, 0.2)',
            border: `1px solid ${notification.type === 'success' ? '#10b981' : '#ef4444'}`,
            color: '#fff',
            fontSize: '14px',
            fontWeight: 500,
          }}
        >
          {notification.message}
        </div>
      )}

      {/* Navigation Tabs */}
      <nav className="nav-tabs">
        <button
          className={`nav-tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          {t('tabOverview')}
        </button>
        <button
          className={`nav-tab ${activeTab === 'receipts' ? 'active' : ''}`}
          onClick={() => setActiveTab('receipts')}
        >
          {t('tabReceipts')} {receipts.length > 0 ? `(${receipts.length})` : ''}
        </button>
        <button
          className={`nav-tab ${activeTab === 'users' ? 'active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          {t('tabUsers')}
        </button>
        <button
          className={`nav-tab ${activeTab === 'panels' ? 'active' : ''}`}
          onClick={() => setActiveTab('panels')}
        >
          {t('tabPanels')}
        </button>
        <button
          className={`nav-tab ${activeTab === 'coming-soon' ? 'active' : ''}`}
          onClick={() => setActiveTab('coming-soon')}
        >
          {t('tabComingSoon')}
        </button>
      </nav>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div>
          {loadingStats && <p style={{ color: '#94a3b8' }}>{t('statsLoading')}</p>}
          {stats && (
            <div className="stats-grid">
              <div className="glass-panel stat-card">
                <span className="stat-label">{t('statPendingReceipts')}</span>
                <span className="stat-value">
                  {stats.pendingReceipts.toLocaleString(numLocale)}
                </span>
                <span className="stat-sub">{t('statPendingReceiptsSub')}</span>
              </div>
              <div className="glass-panel stat-card">
                <span className="stat-label">{t('statTotalUsers')}</span>
                <span className="stat-value">{stats.totalUsers.toLocaleString(numLocale)}</span>
                <span className="stat-sub">{t('statTotalUsersSub')}</span>
              </div>
              <div className="glass-panel stat-card">
                <span className="stat-label">{t('statTotalSales')}</span>
                <span className="stat-value">
                  {stats.totalSales.toLocaleString(numLocale)} {t('currency')}
                </span>
                <span className="stat-sub">{t('statTotalSalesSub')}</span>
              </div>
              <div className="glass-panel stat-card">
                <span className="stat-label">{t('statDailyRevenue')}</span>
                <span className="stat-value">
                  {stats.dailyRevenue.toLocaleString(numLocale)} {t('currency')}
                </span>
                <span className="stat-sub">{t('statDailyRevenueSub')}</span>
              </div>
              <div className="glass-panel stat-card">
                <span className="stat-label">{t('statWeeklyRevenue')}</span>
                <span className="stat-value">
                  {stats.weeklyRevenue.toLocaleString(numLocale)} {t('currency')}
                </span>
                <span className="stat-sub">{t('statWeeklyRevenueSub')}</span>
              </div>
              <div className="glass-panel stat-card">
                <span className="stat-label">{t('statMonthlyRevenue')}</span>
                <span className="stat-value">
                  {stats.monthlyRevenue.toLocaleString(numLocale)} {t('currency')}
                </span>
                <span className="stat-sub">{t('statMonthlyRevenueSub')}</span>
              </div>
              <div className="glass-panel stat-card">
                <span className="stat-label">{t('statActiveSubs')}</span>
                <span className="stat-value">
                  {stats.activeSubscriptions.toLocaleString(numLocale)}
                </span>
                <span className="stat-sub">{t('statActiveSubsSub')}</span>
              </div>
              <div className="glass-panel stat-card">
                <span className="stat-label">{t('statInactiveSubs')}</span>
                <span className="stat-value">
                  {stats.inactiveSubscriptions.toLocaleString(numLocale)}
                </span>
                <span className="stat-sub">{t('statInactiveSubsSub')}</span>
              </div>
              <div className="glass-panel stat-card">
                <span className="stat-label">{t('statReferralBonus')}</span>
                <span className="stat-value">
                  {stats.totalReferralBonus.toLocaleString(numLocale)} {t('currency')}
                </span>
                <span className="stat-sub">{t('statReferralBonusSub')}</span>
              </div>
              <div className="glass-panel stat-card">
                <span className="stat-label">{t('statCashback')}</span>
                <span className="stat-value">
                  {stats.totalCashback.toLocaleString(numLocale)} {t('currency')}
                </span>
                <span className="stat-sub">{t('statCashbackSub')}</span>
              </div>
              {panelHealth && (
                <div className="glass-panel stat-card">
                  <span className="stat-label">{t('panelHealthTitle')}</span>
                  <span className="stat-value">
                    {panelHealth.healthy === panelHealth.configured
                      ? t('panelHealthOk')
                      : t('panelHealthError')}
                  </span>
                  <span className="stat-sub">
                    {t('panelHealthSub', {
                      healthy: panelHealth.healthy,
                      configured: panelHealth.configured,
                    })}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'receipts' && (
        <div className="glass-panel" style={{ padding: '20px' }}>
          <h2 style={{ fontSize: '18px', margin: '0 0 16px' }}>{t('receiptsQueueTitle')}</h2>
          {loadingReceipts && <p style={{ color: '#94a3b8' }}>{t('receiptsLoading')}</p>}
          {!loadingReceipts && receipts.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px', color: '#94a3b8' }}>
              {t('receiptsEmpty')}
            </div>
          )}
          {!loadingReceipts && receipts.length > 0 && (
            <div className="cards-list">
              {receipts.map((rec) => (
                <div key={rec.id} className="glass-panel item-card">
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '4px' }}>
                      {t('receiptAmount', { amount: rec.amount.toLocaleString(numLocale) })}
                    </div>
                    <div style={{ fontSize: '13px', color: '#94a3b8' }}>
                      {t('receiptUser', { id: rec.telegramId, recId: rec.id })}
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                      {t('receiptDate', {
                        date: new Date(rec.createdAt).toLocaleString(numLocale),
                      })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="btn-success"
                      disabled={processingAction}
                      onClick={() => handleReceiptAction(rec.id, 'approve')}
                    >
                      {t('receiptApprove')}
                    </button>
                    <button
                      className="btn-danger"
                      disabled={processingAction}
                      onClick={() => setReceiptActionTarget(rec)}
                    >
                      {t('receiptReject')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'users' && (
        <div className="glass-panel" style={{ padding: '20px' }}>
          <h2 style={{ fontSize: '18px', margin: '0 0 16px' }}>{t('usersTitle')}</h2>

          <div className="search-bar">
            <input
              type="text"
              className="search-input"
              placeholder={t('usersSearchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') loadUsers(searchQuery);
              }}
            />
            <button
              className="btn-primary"
              style={{ width: 'auto' }}
              onClick={() => loadUsers(searchQuery)}
            >
              {t('usersSearchBtn')}
            </button>
          </div>

          {loadingUsers && <p style={{ color: '#94a3b8' }}>{t('usersSearching')}</p>}

          {!loadingUsers && usersList.length === 0 && (
            <p style={{ color: '#94a3b8', textAlign: 'center', padding: '20px' }}>
              {t('usersNotFound')}
            </p>
          )}

          {!loadingUsers && usersList.length > 0 && (
            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('colId')}</th>
                    <th>{t('colUsername')}</th>
                    <th>{t('colName')}</th>
                    <th>{t('colBalance')}</th>
                    <th>{t('colActiveSubs')}</th>
                    <th>{t('colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {usersList.map((u) => (
                    <tr key={u.telegramId}>
                      <td>
                        <code>{u.telegramId}</code>
                      </td>
                      <td>{u.username ? `@${u.username}` : '—'}</td>
                      <td>{[u.firstName, u.lastName].filter(Boolean).join(' ') || '—'}</td>
                      <td style={{ fontWeight: 600 }}>
                        {u.balance.toLocaleString(numLocale)} {t('currency')}
                      </td>
                      <td>
                        <span
                          className={`badge ${u.activeSubscriptionCount > 0 ? 'badge-success' : 'badge-warning'}`}
                        >
                          {t('activeSubsCount', { count: u.activeSubscriptionCount })}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            className="btn-secondary"
                            onClick={() => inspectUser(u.telegramId)}
                          >
                            {t('btnDetails')}
                          </button>
                          <button
                            className="btn-primary"
                            style={{ width: 'auto', padding: '6px 12px', fontSize: '13px' }}
                            onClick={() => setBalanceModalUser(u)}
                          >
                            {t('btnChangeBalance')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* User Details Section */}
          {inspectingUser && (
            <p style={{ color: '#94a3b8', marginTop: '20px' }}>{t('inspectLoading')}</p>
          )}
          {selectedUserSummary && !inspectingUser && (
            <div
              className="glass-panel"
              style={{ marginTop: '24px', padding: '20px', background: 'rgba(15, 23, 42, 0.6)' }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '16px',
                }}
              >
                <h3 style={{ margin: 0, fontSize: '16px' }}>
                  {t('userDetailsTitle', {
                    id: selectedUserSummary.user.telegramId,
                    username: selectedUserSummary.user.username
                      ? `@${selectedUserSummary.user.username}`
                      : t('noUsername'),
                  })}
                </h3>
                <button className="btn-secondary" onClick={() => setSelectedUserSummary(null)}>
                  {t('btnCloseReport')}
                </button>
              </div>

              <div className="stats-grid" style={{ marginBottom: '16px' }}>
                <div className="glass-panel stat-card">
                  <span className="stat-label">{t('userCurBalance')}</span>
                  <span className="stat-value">
                    {selectedUserSummary.user.balance.toLocaleString(numLocale)} {t('currency')}
                  </span>
                </div>
                <div className="glass-panel stat-card">
                  <span className="stat-label">{t('userTotalDeposit')}</span>
                  <span className="stat-value">
                    {selectedUserSummary.totalDeposit.toLocaleString(numLocale)} {t('currency')}
                  </span>
                </div>
                <div className="glass-panel stat-card">
                  <span className="stat-label">{t('userTotalSpend')}</span>
                  <span className="stat-value">
                    {selectedUserSummary.totalSpend.toLocaleString(numLocale)} {t('currency')}
                  </span>
                </div>
                <div className="glass-panel stat-card">
                  <span className="stat-label">{t('userActiveConfigs')}</span>
                  <span className="stat-value">
                    {selectedUserSummary.activeConfigsCount.toLocaleString(numLocale)}
                  </span>
                </div>
                <div className="glass-panel stat-card">
                  <span className="stat-label">{t('userApprovedReceipts')}</span>
                  <span className="stat-value">
                    {selectedUserSummary.receiptsApprovedCount.toLocaleString(numLocale)}
                  </span>
                </div>
                <div className="glass-panel stat-card">
                  <span className="stat-label">{t('userAuditEvents')}</span>
                  <span className="stat-value">
                    {selectedUserSummary.auditEventsCount.toLocaleString(numLocale)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'panels' && (
        <div className="glass-panel" style={{ padding: '20px' }}>
          <h2 style={{ fontSize: '18px', margin: '0 0 16px' }}>{t('panelsFleetTitle')}</h2>
          {loadingPanels && <p style={{ color: '#94a3b8' }}>{t('panelsLoading')}</p>}
          {!loadingPanels && panels.length === 0 && (
            <p style={{ color: '#94a3b8', textAlign: 'center', padding: '20px' }}>
              {t('panelsEmpty')}
            </p>
          )}
          {!loadingPanels && (
            <div className="cards-list">
              {panels.map((p) => (
                <div
                  key={p.id}
                  className="glass-panel item-card"
                  style={{ flexDirection: 'column', alignItems: 'flex-start' }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      width: '100%',
                      alignItems: 'center',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '16px', fontWeight: 700 }}>{p.name}</span>
                      {p.isDefault && (
                        <span className="badge badge-success">{t('panelDefault')}</span>
                      )}
                      <span className={`badge ${p.enabled ? 'badge-success' : 'badge-danger'}`}>
                        {p.enabled ? t('panelActive') : t('panelInactive')}
                      </span>
                    </div>
                    <span style={{ fontSize: '13px', color: '#94a3b8' }}>
                      {t('panelAuthMode')} <code>{p.credentialMode}</code>
                    </span>
                  </div>
                  {p.baseUrl && (
                    <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '6px' }}>
                      {t('panelAddress')} <code>{p.baseUrl}</code>
                    </div>
                  )}
                  {p.services.length > 0 && (
                    <div style={{ marginTop: '10px', width: '100%' }}>
                      <span style={{ fontSize: '13px', color: '#64748b' }}>
                        {t('panelConnectedServices')}{' '}
                      </span>
                      <div
                        style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}
                      >
                        {p.services.map((s) => (
                          <span
                            key={s.serviceId}
                            className="badge"
                            style={{ background: 'rgba(255, 255, 255, 0.06)' }}
                          >
                            {s.name} (ID: {s.serviceId}){' '}
                            {s.isDefault ? t('panelDefaultService') : ''}
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

      {/* Tab 5: Placeholder modules from Section 7 */}
      {activeTab === 'coming-soon' && (
        <div>
          <h2 style={{ fontSize: '18px', margin: '0 0 8px' }}>{t('modulesTitle')}</h2>
          <p style={{ fontSize: '13px', color: '#94a3b8', margin: '0 0 16px' }}>
            {t('modulesDesc')}
          </p>

          <div className="placeholders-grid">
            <div className="glass-panel placeholder-card">
              <span className="placeholder-tag">{t('tagComingSoon')}</span>
              <span style={{ fontSize: '24px' }}>📢</span>
              <strong style={{ fontSize: '15px' }}>{t('modBroadcast')}</strong>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>{t('modBroadcastSub')}</span>
            </div>

            <div className="glass-panel placeholder-card">
              <span className="placeholder-tag">{t('tagComingSoon')}</span>
              <span style={{ fontSize: '24px' }}>📦</span>
              <strong style={{ fontSize: '15px' }}>{t('modPlans')}</strong>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>{t('modPlansSub')}</span>
            </div>

            <div className="glass-panel placeholder-card">
              <span className="placeholder-tag">{t('tagComingSoon')}</span>
              <span style={{ fontSize: '24px' }}>🎟️</span>
              <strong style={{ fontSize: '15px' }}>{t('modPromo')}</strong>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>{t('modPromoSub')}</span>
            </div>

            <div className="glass-panel placeholder-card">
              <span className="placeholder-tag">{t('tagComingSoon')}</span>
              <span style={{ fontSize: '24px' }}>💳</span>
              <strong style={{ fontSize: '15px' }}>{t('modGateways')}</strong>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>{t('modGatewaysSub')}</span>
            </div>

            <div className="glass-panel placeholder-card">
              <span className="placeholder-tag">{t('tagComingSoon')}</span>
              <span style={{ fontSize: '24px' }}>💾</span>
              <strong style={{ fontSize: '15px' }}>{t('modBackups')}</strong>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>{t('modBackupsSub')}</span>
            </div>

            <div className="glass-panel placeholder-card">
              <span className="placeholder-tag">{t('tagComingSoon')}</span>
              <span style={{ fontSize: '24px' }}>🎡</span>
              <strong style={{ fontSize: '15px' }}>{t('modWheel')}</strong>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>{t('modWheelSub')}</span>
            </div>

            <div className="glass-panel placeholder-card">
              <span className="placeholder-tag">{t('tagComingSoon')}</span>
              <span style={{ fontSize: '24px' }}>🎁</span>
              <strong style={{ fontSize: '15px' }}>{t('modTrial')}</strong>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>{t('modTrialSub')}</span>
            </div>
          </div>
        </div>
      )}

      {/* Reject Receipt Modal */}
      {receiptActionTarget && (
        <div className="modal-overlay">
          <div className="glass-panel modal-card">
            <div className="modal-header">
              <h3>{t('modalRejectTitle')}</h3>
              <button className="btn-secondary" onClick={() => setReceiptActionTarget(null)}>
                ✖️
              </button>
            </div>
            <p style={{ fontSize: '14px', color: '#94a3b8' }}>
              {t('modalRejectConfirm', {
                id: receiptActionTarget.id,
                userId: receiptActionTarget.telegramId,
              })}
            </p>
            <div className="form-group">
              <label>{t('modalRejectReasonLabel')}</label>
              <input
                type="text"
                className="form-control"
                placeholder={t('modalRejectReasonPlaceholder')}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setReceiptActionTarget(null)}>
                {t('cancel')}
              </button>
              <button
                className="btn-danger"
                disabled={processingAction}
                onClick={() =>
                  handleReceiptAction(receiptActionTarget.id, 'reject', rejectionReason)
                }
              >
                {processingAction ? t('modalRejectSubmitting') : t('modalRejectSubmit')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Adjust Balance Modal */}
      {balanceModalUser && (
        <div className="modal-overlay">
          <div className="glass-panel modal-card">
            <div className="modal-header">
              <h3>{t('modalBalanceTitle')}</h3>
              <button className="btn-secondary" onClick={() => setBalanceModalUser(null)}>
                ✖️
              </button>
            </div>
            <form onSubmit={handleAdjustBalance}>
              <div style={{ marginBottom: '14px', fontSize: '13px', color: '#94a3b8' }}>
                {t('modalBalanceUser', {
                  userId: balanceModalUser.telegramId,
                  balance: balanceModalUser.balance.toLocaleString(numLocale),
                })}
              </div>

              <div className="form-group">
                <label>{t('modalBalanceOpLabel')}</label>
                <select
                  className="form-control"
                  value={balanceOperation}
                  onChange={(e) => setBalanceOperation(e.target.value as 'add' | 'deduct' | 'set')}
                >
                  <option value="add">{t('modalBalanceOpAdd')}</option>
                  <option value="deduct">{t('modalBalanceOpDeduct')}</option>
                  <option value="set">{t('modalBalanceOpSet')}</option>
                </select>
              </div>

              <div className="form-group">
                <label>{t('modalBalanceAmountLabel')}</label>
                <input
                  type="number"
                  min="0"
                  required
                  className="form-control"
                  placeholder={t('modalBalanceAmountPlaceholder')}
                  value={balanceAmount}
                  onChange={(e) => setBalanceAmount(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>{t('modalBalanceReasonLabel')}</label>
                <input
                  type="text"
                  required
                  className="form-control"
                  placeholder={t('modalBalanceReasonPlaceholder')}
                  value={balanceReason}
                  onChange={(e) => setBalanceReason(e.target.value)}
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setBalanceModalUser(null)}
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ width: 'auto' }}
                  disabled={processingBalance}
                >
                  {processingBalance ? t('modalBalanceSubmitting') : t('modalBalanceSubmit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
