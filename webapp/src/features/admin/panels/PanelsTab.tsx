import React, { useState, useMemo } from 'react';
import {
  Server,
  RefreshCw,
  Activity,
  Plus,
  Zap,
  Users,
  Layers,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Power,
} from 'lucide-react';
import { useAdminPanels } from './hooks/useAdminPanels.js';
import { PanelCard } from './components/PanelCard.js';
import { AddPanelModal } from './components/AddPanelModal.js';
import { EditPanelModal } from './components/EditPanelModal.js';
import { ManageServicesModal } from './components/ManageServicesModal.js';
import { DeletePanelModal } from './components/DeletePanelModal.js';
import { Card } from '@/shared/components/ui/Card.js';
import { Button } from '@/shared/components/ui/Button.js';
import { EmptyState } from '@/shared/components/ui/EmptyState.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { SectionHeader } from '@/shared/components/ui/SectionHeader.js';
import { SegmentedControl, type SegmentedOption } from '@/shared/components/ui/SegmentedControl.js';
import { SkeletonList } from '@/shared/components/ui/Skeleton.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import type { PanelSummary } from '@/shared/types/admin.js';
import type {
  CreatePanelPayload,
  UpdatePanelPayload,
  AddPanelServicePayload,
} from '@/shared/types/api.js';

interface PanelsTabProps {
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

type PanelFilter = 'all' | 'online' | 'issues';

export const PanelsTab: React.FC<PanelsTabProps> = ({ onNotify }) => {
  const { t } = useLanguage();
  const { formatNumber } = useFormatters();
  const {
    panels,
    fleetSummary,
    isLoading,
    isError,
    error,
    isRefetching,
    refetch,
    testPanel,
    testingPanelId,
    togglingPanelId,
    settingDefaultPanelId,
    isTestingAll,
    testAllPanels,
    createPanel,
    isCreating,
    updatePanel,
    isUpdating,
    togglePanel,
    setDefaultPanel,
    deletePanel,
    isDeleting,
    addService,
    isMutatingService,
    setDefaultService,
    setCustomTarget,
    deleteService,
  } = useAdminPanels();

  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingPanel, setEditingPanel] = useState<PanelSummary | null>(null);
  const [servicesPanel, setServicesPanel] = useState<PanelSummary | null>(null);
  const [deletingPanel, setDeletingPanel] = useState<PanelSummary | null>(null);
  const [disablingPanel, setDisablingPanel] = useState<PanelSummary | null>(null);

  // Filter state
  const [filter, setFilter] = useState<PanelFilter>('all');

  // Sync servicesPanel with updated panels query if open
  const activeServicesPanel = useMemo(() => {
    if (!servicesPanel) return null;
    return panels.find((p) => p.id === servicesPanel.id) || servicesPanel;
  }, [servicesPanel, panels]);

  // Handle panel connection test
  const handleTestPanel = async (panelId: string) => {
    try {
      const res = await testPanel(panelId);
      if (res.success && res.healthy) {
        onNotify(
          t('admin.notifications.panelTestSuccess', {
            ms: formatNumber(res.latencyMs ?? 0),
          }),
          'success'
        );
      } else {
        onNotify(res.error || t('admin.notifications.panelTestFailed'), 'error');
      }
    } catch {
      onNotify(t('admin.notifications.networkError'), 'error');
    }
  };

  // Handle fleet test all
  const handleTestAll = async () => {
    try {
      const res = await testAllPanels();
      if (res.success) {
        const results = Object.values(res.results || {});
        const healthyCount = results.filter((r) => r.healthy).length;
        onNotify(
          t('admin.panels.testAllSuccessNotify', {
            healthy: formatNumber(healthyCount),
            total: formatNumber(results.length),
          }),
          'success'
        );
      }
    } catch {
      onNotify(t('admin.notifications.networkError'), 'error');
    }
  };

  // Handle create panel
  const handleCreatePanel = async (payload: CreatePanelPayload) => {
    try {
      const res = await createPanel(payload);
      if (res.success) {
        onNotify(t('admin.panels.createSuccessNotify'), 'success');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('admin.notifications.saveFailed');
      onNotify(message, 'error');
      throw err;
    }
  };

  // Handle edit panel
  const handleUpdatePanel = async (payload: UpdatePanelPayload) => {
    if (!editingPanel) return;
    try {
      await updatePanel(editingPanel.id, payload);
      onNotify(t('admin.panels.updateSuccessNotify'), 'success');
      setEditingPanel(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('admin.notifications.saveFailed');
      onNotify(message, 'error');
      throw err;
    }
  };

  // Handle toggle enable/disable
  const handleToggle = async (panelId: string, enabled: boolean) => {
    try {
      await togglePanel(panelId, enabled);
      onNotify(
        enabled ? t('admin.panels.enableSuccessNotify') : t('admin.panels.disableSuccessNotify'),
        'success'
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('admin.notifications.saveFailed');
      onNotify(message, 'error');
    }
  };

  // Handle set default
  const handleSetDefault = async (panelId: string) => {
    try {
      await setDefaultPanel(panelId);
      onNotify(t('admin.panels.setDefaultSuccessNotify'), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('admin.notifications.saveFailed');
      onNotify(message, 'error');
    }
  };

  // Handle delete panel
  const handleDeletePanel = async (panelId: string) => {
    try {
      await deletePanel(panelId);
      onNotify(t('admin.panels.deleteSuccessNotify'), 'success');
      setDeletingPanel(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('admin.notifications.saveFailed');
      onNotify(message, 'error');
      throw err;
    }
  };

  // Handle add service
  const handleAddService = async (panelId: string, payload: AddPanelServicePayload) => {
    try {
      await addService(panelId, payload);
      onNotify(t('admin.panels.addServiceSuccessNotify'), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('admin.notifications.saveFailed');
      onNotify(message, 'error');
      throw err;
    }
  };

  // Handle set default service
  const handleSetDefaultService = async (panelId: string, serviceId: number) => {
    try {
      await setDefaultService(panelId, serviceId);
      onNotify(t('admin.panels.setDefaultServiceSuccessNotify'), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('admin.notifications.saveFailed');
      onNotify(message, 'error');
      throw err;
    }
  };

  // Handle set custom volume target
  const handleSetCustomTarget = async (panelId: string, serviceId: number) => {
    try {
      await setCustomTarget(panelId, serviceId);
      onNotify(t('admin.panels.setCustomTargetSuccessNotify'), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('admin.notifications.saveFailed');
      onNotify(message, 'error');
      throw err;
    }
  };

  // Handle delete service
  const handleDeleteService = async (panelId: string, serviceId: number) => {
    try {
      await deleteService(panelId, serviceId);
      onNotify(t('admin.panels.deleteServiceSuccessNotify'), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('admin.notifications.saveFailed');
      onNotify(message, 'error');
      throw err;
    }
  };

  // Derived metrics
  const totalPanels = fleetSummary?.totalPanels ?? panels.length;
  const healthyCount =
    fleetSummary?.healthyPanels ?? panels.filter((p) => p.enabled && p.healthy !== false).length;
  const issuesCount =
    (fleetSummary?.unhealthyPanels ??
      panels.filter((p) => p.enabled && p.healthy === false).length) +
    (fleetSummary?.disabledPanels ?? panels.filter((p) => !p.enabled).length);
  const totalActiveConfigs =
    fleetSummary?.totalActiveConfigs ??
    panels.reduce((acc, p) => acc + (p.activeConfigsCount ?? 0), 0);
  const totalServices =
    fleetSummary?.totalServices ?? panels.reduce((acc, p) => acc + p.services.length, 0);

  const allHealthy =
    fleetSummary?.allHealthy ??
    (panels.length > 0 &&
      panels.some((p) => p.enabled) &&
      panels.every((p) => !p.enabled || p.healthy !== false));

  // Filtered panels list
  const filteredPanels = useMemo(() => {
    if (filter === 'online') {
      return panels.filter((p) => p.enabled && p.healthy !== false);
    }
    if (filter === 'issues') {
      return panels.filter((p) => !p.enabled || p.healthy === false);
    }
    return panels;
  }, [panels, filter]);

  const filterOptions: SegmentedOption<PanelFilter>[] = useMemo(
    () => [
      {
        id: 'all',
        label: t('admin.panels.filterAll'),
        count: formatNumber(panels.length),
        tone: 'brand',
      },
      {
        id: 'online',
        label: t('admin.panels.filterOnline'),
        count: formatNumber(healthyCount),
        tone: 'ok',
      },
      {
        id: 'issues',
        label: t('admin.panels.filterIssues'),
        count: formatNumber(issuesCount),
        tone: 'warn',
      },
    ],
    [t, panels.length, healthyCount, issuesCount, formatNumber]
  );

  return (
    <div className="space-y-4 pb-6">
      {/* Top Header & Fleet Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <SectionHeader
          icon={<Server />}
          title={t('admin.panels.fleetTitle')}
          count={totalPanels > 0 ? <bdi dir="ltr">{formatNumber(totalPanels)}</bdi> : undefined}
        />

        <div className="flex items-center gap-2 flex-wrap self-end sm:self-center">
          <Button type="button" size="sm" variant="primary" onClick={() => setIsAddModalOpen(true)}>
            <Plus className="w-3.5 h-3.5" />
            <span>{t('admin.panels.addPanelBtn')}</span>
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            loading={isTestingAll}
            disabled={panels.length === 0}
            onClick={() => void handleTestAll()}
            title={t('admin.panels.testAllBtn')}
          >
            <Zap className="w-3.5 h-3.5 text-warn-fg" />
            <span>{t('admin.panels.testAllBtn')}</span>
          </Button>

          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={isRefetching}
            onClick={() => void refetch()}
            title={t('common.refresh')}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{t('common.refresh')}</span>
          </Button>
        </div>
      </div>

      {isLoading && <SkeletonList count={2} />}

      {/* Error State */}
      {isError && panels.length === 0 && (
        <EmptyState
          tone="danger"
          icon={<XCircle />}
          title={t('common.error')}
          description={error instanceof Error ? error.message : t('common.networkError')}
          className="border-danger/25"
          action={
            <Button type="button" size="sm" variant="primary" onClick={() => void refetch()}>
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{t('common.refresh')}</span>
            </Button>
          }
        />
      )}

      {/* Fleet Status Summary & KPIs */}
      {!isLoading && !isError && panels.length > 0 && (
        <Card padding="md" className="space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <IconTile tone={allHealthy ? 'ok' : 'danger'} size="md">
                <Activity />
              </IconTile>
              <div>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${allHealthy ? 'bg-ok' : 'bg-danger'}`} />
                  <h3 className="text-sm font-semibold m-0 text-ink">
                    {allHealthy
                      ? t('admin.panels.fleetStatusOk')
                      : t('admin.panels.fleetStatusWarning')}
                  </h3>
                </div>
                <p className="text-xs m-0 mt-0.5 text-ink-soft">
                  {t('common.panelsActiveCount', {
                    healthy: formatNumber(healthyCount),
                    total: formatNumber(totalPanels),
                  })}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
            <Card subCard padding="sm" className="space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] text-ok-fg font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{t('admin.panels.fleetMetricHealthy')}</span>
              </div>
              <div className="text-lg font-semibold tnum text-ok-fg">
                <bdi dir="ltr">{formatNumber(healthyCount)}</bdi>
              </div>
            </Card>

            <Card subCard padding="sm" className="space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] text-ink-muted font-medium">
                <AlertCircle className="w-3.5 h-3.5 text-warn-fg" />
                <span>{t('admin.panels.fleetMetricIssues')}</span>
              </div>
              <div className="text-lg font-semibold tnum text-warn-fg">
                <bdi dir="ltr">{formatNumber(issuesCount)}</bdi>
              </div>
            </Card>

            <Card subCard padding="sm" className="space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] text-ink-muted font-medium">
                <Users className="w-3.5 h-3.5 text-brand-fg" />
                <span>{t('admin.panels.fleetMetricConfigs')}</span>
              </div>
              <div className="text-lg font-semibold tnum text-brand-fg">
                <bdi dir="ltr">{formatNumber(totalActiveConfigs)}</bdi>
              </div>
            </Card>

            <Card subCard padding="sm" className="space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] text-ink-muted font-medium">
                <Layers className="w-3.5 h-3.5 text-brand-fg" />
                <span>{t('admin.panels.fleetMetricServices')}</span>
              </div>
              <div className="text-lg font-semibold tnum text-brand-fg">
                <bdi dir="ltr">{formatNumber(totalServices)}</bdi>
              </div>
            </Card>
          </div>
        </Card>
      )}

      {/* Unified Filter Tabs if multiple panels exist */}
      {!isLoading && panels.length > 1 && (
        <SegmentedControl
          options={filterOptions}
          value={filter}
          onChange={setFilter}
          ariaLabel={t('admin.panels.fleetTitle')}
        />
      )}

      {/* Empty State */}
      {!isLoading && !isError && panels.length === 0 && (
        <EmptyState
          tone="brand"
          icon={<Server />}
          title={t('admin.panels.empty')}
          description={t('admin.panels.emptyHint')}
          action={
            <Button type="button" variant="primary" onClick={() => setIsAddModalOpen(true)}>
              <Plus className="w-4 h-4" />
              <span>{t('admin.panels.addPanelBtn')}</span>
            </Button>
          }
        />
      )}

      {/* Filtered Empty State */}
      {!isLoading && !isError && panels.length > 0 && filteredPanels.length === 0 && (
        <EmptyState
          tone="neutral"
          icon={<Server />}
          title={t('admin.panels.emptyFiltered')}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => setFilter('all')}>
              <span>{t('admin.panels.filterAll')}</span>
            </Button>
          }
        />
      )}

      {/* Panels List */}
      {!isLoading && filteredPanels.length > 0 && (
        <div className="grid grid-cols-1 gap-4">
          {filteredPanels.map((p) => (
            <PanelCard
              key={p.id}
              panel={p}
              onTest={(id) => void handleTestPanel(id)}
              onEdit={(target) => setEditingPanel(target)}
              onManageServices={(target) => setServicesPanel(target)}
              onToggle={(id, enabled) => {
                if (!enabled) {
                  setDisablingPanel(p);
                } else {
                  void handleToggle(id, true);
                }
              }}
              onSetDefault={(id) => void handleSetDefault(id)}
              onDelete={(target) => setDeletingPanel(target)}
              isTesting={testingPanelId === p.id}
              isToggling={togglingPanelId === p.id}
              isSettingDefault={settingDefaultPanelId === p.id}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      <AddPanelModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSubmit={handleCreatePanel}
        loading={isCreating}
      />

      <EditPanelModal
        panel={editingPanel}
        isOpen={Boolean(editingPanel)}
        onClose={() => setEditingPanel(null)}
        onSubmit={handleUpdatePanel}
        loading={isUpdating}
      />

      <ManageServicesModal
        panel={activeServicesPanel}
        isOpen={Boolean(activeServicesPanel && servicesPanel)}
        onClose={() => setServicesPanel(null)}
        onAddService={handleAddService}
        onSetDefaultService={handleSetDefaultService}
        onSetCustomTarget={handleSetCustomTarget}
        onDeleteService={handleDeleteService}
        loading={isMutatingService}
      />

      <DeletePanelModal
        panel={deletingPanel}
        isOpen={Boolean(deletingPanel)}
        onClose={() => setDeletingPanel(null)}
        onConfirm={handleDeletePanel}
        loading={isDeleting}
      />

      <Modal
        isOpen={Boolean(disablingPanel)}
        onClose={() => setDisablingPanel(null)}
        maxWidth="sm"
        closeOnBackdrop={togglingPanelId !== disablingPanel?.id}
        title={t('admin.panels.disableConfirmTitle')}
        icon={
          <IconTile tone="warn" size="sm">
            <Power />
          </IconTile>
        }
        footer={
          <div className="flex items-center gap-2.5">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => setDisablingPanel(null)}
              disabled={togglingPanelId === disablingPanel?.id}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="danger"
              className="flex-1"
              loading={togglingPanelId === disablingPanel?.id}
              onClick={async () => {
                if (!disablingPanel) return;
                await handleToggle(disablingPanel.id, false);
                setDisablingPanel(null);
              }}
            >
              <Power className="w-3.5 h-3.5" />
              <span>{t('admin.panels.disableConfirmBtn')}</span>
            </Button>
          </div>
        }
      >
        <p className="text-xs leading-relaxed text-ink-soft m-0">
          {t('admin.panels.disableConfirmBody', { name: disablingPanel?.name ?? '' })}
        </p>
      </Modal>
    </div>
  );
};
