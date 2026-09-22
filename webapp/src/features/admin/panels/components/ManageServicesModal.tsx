import React, { useState } from 'react';
import { Layers, Plus, Star, Target, Trash2 } from 'lucide-react';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Input } from '@/shared/components/ui/Input.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import type { PanelSummary } from '@/shared/types/admin.js';
import type { AddPanelServicePayload } from '@/shared/types/api.js';

interface ManageServicesModalProps {
  panel: PanelSummary | null;
  isOpen: boolean;
  onClose: () => void;
  onAddService: (panelId: string, payload: AddPanelServicePayload) => Promise<void>;
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
  onSetDefaultService,
  onSetCustomTarget,
  onDeleteService,
  loading,
}) => {
  const { t } = useLanguage();
  const { isDark, subCardClass, textPrimary, textMuted } = useThemeTokens();

  const [newServiceId, setNewServiceId] = useState('');
  const [newServiceName, setNewServiceName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!panel) return null;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedId = Number(newServiceId);
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
      title={`${t('admin.panels.manageServicesTitle')} — ${panel.name}`}
      icon={<Layers className="w-5 h-5 text-indigo-500" />}
      maxWidth="lg"
    >
      <div className="space-y-5">
        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs font-medium">
            {error}
          </div>
        )}

        {/* Services List */}
        <div className="space-y-2 text-start">
          <span className={`block text-xs font-semibold ${textPrimary}`}>
            {t('admin.panels.connectedServices')} <span dir="ltr">({panel.services.length})</span>
          </span>

          <div className="space-y-2 max-h-60 overflow-y-auto pe-1">
            {panel.services.map((service) => (
              <div
                key={service.serviceId}
                className={`p-3 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${subCardClass}`}
              >
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span
                    className={`w-7 h-7 rounded-lg border flex items-center justify-center font-mono text-xs font-bold ${
                      isDark
                        ? 'bg-white/[0.04] border-white/10 text-indigo-400'
                        : 'bg-indigo-50 border-indigo-200 text-indigo-700'
                    }`}
                  >
                    {service.serviceId}
                  </span>
                  <span className={`text-sm font-semibold ${textPrimary}`}>{service.name}</span>

                  {service.isDefault && (
                    <Badge variant="warning" className="text-[10px]">
                      <Star className="w-3 h-3 fill-current" />
                      <span>{t('admin.panels.defaultService')}</span>
                    </Badge>
                  )}

                  {service.isCustomTarget && (
                    <Badge variant="info" className="text-[10px]">
                      <Target className="w-3 h-3" />
                      <span>{t('admin.panels.customTargetBadge')}</span>
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-1.5 self-end sm:self-center flex-wrap">
                  {!service.isDefault && (
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => handleSetDefault(service.serviceId)}
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
                      onClick={() => handleSetCustomTarget(service.serviceId)}
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
                            handleDelete(service.serviceId);
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
            ))}
          </div>
        </div>

        {/* Add New Service Form */}
        <form
          onSubmit={handleAdd}
          className={`p-3.5 rounded-xl border space-y-3 ${
            isDark ? 'bg-white/[0.02] border-white/[0.08]' : 'bg-slate-50/80 border-slate-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-indigo-500" />
            <span className={`text-xs font-bold ${textPrimary}`}>
              {t('admin.panels.addServiceTitle')}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="space-y-1 text-start">
              <label className={`block text-[11px] font-medium ${textMuted}`}>
                {t('admin.panels.serviceIdLabel')} <span className="text-rose-500">*</span>
              </label>
              <Input
                type="number"
                min="1"
                value={newServiceId}
                onChange={(e) => setNewServiceId(e.target.value)}
                placeholder="2"
                dir="ltr"
                disabled={loading}
              />
            </div>

            <div className="space-y-1 text-start sm:col-span-2">
              <label className={`block text-[11px] font-medium ${textMuted}`}>
                {t('admin.panels.serviceNameField')} <span className="text-rose-500">*</span>
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

        <div className="flex items-center justify-end pt-2 border-t border-slate-200/60 dark:border-white/[0.08]">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
