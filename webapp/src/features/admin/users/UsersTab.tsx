import React, { useState } from 'react';
import { Users } from 'lucide-react';
import { useAdminUsers } from './hooks/useAdminUsers.js';
import { UserSearchBar } from './components/UserSearchBar.js';
import { UserMobileCard } from './components/UserMobileCard.js';
import { UserTable } from './components/UserTable.js';
import { UserDossierModal } from './components/UserDossierModal.js';
import { BalanceModal } from './components/BalanceModal.js';
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
    isRefetching,
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
    adjustBalanceMutation,
    isAdjustingBalance,
    banUserMutation,
    toggleConfigMutation,
    resetUsageMutation,
    revokeSubUrlMutation,
    syncConfigMutation,
  } = useAdminUsers();

  React.useEffect(() => {
    if (inspectedUserId && inspectedUserId !== inspectingId) {
      inspectUser(inspectedUserId);
      onClearInspectedUser?.();
    }
  }, [inspectedUserId, inspectingId, inspectUser, onClearInspectedUser]);

  const [balanceModalUser, setBalanceModalUser] = useState<UserProfile | null>(null);

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

      {!isLoading && users.length === 0 && (
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
              onCopyId={copy}
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
          onCopyId={copy}
          inspectingId={inspectingId}
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

      <UserDossierModal
        dossier={dossier}
        onClose={closeDossier}
        onOpenBalanceModal={setBalanceModalUser}
        onCopyId={copy}
        isCopied={isCopied}
        onNotify={onNotify}
        onBanUser={handleBanUser}
        onToggleConfig={handleToggleConfig}
        onResetConfigUsage={handleResetConfigUsage}
        onRevokeConfigSubUrl={handleRevokeConfigSubUrl}
        onSyncConfig={handleSyncConfig}
      />

      <BalanceModal
        user={balanceModalUser}
        onClose={() => setBalanceModalUser(null)}
        onSubmit={handleAdjustBalance}
        loading={isAdjustingBalance}
      />
    </div>
  );
};
