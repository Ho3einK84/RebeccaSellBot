import React, { useState } from 'react';
import {
  Tags,
  Plus,
  Edit3,
  Trash2,
  Star,
  Save,
  Loader2,
  Users,
  Percent,
  CreditCard,
  ShieldCheck,
  Check,
  X,
  ChevronDown,
  Info,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { api } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import { normalizeInputDigits } from '@/shared/lib/formatters.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Card } from '@/shared/components/ui/Card.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { Switch } from '@/shared/components/ui/Switch.js';
import { AlertBanner } from '@/shared/components/ui/AlertBanner.js';
import { Input, Select } from '@/shared/components/ui/Input.js';
import type {
  AdminUserGroupDto,
  CreateAdminUserGroupPayload,
  UpdateAdminUserGroupPayload,
} from '@/shared/types/admin.js';

interface UserGroupsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

interface GroupFormState {
  name: string;
  badge: string;
  isDefault: boolean;
  discountPercent: string;
  applyDiscountToCustomVolume: boolean;
  customPricePerGb: string;
  customPricePerDay: string;
  creditLimit: string;
  allowCatalogDiscounts: boolean;
  allowPromoCodes: boolean;
  allowCashback: boolean;
  allowLuckyWheel: boolean;
  allowCustomServiceName: boolean;
}

const DEFAULT_FORM_STATE: GroupFormState = {
  name: '',
  badge: '',
  isDefault: false,
  discountPercent: '0',
  applyDiscountToCustomVolume: false,
  customPricePerGb: '',
  customPricePerDay: '',
  creditLimit: '0',
  allowCatalogDiscounts: true,
  allowPromoCodes: true,
  allowCashback: true,
  allowLuckyWheel: true,
  allowCustomServiceName: false,
};

function sanitizeNonNegativeDigits(raw: string): string {
  return normalizeInputDigits(raw).replace(/[^0-9]/g, '');
}

function parseOptionalNonNegativeInt(raw: string): number | null | 'invalid' {
  const cleaned = raw.trim();
  if (!cleaned) return null;
  if (!/^\d+$/.test(cleaned)) return 'invalid';
  const n = Number(cleaned);
  return Number.isSafeInteger(n) && n >= 0 ? n : 'invalid';
}

export const UserGroupsModal: React.FC<UserGroupsModalProps> = ({ isOpen, onClose, onNotify }) => {
  const { t } = useLanguage();
  const { formatNumber, formatMoney } = useFormatters();
  const { triggerHaptic } = useHaptic();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<AdminUserGroupDto | 'new' | null>(null);
  const [form, setForm] = useState<GroupFormState>(DEFAULT_FORM_STATE);
  const [formError, setFormError] = useState<string | null>(null);
  const [showAdvancedPricing, setShowAdvancedPricing] = useState(false);

  const [deletingGroup, setDeletingGroup] = useState<AdminUserGroupDto | null>(null);
  const [transferTargetId, setTransferTargetId] = useState<string>('__none__');

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.userGroups,
    queryFn: () => api.getAdminUserGroups(),
    enabled: isOpen,
  });

  const invalidateGroupQueries = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.userGroups });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'userDossier'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: CreateAdminUserGroupPayload) => api.createAdminUserGroup(payload),
    onSuccess: () => {
      triggerHaptic('success');
      invalidateGroupQueries();
      onNotify(t('admin.userGroups.createdNotify'), 'success');
      setEditing(null);
      setFormError(null);
    },
    onError: (err: Error) => {
      triggerHaptic('error');
      setFormError(err.message || t('common.error'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateAdminUserGroupPayload }) =>
      api.updateAdminUserGroup(id, payload),
    onSuccess: (_res, variables) => {
      triggerHaptic('success');
      invalidateGroupQueries();
      const isQuickDefault =
        Object.keys(variables.payload).length === 1 && variables.payload.isDefault === true;
      onNotify(
        isQuickDefault
          ? t('admin.userGroups.defaultUpdatedNotify')
          : t('admin.userGroups.updatedNotify'),
        'success'
      );
      setEditing(null);
      setFormError(null);
    },
    onError: (err: Error) => {
      triggerHaptic('error');
      if (editing) {
        setFormError(err.message || t('common.error'));
      } else {
        onNotify(err.message || t('common.error'), 'error');
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, transferToGroupId }: { id: string; transferToGroupId: string | null }) =>
      api.deleteAdminUserGroup(id, transferToGroupId),
    onSuccess: (res) => {
      triggerHaptic('success');
      invalidateGroupQueries();
      setDeletingGroup(null);
      onNotify(
        t('admin.userGroups.deletedNotify', {
          count: formatNumber(res.transferredCount ?? 0),
        }),
        'success'
      );
    },
    onError: (err: Error) => {
      triggerHaptic('error');
      onNotify(err.message || t('common.error'), 'error');
    },
  });

  if (!isOpen) return null;

  const groups = data?.groups ?? [];
  const isBusy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  const openCreateForm = () => {
    triggerHaptic('light');
    setFormError(null);
    setDeletingGroup(null);
    setForm(DEFAULT_FORM_STATE);
    setShowAdvancedPricing(false);
    setEditing('new');
  };

  const openEditForm = (group: AdminUserGroupDto) => {
    triggerHaptic('light');
    setFormError(null);
    setDeletingGroup(null);
    setForm({
      name: group.name,
      badge: group.badge ?? '',
      isDefault: group.isDefault,
      discountPercent: String(group.discountPercent ?? 0),
      applyDiscountToCustomVolume: Boolean(group.applyDiscountToCustomVolume),
      customPricePerGb: group.customPricePerGb !== null ? String(group.customPricePerGb) : '',
      customPricePerDay: group.customPricePerDay !== null ? String(group.customPricePerDay) : '',
      creditLimit: String(group.creditLimit ?? 0),
      allowCatalogDiscounts: Boolean(group.allowCatalogDiscounts),
      allowPromoCodes: Boolean(group.allowPromoCodes),
      allowCashback: Boolean(group.allowCashback),
      allowLuckyWheel: Boolean(group.allowLuckyWheel),
      allowCustomServiceName: Boolean(group.allowCustomServiceName),
    });
    setShowAdvancedPricing(group.customPricePerDay !== null);
    setEditing(group);
  };

  const openDeleteConfirm = (group: AdminUserGroupDto) => {
    triggerHaptic('light');
    const defaultOther = groups.find((g) => g.id !== group.id && g.isDefault);
    setTransferTargetId(defaultOther ? defaultOther.id : '__none__');
    setDeletingGroup(group);
  };

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const name = form.name.trim();
    if (!name || name.length > 80) {
      setFormError(t('admin.userGroups.validationNameRequired'));
      return;
    }

    const badgeRaw = form.badge.trim();
    if (badgeRaw.length > 40) {
      setFormError(t('admin.userGroups.validationBadgeTooLong'));
      return;
    }

    const parsedDiscount = parseOptionalNonNegativeInt(form.discountPercent || '0');
    if (parsedDiscount === 'invalid' || parsedDiscount === null || parsedDiscount > 90) {
      setFormError(t('admin.userGroups.validationDiscountInvalid'));
      return;
    }

    const parsedGb = parseOptionalNonNegativeInt(form.customPricePerGb);
    if (parsedGb === 'invalid') {
      setFormError(t('admin.userGroups.validationPriceInvalid'));
      return;
    }

    const parsedDay = parseOptionalNonNegativeInt(form.customPricePerDay);
    if (parsedDay === 'invalid') {
      setFormError(t('admin.userGroups.validationPriceInvalid'));
      return;
    }

    const parsedCredit = parseOptionalNonNegativeInt(form.creditLimit || '0');
    if (parsedCredit === 'invalid' || parsedCredit === null) {
      setFormError(t('admin.userGroups.validationCreditInvalid'));
      return;
    }

    const payload: CreateAdminUserGroupPayload = {
      name,
      badge: badgeRaw ? badgeRaw : null,
      isDefault: form.isDefault,
      discountPercent: parsedDiscount,
      applyDiscountToCustomVolume: form.applyDiscountToCustomVolume,
      customPricePerGb: parsedGb,
      customPricePerDay: parsedDay,
      creditLimit: parsedCredit,
      allowCatalogDiscounts: form.allowCatalogDiscounts,
      allowPromoCodes: form.allowPromoCodes,
      allowCashback: form.allowCashback,
      allowLuckyWheel: form.allowLuckyWheel,
      allowCustomServiceName: form.allowCustomServiceName,
    };

    if (editing === 'new') {
      createMutation.mutate(payload);
    } else if (editing) {
      updateMutation.mutate({ id: editing.id, payload });
    }
  };

  const handleCloseModal = () => {
    if (isBusy) return;
    setEditing(null);
    setDeletingGroup(null);
    setFormError(null);
    setShowAdvancedPricing(false);
    onClose();
  };

  const renderFlagChip = (label: string, enabled: boolean) => (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium border ${
        enabled
          ? 'bg-ok-soft border-ok/25 text-ok-fg'
          : 'bg-surface border-line text-ink-muted line-through decoration-ink-muted/60'
      }`}
    >
      {enabled ? (
        <Check className="w-2.5 h-2.5 shrink-0" />
      ) : (
        <X className="w-2.5 h-2.5 shrink-0" />
      )}
      <span>{label}</span>
    </span>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCloseModal}
      maxWidth="lg"
      closeOnBackdrop={!isBusy}
      title={t('admin.userGroups.title')}
      subtitle={t('admin.userGroups.subtitle')}
      icon={
        <IconTile tone="accent" size="sm">
          <Tags />
        </IconTile>
      }
    >
      <div className="space-y-4 text-start">
        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-ink-muted gap-2 text-xs">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{t('common.loading')}</span>
          </div>
        ) : editing !== null ? (
          <form onSubmit={handleSubmitForm} className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="m-0 text-sm font-semibold text-ink">
                {editing === 'new'
                  ? t('admin.userGroups.createTitle')
                  : t('admin.userGroups.editTitle')}
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isBusy}
                onClick={() => {
                  setEditing(null);
                  setFormError(null);
                }}
              >
                {t('common.cancel')}
              </Button>
            </div>

            {formError && <AlertBanner tone="danger">{formError}</AlertBanner>}

            {/* Section 1: Identity */}
            <Card subCard padding="md" className="space-y-3">
              <div className="text-xs font-semibold text-ink">
                {t('admin.userGroups.sectionIdentity')}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-ink-soft block">
                    {t('admin.userGroups.nameLabel')}
                  </label>
                  <Input
                    type="text"
                    required
                    maxLength={80}
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder={t('admin.userGroups.namePlaceholder')}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-ink-soft block">
                    {t('admin.userGroups.badgeLabel')}
                  </label>
                  <Input
                    type="text"
                    maxLength={40}
                    value={form.badge}
                    onChange={(e) => setForm((prev) => ({ ...prev, badge: e.target.value }))}
                    placeholder={t('admin.userGroups.badgePlaceholder')}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 pt-1 border-t border-line/70">
                <div className="min-w-0 space-y-0.5">
                  <div className="text-xs font-medium text-ink">
                    {t('admin.userGroups.isDefaultLabel')}
                  </div>
                  <p className="text-[11px] text-ink-muted m-0 leading-relaxed">
                    {t('admin.userGroups.isDefaultHint')}
                  </p>
                </div>
                <Switch
                  checked={form.isDefault}
                  disabled={isBusy}
                  ariaLabel={t('admin.userGroups.isDefaultLabel')}
                  onChange={(checked) => setForm((prev) => ({ ...prev, isDefault: checked }))}
                />
              </div>
            </Card>

            {/* Section 2: Pricing & VIP Credit */}
            <Card subCard padding="md" className="space-y-3">
              <div className="text-xs font-semibold text-ink">
                {t('admin.userGroups.sectionPricing')}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-ink-soft block">
                    {t('admin.userGroups.discountPercentLabel')}
                  </label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    dir="ltr"
                    className="tnum"
                    value={form.discountPercent}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        discountPercent: sanitizeNonNegativeDigits(e.target.value),
                      }))
                    }
                    placeholder="0"
                  />
                  <p className="text-[11px] text-ink-muted m-0">
                    {t('admin.userGroups.discountPercentHint')}
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-ink-soft block">
                    {t('admin.userGroups.creditLimitInputLabel')}
                  </label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    dir="ltr"
                    className="tnum"
                    value={form.creditLimit}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        creditLimit: sanitizeNonNegativeDigits(e.target.value),
                      }))
                    }
                    placeholder="0"
                  />
                  <p className="text-[11px] text-ink-muted m-0">
                    {t('admin.userGroups.creditLimitHint')}
                  </p>
                </div>
              </div>

              {/* Explicit toggle: apply group discount % to custom volume */}
              <div className="rounded-tile border border-brand/25 bg-brand-soft/45 px-3 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <div className="text-xs font-semibold text-ink">
                    {t('admin.userGroups.applyDiscountCustomLabel')}
                  </div>
                  <p className="text-[11px] text-ink-muted m-0 leading-relaxed">
                    {t('admin.userGroups.applyDiscountCustomHint')}
                  </p>
                </div>
                <Switch
                  checked={form.applyDiscountToCustomVolume}
                  disabled={isBusy}
                  ariaLabel={t('admin.userGroups.applyDiscountCustomLabel')}
                  onChange={(checked) =>
                    setForm((prev) => ({ ...prev, applyDiscountToCustomVolume: checked }))
                  }
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-ink-soft block">
                  {t('admin.userGroups.customPricePerGbLabel')}
                </label>
                <Input
                  type="text"
                  inputMode="numeric"
                  dir="ltr"
                  className="tnum"
                  value={form.customPricePerGb}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      customPricePerGb: sanitizeNonNegativeDigits(e.target.value),
                    }))
                  }
                  placeholder={t('admin.userGroups.customPricePerGbPlaceholder')}
                />
                <p className="text-[11px] text-ink-muted m-0 leading-relaxed">
                  {t('admin.userGroups.customPricePerGbHint')}
                </p>
              </div>

              {/* Advanced backend-only fixed-day rate — hidden by default unless expanded or already set */}
              <div className="pt-1 border-t border-line/70 space-y-2">
                <button
                  type="button"
                  onClick={() => setShowAdvancedPricing((prev) => !prev)}
                  aria-expanded={showAdvancedPricing}
                  className="w-full flex items-center justify-between gap-2 text-[11px] font-medium text-ink-muted hover:text-ink py-1 cursor-pointer transition-colors"
                >
                  <span>{t('admin.userGroups.advancedPricingToggle')}</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${
                      showAdvancedPricing ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {showAdvancedPricing && (
                  <div className="p-3 rounded-tile border border-dashed border-line-strong bg-surface-2/45 opacity-90 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <label className="text-xs font-semibold text-ink-soft">
                        {t('admin.userGroups.customPricePerDayLabel')}
                      </label>
                      <Badge variant="outline" size="xs" className="border-dashed">
                        {t('admin.userGroups.fixedDaysBadge')}
                      </Badge>
                    </div>
                    <Input
                      type="text"
                      inputMode="numeric"
                      dir="ltr"
                      className="tnum"
                      value={form.customPricePerDay}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          customPricePerDay: sanitizeNonNegativeDigits(e.target.value),
                        }))
                      }
                      placeholder={t('admin.userGroups.customPricePerDayPlaceholder')}
                    />
                    <p className="text-[11px] text-ink-muted flex items-start gap-1.5 leading-relaxed m-0">
                      <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-ink-muted" />
                      <span>{t('admin.userGroups.customPricePerDayHint')}</span>
                    </p>
                  </div>
                )}
              </div>
            </Card>

            {/* Section 3: Anti-double-discount & feature flags */}
            <Card subCard padding="md" className="space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                <ShieldCheck className="w-4 h-4 text-brand-fg shrink-0" />
                <span>{t('admin.userGroups.sectionFlags')}</span>
              </div>

              <div className="divide-y divide-line/70">
                {[
                  {
                    key: 'allowCatalogDiscounts' as const,
                    label: t('admin.userGroups.flagCatalogLabel'),
                    hint: t('admin.userGroups.flagCatalogHint'),
                  },
                  {
                    key: 'allowPromoCodes' as const,
                    label: t('admin.userGroups.flagPromoLabel'),
                    hint: t('admin.userGroups.flagPromoHint'),
                  },
                  {
                    key: 'allowCashback' as const,
                    label: t('admin.userGroups.flagCashbackLabel'),
                    hint: t('admin.userGroups.flagCashbackHint'),
                  },
                  {
                    key: 'allowLuckyWheel' as const,
                    label: t('admin.userGroups.flagWheelLabel'),
                    hint: t('admin.userGroups.flagWheelHint'),
                  },
                  {
                    key: 'allowCustomServiceName' as const,
                    label: t('admin.userGroups.flagCustomNameLabel'),
                    hint: t('admin.userGroups.flagCustomNameHint'),
                  },
                ].map((item) => (
                  <div
                    key={item.key}
                    className="py-2 first:pt-1 last:pb-0 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="text-xs font-medium text-ink">{item.label}</div>
                      <p className="text-[11px] text-ink-muted m-0 leading-snug">{item.hint}</p>
                    </div>
                    <Switch
                      checked={form[item.key]}
                      disabled={isBusy}
                      ariaLabel={item.label}
                      onChange={(checked) => setForm((prev) => ({ ...prev, [item.key]: checked }))}
                    />
                  </div>
                ))}
              </div>
            </Card>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={isBusy}
                onClick={() => {
                  setEditing(null);
                  setFormError(null);
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={createMutation.isPending || updateMutation.isPending}
                disabled={isBusy}
              >
                <Save className="w-3.5 h-3.5 shrink-0" />
                <span>{t('common.save')}</span>
              </Button>
            </div>
          </form>
        ) : (
          <>
            {/* Top Toolbar */}
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-ink flex items-center gap-1.5">
                <span>
                  {t('admin.userGroups.totalCount', { count: formatNumber(groups.length) })}
                </span>
              </div>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={isBusy}
                onClick={openCreateForm}
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>{t('admin.userGroups.newGroupBtn')}</span>
              </Button>
            </div>

            {groups.length === 0 ? (
              <Card padding="lg" className="text-center space-y-2.5">
                <div className="mx-auto w-10 h-10 rounded-tile bg-surface-2 border border-line flex items-center justify-center text-ink-muted">
                  <Tags className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-ink">
                    {t('admin.userGroups.emptyTitle')}
                  </div>
                  <p className="text-xs text-ink-muted m-0 max-w-md mx-auto leading-relaxed">
                    {t('admin.userGroups.emptyDesc')}
                  </p>
                </div>
                <div className="pt-1">
                  <Button type="button" variant="primary" size="sm" onClick={openCreateForm}>
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                    <span>{t('admin.userGroups.newGroupBtn')}</span>
                  </Button>
                </div>
              </Card>
            ) : (
              <div className="space-y-3">
                {groups.map((group) => {
                  const isDeletingThis = deletingGroup?.id === group.id;
                  const otherGroups = groups.filter((g) => g.id !== group.id);
                  return (
                    <Card key={group.id} padding="md" className="space-y-3">
                      {/* Header row */}
                      <div className="flex items-start justify-between gap-2.5 flex-wrap">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-bold text-ink truncate">
                              {group.name}
                            </span>
                            {group.badge && (
                              <Badge variant="primary" size="xs">
                                {group.badge}
                              </Badge>
                            )}
                            {group.isDefault && (
                              <Badge variant="warning" size="xs" dot>
                                {t('admin.userGroups.defaultBadge')}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] text-ink-muted tnum">
                            <Users className="w-3.5 h-3.5 shrink-0" />
                            <span>
                              {t('admin.userGroups.membersCount', {
                                count: formatNumber(group.memberCount),
                              })}
                            </span>
                          </div>
                        </div>

                        {group.discountPercent > 0 && (
                          <Badge variant="success" size="xs" className="tnum shrink-0">
                            <Percent className="w-3 h-3 me-0.5" />
                            <span>
                              {formatNumber(group.discountPercent)}% ·{' '}
                              {group.applyDiscountToCustomVolume
                                ? t('admin.userGroups.discountScopeWithCustom')
                                : t('admin.userGroups.discountScopePackagesOnly')}
                            </span>
                          </Badge>
                        )}
                      </div>

                      {/* Pricing & Credit Grid */}
                      <div
                        className={`grid gap-2 text-xs ${
                          group.customPricePerDay !== null
                            ? 'grid-cols-2 sm:grid-cols-4'
                            : 'grid-cols-1 sm:grid-cols-3'
                        }`}
                      >
                        <div className="rounded-ctl border border-line bg-surface-2 px-2.5 py-2 space-y-0.5">
                          <div className="text-[10.5px] text-ink-muted">
                            {t('admin.userGroups.discountLabel')}
                          </div>
                          <div className="font-semibold text-ink tnum">
                            {formatNumber(group.discountPercent)}%
                          </div>
                          <div className="text-[10px] text-ink-muted truncate">
                            {group.applyDiscountToCustomVolume
                              ? t('admin.userGroups.discountScopeWithCustom')
                              : t('admin.userGroups.discountScopePackagesOnly')}
                          </div>
                        </div>

                        <div className="rounded-ctl border border-line bg-surface-2 px-2.5 py-2 space-y-0.5">
                          <div className="text-[10.5px] text-ink-muted">
                            {t('admin.userGroups.customGbLabel')}
                          </div>
                          <div className="font-semibold text-ink tnum truncate">
                            {group.customPricePerGb !== null ? (
                              <>
                                <bdi dir="ltr">{formatMoney(group.customPricePerGb)}</bdi>{' '}
                                <span className="text-[10px] font-normal text-ink-muted">
                                  {t('common.currency')}
                                </span>
                              </>
                            ) : (
                              <span className="text-ink-muted font-normal">
                                {t('admin.userGroups.baseTariff')}
                              </span>
                            )}
                          </div>
                        </div>

                        {group.customPricePerDay !== null && (
                          <div className="rounded-ctl border border-dashed border-line-strong bg-surface-2/60 px-2.5 py-2 space-y-0.5">
                            <div className="text-[10.5px] text-ink-muted">
                              {t('admin.userGroups.customDayLabel')}
                            </div>
                            <div className="font-semibold text-ink tnum truncate">
                              <bdi dir="ltr">{formatMoney(group.customPricePerDay)}</bdi>{' '}
                              <span className="text-[10px] font-normal text-ink-muted">
                                {t('common.currency')}
                              </span>
                            </div>
                          </div>
                        )}

                        <div
                          className={`rounded-ctl border px-2.5 py-2 space-y-0.5 ${
                            group.creditLimit > 0
                              ? 'border-brand/30 bg-brand-soft/60'
                              : 'border-line bg-surface-2'
                          }`}
                        >
                          <div className="text-[10.5px] text-ink-muted flex items-center gap-1">
                            <CreditCard className="w-3 h-3 shrink-0" />
                            <span className="truncate">
                              {t('admin.userGroups.creditLimitLabel')}
                            </span>
                          </div>
                          <div
                            className={`font-semibold tnum truncate ${
                              group.creditLimit > 0 ? 'text-brand-fg' : 'text-ink-muted font-normal'
                            }`}
                          >
                            {group.creditLimit > 0 ? (
                              <>
                                <bdi dir="ltr">{formatMoney(group.creditLimit)}</bdi>{' '}
                                <span className="text-[10px] font-normal opacity-80">
                                  {t('common.currency')}
                                </span>
                              </>
                            ) : (
                              t('admin.userGroups.creditDisabled')
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Policy Flags Strip */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {renderFlagChip(
                          t('admin.userGroups.flagCustomVolDiscShort'),
                          group.applyDiscountToCustomVolume
                        )}
                        {renderFlagChip(
                          t('admin.userGroups.flagCatalogShort'),
                          group.allowCatalogDiscounts
                        )}
                        {renderFlagChip(
                          t('admin.userGroups.flagPromoShort'),
                          group.allowPromoCodes
                        )}
                        {renderFlagChip(
                          t('admin.userGroups.flagCashbackShort'),
                          group.allowCashback
                        )}
                        {renderFlagChip(
                          t('admin.userGroups.flagWheelShort'),
                          group.allowLuckyWheel
                        )}
                        {renderFlagChip(
                          t('admin.userGroups.flagCustomNameShort'),
                          group.allowCustomServiceName
                        )}
                      </div>

                      {/* Delete Confirmation with Safe Member Transfer */}
                      {isDeletingThis ? (
                        <div className="pt-2.5 border-t border-danger/25 space-y-2.5 rounded-tile bg-danger-soft/50 p-3">
                          <div className="text-xs font-semibold text-danger-fg">
                            {t('admin.userGroups.deleteTitle', { name: group.name })}
                          </div>
                          <p className="text-[11px] text-ink-soft m-0 leading-relaxed">
                            {t('admin.userGroups.deletePrompt', {
                              count: formatNumber(group.memberCount),
                            })}
                          </p>
                          <div className="space-y-1">
                            <label className="text-[11px] font-medium text-ink-soft block">
                              {t('admin.userGroups.deleteTransferLabel')}
                            </label>
                            <Select
                              compact
                              value={transferTargetId}
                              onChange={(e) => setTransferTargetId(e.target.value)}
                            >
                              <option value="__none__" className="bg-surface text-ink">
                                {t('admin.userGroups.deleteTransferNone')}
                              </option>
                              {otherGroups.map((target) => (
                                <option
                                  key={target.id}
                                  value={target.id}
                                  className="bg-surface text-ink"
                                >
                                  {target.badge ? `${target.badge} ` : ''}
                                  {target.name}
                                  {target.isDefault
                                    ? ` (${t('admin.userGroups.defaultBadge')})`
                                    : ''}
                                </option>
                              ))}
                            </Select>
                          </div>
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={deleteMutation.isPending}
                              onClick={() => setDeletingGroup(null)}
                            >
                              {t('common.cancel')}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="danger"
                              loading={deleteMutation.isPending}
                              onClick={() =>
                                deleteMutation.mutate({
                                  id: group.id,
                                  transferToGroupId:
                                    transferTargetId === '__none__' ? null : transferTargetId,
                                })
                              }
                            >
                              <Trash2 className="w-3.5 h-3.5 shrink-0" />
                              <span>{t('admin.userGroups.deleteConfirmBtn')}</span>
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="pt-2 border-t border-line/70 flex items-center gap-1.5 flex-wrap">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={isBusy}
                            onClick={() => openEditForm(group)}
                          >
                            <Edit3 className="w-3.5 h-3.5 shrink-0" />
                            <span>{t('common.edit')}</span>
                          </Button>
                          {!group.isDefault && (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={isBusy}
                              onClick={() =>
                                updateMutation.mutate({
                                  id: group.id,
                                  payload: { isDefault: true },
                                })
                              }
                            >
                              <Star className="w-3.5 h-3.5 shrink-0" />
                              <span>{t('admin.userGroups.setDefaultBtn')}</span>
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={isBusy}
                            onClick={() => openDeleteConfirm(group)}
                            className="text-danger-fg ms-auto"
                            aria-label={t('common.delete')}
                          >
                            <Trash2 className="w-3.5 h-3.5 shrink-0" />
                          </Button>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};
