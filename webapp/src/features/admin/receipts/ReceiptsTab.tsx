import React, { useState, useEffect, useMemo } from 'react';
import {
  Receipt,
  CheckCircle2,
  Search,
  X,
  Bell,
  Check,
  Clock,
  XCircle,
  Layers,
  CheckSquare,
  Square,
} from 'lucide-react';
import { useAdminReceipts } from './hooks/useAdminReceipts.js';
import { ReceiptCard } from './components/ReceiptCard.js';
import { ReceiptPhotoModal } from './components/ReceiptPhotoModal.js';
import { ApproveReceiptModal } from './components/ApproveReceiptModal.js';
import { RejectReceiptModal } from './components/RejectReceiptModal.js';
import { ReceiptDetailModal } from './components/ReceiptDetailModal.js';
import { BatchApproveModal } from './components/BatchApproveModal.js';
import { ReceiptSettingsModal } from './components/ReceiptSettingsModal.js';
import { Pagination } from '@/shared/components/ui/Pagination.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { SkeletonList } from '@/shared/components/ui/Skeleton.js';
import { Card } from '@/shared/components/ui/Card.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import type { TopupReceipt } from '@/shared/types/admin.js';

interface ReceiptsTabProps {
  onInspectUser: (telegramId: number) => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

type ReceiptStatusFilter = 'pending' | 'approved' | 'rejected' | 'all';

export const ReceiptsTab: React.FC<ReceiptsTabProps> = ({ onInspectUser, onNotify }) => {
  const { t } = useLanguage();
  const { formatNumber, formatMoney } = useFormatters();
  const { textPrimary, textSecondary, textMuted, subCardClass, inputClass } = useThemeTokens();

  // Filters & Pagination State
  const [status, setStatus] = useState<ReceiptStatusFilter>('pending');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 15;

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Query Hook
  const {
    receipts,
    total,
    totalPages,
    pendingCount,
    isLoading,
    isError,
    error,
    refetch,
    actionMutation,
    batchActionMutation,
    isProcessingAction,
  } = useAdminReceipts({
    page,
    limit: pageSize,
    status,
    search: debouncedSearch || undefined,
  });

  // Batch Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Reset selection on tab or page change
  useEffect(() => {
    setSelectedIds(new Set());
  }, [status, page]);

  // Modals state
  const [photoTarget, setPhotoTarget] = useState<TopupReceipt | null>(null);
  const [approveTarget, setApproveTarget] = useState<TopupReceipt | null>(null);
  const [rejectTarget, setRejectTarget] = useState<TopupReceipt | null>(null);
  const [detailTarget, setDetailTarget] = useState<TopupReceipt | null>(null);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  // Selection handlers
  const handleToggleSelect = (receipt: TopupReceipt) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(receipt.id)) {
        next.delete(receipt.id);
      } else {
        next.add(receipt.id);
      }
      return next;
    });
  };

  const isAllSelected = receipts.length > 0 && receipts.every((r) => selectedIds.has(r.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(receipts.map((r) => r.id)));
    }
  };

  const selectedReceipts = useMemo(
    () => receipts.filter((r) => selectedIds.has(r.id)),
    [receipts, selectedIds]
  );

  const selectedTotalAmount = useMemo(
    () => selectedReceipts.reduce((sum, r) => sum + r.amount, 0),
    [selectedReceipts]
  );

  // Approve action
  const handleConfirmApprove = async (receipt: TopupReceipt) => {
    try {
      await actionMutation.mutateAsync({ id: receipt.id, action: 'approve' });
      onNotify(t('admin.notifications.receiptApproved'), 'success');
      setApproveTarget(null);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(receipt.id);
        return next;
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('admin.notifications.receiptActionFailed');
      onNotify(msg, 'error');
    }
  };

  // Reject action
  const handleConfirmReject = async (receipt: TopupReceipt, reason: string) => {
    try {
      await actionMutation.mutateAsync({ id: receipt.id, action: 'reject', reason });
      onNotify(t('admin.notifications.receiptRejected'), 'success');
      setRejectTarget(null);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(receipt.id);
        return next;
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('admin.notifications.receiptActionFailed');
      onNotify(msg, 'error');
    }
  };

  // Batch approve action
  const handleConfirmBatchApprove = async (receiptsToApprove: TopupReceipt[]) => {
    try {
      const ids = receiptsToApprove.map((r) => r.id);
      await batchActionMutation.mutateAsync({ ids, action: 'approve' });
      onNotify(t('admin.receipts.batchApproveSuccess', { count: String(ids.length) }), 'success');
      setSelectedIds(new Set());
      setIsBatchModalOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('admin.notifications.receiptActionFailed');
      onNotify(msg, 'error');
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Header */}
      <div className="flex flex-row justify-between items-center gap-2 mb-1">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border bg-brand/10 border-brand/20 text-brand shadow-xs`}
          >
            <Receipt className="w-4 h-4" />
          </div>
          <h2 className={`text-base font-bold m-0 tracking-tight truncate ${textPrimary}`}>
            {t('admin.receipts.queueTitle')}
          </h2>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Telegram Settings Button */}
          <button
            type="button"
            className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border text-xs font-medium transition-all active:scale-95 cursor-pointer bg-surface/[0.04] hover:bg-surface/[0.08] border-line/10 text-ink-muted shadow-xs`}
            onClick={() => setIsSettingsModalOpen(true)}
            title={t('admin.receipts.settingsBtn')}
          >
            <Bell className="w-3.5 h-3.5 text-brand" />
            <span className="hidden sm:inline">{t('admin.receipts.settingsBtn')}</span>
          </button>

          {/* Count Badge */}
          <Badge variant="neutral" size="sm" className="shrink-0">
            {status === 'pending'
              ? `${formatNumber(pendingCount)} ${t('admin.receipts.tabPending')}`
              : `${formatNumber(total)} ${t('common.all')}`}
          </Badge>
        </div>
      </div>

      {/* Filter Tabs & Search Row */}
      <div className="space-y-2.5">
        {/* Search Input Bar */}
        <div className="relative">
          <Search
            className={`w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3.5 pointer-events-none ${textMuted}`}
          />
          <input
            type="text"
            className={`w-full h-10 ps-10 pe-9 rounded-xl border text-xs sm:text-sm outline-none transition-all ${inputClass}`}
            placeholder={t('admin.receipts.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className={`absolute top-1/2 -translate-y-1/2 end-3 p-1 rounded-md text-ink-muted hover:text-ink transition-colors cursor-pointer`}
              onClick={() => setSearch('')}
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Status Tabs - Horizontally scrollable on small screens with no icon shrink */}
        <div className="p-1 rounded-2xl bg-surface-2 border border-line/80 flex items-center gap-1.5 overflow-x-auto scrollbar-none overscroll-x-contain touch-pan-x">
          <button
            type="button"
            className={`flex-1 min-w-max py-2 px-3.5 rounded-xl text-xs font-medium transition-all duration-150 cursor-pointer flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap ${status === 'pending' ? 'bg-warn/20 text-warn font-semibold border border-warn/30 shadow-xs' : 'text-ink-muted hover:text-ink-soft'}`}
            onClick={() => {
              setStatus('pending');
              setPage(1);
            }}
          >
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span>{t('admin.receipts.tabPending')}</span>
            {pendingCount > 0 && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full tnum font-bold shrink-0 ${status === 'pending' ? 'bg-warn text-ink' : 'bg-warn/20 text-warn'}`}
              >
                {formatNumber(pendingCount)}
              </span>
            )}
          </button>

          <button
            type="button"
            className={`flex-1 min-w-max py-2 px-3.5 rounded-xl text-xs font-medium transition-all duration-150 cursor-pointer flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap ${status === 'approved' ? 'bg-ok/20 text-ok font-semibold border border-ok/30 shadow-xs' : 'text-ink-muted hover:text-ink-soft'}`}
            onClick={() => {
              setStatus('approved');
              setPage(1);
            }}
          >
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>{t('admin.receipts.tabApproved')}</span>
          </button>

          <button
            type="button"
            className={`flex-1 min-w-max py-2 px-3.5 rounded-xl text-xs font-medium transition-all duration-150 cursor-pointer flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap ${status === 'rejected' ? 'bg-danger/20 text-danger font-semibold border border-danger/30 shadow-xs' : 'text-ink-muted hover:text-ink-soft'}`}
            onClick={() => {
              setStatus('rejected');
              setPage(1);
            }}
          >
            <XCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{t('admin.receipts.tabRejected')}</span>
          </button>

          <button
            type="button"
            className={`flex-1 min-w-max py-2 px-3.5 rounded-xl text-xs font-medium transition-all duration-150 cursor-pointer flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap ${status === 'all' ? 'bg-brand/20 text-brand font-semibold border border-brand/30 shadow-xs' : 'text-ink-muted hover:text-ink-soft'}`}
            onClick={() => {
              setStatus('all');
              setPage(1);
            }}
          >
            <Layers className="w-3.5 h-3.5 shrink-0" />
            <span>{t('admin.receipts.tabAll')}</span>
          </button>
        </div>
      </div>

      {/* Batch Actions Bar (when pending & items available) */}
      {status === 'pending' && receipts.length > 0 && (
        <div
          className={`p-2.5 sm:p-3 rounded-2xl border flex flex-wrap items-center justify-between gap-2.5 transition-all ${selectedIds.size > 0 ? 'bg-brand/10 border-brand/30 shadow-xs' : subCardClass}`}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-xl border transition-all active:scale-95 cursor-pointer ${isAllSelected ? 'bg-brand/20 border-brand/40 text-brand' : 'bg-surface/[0.04] border-line/10 text-ink-muted hover:bg-surface/[0.08]'}`}
              onClick={handleToggleSelectAll}
            >
              {isAllSelected ? (
                <CheckSquare className="w-3.5 h-3.5 text-brand" />
              ) : (
                <Square className="w-3.5 h-3.5 opacity-60" />
              )}
              <span>
                {isAllSelected
                  ? t('admin.receipts.batchDeselectAll')
                  : t('admin.receipts.batchSelectAll')}
              </span>
            </button>

            {selectedIds.size > 0 && (
              <span className={`text-xs font-semibold text-brand`}>
                {t('admin.receipts.batchSelectedCount', { count: String(selectedIds.size) })}
                {'·'}
                <span className="tnum">
                  {formatMoney(selectedTotalAmount)} {t('common.currency')}
                </span>
              </span>
            )}
          </div>

          {selectedIds.size > 0 && (
            <button
              type="button"
              className={`inline-flex items-center gap-1.5 h-8.5 px-3.5 rounded-xl font-bold text-xs border transition-all active:scale-95 cursor-pointer shadow-sm bg-ok/25 hover:bg-ok/35 border-ok/40 text-ok`}
              onClick={() => setIsBatchModalOpen(true)}
              disabled={isProcessingAction}
            >
              <Check className="w-3.5 h-3.5" />
              <span>
                {t('admin.receipts.batchApproveBtn', { count: String(selectedIds.size) })}
              </span>
            </button>
          )}
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading && <SkeletonList count={3} />}

      {/* Error State */}
      {isError && receipts.length === 0 && (
        <Card className="p-8 text-center flex flex-col items-center justify-center gap-3 border-danger/20">
          <div className="w-12 h-12 rounded-2xl bg-danger/10 border border-danger/20 text-danger flex items-center justify-center">
            <XCircle className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className={`text-base font-bold m-0 ${textPrimary}`}>{t('common.error')}</h3>
            <p className={`text-xs m-0 ${textSecondary}`}>
              {error instanceof Error ? error.message : t('common.networkError')}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl border text-xs font-medium cursor-pointer transition-all active:scale-95 bg-brand hover:bg-brand text-brand-ink border-brand shadow-xs"
            onClick={() => refetch()}
          >
            <span>{t('common.refresh')}</span>
          </button>
        </Card>
      )}

      {/* Empty State */}
      {!isLoading && !isError && receipts.length === 0 && (
        <Card className="p-10 text-center flex flex-col items-center justify-center gap-3">
          <div
            className={`w-12 h-12 rounded-2xl border flex items-center justify-center ${status === 'pending' && !debouncedSearch ? 'bg-ok/10 border-ok/25 text-ok' : 'bg-surface/[0.04] border-line/10 text-ink-muted'}`}
          >
            {status === 'pending' && !debouncedSearch ? (
              <CheckCircle2 className="w-6 h-6 status-pulse" />
            ) : (
              <Receipt className="w-6 h-6 opacity-60" />
            )}
          </div>
          <div className="space-y-1">
            <p className={`text-sm font-semibold m-0 ${textPrimary}`}>
              {status === 'pending' && !debouncedSearch
                ? t('admin.receipts.empty')
                : t('admin.receipts.emptyFiltered')}
            </p>
            {debouncedSearch && (
              <button
                type="button"
                className="text-xs text-brand hover:underline mt-2 inline-block cursor-pointer"
                onClick={() => setSearch('')}
              >
                {t('common.clear')} {t('common.search')}
              </button>
            )}
          </div>
        </Card>
      )}

      {/* Receipts List */}
      {!isLoading && receipts.length > 0 && (
        <div className="grid grid-cols-1 gap-3">
          {receipts.map((receipt) => (
            <ReceiptCard
              key={receipt.id}
              receipt={receipt}
              isSelected={selectedIds.has(receipt.id)}
              onToggleSelect={status === 'pending' ? handleToggleSelect : undefined}
              onApprove={setApproveTarget}
              onReject={setRejectTarget}
              onViewPhoto={setPhotoTarget}
              onViewDetails={setDetailTarget}
              onInspectUser={onInspectUser}
              disabled={isProcessingAction}
            />
          ))}
        </div>
      )}

      {/* Pagination Controls */}
      {!isLoading && totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          disabled={isProcessingAction}
        />
      )}

      {/* Modals */}
      <ReceiptPhotoModal
        photoUrl={photoTarget ? `/api/admin/receipts/${photoTarget.id}/photo` : null}
        receiptId={photoTarget?.id ?? null}
        onClose={() => setPhotoTarget(null)}
        onErrorNotify={() => onNotify(t('admin.receipts.noPhoto'), 'error')}
      />

      <ApproveReceiptModal
        receipt={approveTarget}
        onClose={() => setApproveTarget(null)}
        onConfirm={handleConfirmApprove}
        loading={isProcessingAction}
      />

      <RejectReceiptModal
        receipt={rejectTarget}
        onClose={() => setRejectTarget(null)}
        onConfirm={handleConfirmReject}
        loading={isProcessingAction}
      />

      <ReceiptDetailModal
        receipt={detailTarget}
        onClose={() => setDetailTarget(null)}
        onApprove={(r) => {
          setDetailTarget(null);
          setApproveTarget(r);
        }}
        onReject={(r) => {
          setDetailTarget(null);
          setRejectTarget(r);
        }}
        onViewPhoto={(r) => {
          setDetailTarget(null);
          setPhotoTarget(r);
        }}
        onInspectUser={(uid) => {
          setDetailTarget(null);
          onInspectUser(uid);
        }}
        loading={isProcessingAction}
      />

      <BatchApproveModal
        receipts={selectedReceipts}
        isOpen={isBatchModalOpen}
        onClose={() => setIsBatchModalOpen(false)}
        onConfirm={handleConfirmBatchApprove}
        loading={isProcessingAction}
      />

      <ReceiptSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        onNotify={onNotify}
      />
    </div>
  );
};
