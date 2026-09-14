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
  const { isDark, textPrimary, textSecondary, textMuted, subCardClass, inputClass } =
    useThemeTokens();

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
            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${
              isDark
                ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400 shadow-xs'
                : 'bg-indigo-50 border-indigo-200 text-indigo-600 shadow-xs'
            }`}
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
            className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border text-xs font-medium transition-all active:scale-95 cursor-pointer ${
              isDark
                ? 'bg-white/[0.04] hover:bg-white/[0.08] border-white/10 text-slate-300'
                : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700 shadow-xs'
            }`}
            onClick={() => setIsSettingsModalOpen(true)}
            title={t('admin.receipts.settingsBtn')}
          >
            <Bell className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">{t('admin.receipts.settingsBtn')}</span>
          </button>

          {/* Count Badge */}
          <span
            className={`text-xs px-2.5 py-0.5 rounded-full border font-medium shrink-0 ${
              isDark
                ? 'bg-white/[0.04] border-white/10 text-zinc-300'
                : 'bg-slate-100 border-slate-200 text-slate-700'
            }`}
          >
            {status === 'pending'
              ? `${formatNumber(pendingCount)} ${t('admin.receipts.tabPending')}`
              : `${formatNumber(total)} ${t('common.all')}`}
          </span>
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
              className={`absolute top-1/2 -translate-y-1/2 end-3 p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer`}
              onClick={() => setSearch('')}
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Status Tabs - Horizontally scrollable on small screens with no icon shrink */}
        <div className="p-1 rounded-2xl bg-slate-100 dark:bg-white/[0.03] border border-slate-200/80 dark:border-white/[0.06] flex items-center gap-1.5 overflow-x-auto scrollbar-none overscroll-x-contain touch-pan-x">
          <button
            type="button"
            className={`flex-1 min-w-max py-2 px-3.5 rounded-xl text-xs font-medium transition-all duration-150 cursor-pointer flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap ${
              status === 'pending'
                ? isDark
                  ? 'bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30 shadow-xs'
                  : 'bg-white text-amber-900 font-semibold border border-amber-200 shadow-xs'
                : isDark
                  ? 'text-zinc-400 hover:text-zinc-200'
                  : 'text-slate-600 hover:text-slate-900'
            }`}
            onClick={() => {
              setStatus('pending');
              setPage(1);
            }}
          >
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span>{t('admin.receipts.tabPending')}</span>
            {pendingCount > 0 && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold shrink-0 ${
                  status === 'pending'
                    ? 'bg-amber-500 text-white'
                    : isDark
                      ? 'bg-amber-500/20 text-amber-400'
                      : 'bg-amber-100 text-amber-800'
                }`}
              >
                {formatNumber(pendingCount)}
              </span>
            )}
          </button>

          <button
            type="button"
            className={`flex-1 min-w-max py-2 px-3.5 rounded-xl text-xs font-medium transition-all duration-150 cursor-pointer flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap ${
              status === 'approved'
                ? isDark
                  ? 'bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30 shadow-xs'
                  : 'bg-white text-emerald-900 font-semibold border border-emerald-200 shadow-xs'
                : isDark
                  ? 'text-zinc-400 hover:text-zinc-200'
                  : 'text-slate-600 hover:text-slate-900'
            }`}
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
            className={`flex-1 min-w-max py-2 px-3.5 rounded-xl text-xs font-medium transition-all duration-150 cursor-pointer flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap ${
              status === 'rejected'
                ? isDark
                  ? 'bg-rose-500/20 text-rose-300 font-semibold border border-rose-500/30 shadow-xs'
                  : 'bg-white text-rose-900 font-semibold border border-rose-200 shadow-xs'
                : isDark
                  ? 'text-zinc-400 hover:text-zinc-200'
                  : 'text-slate-600 hover:text-slate-900'
            }`}
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
            className={`flex-1 min-w-max py-2 px-3.5 rounded-xl text-xs font-medium transition-all duration-150 cursor-pointer flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap ${
              status === 'all'
                ? isDark
                  ? 'bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30 shadow-xs'
                  : 'bg-white text-indigo-900 font-semibold border border-indigo-200 shadow-xs'
                : isDark
                  ? 'text-zinc-400 hover:text-zinc-200'
                  : 'text-slate-600 hover:text-slate-900'
            }`}
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
          className={`p-2.5 sm:p-3 rounded-2xl border flex flex-wrap items-center justify-between gap-2.5 transition-all ${
            selectedIds.size > 0
              ? isDark
                ? 'bg-indigo-500/10 border-indigo-500/30 shadow-xs'
                : 'bg-indigo-50/80 border-indigo-200 shadow-xs'
              : subCardClass
          }`}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-xl border transition-all active:scale-95 cursor-pointer ${
                isAllSelected
                  ? isDark
                    ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                    : 'bg-indigo-100 border-indigo-300 text-indigo-800'
                  : isDark
                    ? 'bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/[0.08]'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
              onClick={handleToggleSelectAll}
            >
              {isAllSelected ? (
                <CheckSquare className="w-3.5 h-3.5 text-indigo-400" />
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
              <span
                className={`text-xs font-semibold ${isDark ? 'text-indigo-300' : 'text-indigo-800'}`}
              >
                {t('admin.receipts.batchSelectedCount', { count: String(selectedIds.size) })}
                {' · '}
                <span className="font-mono">
                  {formatMoney(selectedTotalAmount)} {t('common.currency')}
                </span>
              </span>
            )}
          </div>

          {selectedIds.size > 0 && (
            <button
              type="button"
              className={`inline-flex items-center gap-1.5 h-8.5 px-3.5 rounded-xl font-bold text-xs border transition-all active:scale-95 cursor-pointer shadow-sm ${
                isDark
                  ? 'bg-emerald-500/25 hover:bg-emerald-500/35 border-emerald-500/40 text-emerald-300'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-600'
              }`}
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

      {/* Empty State */}
      {!isLoading && receipts.length === 0 && (
        <Card className="p-10 text-center flex flex-col items-center justify-center gap-3">
          <div
            className={`w-12 h-12 rounded-2xl border flex items-center justify-center ${
              status === 'pending' && !debouncedSearch
                ? isDark
                  ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-600'
                : isDark
                  ? 'bg-white/[0.04] border-white/10 text-zinc-400'
                  : 'bg-slate-100 border-slate-200 text-slate-500'
            }`}
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
                className="text-xs text-indigo-400 hover:underline mt-2 inline-block cursor-pointer"
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
