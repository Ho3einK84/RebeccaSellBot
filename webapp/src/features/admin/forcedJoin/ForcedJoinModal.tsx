import React, { useState } from 'react';
import {
  Megaphone,
  Plus,
  Edit3,
  Trash2,
  Stethoscope,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Save,
  ShieldCheck,
  Loader2,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
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
import type {
  AdminForcedJoinChannelDto,
  AdminForcedJoinScope,
  AdminForcedJoinTestResponse,
} from '@/shared/types/admin.js';

interface ForcedJoinModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

const SCOPES: AdminForcedJoinScope[] = ['off', 'all', 'trial_only', 'purchase_and_trial'];

export const ForcedJoinModal: React.FC<ForcedJoinModalProps> = ({ isOpen, onClose, onNotify }) => {
  const { t } = useLanguage();
  const { formatNumber } = useFormatters();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<AdminForcedJoinChannelDto | 'new' | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [channelId, setChannelId] = useState('');
  const [title, setTitle] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [formTestResult, setFormTestResult] = useState<AdminForcedJoinTestResponse | null>(null);
  const [channelTests, setChannelTests] = useState<Record<string, AdminForcedJoinTestResponse>>({});
  const [testingChannelKey, setTestingChannelKey] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.forcedJoin,
    queryFn: () => api.getAdminForcedJoin(),
    enabled: isOpen,
  });

  const syncData = (next: Awaited<ReturnType<typeof api.getAdminForcedJoin>>) => {
    queryClient.setQueryData(queryKeys.forcedJoin, next);
  };

  const scopeMutation = useMutation({
    mutationFn: (scope: AdminForcedJoinScope) => api.updateAdminForcedJoinScope(scope),
    onSuccess: (next) => {
      syncData(next);
      onNotify(t('admin.forcedJoin.scopeSaved'), 'success');
    },
    onError: (err: Error) => onNotify(err.message || t('common.error'), 'error'),
  });

  const createMutation = useMutation({
    mutationFn: api.createAdminForcedJoinChannel,
    onSuccess: (next) => {
      syncData(next);
      onNotify(t('admin.forcedJoin.channelAdded'), 'success');
      setEditing(null);
      setFormTestResult(null);
    },
    onError: (err: Error) => {
      setFormError(err.message || t('common.error'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Parameters<typeof api.updateAdminForcedJoinChannel>[1];
    }) => api.updateAdminForcedJoinChannel(id, payload),
    onSuccess: (next) => {
      syncData(next);
      onNotify(t('admin.forcedJoin.channelUpdated'), 'success');
      setEditing(null);
      setFormTestResult(null);
    },
    onError: (err: Error) => {
      setFormError(err.message || t('common.error'));
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.toggleAdminForcedJoinChannel(id, enabled),
    onSuccess: syncData,
    onError: (err: Error) => onNotify(err.message || t('common.error'), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteAdminForcedJoinChannel(id),
    onSuccess: (next) => {
      syncData(next);
      setConfirmDeleteId(null);
      onNotify(t('admin.forcedJoin.channelDeleted'), 'success');
    },
    onError: (err: Error) => onNotify(err.message || t('common.error'), 'error'),
  });

  if (!isOpen) return null;

  const scope = data?.scope ?? 'off';
  const channels = data?.channels ?? [];
  const activeCount = data?.activeCount ?? 0;
  const maxChannels = data?.maxChannels ?? 10;
  const isBusy =
    scopeMutation.isPending ||
    createMutation.isPending ||
    updateMutation.isPending ||
    toggleMutation.isPending ||
    deleteMutation.isPending;

  const scopeLabel = (s: AdminForcedJoinScope): string => {
    switch (s) {
      case 'all':
        return t('admin.forcedJoin.scopeAll');
      case 'trial_only':
        return t('admin.forcedJoin.scopeTrialOnly');
      case 'purchase_and_trial':
        return t('admin.forcedJoin.scopePurchaseAndTrial');
      default:
        return t('admin.forcedJoin.scopeOff');
    }
  };

  const openAddForm = () => {
    setFormError(null);
    setFormTestResult(null);
    setChannelId('');
    setTitle('');
    setInviteLink('');
    setEditing('new');
  };

  const openEditForm = (ch: AdminForcedJoinChannelDto) => {
    setFormError(null);
    setFormTestResult(null);
    setChannelId(ch.channelId);
    setTitle(ch.title);
    setInviteLink(ch.inviteLink);
    setEditing(ch);
  };

  const handleTestFormAccess = async () => {
    const cleaned = normalizeInputDigits(channelId).trim();
    if (!cleaned) {
      setFormError(t('admin.forcedJoin.channelIdRequired'));
      return;
    }
    setFormError(null);
    setTestingChannelKey('form');
    try {
      const res = await api.testAdminForcedJoinChannel(cleaned);
      setFormTestResult(res);
      if (res.chatTitle && !title.trim()) {
        setTitle(res.chatTitle);
      }
      if (res.inviteLink && !inviteLink.trim()) {
        setInviteLink(res.inviteLink);
      }
      if (res.ok) {
        onNotify(t('admin.forcedJoin.testOk'), 'success');
      } else {
        onNotify(res.errorMessage || t('admin.forcedJoin.testFailed'), 'error');
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setTestingChannelKey(null);
    }
  };

  const handleTestExistingChannel = async (ch: AdminForcedJoinChannelDto) => {
    setTestingChannelKey(ch.id);
    try {
      const res = await api.testAdminForcedJoinChannel(ch.channelId);
      setChannelTests((prev) => ({ ...prev, [ch.id]: res }));
      if (res.ok) {
        onNotify(t('admin.forcedJoin.testOk'), 'success');
      } else {
        onNotify(res.errorMessage || t('admin.forcedJoin.testFailed'), 'error');
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setTestingChannelKey(null);
    }
  };

  const handleSaveChannel = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const cleanedId = normalizeInputDigits(channelId).trim();
    const cleanedTitle = title.trim();
    const cleanedLink = inviteLink.trim();
    if (!cleanedId) {
      setFormError(t('admin.forcedJoin.channelIdRequired'));
      return;
    }
    if (!cleanedTitle) {
      setFormError(t('admin.forcedJoin.titleRequired'));
      return;
    }

    if (editing === 'new') {
      createMutation.mutate({
        channelId: cleanedId,
        title: cleanedTitle,
        inviteLink: cleanedLink || null,
        enabled: true,
      });
    } else if (editing) {
      updateMutation.mutate({
        id: editing.id,
        payload: {
          channelId: cleanedId,
          title: cleanedTitle,
          inviteLink: cleanedLink || null,
        },
      });
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="lg"
      title={t('admin.forcedJoin.title')}
      subtitle={t('admin.forcedJoin.subtitle')}
      icon={
        <IconTile tone="brand" size="sm">
          <Megaphone />
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
          <form onSubmit={handleSaveChannel} className="space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="m-0 text-sm font-semibold text-ink">
                {editing === 'new'
                  ? t('admin.forcedJoin.addChannelTitle')
                  : t('admin.forcedJoin.editChannelTitle')}
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setFormError(null);
                  setFormTestResult(null);
                }}
              >
                {t('common.cancel')}
              </Button>
            </div>

            {formError && <AlertBanner tone="danger">{formError}</AlertBanner>}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-ink-soft block">
                {t('admin.forcedJoin.channelIdLabel')}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  dir="ltr"
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                  placeholder="@mychannel or -1001234567890"
                  className="flex-1 h-10 px-3 rounded-ctl border border-line bg-surface-2 text-xs text-ink font-mono rs-focus"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={testingChannelKey === 'form'}
                  disabled={testingChannelKey === 'form' || !channelId.trim()}
                  onClick={() => void handleTestFormAccess()}
                  className="h-10 shrink-0"
                >
                  <Stethoscope className="w-3.5 h-3.5 shrink-0" />
                  <span>{t('admin.forcedJoin.testAccessBtn')}</span>
                </Button>
              </div>
              <p className="text-[11px] text-ink-muted m-0">
                {t('admin.forcedJoin.channelIdHint')}
              </p>
            </div>

            {formTestResult && (
              <AlertBanner tone={formTestResult.ok ? 'ok' : 'warn'}>
                <div className="flex items-center gap-2 text-xs">
                  {formTestResult.ok ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                  )}
                  <span>
                    {formTestResult.ok
                      ? t('admin.forcedJoin.testOk')
                      : `${t('admin.forcedJoin.testFailed')}${formTestResult.errorMessage ? `: ${formTestResult.errorMessage}` : ''}`}
                  </span>
                </div>
              </AlertBanner>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-ink-soft block">
                {t('admin.forcedJoin.titleLabel')}
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={80}
                placeholder={t('admin.forcedJoin.titlePlaceholder')}
                className="w-full h-10 px-3 rounded-ctl border border-line bg-surface-2 text-xs text-ink rs-focus"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-ink-soft block">
                {t('admin.forcedJoin.inviteLinkLabel')}
              </label>
              <input
                type="text"
                dir="ltr"
                value={inviteLink}
                onChange={(e) => setInviteLink(e.target.value)}
                placeholder="https://t.me/+..."
                className="w-full h-10 px-3 rounded-ctl border border-line bg-surface-2 text-xs text-ink font-mono rs-focus"
              />
              <p className="text-[11px] text-ink-muted m-0">
                {t('admin.forcedJoin.inviteLinkHint')}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setFormError(null);
                  setFormTestResult(null);
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={createMutation.isPending || updateMutation.isPending}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                <Save className="w-3.5 h-3.5 shrink-0" />
                <span>{t('common.save')}</span>
              </Button>
            </div>
          </form>
        ) : (
          <>
            {/* Scope Selector Card */}
            <Card padding="md" className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-ink">
                    {t('admin.forcedJoin.scopeTitle')}
                  </div>
                  <p className="text-[11px] text-ink-muted m-0">
                    {t('admin.forcedJoin.scopeDesc')}
                  </p>
                </div>
                <Badge variant={scope === 'off' ? 'neutral' : 'primary'} size="xs" dot>
                  {scopeLabel(scope)}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {SCOPES.map((s) => {
                  const selected = scope === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      disabled={scopeMutation.isPending}
                      onClick={() => {
                        if (!selected) scopeMutation.mutate(s);
                      }}
                      className={`press rs-focus rounded-ctl border px-3 py-2 text-xs font-medium text-start transition-colors cursor-pointer ${
                        selected
                          ? 'border-brand bg-brand-soft text-brand-fg font-semibold'
                          : 'border-line bg-surface-2 text-ink-soft hover:text-ink hover:bg-surface-3'
                      }`}
                    >
                      {scopeLabel(s)}
                    </button>
                  );
                })}
              </div>
            </Card>

            {scope !== 'off' && activeCount === 0 && (
              <AlertBanner tone="warn">{t('admin.forcedJoin.noActiveChannelsWarn')}</AlertBanner>
            )}

            <div className="rounded-tile border border-line bg-surface-2/70 px-3 py-2 text-[11px] text-ink-muted flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-ok-fg shrink-0" />
              <span>{t('admin.forcedJoin.failSafeNote')}</span>
            </div>

            {/* Channels Header */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="text-xs font-semibold text-ink flex items-center gap-1.5">
                <span>{t('admin.forcedJoin.channelsTitle')}</span>
                <Badge variant="neutral" size="xs">
                  {formatNumber(activeCount)} / {formatNumber(channels.length)}
                </Badge>
              </div>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={isBusy || channels.length >= maxChannels}
                onClick={openAddForm}
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>{t('admin.forcedJoin.addChannelBtn')}</span>
              </Button>
            </div>

            {/* Channels List */}
            {channels.length === 0 ? (
              <Card padding="lg" className="text-center space-y-2">
                <p className="text-xs text-ink-muted m-0">{t('admin.forcedJoin.emptyChannels')}</p>
              </Card>
            ) : (
              <div className="space-y-2.5">
                {channels.map((ch) => {
                  const testRes = channelTests[ch.id];
                  const isDeletingThis = confirmDeleteId === ch.id;
                  return (
                    <Card key={ch.id} padding="md" className="space-y-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs sm:text-sm font-semibold text-ink truncate">
                              {ch.title}
                            </span>
                            <Badge variant={ch.enabled ? 'success' : 'neutral'} size="xs" dot>
                              {ch.enabled
                                ? t('admin.forcedJoin.enabled')
                                : t('admin.forcedJoin.disabled')}
                            </Badge>
                          </div>
                          <div className="text-[11px] font-mono text-ink-muted truncate">
                            <bdi dir="ltr">{ch.channelId}</bdi>
                          </div>
                          <a
                            href={ch.inviteLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-brand-fg hover:underline truncate max-w-full"
                          >
                            <bdi dir="ltr" className="truncate">
                              {ch.inviteLink}
                            </bdi>
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </a>
                        </div>
                        <Switch
                          checked={ch.enabled}
                          disabled={isBusy}
                          ariaLabel={ch.title}
                          onChange={(checked) =>
                            toggleMutation.mutate({ id: ch.id, enabled: checked })
                          }
                        />
                      </div>

                      {testRes && (
                        <div
                          className={`rounded-ctl px-2.5 py-1.5 text-[11px] flex items-center gap-1.5 ${
                            testRes.ok
                              ? 'bg-ok-soft text-ok-fg border border-ok/25'
                              : 'bg-warn-soft text-warn-fg border border-warn/25'
                          }`}
                        >
                          {testRes.ok ? (
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          ) : (
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          )}
                          <span className="truncate">
                            {testRes.ok
                              ? t('admin.forcedJoin.testOk')
                              : `${t('admin.forcedJoin.testFailed')}${testRes.errorMessage ? `: ${testRes.errorMessage}` : ''}`}
                          </span>
                        </div>
                      )}

                      {isDeletingThis ? (
                        <div className="pt-2 border-t border-line flex items-center justify-between gap-2">
                          <span className="text-[11px] text-danger-fg font-medium">
                            {t('admin.forcedJoin.deleteConfirm')}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              {t('common.cancel')}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="danger"
                              loading={deleteMutation.isPending}
                              onClick={() => deleteMutation.mutate(ch.id)}
                            >
                              {t('common.delete')}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="pt-2 border-t border-line/70 flex items-center gap-1.5 flex-wrap">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            loading={testingChannelKey === ch.id}
                            disabled={testingChannelKey === ch.id}
                            onClick={() => void handleTestExistingChannel(ch)}
                          >
                            <Stethoscope className="w-3.5 h-3.5 shrink-0" />
                            <span>{t('admin.forcedJoin.testAccessBtn')}</span>
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={isBusy}
                            onClick={() => openEditForm(ch)}
                          >
                            <Edit3 className="w-3.5 h-3.5 shrink-0" />
                            <span>{t('common.edit')}</span>
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={isBusy}
                            onClick={() => setConfirmDeleteId(ch.id)}
                            className="text-danger-fg ms-auto"
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
