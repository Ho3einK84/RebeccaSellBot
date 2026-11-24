import React, { useState, useEffect } from 'react';
import {
  Megaphone,
  ExternalLink,
  CheckCircle2,
  RefreshCw,
  AlertTriangle,
  Send,
} from 'lucide-react';
import { Card } from '@/shared/components/ui/Card.js';
import { Button } from '@/shared/components/ui/Button.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import { api, ApiClientError } from '@/shared/lib/api.js';
import { minimizeOrCloseWebApp } from '@/shared/lib/telegramNavigation.js';
import type {
  ForcedJoinChannelDto,
  ForcedJoinErrorPayload,
  ForcedJoinScopeDto,
} from '@/shared/types/userPortal.js';

export function extractForcedJoinPayload(
  err: unknown
): { scope: ForcedJoinScopeDto; channels: ForcedJoinChannelDto[] } | null {
  if (!(err instanceof ApiClientError)) return null;
  const payload = (err.data ?? {}) as ForcedJoinErrorPayload;
  if (err.code !== 'CHANNEL_JOIN_REQUIRED' && payload.code !== 'CHANNEL_JOIN_REQUIRED') {
    return null;
  }
  const channels = Array.isArray(payload.channels) ? payload.channels : [];
  return {
    scope: payload.scope ?? 'all',
    channels,
  };
}

function openChannelLink(url: string): void {
  if (typeof window === 'undefined') return;
  const tg = window.Telegram?.WebApp;
  if (tg && typeof tg.openTelegramLink === 'function' && /^https:\/\/t\.me\//i.test(url)) {
    tg.openTelegramLink(url);
    return;
  }
  if (tg && typeof tg.openLink === 'function') {
    tg.openLink(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

interface ForcedJoinGateBodyProps {
  initialChannels: ForcedJoinChannelDto[];
  action: 'any' | 'trial' | 'purchase';
  onVerified: () => void;
  onNotify?: (message: string, type?: 'success' | 'error') => void;
  showBackToBot?: boolean;
}

const ForcedJoinGateBody: React.FC<ForcedJoinGateBodyProps> = ({
  initialChannels,
  action,
  onVerified,
  onNotify,
  showBackToBot = false,
}) => {
  const { t } = useLanguage();
  const { triggerHaptic } = useHaptic();
  const [channels, setChannels] = useState<ForcedJoinChannelDto[]>(initialChannels);
  const [isChecking, setIsChecking] = useState(false);
  const [stillMissing, setStillMissing] = useState(false);

  useEffect(() => {
    setChannels(initialChannels);
    setStillMissing(false);
  }, [initialChannels]);

  const handleRecheck = async () => {
    if (isChecking) return;
    setIsChecking(true);
    setStillMissing(false);
    triggerHaptic('medium');
    try {
      const res = await api.checkUserForcedJoin(action);
      if (res.joined) {
        triggerHaptic('success');
        onNotify?.(t('user.forcedJoin.verified'), 'success');
        onVerified();
      } else {
        triggerHaptic('error');
        setChannels(res.channels.length > 0 ? res.channels : initialChannels);
        setStillMissing(true);
      }
    } catch {
      triggerHaptic('error');
      onNotify?.(t('common.networkError'), 'error');
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="flex flex-col gap-3.5 w-full">
      <div className="flex flex-col gap-2">
        {channels.map((ch) => (
          <button
            key={ch.id || ch.channelId}
            type="button"
            onClick={() => {
              triggerHaptic('light');
              openChannelLink(ch.inviteLink);
            }}
            className="press rs-focus flex items-center justify-between gap-3 w-full rounded-tile border border-line bg-surface-2 hover:bg-surface-3 px-3.5 py-2.5 text-start transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <IconTile tone="brand" size="sm">
                <Megaphone />
              </IconTile>
              <div className="min-w-0 flex-1">
                <div className="text-xs sm:text-sm font-semibold text-ink truncate">{ch.title}</div>
                <bdi dir="ltr" className="text-[11px] text-ink-muted truncate block">
                  {ch.channelId.startsWith('@') ? ch.channelId : ch.inviteLink}
                </bdi>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-semibold text-brand-fg shrink-0">
              <span>{t('user.forcedJoin.joinBtn')}</span>
              <ExternalLink className="w-3 h-3 shrink-0" />
            </span>
          </button>
        ))}
      </div>

      {stillMissing && (
        <div className="rounded-ctl border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn-fg flex items-center gap-2 text-start">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{t('user.forcedJoin.stillMissing')}</span>
        </div>
      )}

      <div className="flex flex-col gap-2 pt-1 border-t border-line">
        <Button
          type="button"
          variant="primary"
          size="md"
          block
          loading={isChecking}
          disabled={isChecking}
          onClick={() => void handleRecheck()}
        >
          {isChecking ? (
            <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          )}
          <span>
            {isChecking ? t('user.forcedJoin.checking') : t('user.forcedJoin.recheckBtn')}
          </span>
        </Button>

        {showBackToBot && (
          <Button type="button" variant="secondary" size="md" block onClick={minimizeOrCloseWebApp}>
            <Send className="w-3.5 h-3.5 shrink-0" />
            <span>{t('user.backToBot')}</span>
          </Button>
        )}
      </div>
    </div>
  );
};

interface ForcedJoinFullScreenProps {
  channels: ForcedJoinChannelDto[];
  onVerified: () => void;
  onNotify?: (message: string, type?: 'success' | 'error') => void;
}

export const ForcedJoinFullScreen: React.FC<ForcedJoinFullScreenProps> = ({
  channels,
  onVerified,
  onNotify,
}) => {
  const { t } = useLanguage();
  return (
    <div className="safe-top safe-bottom relative flex min-h-[100dvh] w-full flex-col items-center justify-center bg-canvas p-4 text-ink">
      <Card
        padding="lg"
        className="anim-rise relative z-10 flex w-full max-w-sm flex-col items-center gap-4 border-brand/30 text-center"
      >
        <IconTile tone="brand" size="lg">
          <Megaphone />
        </IconTile>
        <div className="flex flex-col gap-1.5">
          <h2 className="m-0 text-base font-semibold text-ink sm:text-lg leading-[1.4]">
            {t('user.forcedJoin.title')}
          </h2>
          <p className="m-0 text-xs leading-relaxed text-ink-muted">{t('user.forcedJoin.desc')}</p>
        </div>
        <ForcedJoinGateBody
          initialChannels={channels}
          action="any"
          onVerified={onVerified}
          onNotify={onNotify}
          showBackToBot
        />
      </Card>
    </div>
  );
};

interface ForcedJoinModalProps {
  isOpen: boolean;
  channels: ForcedJoinChannelDto[];
  action: 'trial' | 'purchase';
  onClose: () => void;
  onVerified: () => void;
  onNotify?: (message: string, type?: 'success' | 'error') => void;
}

export const ForcedJoinModal: React.FC<ForcedJoinModalProps> = ({
  isOpen,
  channels,
  action,
  onClose,
  onVerified,
  onNotify,
}) => {
  const { t } = useLanguage();
  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="sm"
      title={t('user.forcedJoin.title')}
      subtitle={
        action === 'trial' ? t('user.forcedJoin.trialDesc') : t('user.forcedJoin.purchaseDesc')
      }
      icon={
        <IconTile tone="brand" size="sm">
          <Megaphone />
        </IconTile>
      }
    >
      <ForcedJoinGateBody
        initialChannels={channels}
        action={action}
        onVerified={onVerified}
        onNotify={onNotify}
      />
    </Modal>
  );
};
