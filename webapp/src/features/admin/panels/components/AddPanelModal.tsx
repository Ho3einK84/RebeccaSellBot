import React, { useState, useEffect } from 'react';
import { Plus, Server } from 'lucide-react';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Input } from '@/shared/components/ui/Input.js';
import { Button } from '@/shared/components/ui/Button.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { AlertBanner } from '@/shared/components/ui/AlertBanner.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { normalizeInputDigits } from '@/shared/lib/formatters.js';
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

  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [serviceId, setServiceId] = useState('1');
  const [serviceName, setServiceName] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setName('');
      setBaseUrl('');
      setApiKey('');
      setServiceId('1');
      setServiceName('');
      setValidationError(null);
    }
  }, [isOpen]);

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

    const parsedServiceId = Number(normalizeInputDigits(serviceId));
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
      closeOnBackdrop={!loading}
      title={t('admin.panels.addModalTitle')}
      icon={
        <IconTile tone="brand" size="sm">
          <Server />
        </IconTile>
      }
      maxWidth="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="add-panel-form" variant="primary" loading={loading}>
            <Plus className="w-4 h-4" />
            <span>{t('admin.panels.createButton')}</span>
          </Button>
        </div>
      }
    >
      <form id="add-panel-form" onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {validationError && <AlertBanner tone="danger">{validationError}</AlertBanner>}

        <div className="space-y-1.5 text-start">
          <label className="block text-xs font-semibold text-ink">
            {t('admin.panels.nameField')} <span className="text-danger-fg">*</span>
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
          <label className="block text-xs font-semibold text-ink">
            {t('admin.panels.urlField')} <span className="text-danger-fg">*</span>
          </label>
          <Input
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://panel.example.com:2087"
            dir="ltr"
            disabled={loading}
          />
          <span className="block text-[11px] text-ink-soft">{t('admin.panels.urlHelp')}</span>
        </div>

        <div className="space-y-1.5 text-start">
          <label className="block text-xs font-semibold text-ink">
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
            <label className="block text-xs font-semibold text-ink">
              {t('admin.panels.serviceIdField')}
            </label>
            <Input
              type="text"
              inputMode="numeric"
              value={serviceId}
              onChange={(e) =>
                setServiceId(normalizeInputDigits(e.target.value).replace(/[^0-9]/g, ''))
              }
              placeholder="1"
              dir="ltr"
              className="tnum"
              disabled={loading}
            />
          </div>

          <div className="space-y-1.5 text-start">
            <label className="block text-xs font-semibold text-ink">
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
      </form>
    </Modal>
  );
};
