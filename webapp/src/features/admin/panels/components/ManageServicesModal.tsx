import React, { useState, useEffect } from 'react';
import { Layers, Plus, Save, Sliders, Star, Target, Trash2 } from 'lucide-react';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Input } from '@/shared/components/ui/Input.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { AlertBanner } from '@/shared/components/ui/AlertBanner.js';
import { Switch } from '@/shared/components/ui/Switch.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { normalizeInputDigits } from '@/shared/lib/formatters.js';
import type { PanelServiceSummary, PanelSummary } from '@/shared/types/admin.js';
import type { AddPanelServicePayload, UpdatePanelServicePayload } from '@/shared/types/api.js';

interface ManageServicesModalProps {
  panel: PanelSummary | null;
  isOpen: boolean;
  onClose: () => void;
  onAddService: (panelId: string, payload: AddPanelServicePayload) => Promise<void>;
  onUpdateService?: (
    panelId: string,
    serviceId: number,
    payload: UpdatePanelServicePayload
  ) => Promise<void>;
  onSetDefaultService: (panelId: string, serviceId: number) => Promise<void>;
  onSetCustomTarget: (panelId: string, serviceId: number) => Promise<void>;
  onDeleteService: (panelId: string, serviceId: number) => Promise<void>;
  loading: boolean;
}

export const ManageServicesModal: React.FC<ManageServicesModalProps> = ({
  panel,
  isOpen,
  onClose,
  onAddService,
  onUpdateService,
  onSetDefaultService,
  onSetCustomTarget,
  onDeleteService,
  loading,
}) => {
  const { t } = useLanguage();
  const { formatNumber } = useFormatters();

  const [newServiceId, setNewServiceId] = useState('');
  const [newServiceName, setNewServiceName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [editingServiceId, setEditingServiceId] = useState<number | null>(null);
  const [editMaxConfigs, setEditMaxConfigs] = useState('');
  const [editStock, setEditStock] = useState('');
  const [editDaily, setEditDaily] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNewServiceId('');
    setNewServiceName('');
    setConfirmDeleteId(null);
    setEditingServiceId(null);
    setEditMaxConfigs('');
    setEditStock('');
    setEditDaily('');
    setError(null);
  }, [isOpen, panel?.id]);

  if (!panel) return null;

  const parseOptionalLimit = (raw: string): { ok: true; value: number | null } | { ok: false } => {
    const normalized = normalizeInputDigits(raw).trim();
    if (!normalized) return { ok: true, value: null };
    if (!/^\d+$/u.test(normalized)) return { ok: false };
    const n = Number(normalized);
    if (!Number.isSafeInteger(n) || n < 0 || n > 2_147_483_647) return { ok: false };
    return { ok: true, value: n };
  };

  const startEditLimits = (service: PanelServiceSummary) => {
    if (editingServiceId === service.serviceId) {
      setEditingServiceId(null);
      return;
    }
    setEditingServiceId(service.serviceId);
    setEditMaxConfigs(service.maxConfigs != null ? String(service.maxConfigs) : '');
    setEditStock(service.stockRemaining != null ? String(service.stockRemaining) : '');
    setEditDaily(service.dailyCreateLimit != null ? String(service.dailyCreateLimit) : '');
    setError(null);
  };

  const handleToggleServiceEnabled = async (service: PanelServiceSummary) => {
    if (!onUpdateService) return;
    setError(null);
    try {
      await onUpdateService(panel.id, service.serviceId, { enabled: service.enabled === false });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('admin.notifications.saveFailed'));
    }
  };

  const handleSaveServiceLimits = async (serviceId: number) => {
    if (!onUpdateService) return;
    setError(null);
    const parsedMax = parseOptionalLimit(editMaxConfigs);
    const parsedStock = parseOptionalLimit(editStock);
    const parsedDaily = parseOptionalLimit(editDaily);
    if (!parsedMax.ok || !parsedStock.ok || !parsedDaily.ok) {
      setError(t('admin.panels.validationLimitInvalid'));
      return;
    }
    try {
      await onUpdateService(panel.id, serviceId, {
        maxConfigs: parsedMax.value,
        stockRemaining: parsedStock.value,
        dailyCreateLimit: parsedDaily.value,
      });
      setEditingServiceId(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('admin.notifications.saveFailed'));
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedId = Number(normalizeInputDigits(newServiceId));
    if (!Number.isSafeInteger(parsedId) || parsedId <= 0) {
      setError(t('admin.panels.validationServiceId'));
      return;
    }

    const trimmedName = newServiceName.trim();
    if (!trimmedName) {
      setError(t('admin.panels.validationServiceName'));
      return;
    }

    try {
      await onAddService(panel.id, { serviceId: parsedId, name: trimmedName });
      setNewServiceId('');
      setNewServiceName('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('admin.notifications.saveFailed'));
    }
  };

  const handleDelete = async (serviceId: number) => {
    setError(null);
    try {
      await onDeleteService(panel.id, serviceId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('admin.notifications.saveFailed'));
    }
  };

  const handleSetDefault = async (serviceId: number) => {
    setError(null);
    try {
      await onSetDefaultService(panel.id, serviceId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('admin.notifications.saveFailed'));
    }
  };

  const handleSetCustomTarget = async (serviceId: number) => {
    setError(null);
    try {
      await onSetCustomTarget(panel.id, serviceId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('admin.notifications.saveFailed'));
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('admin.panels.manageServicesTitle')}
      subtitle={panel.name}
      icon={
        <IconTile tone="brand" size="sm">
          <Layers />
        </IconTile>
      }
      maxWidth="lg"
      footer={
        <div className="flex items-center justify-end">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && <AlertBanner tone="danger">{error}</AlertBanner>}

        {/* Services List */}
        <div className="space-y-2 text-start">
          <span className="block text-xs font-semibold text-ink">
            {t('admin.panels.connectedServices')}{' '}
            <bdi dir="ltr">({formatNumber(panel.services.length)})</bdi>
          </span>

          <div className="space-y-2 max-h-80 overflow-y-auto pe-1">
            {panel.services.map((service) => {
              const svcEnabled = service.enabled !== false;
              const isEditingThis = editingServiceId === service.serviceId;
              return (
                <div
                  key={service.serviceId}
                  className={`p-3 rounded-tile border border-line bg-surface-2 space-y-2.5 ${
                    !svcEnabled ? 'opacity-80' : ''
                  }`}
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="w-7 h-7 rounded-ctl border flex items-center justify-center tnum text-xs font-semibold bg-surface border-line text-brand-fg">
                        <bdi dir="ltr">{formatNumber(service.serviceId)}</bdi>
                      </span>
                      <span className="text-sm font-semibold text-ink">{service.name}</span>

                      {!svcEnabled && (
                        <Badge variant="neutral" size="xs">
                          {t('admin.panels.servicePausedBadge')}
                        </Badge>
                      )}
                      {svcEnabled && service.isAvailableForCreate === false && (
                        <Badge variant="error" size="xs">
                          {t('admin.panels.capacityFullBadge')}
                        </Badge>
                      )}

                      {service.isDefault && (
                        <Badge variant="warning" size="xs">
                          <Star className="w-3 h-3 fill-current" />
                          <span>{t('admin.panels.defaultService')}</span>
                        </Badge>
                      )}

                      {service.isCustomTarget && (
                        <Badge variant="info" size="xs">
                          <Target className="w-3 h-3" />
                          <span>{t('admin.panels.customTargetBadge')}</span>
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 self-end sm:self-center flex-wrap">
                      {onUpdateService && (
                        <>
                          <Switch
                            checked={svcEnabled}
                            disabled={loading}
                            onChange={() => void handleToggleServiceEnabled(service)}
                            ariaLabel={t('admin.panels.serviceEnabledLabel')}
                          />
                          <Button
                            type="button"
                            size="xs"
                            variant={isEditingThis ? 'primary' : 'outline'}
                            onClick={() => startEditLimits(service)}
                            disabled={loading}
                            title={t('admin.panels.serviceEditLimitsBtn')}
                          >
                            <Sliders className="w-3 h-3" />
                            <span>{t('admin.panels.serviceEditLimitsBtn')}</span>
                          </Button>
                        </>
                      )}

                      {!service.isDefault && (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() => void handleSetDefault(service.serviceId)}
                          disabled={loading}
                          title={t('admin.panels.makeDefaultServiceBtn')}
                        >
                          <Star className="w-3 h-3" />
                          <span>{t('admin.panels.makeDefaultServiceBtn')}</span>
                        </Button>
                      )}

                      {!service.isCustomTarget && (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() => void handleSetCustomTarget(service.serviceId)}
                          disabled={loading}
                          title={t('admin.panels.setCustomTargetBtn')}
                        >
                          <Target className="w-3 h-3" />
                          <span>{t('admin.panels.setCustomTargetBtn')}</span>
                        </Button>
                      )}

                      {!service.isDefault &&
                        panel.services.length > 1 &&
                        (confirmDeleteId === service.serviceId ? (
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              size="xs"
                              variant="danger"
                              onClick={() => {
                                setConfirmDeleteId(null);
                                void handleDelete(service.serviceId);
                              }}
                              disabled={loading}
                            >
                              <span>{t('common.confirm')}</span>
                            </Button>
                            <Button
                              type="button"
                              size="xs"
                              variant="secondary"
                              onClick={() => setConfirmDeleteId(null)}
                              disabled={loading}
                            >
                              <span>{t('common.cancel')}</span>
                            </Button>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            size="xs"
                            variant="danger"
                            onClick={() => setConfirmDeleteId(service.serviceId)}
                            disabled={loading}
                            title={t('common.delete')}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        ))}
                    </div>
                  </div>

                  {/* Live Usage / Limits Summary Chips */}
                  {(service.maxConfigs != null ||
                    service.stockRemaining != null ||
                    service.dailyCreateLimit != null ||
                    (service.activeConfigsCount ?? 0) > 0) && (
                    <div className="flex items-center gap-1.5 flex-wrap text-[11px] tnum">
                      <Badge variant="neutral" size="xs">
                        {service.maxConfigs != null
                          ? `${t('admin.panels.maxConfigsField')}: ${t(
                              'admin.panels.capacityUsageLabel',
                              {
                                used: formatNumber(
                                  (service.activeConfigsCount ?? 0) + (service.reservedCount ?? 0)
                                ),
                                max: formatNumber(service.maxConfigs),
                              }
                            )}`
                          : t('admin.panels.configsCount', {
                              count: formatNumber(service.activeConfigsCount ?? 0),
                            })}
                      </Badge>
                      {service.stockRemaining != null && (
                        <Badge
                          variant={service.stockRemaining <= 0 ? 'error' : 'success'}
                          size="xs"
                        >
                          {t('admin.panels.stockLabel', {
                            count: formatNumber(service.stockRemaining),
                          })}
                        </Badge>
                      )}
                      {service.dailyCreateLimit != null && (
                        <Badge
                          variant={
                            (service.todayCreatedCount ?? 0) >= service.dailyCreateLimit
                              ? 'error'
                              : 'info'
                          }
                          size="xs"
                        >
                          {t('admin.panels.dailyUsageLabel', {
                            today: formatNumber(service.todayCreatedCount ?? 0),
                            limit: formatNumber(service.dailyCreateLimit),
                          })}
                        </Badge>
                      )}
                    </div>
                  )}

                  {/* Inline Limits Editor */}
                  {isEditingThis && onUpdateService && (
                    <div className="pt-2 border-t border-line space-y-2.5">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <label className="block text-[11px] font-medium text-ink-muted">
                            {t('admin.panels.maxConfigsField')}
                          </label>
                          <Input
                            type="text"
                            inputMode="numeric"
                            dir="ltr"
                            className="tnum"
                            value={editMaxConfigs}
                            onChange={(e) =>
                              setEditMaxConfigs(
                                normalizeInputDigits(e.target.value).replace(/[^0-9]/g, '')
                              )
                            }
                            placeholder={t('admin.panels.unlimitedPlaceholder')}
                            disabled={loading}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[11px] font-medium text-ink-muted">
                            {t('admin.panels.stockRemainingField')}
                          </label>
                          <Input
                            type="text"
                            inputMode="numeric"
                            dir="ltr"
                            className="tnum"
                            value={editStock}
                            onChange={(e) =>
                              setEditStock(
                                normalizeInputDigits(e.target.value).replace(/[^0-9]/g, '')
                              )
                            }
                            placeholder={t('admin.panels.unlimitedPlaceholder')}
                            disabled={loading}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[11px] font-medium text-ink-muted">
                            {t('admin.panels.dailyCreateLimitField')}
                          </label>
                          <Input
                            type="text"
                            inputMode="numeric"
                            dir="ltr"
                            className="tnum"
                            value={editDaily}
                            onChange={(e) =>
                              setEditDaily(
                                normalizeInputDigits(e.target.value).replace(/[^0-9]/g, '')
                              )
                            }
                            placeholder={t('admin.panels.unlimitedPlaceholder')}
                            disabled={loading}
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          type="button"
                          size="xs"
                          variant="secondary"
                          onClick={() => setEditingServiceId(null)}
                          disabled={loading}
                        >
                          {t('common.cancel')}
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          variant="primary"
                          loading={loading}
                          onClick={() => void handleSaveServiceLimits(service.serviceId)}
                        >
                          <Save className="w-3 h-3" />
                          <span>{t('admin.panels.serviceSaveLimitsBtn')}</span>
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Add New Service Form */}
        <form
          onSubmit={(e) => void handleAdd(e)}
          className="p-3.5 rounded-tile border border-line bg-surface-2 space-y-3"
        >
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-brand-fg" />
            <span className="text-xs font-semibold text-ink">
              {t('admin.panels.addServiceTitle')}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="space-y-1 text-start">
              <label className="block text-[11px] font-medium text-ink-muted">
                {t('admin.panels.serviceIdLabel')} <span className="text-danger-fg">*</span>
              </label>
              <Input
                type="text"
                inputMode="numeric"
                value={newServiceId}
                onChange={(e) =>
                  setNewServiceId(normalizeInputDigits(e.target.value).replace(/[^0-9]/g, ''))
                }
                placeholder="2"
                dir="ltr"
                className="tnum"
                disabled={loading}
              />
            </div>

            <div className="space-y-1 text-start sm:col-span-2">
              <label className="block text-[11px] font-medium text-ink-muted">
                {t('admin.panels.serviceNameField')} <span className="text-danger-fg">*</span>
              </label>
              <div className="flex items-center gap-2">
                <Input
                  value={newServiceName}
                  onChange={(e) => setNewServiceName(e.target.value)}
                  placeholder={t('admin.panels.newServiceNamePlaceholder')}
                  disabled={loading}
                  maxLength={80}
                />
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  loading={loading}
                  className="shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t('admin.panels.addServiceBtn')}</span>
                </Button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </Modal>
  );
};
