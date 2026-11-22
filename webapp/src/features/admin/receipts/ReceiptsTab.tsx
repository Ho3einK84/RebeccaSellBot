import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  CreditCard,
  Ban,
  Zap,
} from 'lucide-react';
import { useAdminReceipts } from './hooks/useAdminReceipts.js';
import { ReceiptCard } from './components/ReceiptCard.js';
import { ReceiptPhotoModal } from './components/ReceiptPhotoModal.js';
import { ApproveReceiptModal } from './components/ApproveReceiptModal.js';
import { RejectReceiptModal } from './components/RejectReceiptModal.js';
import { VoidReceiptModal } from './components/VoidReceiptModal.js';
import { ReceiptDetailModal } from './components/ReceiptDetailModal.js';
import { BatchApproveModal } from './components/BatchApproveModal.js';
import { ReceiptSettingsModal } from './components/ReceiptSettingsModal.js';
import { BankCardsModal } from '../bankCards/BankCardsModal.js';
import { PaymentGatewaysModal } from '../paymentGateways/PaymentGatewaysModal.js';
import { Pagination } from '@/shared/components/ui/Pagination.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Card } from '@/shared/components/ui/Card.js';
import { EmptyState } from '@/shared/components/ui/EmptyState.js';
import { SectionHeader } from '@/shared/components/ui/SectionHeader.js';
import { SegmentedControl, type SegmentedOption } from '@/shared/components/ui/SegmentedControl.js';
import { SkeletonList } from '@/shared/components/ui/Skeleton.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import type { TopupReceipt } from '@/shared/types/admin.js';

interface ReceiptsTabProps {
  onInspectUser: (telegramId: number) => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

type ReceiptStatusFilter = 'pending' | 'approved' | 'rejected' | 'voided' | 'all';

export const ReceiptsTab: React.FC<ReceiptsTabProps> = ({ onInspectUser, onNotify }) => {
  const { t } = useLanguage();
  const { formatNumber, formatMoney } = useFormatters();

  const [status, setStatus] = useState<ReceiptStatusFilter>('pending');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 15;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

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

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelectedIds(new Set());
  }, [status, page]);

  const [photoTarget, setPhotoTarget] = useState<TopupReceipt | null>(null);
  const [approveTarget, setApproveTarget] = useState<TopupReceipt | null>(null);
  const [rejectTarget, setRejectTarget] = useState<TopupReceipt | null>(null);
  const [voidTarget, setVoidTarget] = useState<TopupReceipt | null>(null);
  const [detailTarget, setDetailTarget] = useState<TopupReceipt | null>(null);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isBankCardsModalOpen, setIsBankCardsModalOpen] = useState(false);
  const [isGatewaysModalOpen, setIsGatewaysModalOpen] = useState(false);

  const handlePhotoError = useCallback(() => {
    onNotify(t('admin.receipts.noPhoto'), 'error');
  }, [onNotify, t]);

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

  const statusFilterOptions: SegmentedOption<ReceiptStatusFilter>[] = useMemo(
    () => [
      {
        id: 'pending',
        label: t('admin.receipts.tabPending'),
        icon: Clock,
        count: pendingCount > 0 ? formatNumber(pendingCount) : null,
        tone: 'warn',
      },
      {
        id: 'approved',
        label: t('admin.receipts.tabApproved'),
        icon: CheckCircle2,
        tone: 'ok',
      },
      {
        id: 'rejected',
        label: t('admin.receipts.tabRejected'),
        icon: XCircle,
        tone: 'danger',
      },
      {
        id: 'voided',
        label: t('admin.receipts.tabVoided'),
        icon: Ban,
        tone: 'brand',
      },
      {
        id: 'all',
        label: t('admin.receipts.tabAll'),
        icon: Layers,
        tone: 'brand',
      },
    ],
    [t, pendingCount, formatNumber]
  );

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

  const handleConfirmVoid = async (
    receipt: TopupReceipt,
    options: { reason?: string; disablePurchasedConfigs: boolean }
  ) => {
    try {
      await actionMutation.mutateAsync({
        id: receipt.id,
        action: 'void',
        reason: options.reason,
        disablePurchasedConfigs: options.disablePurchasedConfigs,
      });
      onNotify(t('admin.notifications.receiptVoided'), 'success');
      setVoidTarget(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('admin.notifications.receiptActionFailed');
      onNotify(msg, 'error');
    }
  };

  const handleConfirmBatchApprove = async (receiptsToApprove: TopupReceipt[]) => {
    try {
      const ids = receiptsToApprove.map((r) => r.id);
      await batchActionMutation.mutateAsync({ ids, action: 'approve' });
      onNotify(
        t('admin.receipts.batchApproveSuccess', { count: formatNumber(ids.length) }),
        'success'
      );
      setSelectedIds(new Set());
      setIsBatchModalOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('admin.notifications.receiptActionFailed');
      onNotify(msg, 'error');
    }
  };

  return (
    <div className="space-y-4 pb-6">
      {/* Top Header */}
      <div className="flex flex-row justify-between items-center gap-2">
        <SectionHeader
          icon={<Receipt />}
          title={t('admin.receipts.queueTitle')}
          count={formatNumber(status === 'pending' ? pendingCount : total)}
          className="flex-1 min-w-0"
        />

        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setIsGatewaysModalOpen(true)}
            title={t('admin.receipts.paymentGatewaysBtn')}
          >
            <Zap className="w-3.5 h-3.5 text-ok-fg shrink-0" />
            <span className="hidden sm:inline">{t('admin.receipts.paymentGatewaysBtn')}</span>
          </Button>

          <Button
            size="sm"
            variant="secondary"
            onClick={() => setIsBankCardsModalOpen(true)}
            title={t('admin.receipts.bankCardsBtn')}
          >
            <CreditCard className="w-3.5 h-3.5 text-warn-fg shrink-0" />
            <span className="hidden sm:inline">{t('admin.receipts.bankCardsBtn')}</span>
          </Button>

          <Button
            size="sm"
            variant="secondary"
            onClick={() => setIsSettingsModalOpen(true)}
            title={t('admin.receipts.settingsBtn')}
          >
            <Bell className="w-3.5 h-3.5 text-brand-fg shrink-0" />
            <span className="hidden sm:inline">{t('admin.receipts.settingsBtn')}</span>
          </Button>
        </div>
      </div>

      {/* Filter Tabs & Search Row */}
      <div className="space-y-2.5">
        <div className="relative">
          <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3.5 pointer-events-none text-ink-muted" />
          <input
            type="text"
            className="w-full h-11 ps-10 pe-10 rounded-tile border border-line bg-surface text-ink placeholder:text-ink-muted text-xs sm:text-sm outline-none rs-focus"
            placeholder={t('admin.receipts.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="absolute top-1/2 -translate-y-1/2 end-2 w-8 h-8 flex items-center justify-center rounded-ctl text-ink-muted hover:text-ink hover:bg-surface-2 cursor-pointer rs-focus"
              onClick={() => setSearch('')}
              aria-label={t('common.clearSearch')}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Unified Status Filter Bar */}
        <SegmentedControl
          options={statusFilterOptions}
          value={status}
          onChange={(nextStatus) => {
            setStatus(nextStatus);
            setPage(1);
          }}
          ariaLabel={t('admin.receipts.queueTitle')}
        />
      </div>

      {/* Batch Actions Bar */}
      {status === 'pending' && receipts.length > 0 && (
        <Card
          subCard
          padding="sm"
          tone={selectedIds.size > 0 ? 'brand' : 'default'}
          className="flex flex-wrap items-center justify-between gap-2.5"
        >
          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              type="button"
              className={`inline-flex items-center gap-1.5 h-9 text-xs font-medium px-3 rounded-ctl border press rs-focus cursor-pointer ${
                isAllSelected
                  ? 'bg-surface border-brand/40 text-brand-fg font-semibold'
                  : 'bg-surface border-line text-ink-soft hover:border-line-strong'
              }`}
              onClick={handleToggleSelectAll}
            >
              {isAllSelected ? (
                <CheckSquare className="w-3.5 h-3.5 text-brand-fg" />
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
              <span className="text-xs font-semibold text-brand-fg tnum">
                {t('admin.receipts.batchSelectedCount', { count: formatNumber(selectedIds.size) })}{' '}
                · <bdi dir="ltr">{formatMoney(selectedTotalAmount)}</bdi> {t('common.currency')}
              </span>
            )}
          </div>

          {selectedIds.size > 0 && (
            <Button
              size="sm"
              variant="success"
              onClick={() => setIsBatchModalOpen(true)}
              disabled={isProcessingAction}
            >
              <Check className="w-3.5 h-3.5" />
              <span>
                {t('admin.receipts.batchApproveBtn', { count: formatNumber(selectedIds.size) })}
              </span>
            </Button>
          )}
        </Card>
      )}

      {isLoading && <SkeletonList count={3} />}

      {isError && receipts.length === 0 && (
        <EmptyState
          icon={<XCircle />}
          tone="danger"
          title={t('common.error')}
          description={error instanceof Error ? error.message : t('common.networkError')}
          action={
            <Button size="sm" variant="primary" onClick={() => void refetch()}>
              {t('common.refresh')}
            </Button>
          }
        />
      )}

      {!isLoading && !isError && receipts.length === 0 && (
        <EmptyState
          icon={status === 'pending' && !debouncedSearch ? <CheckCircle2 /> : <Receipt />}
          tone={status === 'pending' && !debouncedSearch ? 'ok' : 'neutral'}
          title={
            status === 'pending' && !debouncedSearch
              ? t('admin.receipts.empty')
              : t('admin.receipts.emptyFiltered')
          }
          action={
            debouncedSearch ? (
              <Button size="sm" variant="secondary" onClick={() => setSearch('')}>
                {t('common.clearSearch')}
              </Button>
            ) : undefined
          }
        />
      )}

      {/* Receipts Grid */}
      {!isLoading && receipts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
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

      {!isLoading && totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          disabled={isProcessingAction}
        />
      )}

      <ReceiptPhotoModal
        photoUrl={
          photoTarget ? `/api/admin/receipts/${encodeURIComponent(photoTarget.id)}/photo` : null
        }
        receiptId={photoTarget?.id ?? null}
        mediaType={photoTarget?.mediaType}
        onClose={() => setPhotoTarget(null)}
        onErrorNotify={handlePhotoError}
      />

      <ApproveReceiptModal
        receipt={approveTarget}
        onClose={() => setApproveTarget(null)}
        onConfirm={(r) => void handleConfirmApprove(r)}
        loading={isProcessingAction}
      />

      <RejectReceiptModal
        receipt={rejectTarget}
        onClose={() => setRejectTarget(null)}
        onConfirm={(r, reason) => void handleConfirmReject(r, reason)}
        loading={isProcessingAction}
      />

      <VoidReceiptModal
        receipt={voidTarget}
        onClose={() => setVoidTarget(null)}
        onConfirm={(r, opts) => void handleConfirmVoid(r, opts)}
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
        onVoid={(r) => {
          setDetailTarget(null);
          setVoidTarget(r);
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
        onConfirm={(items) => void handleConfirmBatchApprove(items)}
        loading={isProcessingAction}
      />

      <ReceiptSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        onNotify={onNotify}
      />

      <BankCardsModal
        isOpen={isBankCardsModalOpen}
        onClose={() => setIsBankCardsModalOpen(false)}
        onNotify={onNotify}
      />

      <PaymentGatewaysModal
        isOpen={isGatewaysModalOpen}
        onClose={() => setIsGatewaysModalOpen(false)}
        onNotify={onNotify}
      />
    </div>
  );
};
