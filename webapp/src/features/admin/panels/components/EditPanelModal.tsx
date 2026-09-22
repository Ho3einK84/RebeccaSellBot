import React, { useState, useEffect } from 'react';
import { Settings, Save } from 'lucide-react';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Input } from '@/shared/components/ui/Input.js';
import { Button } from '@/shared/components/ui/Button.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import type { PanelSummary } from '@/shared/types/admin.js';
import type { UpdatePanelPayload } from '@/shared/types/api.js';

interface EditPanelModalProps {
  panel: PanelSummary | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: UpdatePanelPayload) => Promise<void>;
  loading: boolean;
}

export const EditPanelModal: React.FC<EditPanelModalProps> = ({
  panel,
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
  const [clearApiKey, setClearApiKey] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (panel) {
      setName(panel.name);
      setBaseUrl(panel.baseUrl || '');
      setApiKey('');
      setClearApiKey(false);
      setValidationError(null);
    }
  }, [panel]);

  if (!panel) return null;

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

    try {
      await onSubmit({
        name: trimmedName,
        baseUrl: trimmedUrl,
        apiKey: clearApiKey ? null : apiKey.trim() || undefined,
      });
      onClose();
    } catch (err: unknown) {
      setValidationError(err instanceof Error ? err.message : t('admin.notifications.saveFailed'));
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('admin.panels.editModalTitle')}
      icon={<Settings className="w-5 h-5 text-indigo-500" />}
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
            dir="ltr"
            disabled={loading}
          />
        </div>

        <div className="space-y-1.5 text-start">
          <label className={`block text-xs font-semibold ${textPrimary}`}>
            {t('admin.panels.apiKeyField')}
          </label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              if (clearApiKey) setClearApiKey(false);
            }}
            placeholder={t('admin.panels.apiKeyEditPlaceholder')}
            dir="ltr"
            disabled={loading || clearApiKey}
          />
          <span className={`block text-[11px] ${textSecondary}`}>
            {t('admin.panels.apiKeyEditHelp')}
          </span>
          <label className="flex items-center gap-2 pt-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={clearApiKey}
              onChange={(e) => {
                setClearApiKey(e.target.checked);
                if (e.target.checked) setApiKey('');
              }}
              disabled={loading}
              className="rounded border-slate-300 dark:border-white/20 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
            />
            <span className={`text-xs ${textSecondary}`}>
              {t('admin.panels.clearApiKeyOption')}
            </span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200/60 dark:border-white/[0.08]">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" loading={loading}>
            <Save className="w-4 h-4" />
            <span>{t('admin.panels.saveChangesButton')}</span>
          </Button>
        </div>
      </form>
    </Modal>
  );
};
