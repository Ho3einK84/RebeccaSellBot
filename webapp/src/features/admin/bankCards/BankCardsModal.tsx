import React, { useState } from 'react';
import {
  CreditCard,
  Plus,
  Edit3,
  Trash2,
  ArrowUp,
  ArrowDown,
  Loader2,
  Download,
  RefreshCw,
  AlertTriangle,
  Save,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { api } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import { formatCardNumberSpaced } from '@/shared/lib/formatters.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Card } from '@/shared/components/ui/Card.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { Switch } from '@/shared/components/ui/Switch.js';
import { AlertBanner } from '@/shared/components/ui/AlertBanner.js';
import type { AdminBankCardDto } from '@/shared/types/admin.js';

interface BankCardsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

function normalizeDigitsInput(raw: string): string {
  return raw
    .replace(/[۰-۹]/gu, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff\s\-–—−_.,،٬]/gu, '');
}

function checkLuhn(digits: string): boolean {
  if (!/^\d{12,24}$/u.test(digits)) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = digits.charCodeAt(i) - 48;
    if (dbl) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

const CAP_PRESETS = [5_000_000, 10_000_000, 20_000_000, 50_000_000] as const;

export const BankCardsModal: React.FC<BankCardsModalProps> = ({ isOpen, onClose, onNotify }) => {
  const { t } = useLanguage();
  const { formatMoney, formatNumber } = useFormatters();
  const queryClient = useQueryClient();

  const [editingCard, setEditingCard] = useState<AdminBankCardDto | 'new' | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [cardNumber, setCardNumber] = useState('');
  const [cardHolder, setCardHolder] = useState('');
  const [bankName, setBankName] = useState('');
  const [dailyCap, setDailyCap] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.bankCards,
    queryFn: () => api.getAdminBankCards(),
    enabled: isOpen,
  });

  const syncData = (next: Awaited<ReturnType<typeof api.getAdminBankCards>>) => {
    queryClient.setQueryData(queryKeys.bankCards, next);
  };

  const createMutation = useMutation({
    mutationFn: api.createAdminBankCard,
    onSuccess: (next) => {
      syncData(next);
      onNotify(t('admin.bankCards.createdNotify'), 'success');
      setEditingCard(null);
    },
    onError: (err: Error) => onNotify(err.message || t('common.error'), 'error'),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Parameters<typeof api.updateAdminBankCard>[1];
    }) => api.updateAdminBankCard(id, payload),
    onSuccess: (next) => {
      syncData(next);
      onNotify(t('admin.bankCards.updatedNotify'), 'success');
      setEditingCard(null);
    },
    onError: (err: Error) => onNotify(err.message || t('common.error'), 'error'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.toggleAdminBankCard(id, enabled),
    onSuccess: syncData,
    onError: (err: Error) => onNotify(err.message || t('common.error'), 'error'),
  });

  const reorderMutation = useMutation({
    mutationFn: (orderedIds: string[]) => api.reorderAdminBankCards(orderedIds),
    onSuccess: syncData,
    onError: (err: Error) => onNotify(err.message || t('common.error'), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteAdminBankCard(id),
    onSuccess: (next) => {
      syncData(next);
      setConfirmDeleteId(null);
      onNotify(t('admin.bankCards.deletedNotify'), 'success');
    },
    onError: (err: Error) => onNotify(err.message || t('common.error'), 'error'),
  });

  const importMutation = useMutation({
    mutationFn: () => api.importLegacyAdminBankCard(),
    onSuccess: (next) => {
      syncData(next);
      onNotify(t('admin.bankCards.importedNotify'), 'success');
    },
    onError: (err: Error) => onNotify(err.message || t('common.error'), 'error'),
  });

  const settingsMutation = useMutation({
    mutationFn: api.updateAdminBankCardSettings,
    onSuccess: (next) => {
      syncData(next);
      onNotify(t('admin.bankCards.settingsSavedNotify'), 'success');
    },
    onError: (err: Error) => onNotify(err.message || t('common.error'), 'error'),
  });

  if (!isOpen) return null;

  const cards = data?.cards ?? [];
  const legacyCard = data?.legacyCard ?? null;
  const maxCards = data?.bounds?.maxCards ?? 20;
  const activeCount = data?.activeCount ?? 0;
  const isBusy =
    createMutation.isPending ||
    updateMutation.isPending ||
    toggleMutation.isPending ||
    reorderMutation.isPending ||
    deleteMutation.isPending ||
    importMutation.isPending ||
    settingsMutation.isPending;

  const openAddForm = () => {
    setFormError(null);
    setCardNumber('');
    setCardHolder('');
    setBankName('');
    setDailyCap('');
    setEditingCard('new');
  };

  const openEditForm = (card: AdminBankCardDto) => {
    setFormError(null);
    setCardNumber(formatCardNumberSpaced(card.cardNumber));
    setCardHolder(card.cardHolder);
    setBankName(card.bankName ?? '');
    setDailyCap(card.dailyCapToman ? String(card.dailyCapToman) : '');
    setEditingCard(card);
  };

  const handleMove = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= cards.length) return;
    const ids = cards.map((c) => c.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(target, 0, moved!);
    reorderMutation.mutate(ids);
  };

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const cleanNum = normalizeDigitsInput(cardNumber);
    if (!/^\d{12,24}$/u.test(cleanNum)) {
      setFormError(t('admin.bankCards.validationCardNumber'));
      return;
    }
    const cleanHolder = cardHolder.trim();
    if (!cleanHolder) {
      setFormError(t('admin.bankCards.validationCardHolder'));
      return;
    }
    const cleanCapRaw = normalizeDigitsInput(dailyCap);
    const parsedCap = cleanCapRaw ? Number(cleanCapRaw) : 0;
    const finalCap = Number.isSafeInteger(parsedCap) && parsedCap > 0 ? parsedCap : null;
    const cleanBank = bankName.trim() || null;

    if (editingCard === 'new') {
      createMutation.mutate({
        cardNumber: cleanNum,
        cardHolder: cleanHolder,
        bankName: cleanBank,
        dailyCapToman: finalCap,
        enabled: true,
      });
    } else if (editingCard) {
      updateMutation.mutate({
        id: editingCard.id,
        payload: {
          cardNumber: cleanNum,
          cardHolder: cleanHolder,
          bankName: cleanBank,
          dailyCapToman: finalCap,
        },
      });
    }
  };

  const normalizedPreviewDigits = normalizeDigitsInput(cardNumber);
  const showLuhnWarning =
    normalizedPreviewDigits.length === 16 && !checkLuhn(normalizedPreviewDigits);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        editingCard === 'new'
          ? t('admin.bankCards.addCard')
          : editingCard
            ? t('admin.bankCards.editCard')
            : t('admin.bankCards.title')
      }
      subtitle={!editingCard ? t('admin.bankCards.subtitle') : undefined}
      icon={
        <IconTile tone="warn" size="sm">
          <CreditCard />
        </IconTile>
      }
      maxWidth="lg"
      footer={
        editingCard ? (
          <div className="flex items-center gap-2.5">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => setEditingCard(null)}
              disabled={isBusy}
            >
              {t('admin.bankCards.cancelBtn')}
            </Button>
            <Button
              type="submit"
              form="bank-card-form"
              variant="primary"
              className="flex-1"
              loading={createMutation.isPending || updateMutation.isPending}
              disabled={isBusy}
            >
              <Save className="w-3.5 h-3.5" />
              <span>{t('admin.bankCards.saveBtn')}</span>
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
              {t('common.close')}
            </Button>
            {cards.length < maxCards && (
              <Button
                type="button"
                variant="primary"
                className="flex-1"
                onClick={openAddForm}
                disabled={isBusy}
              >
                <Plus className="w-4 h-4" />
                <span>{t('admin.bankCards.addCard')}</span>
              </Button>
            )}
          </div>
        )
      }
    >
      {isLoading ? (
        <div className="py-12 flex flex-col items-center justify-center gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-brand-fg" />
          <span className="text-xs text-ink-muted">{t('common.loading')}</span>
        </div>
      ) : editingCard ? (
        <form id="bank-card-form" onSubmit={handleSubmitForm} className="space-y-3.5 text-start">
          {formError && <AlertBanner tone="danger">{formError}</AlertBanner>}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-ink block">
              {t('admin.bankCards.cardNumberLabel')}
            </label>
            <input
              type="text"
              dir="ltr"
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
              placeholder={t('admin.bankCards.cardNumberPlaceholder')}
              className="w-full h-11 px-3.5 rounded-tile border border-line bg-surface text-ink font-mono text-sm outline-none rs-focus"
              required
            />
            {showLuhnWarning && (
              <p className="text-[11px] text-warn-fg flex items-center gap-1 m-0">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{t('admin.bankCards.luhnWarning')}</span>
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-ink block">
              {t('admin.bankCards.cardHolderLabel')}
            </label>
            <input
              type="text"
              value={cardHolder}
              onChange={(e) => setCardHolder(e.target.value)}
              placeholder={t('admin.bankCards.cardHolderPlaceholder')}
              className="w-full h-11 px-3.5 rounded-tile border border-line bg-surface text-ink text-sm outline-none rs-focus"
              required
              maxLength={120}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-ink block">
              {t('admin.bankCards.bankNameLabel')}
            </label>
            <input
              type="text"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder={t('admin.bankCards.bankNamePlaceholder')}
              className="w-full h-11 px-3.5 rounded-tile border border-line bg-surface text-ink text-sm outline-none rs-focus"
              maxLength={60}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-ink block">
              {t('admin.bankCards.dailyCapLabel')}
            </label>
            <input
              type="text"
              dir="ltr"
              value={dailyCap}
              onChange={(e) => setDailyCap(e.target.value)}
              placeholder={t('admin.bankCards.dailyCapPlaceholder')}
              className="w-full h-11 px-3.5 rounded-tile border border-line bg-surface text-ink tnum text-sm outline-none rs-focus"
            />
            <div className="flex flex-wrap gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => setDailyCap('')}
                className="h-7 px-2.5 rounded-ctl border border-line bg-surface-2 text-[11px] font-medium text-ink-soft hover:border-line-strong cursor-pointer"
              >
                {t('admin.bankCards.unlimited')}
              </button>
              {CAP_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setDailyCap(String(preset))}
                  className="h-7 px-2.5 rounded-ctl border border-line bg-surface-2 text-[11px] font-medium text-ink-soft hover:border-line-strong cursor-pointer tnum"
                >
                  {formatMoney(preset)}
                </button>
              ))}
            </div>
          </div>
        </form>
      ) : (
        <div className="space-y-4 text-start">
          {/* Status / Rotation Banner */}
          {data?.rotationActive && (
            <AlertBanner tone="info">
              <span className="inline-flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {t('admin.bankCards.rotationActive', { count: formatNumber(activeCount) })}
                </span>
              </span>
            </AlertBanner>
          )}
          {cards.length > 0 && activeCount === 0 && legacyCard && (
            <AlertBanner tone="warn">{t('admin.bankCards.allDisabledWarn')}</AlertBanner>
          )}

          {/* Card List or Empty Fallback */}
          {cards.length === 0 ? (
            <Card subCard padding="md" className="space-y-3">
              <div className="space-y-1">
                <h4 className="text-xs font-semibold text-ink m-0">
                  {t('admin.bankCards.emptyTitle')}
                </h4>
                <p className="text-xs text-ink-muted leading-relaxed m-0">
                  {t('admin.bankCards.emptyDesc')}
                </p>
              </div>

              {legacyCard && (
                <div className="rounded-tile border border-line bg-surface p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-ink-muted">
                      {t('admin.bankCards.legacyBanner')}
                    </span>
                    {legacyCard.bankName && (
                      <Badge variant="neutral" size="xs">
                        {legacyCard.bankName}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <bdi dir="ltr" className="font-mono text-sm font-semibold text-ink">
                      {formatCardNumberSpaced(legacyCard.cardNumber)}
                    </bdi>
                    <span className="text-xs text-ink-soft">{legacyCard.cardHolder || '—'}</span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="tonal"
                    onClick={() => importMutation.mutate()}
                    loading={importMutation.isPending}
                    disabled={isBusy}
                    block
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{t('admin.bankCards.importLegacy')}</span>
                  </Button>
                </div>
              )}
            </Card>
          ) : (
            <div className="space-y-2.5">
              {cards.map((card, index) => {
                const capPercent =
                  card.dailyCapToman && card.dailyCapToman > 0
                    ? Math.min(100, Math.round((card.dailyUsageToman / card.dailyCapToman) * 100))
                    : 0;
                return (
                  <Card key={card.id} subCard padding="md" className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-semibold text-ink">
                            {card.bankName || card.detectedBankName || t('user.wallet.bankCard')}
                          </span>
                          <Badge
                            variant={
                              !card.enabled ? 'neutral' : card.isCapReached ? 'error' : 'success'
                            }
                            size="xs"
                            dot
                          >
                            {!card.enabled
                              ? t('admin.bankCards.inactive')
                              : card.isCapReached
                                ? t('admin.bankCards.capReached')
                                : t('admin.bankCards.active')}
                          </Badge>
                        </div>
                        <bdi
                          dir="ltr"
                          className="font-mono text-sm font-semibold text-brand-fg block"
                        >
                          {formatCardNumberSpaced(card.cardNumber)}
                        </bdi>
                        <span className="text-xs text-ink-muted block truncate">
                          {card.cardHolder || '—'}
                        </span>
                      </div>

                      <Switch
                        checked={card.enabled}
                        onChange={(next) => toggleMutation.mutate({ id: card.id, enabled: next })}
                        ariaLabel={card.cardHolder || card.cardNumber}
                      />
                    </div>

                    {/* Daily Cap & Usage Progress */}
                    <div className="space-y-1 text-[11px] tnum">
                      <div className="flex items-center justify-between text-ink-muted">
                        <span>{t('admin.bankCards.todayVolume')}</span>
                        <span className="font-medium text-ink">
                          <bdi dir="ltr">{formatMoney(card.dailyUsageToman)}</bdi>
                          {card.dailyCapToman ? (
                            <>
                              {' / '}
                              <bdi dir="ltr">{formatMoney(card.dailyCapToman)}</bdi>
                            </>
                          ) : (
                            ` (${t('admin.bankCards.unlimited')})`
                          )}{' '}
                          {t('common.currency')}
                        </span>
                      </div>
                      {card.dailyCapToman && (
                        <div className="w-full h-1.5 rounded-full bg-surface-2 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              card.isCapReached
                                ? 'bg-danger'
                                : capPercent >= 80
                                  ? 'bg-warn'
                                  : 'bg-ok'
                            }`}
                            style={{ width: `${capPercent}%` }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Row Actions */}
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-line">
                      <div className="flex items-center gap-1">
                        {cards.length > 1 && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleMove(index, -1)}
                              disabled={index === 0 || isBusy}
                              aria-label={t('admin.bankCards.moveUp')}
                              className="w-8 h-8 rounded-ctl border border-line bg-surface inline-flex items-center justify-center text-ink-soft hover:text-ink disabled:opacity-40 cursor-pointer"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMove(index, 1)}
                              disabled={index === cards.length - 1 || isBusy}
                              aria-label={t('admin.bankCards.moveDown')}
                              className="w-8 h-8 rounded-ctl border border-line bg-surface inline-flex items-center justify-center text-ink-soft hover:text-ink disabled:opacity-40 cursor-pointer"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          size="xs"
                          variant="secondary"
                          onClick={() => openEditForm(card)}
                          disabled={isBusy}
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>{t('admin.bankCards.editBtn')}</span>
                        </Button>

                        {confirmDeleteId === card.id ? (
                          <Button
                            type="button"
                            size="xs"
                            variant="danger"
                            onClick={() => deleteMutation.mutate(card.id)}
                            loading={deleteMutation.isPending}
                            disabled={isBusy}
                          >
                            <span>{t('admin.bankCards.deleteConfirm')}</span>
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            onClick={() => setConfirmDeleteId(card.id)}
                            disabled={isBusy}
                            aria-label={t('common.delete')}
                          >
                            <Trash2 className="w-3.5 h-3.5 text-danger-fg" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Unique Topup Amount Setting */}
          <Card subCard padding="md" className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <span className="text-xs font-semibold block text-ink">
                {t('admin.bankCards.uniqueAmountLabel')}
              </span>
              <span className="text-[11px] leading-relaxed block text-ink-muted">
                {t('admin.bankCards.uniqueAmountDesc')}
              </span>
            </div>
            <Switch
              checked={Boolean(data?.uniqueTopupAmountEnabled)}
              onChange={(next) => settingsMutation.mutate({ uniqueTopupAmountEnabled: next })}
              ariaLabel={t('admin.bankCards.uniqueAmountLabel')}
            />
          </Card>
        </div>
      )}
    </Modal>
  );
};
