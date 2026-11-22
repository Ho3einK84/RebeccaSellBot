import React, { useState, useEffect, useCallback } from 'react';
import { Users, XCircle, Loader2 } from 'lucide-react';
import { useAdminUsers } from './hooks/useAdminUsers.js';
import { UserSearchBar } from './components/UserSearchBar.js';
import { UserMobileCard } from './components/UserMobileCard.js';
import { UserTable } from './components/UserTable.js';
import { UserDossierModal } from './components/UserDossierModal.js';
import { BalanceModal } from './components/BalanceModal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Pagination } from '@/shared/components/ui/Pagination.js';
import { EmptyState } from '@/shared/components/ui/EmptyState.js';
import { SkeletonList } from '@/shared/components/ui/Skeleton.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import type { UserProfile, BalanceOperation } from '@/shared/types/admin.js';

interface UsersTabProps {
  onNotify: (message: string, type?: 'success' | 'error') => void;
  inspectedUserId?: number | null;
  onClearInspectedUser?: () => void;
}

export const UsersTab: React.FC<UsersTabProps> = ({
  onNotify,
  inspectedUserId,
  onClearInspectedUser,
}) => {
  const { t } = useLanguage();
  const { formatMoney } = useFormatters();
  const { copy, isCopied } = useCopy();

  const {
    users,
    page,
    totalPages,
    totalCount,
    isLoading,
    isError,
    error,
    isRefetching,
    refetch,
    setPage,
    searchQuery,
    setSearchQuery,
    filter,
    setFilter,
    sort,
    setSort,
    handleSearch,
    handleClearSearch,
    inspectingId,
    inspectUser,
    closeDossier,
    dossier,
    isInspecting,
    isDossierError,
    dossierError,
    adjustBalanceMutation,
    isAdjustingBalance,
    sendMessageMutation,
    banUserMutation,
    toggleConfigMutation,
    resetUsageMutation,
    revokeSubUrlMutation,
    syncConfigMutation,
  } = useAdminUsers();

  useEffect(() => {
    if (inspectedUserId && inspectedUserId !== inspectingId) {
      inspectUser(inspectedUserId);
      onClearInspectedUser?.();
    }
  }, [inspectedUserId, inspectingId, inspectUser, onClearInspectedUser]);

  useEffect(() => {
    if (isDossierError && inspectingId) {
      const msg = dossierError instanceof Error ? dossierError.message : t('common.networkError');
      onNotify(msg, 'error');
      closeDossier();
    }
  }, [isDossierError, dossierError, inspectingId, onNotify, closeDossier, t]);

  const [balanceModalUser, setBalanceModalUser] = useState<UserProfile | null>(null);

  const handleCopyWithToast = useCallback(
    async (text: string, key: string) => {
      const ok = await copy(text, key);
      if (ok) {
        onNotify(t('common.copied'), 'success');
      }
    },
    [copy, onNotify, t]
  );

  const handleAdjustBalance = async (data: {
    operation: BalanceOperation;
    amount: number;
    reason: string;
  }) => {
    if (!balanceModalUser) return;
    try {
      const res = await adjustBalanceMutation.mutateAsync({
        telegramId: balanceModalUser.telegramId,
        payload: data,
      });
      onNotify(
        t('admin.notifications.balanceSuccess', { balance: formatMoney(res.balance) }),
        'success'
      );
      setBalanceModalUser(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('admin.notifications.balanceFailed');
      onNotify(msg, 'error');
    }
  };

  const handleBanUser = async (telegramId: number, isBanned: boolean, reason?: string) => {
    await banUserMutation.mutateAsync({ telegramId, isBanned, reason });
  };

  const handleSendMessage = async (telegramId: number, message: string) => {
    await sendMessageMutation.mutateAsync({ telegramId, message });
  };

  const handleToggleConfig = async (
    telegramId: number,
    configUsername: string,
    panelId?: string
  ) => {
    await toggleConfigMutation.mutateAsync({ telegramId, configUsername, panelId });
  };

  const handleResetConfigUsage = async (
    telegramId: number,
    configUsername: string,
    panelId?: string
  ) => {
    await resetUsageMutation.mutateAsync({ telegramId, configUsername, panelId });
  };

  const handleRevokeConfigSubUrl = async (
    telegramId: number,
    configUsername: string,
    panelId?: string
  ) => {
    await revokeSubUrlMutation.mutateAsync({ telegramId, configUsername, panelId });
  };

  const handleSyncConfig = async (telegramId: number, configUsername: string, panelId?: string) => {
    await syncConfigMutation.mutateAsync({ telegramId, configUsername, panelId });
  };

  return (
    <div className="space-y-4 pb-6">
      <UserSearchBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSearch={handleSearch}
        onClear={handleClearSearch}
        totalCount={totalCount}
        filter={filter}
        onFilterChange={setFilter}
        sort={sort}
        onSortChange={setSort}
      />

      {isLoading && <SkeletonList count={4} />}

      {isError && users.length === 0 && (
        <EmptyState
          icon={<XCircle />}
          tone="danger"
          title={t('common.error')}
          description={error instanceof Error ? error.message : t('common.networkError')}
          action={
            <Button size="sm" variant="primary" onClick={() => void refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      )}

      {!isLoading && !isError && users.length === 0 && (
        <EmptyState
          icon={<Users />}
          tone="neutral"
          title={t('admin.users.notFound')}
          description={t('admin.users.searchPlaceholder')}
        />
      )}

      {!isLoading && users.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:hidden">
          {users.map((u) => (
            <UserMobileCard
              key={u.telegramId}
              user={u}
              onInspect={inspectUser}
              onOpenBalanceModal={setBalanceModalUser}
              onCopyId={(text, key) => void handleCopyWithToast(text, key)}
              isCopied={isCopied(`user-${u.telegramId}`)}
              inspecting={inspectingId === u.telegramId && isInspecting}
            />
          ))}
        </div>
      )}

      {!isLoading && users.length > 0 && (
        <UserTable
          users={users}
          onInspect={inspectUser}
          onOpenBalanceModal={setBalanceModalUser}
          onCopyId={(text, key) => void handleCopyWithToast(text, key)}
          isCopied={isCopied}
          inspectingId={inspectingId}
          isInspecting={isInspecting}
        />
      )}

      {!isLoading && totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          disabled={isRefetching}
        />
      )}

      {inspectingId && isInspecting && !dossier && (
        <Modal
          isOpen={true}
          onClose={closeDossier}
          maxWidth="sm"
          title={t('admin.users.btnDetails')}
        >
          <div className="flex flex-col items-center justify-center gap-2.5 py-8 text-xs text-ink-muted">
            <Loader2 className="w-6 h-6 animate-spin text-brand-fg" />
            <span>{t('common.loading')}</span>
          </div>
        </Modal>
      )}

      <UserDossierModal
        dossier={dossier}
        onClose={closeDossier}
        onOpenBalanceModal={setBalanceModalUser}
        onCopyId={(text, key) => void handleCopyWithToast(text, key)}
        isCopied={isCopied}
        onNotify={onNotify}
        onBanUser={handleBanUser}
        onSendMessage={handleSendMessage}
        onToggleConfig={handleToggleConfig}
        onResetConfigUsage={handleResetConfigUsage}
        onRevokeConfigSubUrl={handleRevokeConfigSubUrl}
        onSyncConfig={handleSyncConfig}
      />

      <BalanceModal
        user={balanceModalUser}
        onClose={() => setBalanceModalUser(null)}
        onSubmit={(payload) => void handleAdjustBalance(payload)}
        loading={isAdjustingBalance}
      />
    </div>
  );
};
