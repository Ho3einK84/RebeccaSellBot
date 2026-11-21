import React, { useState, useEffect } from 'react';
import { Bell, Save, Check, Users, Loader2 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Card } from '@/shared/components/ui/Card.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { Switch } from '@/shared/components/ui/Switch.js';
import { useReceiptSettings } from '../hooks/useAdminReceipts.js';

interface ReceiptSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

export const ReceiptSettingsModal: React.FC<ReceiptSettingsModalProps> = ({
  isOpen,
  onClose,
  onNotify,
}) => {
  const { t } = useLanguage();
  const { formatId } = useFormatters();
  const { textPrimary, textSecondary, textMuted } = useThemeTokens();
  const { settings, isLoading, updateSettings, isUpdating } = useReceiptSettings(isOpen);

  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<'full' | 'simple'>('full');
  const [isAllAdmins, setIsAllAdmins] = useState(true);
  const [selectedAdmins, setSelectedAdmins] = useState<number[]>([]);

  useEffect(() => {
    if (settings) {
      setEnabled(settings.enabled);
      setMode(settings.mode);
      const hasSpecific = settings.admins && settings.admins.length > 0;
      setIsAllAdmins(!hasSpecific);
      setSelectedAdmins(settings.admins || []);
    }
  }, [settings, isOpen]);

  if (!isOpen) return null;

  const allAdmins = settings?.allAdmins ?? [];

  const handleToggleAdmin = (adminId: number) => {
    if (isAllAdmins) {
      setIsAllAdmins(false);
      setSelectedAdmins([adminId]);
      return;
    }

    if (selectedAdmins.includes(adminId)) {
      const next = selectedAdmins.filter((id) => id !== adminId);
      if (next.length === 0) {
        setIsAllAdmins(true);
        setSelectedAdmins([]);
      } else {
        setSelectedAdmins(next);
      }
    } else {
      setSelectedAdmins([...selectedAdmins, adminId]);
    }
  };

  const handleSave = async () => {
    try {
      await updateSettings({
        enabled,
        mode,
        admins: isAllAdmins ? [] : selectedAdmins,
      });
      onNotify(t('admin.receipts.settingsSaveSuccess'), 'success');
      onClose();
    } catch {
      onNotify(t('common.error'), 'error');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('admin.receipts.settingsModalTitle')}
      icon={
        <IconTile tone="brand" size="sm">
          <Bell />
        </IconTile>
      }
      maxWidth="md"
      footer={
        !isLoading ? (
          <div className="flex items-center gap-2.5">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={onClose}
              disabled={isUpdating}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              className="flex-1"
              disabled={isUpdating}
              loading={isUpdating}
              onClick={handleSave}
            >
              <Save className="w-3.5 h-3.5" />
              <span>{t('admin.receipts.settingsSaveBtn')}</span>
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {isLoading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-brand-fg" />
            <span className={`text-xs ${textMuted}`}>{t('common.loading')}</span>
          </div>
        ) : (
          <>
            <Card subCard padding="md" className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <span className={`text-xs font-semibold block ${textPrimary}`}>
                  {t('admin.receipts.settingsNotifyEnabled')}
                </span>
                <span className={`text-[11px] leading-relaxed block ${textSecondary}`}>
                  {t('admin.receipts.settingsNotifyEnabledDesc')}
                </span>
              </div>
              <Switch
                checked={enabled}
                onChange={setEnabled}
                ariaLabel={t('admin.receipts.settingsNotifyEnabled')}
              />
            </Card>

            <Card subCard padding="md" className="space-y-2.5">
              <span className={`text-xs font-semibold block ${textPrimary}`}>
                {t('admin.receipts.settingsModeTitle')}
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  className={`p-3 rounded-tile border text-start cursor-pointer flex flex-col gap-1 rs-focus ${
                    mode === 'full'
                      ? 'bg-brand-soft border-brand/35 text-brand-fg'
                      : 'bg-surface border-line text-ink-soft hover:border-line-strong'
                  }`}
                  onClick={() => setMode('full')}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">
                      {t('admin.receipts.settingsModeFullTitle')}
                    </span>
                    {mode === 'full' && <Check className="w-3.5 h-3.5" />}
                  </div>
                  <span className="text-[11px] opacity-80">
                    {t('admin.receipts.settingsModeFull')}
                  </span>
                </button>

                <button
                  type="button"
                  className={`p-3 rounded-tile border text-start cursor-pointer flex flex-col gap-1 rs-focus ${
                    mode === 'simple'
                      ? 'bg-brand-soft border-brand/35 text-brand-fg'
                      : 'bg-surface border-line text-ink-soft hover:border-line-strong'
                  }`}
                  onClick={() => setMode('simple')}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">
                      {t('admin.receipts.settingsModeSimpleTitle')}
                    </span>
                    {mode === 'simple' && <Check className="w-3.5 h-3.5" />}
                  </div>
                  <span className="text-[11px] opacity-80">
                    {t('admin.receipts.settingsModeSimple')}
                  </span>
                </button>
              </div>
            </Card>

            <Card subCard padding="md" className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className={`text-xs font-semibold flex items-center gap-1.5 ${textPrimary}`}>
                  <Users className="w-3.5 h-3.5 text-brand-fg" />
                  <span>{t('admin.receipts.settingsAdminsTitle')}</span>
                </span>
                <button
                  type="button"
                  className={`inline-flex items-center gap-1.5 h-8 text-xs font-medium px-2.5 rounded-ctl border cursor-pointer rs-focus ${
                    isAllAdmins
                      ? 'bg-brand-soft border-brand/35 text-brand-fg font-semibold'
                      : 'bg-surface border-line text-ink-soft hover:border-line-strong'
                  }`}
                  onClick={() => {
                    setIsAllAdmins(true);
                    setSelectedAdmins([]);
                  }}
                >
                  {isAllAdmins && <Check className="w-3 h-3" />}
                  <span>{t('admin.receipts.settingsAdminsAll')}</span>
                </button>
              </div>

              <div className="space-y-1.5 pt-1">
                {allAdmins.map((adminId) => {
                  const isChecked = !isAllAdmins && selectedAdmins.includes(adminId);
                  return (
                    <button
                      type="button"
                      key={adminId}
                      className={`w-full p-2.5 rounded-tile border flex items-center justify-between text-xs cursor-pointer rs-focus ${
                        isChecked
                          ? 'bg-brand-soft border-brand/30 text-brand-fg font-semibold'
                          : 'bg-surface border-line text-ink-soft hover:border-line-strong'
                      }`}
                      onClick={() => handleToggleAdmin(adminId)}
                    >
                      <bdi dir="ltr" className="tnum font-medium text-xs">
                        #{formatId(adminId)}
                      </bdi>
                      <span
                        className={`w-4 h-4 rounded-xs border flex items-center justify-center ${
                          isChecked
                            ? 'bg-brand border-brand text-brand-ink'
                            : 'border-line-strong bg-surface-2'
                        }`}
                      >
                        {isChecked && <Check className="w-3 h-3" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Card>
          </>
        )}
      </div>
    </Modal>
  );
};
