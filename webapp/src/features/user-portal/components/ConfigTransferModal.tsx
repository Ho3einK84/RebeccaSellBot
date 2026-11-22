import React, { useState } from 'react';
import { Send, Search, AlertCircle, UserCheck, AlertTriangle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { api, ApiClientError } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import type { RecipientPreview, UserConfigRecord } from '@/shared/types/userPortal.js';

interface ConfigTransferModalProps {
  isOpen: boolean;
  config: UserConfigRecord | null;
  onClose: () => void;
  onTransferred: () => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

export const ConfigTransferModal: React.FC<ConfigTransferModalProps> = ({
  isOpen,
  config,
  onClose,
  onTransferred,
  onNotify,
}) => {
  const { t } = useLanguage();
  const { triggerHaptic } = useHaptic();
  const queryClient = useQueryClient();

  const [recipientInput, setRecipientInput] = useState('');
  const [preview, setPreview] = useState<{
    recipient: RecipientPreview;
    autoRenewWillReset: boolean;
  } | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  if (!isOpen || !config) return null;

  const mapTransferError = (err: unknown): string => {
    if (err instanceof ApiClientError) {
      if (err.code === 'TRANSFER_TARGET_NOT_FOUND')
        return t('user.services.transferTargetNotFound');
      if (err.code === 'TRANSFER_TO_SELF') return t('user.services.transferToSelf');
      if (err.code === 'TRANSFER_TARGET_BANNED') return t('user.services.transferTargetBanned');
      if (err.code === 'PANEL_DOWN') return t('user.services.panelDownError');
    }
    return t('common.error');
  };

  const handleClose = () => {
    if (isLookingUp || isTransferring) return;
    setRecipientInput('');
    setPreview(null);
    setErrorText(null);
    onClose();
  };

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = recipientInput.trim();
    if (!trimmed || isLookingUp) return;
    setIsLookingUp(true);
    setErrorText(null);
    triggerHaptic('light');

    try {
      const res = await api.previewUserConfigTransfer(config.id, trimmed);
      setPreview(res);
      triggerHaptic('selection');
    } catch (err) {
      triggerHaptic('error');
      setPreview(null);
      setErrorText(mapTransferError(err));
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleConfirmTransfer = async () => {
    if (!preview || isTransferring) return;
    setIsTransferring(true);
    setErrorText(null);
    triggerHaptic('warning');

    try {
      const res = await api.transferUserConfig(config.id, {
        toTelegramId: preview.recipient.telegramId,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.user.configs });
      await queryClient.invalidateQueries({ queryKey: queryKeys.user.profile });
      triggerHaptic('success');
      onNotify(
        t('user.services.transferSuccess').replace('{username}', res.configUsername),
        'success'
      );
      setRecipientInput('');
      setPreview(null);
      onTransferred();
    } catch (err) {
      triggerHaptic('error');
      setErrorText(mapTransferError(err));
    } finally {
      setIsTransferring(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      maxWidth="sm"
      closeOnBackdrop={!isTransferring}
      hideCloseButton={isTransferring}
      title={t('user.services.transferModalTitle')}
      subtitle={t('user.services.transferModalSubtitle')}
      icon={
        <IconTile tone="info" size="sm">
          <Send />
        </IconTile>
      }
    >
      <div className="flex flex-col gap-3.5 text-start">
        <div className="rounded-tile border border-line bg-surface-2 px-3 py-2 text-xs flex items-center justify-between gap-2">
          <span className="text-ink-muted">{t('user.shop.configUsername')}</span>
          <bdi dir="ltr" className="font-mono font-semibold text-ink">
            {config.configUsername}
          </bdi>
        </div>

        <form onSubmit={(e) => void handleLookup(e)} className="flex flex-col gap-2">
          <label className="text-xs font-medium text-ink-soft">
            {t('user.services.transferRecipientLabel')}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              dir="ltr"
              value={recipientInput}
              onChange={(e) => {
                setRecipientInput(e.target.value);
                if (preview) setPreview(null);
                if (errorText) setErrorText(null);
              }}
              placeholder={t('user.services.transferRecipientPlaceholder')}
              disabled={isLookingUp || isTransferring}
              className="flex-1 min-h-11 px-3 rounded-ctl border border-line bg-surface-2 text-xs sm:text-sm font-mono text-ink placeholder:text-ink-muted rs-focus"
            />
            <Button
              type="submit"
              size="md"
              variant="secondary"
              loading={isLookingUp}
              disabled={!recipientInput.trim() || isLookingUp || isTransferring}
            >
              <Search className="w-4 h-4 shrink-0" />
              <span>{t('user.services.transferLookup')}</span>
            </Button>
          </div>
        </form>

        {errorText && (
          <div className="rounded-tile border border-danger/30 bg-danger-soft p-2.5 text-xs text-danger-fg flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorText}</span>
          </div>
        )}

        {preview && (
          <div className="anim-pop rounded-tile border border-brand/30 bg-brand-soft/60 p-3.5 flex flex-col gap-2.5">
            <div className="flex items-center gap-2.5">
              <IconTile tone="brand" size="sm">
                <UserCheck />
              </IconTile>
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] text-ink-muted">
                  {t('user.services.transferConfirmPreview')}
                </span>
                <span className="text-xs sm:text-sm font-semibold text-ink truncate">
                  {preview.recipient.displayName}
                </span>
                <span className="text-[11px] font-mono text-ink-soft">
                  <bdi dir="ltr">
                    {preview.recipient.username ? `${preview.recipient.username} · ` : ''}#
                    {preview.recipient.telegramId}
                  </bdi>
                </span>
              </div>
            </div>

            {preview.autoRenewWillReset && (
              <div className="flex items-start gap-1.5 text-[11px] text-warn-fg">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{t('user.services.transferAutoRenewResetNote')}</span>
              </div>
            )}

            <Button
              type="button"
              variant="primary"
              size="md"
              block
              loading={isTransferring}
              disabled={isTransferring}
              onClick={() => void handleConfirmTransfer()}
            >
              <Send className="w-4 h-4 shrink-0" />
              <span>{t('user.services.transferConfirmButton')}</span>
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
};
