import React, { useEffect, useState } from 'react';
import { Gift, Sparkles, Copy, Check, Phone, CheckCircle2, Wifi, Send } from 'lucide-react';
import QRCode from 'qrcode';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { useTelegramContactVerification } from '@/shared/hooks/useTelegramContactVerification.js';
import { api, ApiClientError } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { Card } from '@/shared/components/ui/Card.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { SmartConnectButtons } from './SmartConnectButtons.js';
import type { TrialClaimResponse, UserTrialStatus } from '@/shared/types/userPortal.js';

interface FreeTrialBannerProps {
  trial: UserTrialStatus | null | undefined;
  botUsername?: string;
  compact?: boolean;
  onClaimed?: (result: TrialClaimResponse) => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

export const FreeTrialBanner: React.FC<FreeTrialBannerProps> = ({
  trial,
  botUsername,
  compact = false,
  onClaimed,
  onNotify,
}) => {
  const { t } = useLanguage();
  const { formatNumber } = useFormatters();
  const { triggerHaptic } = useHaptic();
  const queryClient = useQueryClient();

  const [isClaiming, setIsClaiming] = useState(false);
  const [needsPhoneGate, setNeedsPhoneGate] = useState(false);

  const executeClaim = async () => {
    if (isClaiming) return;
    setIsClaiming(true);
    triggerHaptic('medium');
    try {
      const res = await api.claimUserTrial();
      triggerHaptic('success');
      await queryClient.invalidateQueries({ queryKey: queryKeys.user.profile });
      await queryClient.invalidateQueries({ queryKey: queryKeys.user.configs });
      await queryClient.invalidateQueries({ queryKey: queryKeys.user.trial });
      setNeedsPhoneGate(false);
      onNotify(t('user.trial.modalTitle'), 'success');
      onClaimed?.(res);
    } catch (err: unknown) {
      triggerHaptic('error');
      if (err instanceof ApiClientError) {
        if (err.code === 'PHONE_VERIFICATION_REQUIRED') {
          setNeedsPhoneGate(true);
          return;
        }
        if (err.code === 'TRIAL_ALREADY_USED') {
          onNotify(t('user.trial.alreadyUsed'), 'error');
          void queryClient.invalidateQueries({ queryKey: queryKeys.user.profile });
          return;
        }
        if (err.code === 'TRIAL_DISABLED') {
          onNotify(t('user.trial.disabled'), 'error');
          return;
        }
      }
      onNotify(t('user.trial.failed'), 'error');
    } finally {
      setIsClaiming(false);
    }
  };

  const phoneVerify = useTelegramContactVerification({
    botUsername,
    onVerified: () => {
      setNeedsPhoneGate(false);
      void executeClaim();
    },
  });

  if (!trial || !trial.enabled || !trial.eligible) return null;

  const showPhonePrompt = needsPhoneGate || Boolean(trial.phoneVerificationRequired);

  return (
    <Card
      tone="brand"
      padding={compact ? 'md' : 'lg'}
      className="flex flex-col gap-3 text-start relative overflow-hidden"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <IconTile tone="brand" size={compact ? 'sm' : 'md'}>
            <Gift />
          </IconTile>
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xs sm:text-sm font-semibold text-ink m-0">
                {t('user.trial.title')}
              </h3>
              <Badge variant="primary" size="xs">
                <Sparkles className="w-3 h-3" />
                <span>{t('user.trial.badge')}</span>
              </Badge>
            </div>
            <p className="text-xs text-ink-soft m-0 leading-relaxed">
              {showPhonePrompt
                ? t('user.trial.phoneRequiredDesc')
                : t('user.trial.desc')
                    .replace('{gb}', formatNumber(trial.gb))
                    .replace('{days}', formatNumber(trial.days))}
            </p>
          </div>
        </div>
      </div>

      {showPhonePrompt ? (
        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            loading={phoneVerify.isVerifying || isClaiming}
            disabled={phoneVerify.isVerifying || isClaiming}
            onClick={phoneVerify.startVerification}
            className="flex-1"
          >
            <Phone className="w-3.5 h-3.5 shrink-0" />
            <span>
              {phoneVerify.isVerifying
                ? t('user.shop.verifyPhoneWaiting')
                : t('user.trial.verifyAndClaim')}
            </span>
          </Button>
          {phoneVerify.supportsNativeRequestContact && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={phoneVerify.openBotFallback}
            >
              <Send className="w-3.5 h-3.5 shrink-0" />
              <span>{t('user.shop.verifyPhoneInBot')}</span>
            </Button>
          )}
        </div>
      ) : (
        <Button
          type="button"
          variant="primary"
          size="sm"
          loading={isClaiming}
          disabled={isClaiming}
          onClick={() => void executeClaim()}
          block
        >
          <Sparkles className="w-3.5 h-3.5 shrink-0" />
          <span>{isClaiming ? t('user.trial.claiming') : t('user.trial.claimCta')}</span>
        </Button>
      )}
    </Card>
  );
};

interface FreeTrialResultModalProps {
  result: TrialClaimResponse | null;
  onClose: () => void;
  onGoToServices: () => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

export const FreeTrialResultModal: React.FC<FreeTrialResultModalProps> = ({
  result,
  onClose,
  onGoToServices,
  onNotify,
}) => {
  const { t } = useLanguage();
  const { copy, isCopied } = useCopy();
  const { triggerHaptic } = useHaptic();
  const [qrSrc, setQrSrc] = useState('');

  useEffect(() => {
    if (!result?.subUrl) {
      setQrSrc('');
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(result.subUrl, {
      width: 210,
      margin: 1.5,
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setQrSrc(url);
      })
      .catch(() => {
        if (!cancelled) setQrSrc('');
      });
    return () => {
      cancelled = true;
    };
  }, [result?.subUrl]);

  if (!result) return null;

  const handleCopy = async () => {
    if (!result.subUrl) return;
    triggerHaptic('light');
    const ok = await copy(result.subUrl, 'trial-sub-url');
    if (ok) onNotify(t('user.services.linkCopied'), 'success');
  };

  return (
    <Modal
      isOpen={Boolean(result)}
      onClose={onClose}
      maxWidth="md"
      title={t('user.trial.modalTitle')}
      subtitle={t('user.trial.modalSubtitle')}
      icon={
        <IconTile tone="ok" size="sm">
          <CheckCircle2 />
        </IconTile>
      }
      footer={
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button
            type="button"
            variant="primary"
            className="flex-1"
            onClick={() => {
              onClose();
              onGoToServices();
            }}
          >
            <Wifi className="w-4 h-4 shrink-0" />
            <span>{t('user.shop.goToServices')}</span>
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-start">
        {qrSrc && (
          <div className="flex justify-center">
            <div className="rounded-tile bg-white p-2.5 border border-line shadow-sm">
              <img src={qrSrc} alt="Trial QR Code" className="w-44 h-44 block" />
            </div>
          </div>
        )}

        <div className="rounded-tile border border-line bg-surface-2 p-3 flex items-center justify-between gap-2">
          <div className="flex flex-col min-w-0">
            <span className="text-[11px] text-ink-muted">{t('user.shop.configUsername')}</span>
            <bdi dir="ltr" className="text-xs sm:text-sm font-mono font-semibold text-ink truncate">
              {result.configUsername}
            </bdi>
          </div>
          {result.subUrl && (
            <Button
              type="button"
              size="sm"
              variant={isCopied('trial-sub-url') ? 'success' : 'secondary'}
              onClick={() => void handleCopy()}
            >
              {isCopied('trial-sub-url') ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>
                {isCopied('trial-sub-url') ? t('common.copied') : t('user.services.copyLink')}
              </span>
            </Button>
          )}
        </div>

        {result.subUrl && (
          <SmartConnectButtons subUrl={result.subUrl} configUsername={result.configUsername} />
        )}
      </div>
    </Modal>
  );
};
