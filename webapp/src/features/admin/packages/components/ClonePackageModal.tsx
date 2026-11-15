import React, { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Input } from '@/shared/components/ui/Input.js';
import { Button } from '@/shared/components/ui/Button.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useTelegramBackButton } from '@/shared/hooks/useTelegramBackButton.js';
import type { AdminPackageDto } from '@/shared/types/admin.js';
import { formatBilingualPackageName, MAX_PACKAGE_NAME_LENGTH } from '../packageValidation.js';

interface ClonePackageModalProps {
  pkg: AdminPackageDto | null;
  isCloning: boolean;
  onClose: () => void;
  onConfirm: (id: string, name?: string) => Promise<void>;
}

export const ClonePackageModal: React.FC<ClonePackageModalProps> = ({
  pkg,
  isCloning,
  onClose,
  onConfirm,
}) => {
  const { t, locale } = useLanguage();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useTelegramBackButton(onClose, pkg !== null);

  useEffect(() => {
    if (pkg) {
      setName('');
      setError(null);
    }
  }, [pkg]);

  if (!pkg) return null;

  const displayName = formatBilingualPackageName(pkg.name, locale).primary;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length > MAX_PACKAGE_NAME_LENGTH) {
      setError(t('admin.packages.validation.nameTooLong', { max: MAX_PACKAGE_NAME_LENGTH }));
      return;
    }
    setError(null);
    try {
      await onConfirm(pkg.id, trimmed || undefined);
      onClose();
    } catch {
      // error toast handled by useAdminPackages onError; keep modal open
    }
  };

  return (
    <Modal
      isOpen={pkg !== null}
      onClose={onClose}
      maxWidth="md"
      icon={<Copy className="w-5 h-5 text-brand" />}
      title={t('admin.packages.cloneModal.title')}
      subtitle={t('admin.packages.cloneModal.subtitle', { name: displayName })}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isCloning}>
            {t('admin.packages.actions.cancel')}
          </Button>
          <Button
            type="submit"
            form="clone-package-form"
            variant="primary"
            size="sm"
            loading={isCloning}
          >
            {isCloning
              ? t('admin.packages.cloneModal.cloning')
              : t('admin.packages.cloneModal.confirmButton')}
          </Button>
        </div>
      }
    >
      <form id="clone-package-form" onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label
            htmlFor="clone-package-name"
            className="block text-xs font-semibold text-ink-soft mb-1"
          >
            {t('admin.packages.cloneModal.nameLabel')}
          </label>
          <Input
            id="clone-package-name"
            value={name}
            placeholder={t('admin.packages.cloneModal.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
          />
          {error && <p className="text-xs text-danger mt-1">{error}</p>}
        </div>
      </form>
    </Modal>
  );
};
