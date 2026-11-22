import React, { useState } from 'react';
import { Link2, Check, AlertCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { api, ApiClientError } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';

interface ClaimSubLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

export const ClaimSubLinkModal: React.FC<ClaimSubLinkModalProps> = ({
  isOpen,
  onClose,
  onNotify,
}) => {
  const { t } = useLanguage();
  const { triggerHaptic } = useHaptic();
  const queryClient = useQueryClient();

  const [subUrl, setSubUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const handleClose = () => {
    if (isSubmitting) return;
    setSubUrl('');
    setErrorText(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = subUrl.trim();
    if (!trimmed || isSubmitting) return;
    setIsSubmitting(true);
    setErrorText(null);
    triggerHaptic('medium');

    try {
      const res = await api.claimUserSubLink(trimmed);
      await queryClient.invalidateQueries({ queryKey: queryKeys.user.configs });
      await queryClient.invalidateQueries({ queryKey: queryKeys.user.profile });
      triggerHaptic('success');
      onNotify(
        t('user.services.claimSuccess').replace('{username}', res.username || '—'),
        'success'
      );
      setSubUrl('');
      onClose();
    } catch (err: unknown) {
      triggerHaptic('error');
      let msg = t('user.services.claimNotFound');
      if (err instanceof ApiClientError) {
        if (err.code === 'CLAIM_ALREADY_CLAIMED') msg = t('user.services.claimAlreadyClaimed');
        else if (err.code === 'CLAIM_RATE_LIMITED') msg = t('user.services.claimRateLimited');
        else if (err.code === 'PANEL_DOWN') msg = t('user.services.panelDownError');
      }
      setErrorText(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      maxWidth="sm"
      title={t('user.services.claimModalTitle')}
      subtitle={t('user.services.claimModalSubtitle')}
      icon={
        <IconTile tone="brand" size="sm">
          <Link2 />
        </IconTile>
      }
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3.5 text-start">
        <input
          type="url"
          dir="ltr"
          value={subUrl}
          onChange={(e) => {
            setSubUrl(e.target.value);
            if (errorText) setErrorText(null);
          }}
          placeholder={t('user.services.claimPlaceholder')}
          disabled={isSubmitting}
          required
          className="w-full min-h-11 px-3 rounded-ctl border border-line bg-surface-2 text-xs sm:text-sm font-mono text-ink placeholder:text-ink-muted rs-focus"
        />

        {errorText && (
          <div className="rounded-tile border border-danger/30 bg-danger-soft p-2.5 text-xs text-danger-fg flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorText}</span>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            className="flex-1"
            loading={isSubmitting}
            disabled={!subUrl.trim() || isSubmitting}
          >
            <Check className="w-4 h-4 shrink-0" />
            <span>{t('user.services.claimSubmit')}</span>
          </Button>
        </div>
      </form>
    </Modal>
  );
};
