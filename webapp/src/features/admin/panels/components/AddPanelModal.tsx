import React, { useState } from 'react';
import { Plus, Server } from 'lucide-react';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Input } from '@/shared/components/ui/Input.js';
import { Button } from '@/shared/components/ui/Button.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import type { CreatePanelPayload } from '@/shared/types/api.js';

interface AddPanelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: CreatePanelPayload) => Promise<void>;
  loading: boolean;
}

export const AddPanelModal: React.FC<AddPanelModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  loading,
}) => {
  const { t } = useLanguage();
  const { textPrimary, textSecondary } = useThemeTokens();

  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [serviceId, setServiceId] = useState('1');
  const [serviceName, setServiceName] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setValidationError(t('admin.panels.validationNameRequired'));
      return;
    }

    const trimmedUrl = baseUrl.trim();
    if (!trimmedUrl) {
      setValidationError(t('admin.panels.validationUrlRequired'));
      return;
    }
    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      setValidationError(t('admin.panels.validationUrlScheme'));
      return;
    }

    const parsedServiceId = Number(serviceId);
    if (!Number.isSafeInteger(parsedServiceId) || parsedServiceId <= 0) {
      setValidationError(t('admin.panels.validationServiceId'));
      return;
    }

    try {
      await onSubmit({
        name: trimmedName,
        baseUrl: trimmedUrl,
        apiKey: apiKey.trim() || undefined,
        serviceId: parsedServiceId,
        serviceName: serviceName.trim() || undefined,
      });
      // reset form on success
      setName('');
      setBaseUrl('');
      setApiKey('');
      setServiceId('1');
      setServiceName('');
      onClose();
    } catch (err: unknown) {
      setValidationError(err instanceof Error ? err.message : t('admin.notifications.saveFailed'));
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('admin.panels.addModalTitle')}
      icon={<Server className="w-5 h-5 text-indigo-500" />}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {validationError && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs font-medium">
            {validationError}
          </div>
        )}

        <div className="space-y-1.5 text-start">
          <label className={`block text-xs font-semibold ${textPrimary}`}>
            {t('admin.panels.nameField')} <span className="text-rose-500">*</span>
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('admin.panels.namePlaceholder')}
            disabled={loading}
            maxLength={80}
            autoFocus
          />
        </div>

        <div className="space-y-1.5 text-start">
          <label className={`block text-xs font-semibold ${textPrimary}`}>
            {t('admin.panels.urlField')} <span className="text-rose-500">*</span>
          </label>
          <Input
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://panel.example.com:2087"
            dir="ltr"
            disabled={loading}
          />
          <span className={`block text-[11px] ${textSecondary}`}>{t('admin.panels.urlHelp')}</span>
        </div>

        <div className="space-y-1.5 text-start">
          <label className={`block text-xs font-semibold ${textPrimary}`}>
            {t('admin.panels.apiKeyField')}
          </label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={t('admin.panels.apiKeyPlaceholder')}
            dir="ltr"
            disabled={loading}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5 text-start">
            <label className={`block text-xs font-semibold ${textPrimary}`}>
              {t('admin.panels.serviceIdField')}
            </label>
            <Input
              type="number"
              min="1"
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              placeholder="1"
              dir="ltr"
              disabled={loading}
            />
          </div>

          <div className="space-y-1.5 text-start">
            <label className={`block text-xs font-semibold ${textPrimary}`}>
              {t('admin.panels.serviceNameField')}
            </label>
            <Input
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              placeholder={t('admin.panels.serviceNameDefault')}
              disabled={loading}
              maxLength={80}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200/60 dark:border-white/[0.08]">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" loading={loading}>
            <Plus className="w-4 h-4" />
            <span>{t('admin.panels.createButton')}</span>
          </Button>
        </div>
      </form>
    </Modal>
  );
};
