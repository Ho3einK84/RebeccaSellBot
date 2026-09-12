import React, { useState, useEffect } from 'react';
import { Bell, Save, RotateCw, Check, Users } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useThemeTokens } from '@/shared/theme/useThemeTokens.js';
import { Modal } from '@/shared/components/ui/Modal.js';
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
  const { isDark, subCardClass, textPrimary, textSecondary, textMuted } = useThemeTokens();
  const { settings, isLoading, updateSettings, isUpdating } = useReceiptSettings();

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
      icon={<Bell className="w-5 h-5 text-indigo-500" />}
      maxWidth="md"
    >
      <div className="space-y-4">
        {isLoading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2">
            <RotateCw className="w-6 h-6 animate-spin text-indigo-500" />
            <span className={`text-xs ${textMuted}`}>{t('common.loading')}</span>
          </div>
        ) : (
          <>
            {/* Toggle: Notify Enabled */}
            <div
              className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${subCardClass}`}
            >
              <div className="space-y-0.5">
                <span className={`text-xs font-semibold block ${textPrimary}`}>
                  {t('admin.receipts.settingsNotifyEnabled')}
                </span>
                <span className={`text-[11px] leading-relaxed block ${textSecondary}`}>
                  {t('admin.receipts.settingsNotifyEnabledDesc')}
                </span>
              </div>
              <input
                type="checkbox"
                className="toggle toggle-primary toggle-sm cursor-pointer"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
            </div>

            {/* Notification Mode Selection */}
            <div className={`p-3.5 rounded-xl border space-y-2.5 ${subCardClass}`}>
              <span className={`text-xs font-semibold block ${textPrimary}`}>
                {t('admin.receipts.settingsModeTitle')}
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  className={`p-3 rounded-xl border text-start transition-all cursor-pointer flex flex-col gap-1 ${
                    mode === 'full'
                      ? isDark
                        ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                        : 'bg-indigo-50 border-indigo-300 text-indigo-800'
                      : isDark
                        ? 'bg-white/[0.02] border-white/10 text-zinc-400 hover:bg-white/[0.05]'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                  onClick={() => setMode('full')}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">{t('admin.receipt_notify_mode_full')}</span>
                    {mode === 'full' && <Check className="w-3.5 h-3.5" />}
                  </div>
                  <span className="text-[10px] opacity-80">
                    {t('admin.receipts.settingsModeFull')}
                  </span>
                </button>

                <button
                  type="button"
                  className={`p-3 rounded-xl border text-start transition-all cursor-pointer flex flex-col gap-1 ${
                    mode === 'simple'
                      ? isDark
                        ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                        : 'bg-indigo-50 border-indigo-300 text-indigo-800'
                      : isDark
                        ? 'bg-white/[0.02] border-white/10 text-zinc-400 hover:bg-white/[0.05]'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                  onClick={() => setMode('simple')}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">
                      {t('admin.receipt_notify_mode_simple')}
                    </span>
                    {mode === 'simple' && <Check className="w-3.5 h-3.5" />}
                  </div>
                  <span className="text-[10px] opacity-80">
                    {t('admin.receipts.settingsModeSimple')}
                  </span>
                </button>
              </div>
            </div>

            {/* Recipient Admins Selection */}
            <div className={`p-3.5 rounded-xl border space-y-2.5 ${subCardClass}`}>
              <div className="flex items-center justify-between">
                <span className={`text-xs font-semibold flex items-center gap-1.5 ${textPrimary}`}>
                  <Users className="w-3.5 h-3.5 text-indigo-400" />
                  <span>{t('admin.receipts.settingsAdminsTitle')}</span>
                </span>
                <button
                  type="button"
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                    isAllAdmins
                      ? isDark
                        ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                        : 'bg-indigo-50 border-indigo-300 text-indigo-700'
                      : isDark
                        ? 'bg-white/[0.04] border-white/10 text-zinc-400'
                        : 'bg-slate-100 border-slate-200 text-slate-600'
                  }`}
                  onClick={() => {
                    setIsAllAdmins(true);
                    setSelectedAdmins([]);
                  }}
                >
                  {t('admin.receipts.settingsAdminsAll')}
                </button>
              </div>

              {/* Admin checklist */}
              <div className="space-y-1.5 pt-1">
                {allAdmins.map((adminId) => {
                  const isChecked = isAllAdmins || selectedAdmins.includes(adminId);
                  return (
                    <div
                      key={adminId}
                      className={`p-2.5 rounded-xl border flex items-center justify-between text-xs transition-all cursor-pointer ${
                        isChecked
                          ? isDark
                            ? 'bg-indigo-500/10 border-indigo-500/25 text-indigo-300'
                            : 'bg-indigo-50/70 border-indigo-200 text-indigo-900'
                          : isDark
                            ? 'bg-white/[0.02] border-white/5 text-zinc-400'
                            : 'bg-white border-slate-200 text-slate-600'
                      }`}
                      onClick={() => handleToggleAdmin(adminId)}
                    >
                      <span dir="ltr" className="font-mono text-xs">
                        {adminId}
                      </span>
                      <div
                        className={`w-4 h-4 rounded-md border flex items-center justify-center ${
                          isChecked
                            ? 'bg-indigo-600 border-indigo-600 text-white'
                            : isDark
                              ? 'border-white/20'
                              : 'border-slate-300'
                        }`}
                      >
                        {isChecked && <Check className="w-3 h-3" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="modal-action mt-5 flex gap-2.5">
              <button
                type="button"
                className={`flex-1 h-10 px-4 rounded-xl text-xs font-medium border transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center ${
                  isDark
                    ? 'bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/[0.08]'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100 shadow-xs'
                }`}
                onClick={onClose}
                disabled={isUpdating}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className={`flex-1 h-10 px-4 rounded-xl font-semibold text-xs border transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 ${
                  isDark
                    ? 'bg-indigo-500 hover:bg-indigo-400 text-white border-indigo-500 shadow-xs'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-600 shadow-xs'
                }`}
                disabled={isUpdating}
                onClick={handleSave}
              >
                {isUpdating ? (
                  <RotateCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>{t('admin.receipts.settingsSaveBtn')}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};
