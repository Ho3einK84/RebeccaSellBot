import React, { useState } from 'react';
import { RotateCw } from 'lucide-react';
import { useAdminUsers } from './hooks/useAdminUsers.js';
import { UserSearchBar } from './components/UserSearchBar.js';
import { UserMobileCard } from './components/UserMobileCard.js';
import { UserTable } from './components/UserTable.js';
import { UserDossierModal } from './components/UserDossierModal.js';
import { BalanceModal } from './components/BalanceModal.js';
import { Pagination } from '@/shared/components/ui/Pagination.js';
import { Card } from '@/shared/components/ui/Card.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
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
  const { textSecondary } = useThemeTokens();
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
    handleSearch,
    handleClearSearch,
    inspectingId,
    inspectUser,
    closeDossier,
    dossier,
    isInspecting,
    adjustBalanceMutation,
    isAdjustingBalance,
  } = useAdminUsers();

  // If parent passed an external inspected user ID (e.g. from receipts tab), inspect it
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
      onNotify(t('admin.notifications.balanceSuccess', { balance: res.balance }), 'success');
      setBalanceModalUser(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('admin.notifications.balanceFailed');
      onNotify(msg, 'error');
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <UserSearchBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSearch={handleSearch}
        onClear={handleClearSearch}
        totalCount={totalCount}
      />

      {isLoading && (
        <div className={`flex items-center justify-center p-8 gap-3 ${textSecondary}`}>
          <RotateCw className="w-5 h-5 animate-spin text-indigo-500" />
          <span className="text-sm">{t('admin.users.searching')}</span>
        </div>
      )}

      {!isLoading && users.length === 0 && (
        <Card className="p-8 text-center text-sm">{t('admin.users.notFound')}</Card>
      )}

      {/* Mobile Card List (< md) */}
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

      {/* Desktop Table (>= md) */}
      {!isLoading && users.length > 0 && (
        <UserTable
          users={users}
          onInspect={inspectUser}
          onOpenBalanceModal={setBalanceModalUser}
          onCopyId={copy}
          inspectingId={inspectingId}
        />
      )}

      {/* Pagination Controls */}
      {!isLoading && totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          disabled={isRefetching}
        />
      )}

      {/* User Dossier Modal */}
      <UserDossierModal
        dossier={dossier}
        onClose={closeDossier}
        onOpenBalanceModal={setBalanceModalUser}
        onCopyId={copy}
      />

      {/* Balance Adjustment Modal */}
      <BalanceModal
        user={balanceModalUser}
        onClose={() => setBalanceModalUser(null)}
        onSubmit={handleAdjustBalance}
        loading={isAdjustingBalance}
      />
    </div>
  );
};
