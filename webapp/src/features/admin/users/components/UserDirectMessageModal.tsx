import React, { useState, useEffect } from 'react';
import { Send } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { IconTile } from '@/shared/components/ui/IconTile.js';
import { Textarea } from '@/shared/components/ui/Input.js';
import type { UserProfile } from '@/shared/types/admin.js';

interface UserDirectMessageModalProps {
  user: UserProfile | null;
  isOpen: boolean;
  onClose: () => void;
  onSend: (message: string) => Promise<void>;
  loading?: boolean;
}

const MAX_DM_LENGTH = 3800;

export const UserDirectMessageModal: React.FC<UserDirectMessageModalProps> = ({
  user,
  isOpen,
  onClose,
  onSend,
  loading = false,
}) => {
  const { t } = useLanguage();
  const { formatId, formatNumber, sanitizeDisplayName } = useFormatters();
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!isOpen) setMessage('');
  }, [isOpen, user?.telegramId]);

  if (!isOpen || !user) return null;

  const { displayName } = sanitizeDisplayName(
    user.firstName,
    user.lastName,
    user.username ? `@${user.username}` : `#${formatId(user.telegramId)}`
  );

  const trimmed = message.trim();
  const canSend = trimmed.length > 0 && trimmed.length <= MAX_DM_LENGTH && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    await onSend(trimmed);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="md"
      closeOnBackdrop={!loading}
      title={t('admin.users.dmModalTitle')}
      subtitle={
        <span className="inline-flex items-center gap-1.5 text-brand-fg tnum">
          <span>{displayName}</span>
          <span className="opacity-40">·</span>
          <bdi dir="ltr">#{formatId(user.telegramId)}</bdi>
        </span>
      }
      icon={
        <IconTile tone="brand" size="sm">
          <Send />
        </IconTile>
      }
      footer={
        <div className="flex items-center gap-2.5">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={onClose}
            disabled={loading}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="admin-user-dm-form"
            variant="primary"
            className="flex-1"
            disabled={!canSend}
            loading={loading}
          >
            <Send className="w-3.5 h-3.5" />
            <span>{loading ? t('admin.users.dmSending') : t('admin.users.dmSendBtn')}</span>
          </Button>
        </div>
      }
    >
      <form id="admin-user-dm-form" onSubmit={(e) => void handleSubmit(e)} className="space-y-2">
        <Textarea
          rows={5}
          maxLength={MAX_DM_LENGTH}
          placeholder={t('admin.users.dmPlaceholder')}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div className="flex justify-end text-[11px] text-ink-muted tnum">
          <bdi dir="ltr">
            {formatNumber(message.length)} / {formatNumber(MAX_DM_LENGTH)}
          </bdi>
        </div>
      </form>
    </Modal>
  );
};
