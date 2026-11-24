import React, { useEffect, useState } from 'react';
import { Tags, Check, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { api } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import { normalizeInputDigits } from '@/shared/lib/formatters.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { Input, Select } from '@/shared/components/ui/Input.js';
import { AlertBanner } from '@/shared/components/ui/AlertBanner.js';
import type { AssignUserGroupPayload, UserProfile } from '@/shared/types/admin.js';

type DurationChoice = 'permanent' | '7' | '30' | '90' | 'custom';

interface UserGroupAssignModalProps {
  user: UserProfile | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: AssignUserGroupPayload) => Promise<void>;
  loading?: boolean;
}

export const UserGroupAssignModal: React.FC<UserGroupAssignModalProps> = ({
  user,
  isOpen,
  onClose,
  onSubmit,
  loading = false,
}) => {
  const { t } = useLanguage();
  const { formatNumber, formatMoney, formatId, sanitizeDisplayName } = useFormatters();

  const [selectedGroupId, setSelectedGroupId] = useState<string>('__none__');
  const [durationChoice, setDurationChoice] = useState<DurationChoice>('permanent');
  const [customDays, setCustomDays] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.userGroups,
    queryFn: () => api.getAdminUserGroups(),
    enabled: isOpen,
  });

  useEffect(() => {
    if (!isOpen || !user) return;
    setSelectedGroupId(user.group?.isAssigned && user.group.id ? user.group.id : '__none__');
    setDurationChoice('permanent');
    setCustomDays('');
    setError(null);
  }, [isOpen, user]);

  if (!isOpen || !user) return null;

  const groups = data?.groups ?? [];
  const { displayName } = sanitizeDisplayName(
    user.firstName,
    user.lastName,
    user.username ? `@${user.username}` : t('user.guestUser')
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const groupId = selectedGroupId === '__none__' ? null : selectedGroupId;
    let durationDays: number | null = null;

    if (groupId !== null && durationChoice !== 'permanent') {
      if (durationChoice === 'custom') {
        const cleaned = normalizeInputDigits(customDays).replace(/[^0-9]/g, '');
        const parsed = Number(cleaned);
        if (!cleaned || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > 3650) {
          setError(t('admin.users.durationCustomInvalid'));
          return;
        }
        durationDays = parsed;
      } else {
        durationDays = Number(durationChoice);
      }
    }

    await onSubmit({ groupId, durationDays });
  };

  const durationOptions: Array<{ id: DurationChoice; label: string }> = [
    { id: 'permanent', label: t('admin.users.durationPermanent') },
    { id: '7', label: t('admin.users.duration7d') },
    { id: '30', label: t('admin.users.duration30d') },
    { id: '90', label: t('admin.users.duration90d') },
    { id: 'custom', label: t('admin.users.durationCustom') },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="md"
      closeOnBackdrop={!loading}
      title={t('admin.users.assignGroupTitle')}
      subtitle={
        <div className="flex items-center gap-1.5 flex-wrap tnum text-brand-fg">
          <span>{displayName}</span>
          {user.username && <bdi dir="ltr">(@{user.username})</bdi>}
          <span className="opacity-40">·</span>
          <bdi dir="ltr">#{formatId(user.telegramId)}</bdi>
        </div>
      }
      icon={
        <IconTile tone="accent" size="sm">
          <Tags />
        </IconTile>
      }
      footer={
        <div className="flex items-center gap-2.5">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={onClose}
            disabled={loading}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="assign-user-group-form"
            variant="primary"
            className="flex-1"
            loading={loading}
            disabled={loading || isLoading}
          >
            <Check className="w-3.5 h-3.5 shrink-0" />
            <span>{t('admin.users.assignGroupSave')}</span>
          </Button>
        </div>
      }
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-8 gap-2 text-xs text-ink-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{t('common.loading')}</span>
        </div>
      ) : (
        <form
          id="assign-user-group-form"
          onSubmit={(e) => void handleSubmit(e)}
          className="space-y-4 text-start"
        >
          {error && <AlertBanner tone="danger">{error}</AlertBanner>}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold block text-ink">
              {t('admin.users.assignGroupSelectLabel')}
            </label>
            <Select
              value={selectedGroupId}
              onChange={(e) => setSelectedGroupId(e.target.value)}
              disabled={loading}
            >
              <option value="__none__" className="bg-surface text-ink">
                {t('admin.users.assignGroupNoneOption')}
              </option>
              {groups.map((grp) => {
                const perks: string[] = [];
                if (grp.discountPercent > 0) perks.push(`-${formatNumber(grp.discountPercent)}%`);
                if (grp.creditLimit > 0) {
                  perks.push(`${formatMoney(grp.creditLimit)} ${t('common.currency')}`);
                }
                const perkText = perks.length > 0 ? ` (${perks.join(' · ')})` : '';
                return (
                  <option key={grp.id} value={grp.id} className="bg-surface text-ink">
                    {grp.badge ? `${grp.badge} ` : ''}
                    {grp.name}
                    {grp.isDefault ? ` [${t('admin.userGroups.defaultBadge')}]` : ''}
                    {perkText}
                  </option>
                );
              })}
            </Select>
          </div>

          {selectedGroupId !== '__none__' && (
            <div className="space-y-2">
              <label className="text-xs font-semibold block text-ink">
                {t('admin.users.assignGroupDurationLabel')}
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {durationOptions.map((opt) => {
                  const selected = durationChoice === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={loading}
                      onClick={() => {
                        setDurationChoice(opt.id);
                        setError(null);
                      }}
                      className={`h-9 px-2.5 rounded-ctl text-xs border press rs-focus cursor-pointer transition-colors ${
                        selected
                          ? 'bg-brand-soft border-brand/40 text-brand-fg font-semibold'
                          : 'bg-surface-2 border-line text-ink-soft hover:border-line-strong hover:text-ink font-medium'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              {durationChoice === 'custom' && (
                <Input
                  type="text"
                  inputMode="numeric"
                  dir="ltr"
                  className="tnum"
                  placeholder={t('admin.users.durationCustomPlaceholder')}
                  value={customDays}
                  onChange={(e) => {
                    setCustomDays(normalizeInputDigits(e.target.value).replace(/[^0-9]/g, ''));
                    setError(null);
                  }}
                />
              )}
            </div>
          )}
        </form>
      )}
    </Modal>
  );
};
