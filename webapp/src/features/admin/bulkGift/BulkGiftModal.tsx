import React, { useEffect, useState } from 'react';
import {
  Gift,
  Rocket,
  ListChecks,
  StopCircle,
  Loader2,
  Users,
  Database,
  Clock,
  RefreshCw,
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
import { Badge, type BadgeVariant } from '@/shared/components/ui/Badge.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { ProgressBar } from '@/shared/components/ui/ProgressBar.js';
import { SegmentedControl } from '@/shared/components/ui/SegmentedControl.js';
import { AlertBanner } from '@/shared/components/ui/AlertBanner.js';
import type {
  AdminBulkGiftJobDto,
  BulkGiftJobStatusDto,
  BulkGiftPreviewResponse,
  BulkGiftTargetStatusDto,
} from '@/shared/types/admin.js';

interface BulkGiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

const ALL_STATUSES: BulkGiftTargetStatusDto[] = ['active', 'on_hold', 'limited'];

function jobStatusBadgeVariant(status: BulkGiftJobStatusDto): BadgeVariant {
  switch (status) {
    case 'completed':
      return 'success';
    case 'running':
    case 'queued':
      return 'info';
    case 'cancel_requested':
      return 'warning';
    case 'cancelled':
      return 'neutral';
  }
}

export const BulkGiftModal: React.FC<BulkGiftModalProps> = ({ isOpen, onClose, onNotify }) => {
  const { t } = useLanguage();
  const { formatNumber, formatIsoDate } = useFormatters();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<'create' | 'campaigns'>('create');
  const [page, setPage] = useState(1);

  // Builder form state
  const [giftGbInput, setGiftGbInput] = useState('0');
  const [giftDaysInput, setGiftDaysInput] = useState('0');
  const [statuses, setStatuses] = useState<BulkGiftTargetStatusDto[]>(['active']);
  const [panelId, setPanelId] = useState<string>('');
  const [serviceId, setServiceId] = useState<string>('');
  const [notifyMessage, setNotifyMessage] = useState('');
  const [confirmLaunch, setConfirmLaunch] = useState(false);
  const [confirmCancelJobId, setConfirmCancelJobId] = useState<string | null>(null);

  // Live audience preview
  const [preview, setPreview] = useState<BulkGiftPreviewResponse | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: queryKeys.bulkGiftJobs(page),
    queryFn: () => api.getAdminBulkGiftJobs(page, 8),
    enabled: isOpen,
    refetchInterval: (query) => {
      const active = query.state.data?.activeCount ?? 0;
      return isOpen && active > 0 ? 3000 : false;
    },
  });

  // Debounced live audience preview
  useEffect(() => {
    if (!isOpen || tab !== 'create') return;
    let cancelled = false;
    setIsPreviewLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.previewAdminBulkGift({
          targetStatuses: statuses,
          panelId: panelId || null,
          serviceId: panelId && serviceId ? Number(serviceId) : null,
        });
        if (!cancelled) setPreview(res);
      } catch {
        if (!cancelled) setPreview(null);
      } finally {
        if (!cancelled) setIsPreviewLoading(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, tab, statuses, panelId, serviceId]);

  const createMutation = useMutation({
    mutationFn: api.createAdminBulkGiftJob,
    onSuccess: () => {
      onNotify(t('admin.bulkGift.launchedNotify'), 'success');
      setConfirmLaunch(false);
      setGiftGbInput('0');
      setGiftDaysInput('0');
      setNotifyMessage('');
      setPage(1);
      setTab('campaigns');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'bulkGiftJobs'] });
    },
    onError: (err: Error) => {
      setConfirmLaunch(false);
      onNotify(err.message || t('common.error'), 'error');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.cancelAdminBulkGiftJob(id),
    onSuccess: () => {
      setConfirmCancelJobId(null);
      onNotify(t('admin.bulkGift.cancelRequestedNotify'), 'success');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'bulkGiftJobs'] });
    },
    onError: (err: Error) => onNotify(err.message || t('common.error'), 'error'),
  });

  if (!isOpen) return null;

  const panels = data?.panels ?? [];
  const selectedPanel = panels.find((p) => p.id === panelId) ?? null;
  const maxGb = data?.limits?.maxGb ?? 10_000;
  const maxDays = data?.limits?.maxDays ?? 3_650;
  const maxMsgLen = data?.limits?.maxMessageLength ?? 3_800;

  const parsedGb = Number.parseInt(normalizeInputDigits(giftGbInput).trim() || '0', 10);
  const parsedDays = Number.parseInt(normalizeInputDigits(giftDaysInput).trim() || '0', 10);
  const validGb = Number.isSafeInteger(parsedGb) && parsedGb >= 0 && parsedGb <= maxGb;
  const validDays = Number.isSafeInteger(parsedDays) && parsedDays >= 0 && parsedDays <= maxDays;
  const hasReward = validGb && validDays && (parsedGb > 0 || parsedDays > 0);
  const canLaunch =
    hasReward &&
    statuses.length > 0 &&
    !isPreviewLoading &&
    (preview?.configCount ?? 0) > 0 &&
    !createMutation.isPending;

  const toggleStatus = (st: BulkGiftTargetStatusDto) => {
    setConfirmLaunch(false);
    setStatuses((prev) => {
      if (prev.includes(st)) {
        if (prev.length <= 1) return prev;
        return prev.filter((item) => item !== st);
      }
      return [...prev, st];
    });
  };

  const statusLabel = (st: BulkGiftTargetStatusDto): string => {
    if (st === 'active') return t('admin.bulkGift.statusActive');
    if (st === 'on_hold') return t('admin.bulkGift.statusOnHold');
    return t('admin.bulkGift.statusLimited');
  };

  const jobStatusLabel = (st: BulkGiftJobStatusDto): string => {
    switch (st) {
      case 'queued':
        return t('admin.bulkGift.jobQueued');
      case 'running':
        return t('admin.bulkGift.jobRunning');
      case 'cancel_requested':
        return t('admin.bulkGift.jobCancelling');
      case 'cancelled':
        return t('admin.bulkGift.jobCancelled');
      case 'completed':
        return t('admin.bulkGift.jobCompleted');
    }
  };

  const formatReward = (gb: number, days: number): string => {
    const parts: string[] = [];
    if (gb > 0) parts.push(`+${formatNumber(gb)} ${t('common.gb')}`);
    if (days > 0) parts.push(`+${formatNumber(days)} ${t('common.days')}`);
    return parts.join(' · ') || '—';
  };

  const handleLaunch = () => {
    if (!canLaunch) return;
    createMutation.mutate({
      giftGb: parsedGb,
      giftDays: parsedDays,
      targetStatuses: statuses,
      panelId: panelId || null,
      serviceId: panelId && serviceId ? Number(serviceId) : null,
      notifyMessage: notifyMessage.trim() || null,
    });
  };

  const renderJobCard = (job: AdminBulkGiftJobDto) => {
    const processed = job.appliedCount + job.skippedCount + job.failedCount;
    const pct =
      job.totalCount > 0 ? Math.min(100, Math.round((processed / job.totalCount) * 100)) : 100;
    const cancellable = job.status === 'queued' || job.status === 'running';
    const confirmingCancel = confirmCancelJobId === job.id;
    const panelName = job.panelId
      ? (panels.find((p) => p.id === job.panelId)?.name ?? job.panelId)
      : null;

    return (
      <Card key={job.id} padding="md" className="space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs sm:text-sm font-bold text-ink">
                {formatReward(job.giftGb, job.giftDays)}
              </span>
              <Badge variant={jobStatusBadgeVariant(job.status)} size="xs" dot>
                {jobStatusLabel(job.status)}
              </Badge>
            </div>
            <div className="text-[11px] text-ink-muted flex items-center gap-1.5 flex-wrap">
              <span>{job.targetStatuses.map(statusLabel).join('، ')}</span>
              {panelName && (
                <>
                  <span>·</span>
                  <span>
                    {panelName}
                    {job.serviceId ? ` (#${job.serviceId})` : ''}
                  </span>
                </>
              )}
              <span>·</span>
              <span>{formatIsoDate(job.createdAt)}</span>
            </div>
          </div>
          <span className="text-xs font-bold tnum text-brand-fg shrink-0">
            {formatNumber(pct)}%
          </span>
        </div>

        <ProgressBar
          value={pct}
          tone={
            job.status === 'completed'
              ? 'ok'
              : job.status === 'cancelled'
                ? 'neutral'
                : job.status === 'cancel_requested'
                  ? 'warn'
                  : 'brand'
          }
          size="md"
        />

        <div className="grid grid-cols-4 gap-1.5 text-center">
          <div className="rounded-ctl bg-surface-2 px-2 py-1.5">
            <div className="text-[10px] text-ink-muted">{t('admin.bulkGift.metricTotal')}</div>
            <div className="text-xs font-bold tnum text-ink">{formatNumber(job.totalCount)}</div>
          </div>
          <div className="rounded-ctl bg-ok-soft/60 px-2 py-1.5">
            <div className="text-[10px] text-ok-fg">{t('admin.bulkGift.metricApplied')}</div>
            <div className="text-xs font-bold tnum text-ok-fg">
              {formatNumber(job.appliedCount)}
            </div>
          </div>
          <div className="rounded-ctl bg-surface-2 px-2 py-1.5">
            <div className="text-[10px] text-ink-muted">{t('admin.bulkGift.metricSkipped')}</div>
            <div className="text-xs font-bold tnum text-ink-soft">
              {formatNumber(job.skippedCount)}
            </div>
          </div>
          <div className="rounded-ctl bg-danger-soft/60 px-2 py-1.5">
            <div className="text-[10px] text-danger-fg">{t('admin.bulkGift.metricFailed')}</div>
            <div className="text-xs font-bold tnum text-danger-fg">
              {formatNumber(job.failedCount)}
            </div>
          </div>
        </div>

        {cancellable && (
          <div className="pt-2 border-t border-line flex items-center justify-between gap-2">
            {confirmingCancel ? (
              <>
                <span className="text-[11px] text-warn-fg font-medium">
                  {t('admin.bulkGift.cancelConfirmPrompt')}
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setConfirmCancelJobId(null)}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    loading={cancelMutation.isPending}
                    onClick={() => cancelMutation.mutate(job.id)}
                  >
                    <StopCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{t('admin.bulkGift.cancelConfirmBtn')}</span>
                  </Button>
                </div>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="danger"
                onClick={() => setConfirmCancelJobId(job.id)}
                className="ms-auto"
              >
                <StopCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{t('admin.bulkGift.cancelCampaignBtn')}</span>
              </Button>
            )}
          </div>
        )}
      </Card>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="lg"
      title={t('admin.bulkGift.title')}
      subtitle={t('admin.bulkGift.subtitle')}
      icon={
        <IconTile tone="accent" size="sm">
          <Gift />
        </IconTile>
      }
    >
      <div className="space-y-4 text-start">
        <SegmentedControl
          value={tab}
          onChange={(v) => {
            setConfirmLaunch(false);
            setTab(v);
          }}
          options={[
            { id: 'create', label: t('admin.bulkGift.tabCreate'), icon: Rocket },
            {
              id: 'campaigns',
              label: t('admin.bulkGift.tabCampaigns'),
              icon: ListChecks,
              count: data?.activeCount ? formatNumber(data.activeCount) : null,
              tone: data?.activeCount ? 'brand' : 'default',
            },
          ]}
        />

        {tab === 'create' ? (
          <div className="space-y-3.5">
            {/* Reward Amount Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Card padding="md" className="space-y-2">
                <label className="text-xs font-semibold text-ink flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-brand-fg" />
                  <span>{t('admin.bulkGift.gbLabel')}</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  dir="ltr"
                  value={giftGbInput}
                  onChange={(e) => {
                    setConfirmLaunch(false);
                    setGiftGbInput(e.target.value);
                  }}
                  className="w-full h-10 px-3 rounded-ctl border border-line bg-surface-2 text-sm font-semibold text-ink tnum rs-focus"
                />
                <div className="flex items-center gap-1.5 flex-wrap">
                  {[0, 5, 10, 20, 50].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setConfirmLaunch(false);
                        setGiftGbInput(String(preset));
                      }}
                      className="px-2 py-0.5 rounded-full border border-line bg-surface-2 hover:bg-surface-3 text-[11px] font-medium text-ink-soft cursor-pointer"
                    >
                      {preset === 0 ? '0' : `+${formatNumber(preset)} GB`}
                    </button>
                  ))}
                </div>
              </Card>

              <Card padding="md" className="space-y-2">
                <label className="text-xs font-semibold text-ink flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-accent-fg" />
                  <span>{t('admin.bulkGift.daysLabel')}</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  dir="ltr"
                  value={giftDaysInput}
                  onChange={(e) => {
                    setConfirmLaunch(false);
                    setGiftDaysInput(e.target.value);
                  }}
                  className="w-full h-10 px-3 rounded-ctl border border-line bg-surface-2 text-sm font-semibold text-ink tnum rs-focus"
                />
                <div className="flex items-center gap-1.5 flex-wrap">
                  {[0, 3, 7, 15, 30].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setConfirmLaunch(false);
                        setGiftDaysInput(String(preset));
                      }}
                      className="px-2 py-0.5 rounded-full border border-line bg-surface-2 hover:bg-surface-3 text-[11px] font-medium text-ink-soft cursor-pointer"
                    >
                      {preset === 0 ? '0' : `+${formatNumber(preset)} ${t('common.days')}`}
                    </button>
                  ))}
                </div>
              </Card>
            </div>

            {/* Audience Filter */}
            <Card padding="md" className="space-y-3">
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-ink">
                  {t('admin.bulkGift.targetStatusesLabel')}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {ALL_STATUSES.map((st) => {
                    const active = statuses.includes(st);
                    return (
                      <button
                        key={st}
                        type="button"
                        onClick={() => toggleStatus(st)}
                        className={`press rs-focus rounded-full border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                          active
                            ? 'border-brand bg-brand-soft text-brand-fg font-semibold'
                            : 'border-line bg-surface-2 text-ink-soft hover:text-ink'
                        }`}
                      >
                        {active ? '✓ ' : ''}
                        {statusLabel(st)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {panels.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-ink-soft block">
                      {t('admin.bulkGift.panelFilterLabel')}
                    </label>
                    <select
                      value={panelId}
                      onChange={(e) => {
                        setConfirmLaunch(false);
                        setPanelId(e.target.value);
                        setServiceId('');
                      }}
                      className="w-full h-9 px-2.5 rounded-ctl border border-line bg-surface-2 text-xs text-ink rs-focus"
                    >
                      <option value="">{t('admin.bulkGift.allPanels')}</option>
                      {panels.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedPanel && selectedPanel.services.length > 0 && (
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-ink-soft block">
                        {t('admin.bulkGift.serviceFilterLabel')}
                      </label>
                      <select
                        value={serviceId}
                        onChange={(e) => {
                          setConfirmLaunch(false);
                          setServiceId(e.target.value);
                        }}
                        className="w-full h-9 px-2.5 rounded-ctl border border-line bg-surface-2 text-xs text-ink rs-focus"
                      >
                        <option value="">{t('admin.bulkGift.allServices')}</option>
                        {selectedPanel.services.map((svc) => (
                          <option key={svc.serviceId} value={String(svc.serviceId)}>
                            {svc.name} (#{svc.serviceId})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {/* Live Preview Box */}
              <div className="rounded-tile border border-brand/25 bg-brand-soft/45 px-3.5 py-2.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-medium text-ink">
                  <Users className="w-4 h-4 text-brand-fg shrink-0" />
                  <span>{t('admin.bulkGift.previewLabel')}</span>
                </div>
                {isPreviewLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-brand-fg" />
                ) : (
                  <span className="text-xs font-bold tnum text-brand-fg">
                    {t('admin.bulkGift.previewValue', {
                      configs: formatNumber(preview?.configCount ?? 0),
                      users: formatNumber(preview?.userCount ?? 0),
                    })}
                  </span>
                )}
              </div>
            </Card>

            {/* Optional Notification Message */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-ink-soft">
                  {t('admin.bulkGift.notifyMessageLabel')}
                </label>
                <span className="text-[10px] tnum text-ink-muted">
                  {formatNumber(notifyMessage.length)} / {formatNumber(maxMsgLen)}
                </span>
              </div>
              <textarea
                rows={3}
                maxLength={maxMsgLen}
                value={notifyMessage}
                onChange={(e) => setNotifyMessage(e.target.value)}
                placeholder={t('admin.bulkGift.notifyPlaceholder')}
                className="w-full p-3 rounded-ctl border border-line bg-surface-2 text-xs text-ink leading-relaxed rs-focus resize-y"
              />
            </div>

            {!hasReward && (
              <p className="text-[11px] text-ink-muted m-0">
                {t('admin.bulkGift.amountRequiredHint')}
              </p>
            )}

            {confirmLaunch ? (
              <AlertBanner tone="warn">
                <div className="space-y-2.5">
                  <div className="text-xs font-semibold">
                    {t('admin.bulkGift.confirmTitle', {
                      reward: formatReward(parsedGb, parsedDays),
                      configs: formatNumber(preview?.configCount ?? 0),
                    })}
                  </div>
                  <p className="text-[11px] m-0 opacity-90">{t('admin.bulkGift.confirmHint')}</p>
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setConfirmLaunch(false)}
                    >
                      {t('common.cancel')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      loading={createMutation.isPending}
                      onClick={handleLaunch}
                    >
                      <Rocket className="w-3.5 h-3.5 shrink-0" />
                      <span>{t('admin.bulkGift.launchBtn')}</span>
                    </Button>
                  </div>
                </div>
              </AlertBanner>
            ) : (
              <Button
                type="button"
                variant="primary"
                size="md"
                block
                disabled={!canLaunch}
                onClick={() => setConfirmLaunch(true)}
              >
                <Rocket className="w-4 h-4 shrink-0" />
                <span>{t('admin.bulkGift.reviewAndLaunchBtn')}</span>
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-muted">
                {t('admin.bulkGift.totalCampaigns', {
                  count: formatNumber(data?.total ?? 0),
                })}
              </span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={isRefetching}
                onClick={() => void refetch()}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefetching ? 'animate-spin' : ''}`} />
                <span>{t('common.refresh')}</span>
              </Button>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-ink-muted gap-2 text-xs">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{t('common.loading')}</span>
              </div>
            ) : !data || data.items.length === 0 ? (
              <Card padding="lg" className="text-center">
                <p className="text-xs text-ink-muted m-0">{t('admin.bulkGift.emptyCampaigns')}</p>
              </Card>
            ) : (
              <div className="space-y-2.5">
                {data.items.map(renderJobCard)}

                {data.totalPages > 1 && (
                  <div className="flex items-center justify-between pt-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      {t('admin.users.paginationPrev')}
                    </Button>
                    <span className="text-xs text-ink-muted tnum">
                      {formatNumber(data.page)} / {formatNumber(data.totalPages)}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={page >= data.totalPages}
                      onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                    >
                      {t('admin.users.paginationNext')}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
