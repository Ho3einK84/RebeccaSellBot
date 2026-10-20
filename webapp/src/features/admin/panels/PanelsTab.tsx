import React, { useState, useMemo } from 'react';
import {
  Server,
  RotateCw,
  Activity,
  Plus,
  Zap,
  Users,
  Layers,
  AlertCircle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { useAdminPanels } from './hooks/useAdminPanels.js';
import { PanelCard } from './components/PanelCard.js';
import { AddPanelModal } from './components/AddPanelModal.js';
import { EditPanelModal } from './components/EditPanelModal.js';
import { ManageServicesModal } from './components/ManageServicesModal.js';
import { DeletePanelModal } from './components/DeletePanelModal.js';
import { Card } from '@/shared/components/ui/Card.js';
import { Button } from '@/shared/components/ui/Button.js';
import { SkeletonList } from '@/shared/components/ui/Skeleton.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
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
    isAddingService,
    setDefaultService,
    setCustomTarget,
    deleteService,
  } = useAdminPanels();
  const { textPrimary, textSecondary } = useThemeTokens();

  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingPanel, setEditingPanel] = useState<PanelSummary | null>(null);
  const [servicesPanel, setServicesPanel] = useState<PanelSummary | null>(null);
  const [deletingPanel, setDeletingPanel] = useState<PanelSummary | null>(null);

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

  return (
    <div className="space-y-4">
      {/* Top Header & Fleet Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border bg-brand/10 border-brand/20 text-brand shadow-xs`}
          >
            <Server className="w-4 h-4" />
          </div>
          <h2 className={`text-base font-bold m-0 tracking-tight truncate ${textPrimary}`}>
            {t('admin.panels.fleetTitle')}
          </h2>
        </div>

        <div className="flex items-center gap-2 flex-wrap self-end sm:self-center">
          {/* Add Panel Button */}
          <Button type="button" size="sm" variant="primary" onClick={() => setIsAddModalOpen(true)}>
            <Plus className="w-3.5 h-3.5" />
            <span>{t('admin.panels.addPanelBtn')}</span>
          </Button>

          {/* Test All Button */}
          <Button
            type="button"
            size="sm"
            variant="outline"
            loading={isTestingAll}
            disabled={panels.length === 0}
            onClick={handleTestAll}
            title={t('admin.panels.testAllBtn')}
          >
            <Zap className="w-3.5 h-3.5 text-warn" />
            <span>{t('admin.panels.testAllBtn')}</span>
          </Button>

          {/* Refresh Button */}
          <button
            type="button"
            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-xl border text-xs font-medium transition-all active:scale-95 cursor-pointer bg-surface/[0.04] border-line/10 hover:bg-surface/[0.08] text-ink-muted shadow-xs`}
            onClick={() => refetch()}
            title={t('common.refresh')}
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>{t('common.refresh')}</span>
          </button>
        </div>
      </div>

      {isLoading && <SkeletonList count={2} />}

      {/* Error State */}
      {isError && panels.length === 0 && (
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

      {/* Fleet Status Summary & KPIs */}
      {!isLoading && !isError && panels.length > 0 && (
        <Card className="p-4 sm:p-5 space-y-4">
          {/* Main Health Status Strip */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-11 h-11 rounded-2xl flex items-center justify-center border shrink-0 transition-colors ${
                  allHealthy
                    ? 'bg-ok/15 text-ok border-ok/25'
                    : 'bg-danger/15 text-danger border-danger/25'
                }`}
              >
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      allHealthy ? 'bg-ok status-pulse' : 'bg-danger'
                    }`}
                  />
                  <h3 className={`text-sm font-bold m-0 tracking-tight ${textPrimary}`}>
                    {allHealthy
                      ? t('admin.panels.fleetStatusOk')
                      : t('admin.panels.fleetStatusWarning')}
                  </h3>
                </div>
                <p className={`text-xs m-0 mt-0.5 ${textSecondary}`}>
                  {t('common.panelsActiveCount', {
                    healthy: formatNumber(healthyCount),
                    total: formatNumber(totalPanels),
                  })}
                </p>
              </div>
            </div>
          </div>

          {/* 4 Quick Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
            {/* Healthy Panels */}
            <div className={`p-3 rounded-xl border space-y-1 bg-surface/[0.02] border-line/[0.06]`}>
              <div className="flex items-center gap-1.5 text-[11px] text-ok font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{t('admin.panels.fleetMetricHealthy')}</span>
              </div>
              <div className="text-lg font-extrabold tnum text-ok">
                {formatNumber(healthyCount)}
              </div>
            </div>

            {/* Issues or Disabled */}
            <div className={`p-3 rounded-xl border space-y-1 bg-surface/[0.02] border-line/[0.06]`}>
              <div className="flex items-center gap-1.5 text-[11px] text-ink-muted font-medium">
                <AlertCircle className="w-3.5 h-3.5 text-warn" />
                <span>{t('admin.panels.fleetMetricIssues')}</span>
              </div>
              <div className="text-lg font-extrabold tnum text-warn">
                {formatNumber(issuesCount)}
              </div>
            </div>

            {/* Fleet Total Active Configs */}
            <div className={`p-3 rounded-xl border space-y-1 bg-surface/[0.02] border-line/[0.06]`}>
              <div className="flex items-center gap-1.5 text-[11px] text-ink-muted font-medium">
                <Users className="w-3.5 h-3.5 text-brand" />
                <span>{t('admin.panels.fleetMetricConfigs')}</span>
              </div>
              <div className="text-lg font-extrabold tnum text-brand">
                {formatNumber(totalActiveConfigs)}
              </div>
            </div>

            {/* Fleet Total Services */}
            <div className={`p-3 rounded-xl border space-y-1 bg-surface/[0.02] border-line/[0.06]`}>
              <div className="flex items-center gap-1.5 text-[11px] text-ink-muted font-medium">
                <Layers className="w-3.5 h-3.5 text-brand" />
                <span>{t('admin.panels.fleetMetricServices')}</span>
              </div>
              <div className="text-lg font-extrabold tnum text-brand">
                {formatNumber(totalServices)}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Filter Tabs if multiple panels exist */}
      {!isLoading && panels.length > 1 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            className={`h-7 px-3 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              filter === 'all'
                ? 'bg-brand text-brand-ink shadow-xs'
                : 'bg-surface/[0.04] text-ink-soft hover:bg-surface/[0.08] border border-line'
            }`}
            onClick={() => setFilter('all')}
          >
            {t('admin.panels.filterAll')} ({formatNumber(panels.length)})
          </button>

          <button
            type="button"
            className={`h-7 px-3 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              filter === 'online'
                ? 'bg-ok text-ink shadow-xs'
                : 'bg-surface/[0.04] text-ink-soft hover:bg-surface/[0.08] border border-line'
            }`}
            onClick={() => setFilter('online')}
          >
            {t('admin.panels.filterOnline')} ({formatNumber(healthyCount)})
          </button>

          <button
            type="button"
            className={`h-7 px-3 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              filter === 'issues'
                ? 'bg-warn text-ink shadow-xs'
                : 'bg-surface/[0.04] text-ink-soft hover:bg-surface/[0.08] border border-line'
            }`}
            onClick={() => setFilter('issues')}
          >
            {t('admin.panels.filterIssues')} ({formatNumber(issuesCount)})
          </button>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !isError && panels.length === 0 && (
        <Card className="p-8 text-center space-y-3">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-brand/10 border border-brand/20 text-brand flex items-center justify-center">
            <Server className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className={`text-base font-bold m-0 ${textPrimary}`}>{t('admin.panels.empty')}</h3>
            <p className={`text-xs m-0 ${textSecondary}`}>{t('admin.panels.emptyHint')}</p>
          </div>
          <Button
            type="button"
            variant="primary"
            onClick={() => setIsAddModalOpen(true)}
            className="mx-auto"
          >
            <Plus className="w-4 h-4" />
            <span>{t('admin.panels.addPanelBtn')}</span>
          </Button>
        </Card>
      )}

      {/* Filtered Empty State */}
      {!isLoading && !isError && panels.length > 0 && filteredPanels.length === 0 && (
        <Card className="p-8 text-center space-y-3">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-brand/10 border border-brand/20 text-brand flex items-center justify-center">
            <Server className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className={`text-base font-bold m-0 ${textPrimary}`}>
              {t('admin.panels.emptyFiltered')}
            </h3>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setFilter('all')}
            className="mx-auto"
          >
            <span>{t('admin.panels.filterAll')}</span>
          </Button>
        </Card>
      )}

      {/* Panels List */}
      {!isLoading && filteredPanels.length > 0 && (
        <div className="grid grid-cols-1 gap-4">
          {filteredPanels.map((p) => (
            <PanelCard
              key={p.id}
              panel={p}
              onTest={handleTestPanel}
              onEdit={(target) => setEditingPanel(target)}
              onManageServices={(target) => setServicesPanel(target)}
              onToggle={handleToggle}
              onSetDefault={handleSetDefault}
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
        loading={isAddingService}
      />

      <DeletePanelModal
        panel={deletingPanel}
        isOpen={Boolean(deletingPanel)}
        onClose={() => setDeletingPanel(null)}
        onConfirm={handleDeletePanel}
        loading={isDeleting}
      />
    </div>
  );
};
