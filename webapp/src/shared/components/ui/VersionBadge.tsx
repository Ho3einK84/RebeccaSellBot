import React from 'react';
import { Check, Copy, GitBranch, GitCommitHorizontal, Tag } from 'lucide-react';
import { Badge, type BadgeVariant } from './Badge.js';
import { Card } from './Card.js';
import { IconTile } from './IconTile.js';
import { useToast } from './Toast.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { resolveClientAppVersion } from '@/shared/lib/appVersion.js';
import type { AppVersionInfo, ReleaseChannel } from '@/shared/types/api.js';

function channelBadgeVariant(channel: ReleaseChannel): BadgeVariant {
  if (channel === 'dev') return 'warning';
  if (channel === 'prerelease') return 'info';
  return 'success';
}

function channelDotClass(channel: ReleaseChannel): string {
  if (channel === 'dev') return 'bg-warn';
  if (channel === 'prerelease') return 'bg-info';
  return 'bg-ok';
}

function channelShortTag(info: AppVersionInfo): string {
  if (info.channel === 'dev') return info.branch || 'dev';
  if (info.channel === 'prerelease') return 'pre';
  return info.branch || 'main';
}

interface VersionBadgeProps {
  version?: AppVersionInfo | null;
  size?: 'xs' | 'sm';
  showChannel?: boolean;
  className?: string;
}

/**
 * Compact monospace version pill for desktop headers and status areas.
 * Distinguishes official `main` (stable) builds from `dev` and `prerelease` builds at a glance.
 */
export const VersionBadge: React.FC<VersionBadgeProps> = ({
  version,
  size = 'xs',
  showChannel = false,
  className = '',
}) => {
  const { t } = useLanguage();
  const info = resolveClientAppVersion(version);
  const variant: BadgeVariant =
    info.channel === 'dev' ? 'warning' : info.channel === 'prerelease' ? 'info' : 'neutral';
  const channelLabel =
    info.channel === 'dev'
      ? t('version.channelDev')
      : info.channel === 'prerelease'
        ? t('version.channelPrerelease')
        : t('version.channelStable');
  const tooltip = `${info.fullVersion || info.displayVersion} (${channelLabel})`;

  return (
    <Badge
      variant={variant}
      size={size}
      dot={info.channel !== 'stable'}
      title={tooltip}
      className={`shrink-0 ${className}`}
    >
      <bdi dir="ltr" className="font-mono tnum tracking-tight">
        {info.displayVersion}
      </bdi>
      {showChannel ? (
        <span className="hidden sm:inline opacity-75 font-normal">
          · <bdi dir="ltr">{channelShortTag(info)}</bdi>
        </span>
      ) : null}
    </Badge>
  );
};

interface AppVersionFooterProps {
  version?: AppVersionInfo | null;
  detailed?: boolean;
  className?: string;
}

/**
 * Minimal, single-line version signature placed cleanly at the bottom of the WebApp workspace.
 * Displays only the sleek version tag for users, and adds a compact copyable commit chip for admins.
 */
export const AppVersionFooter: React.FC<AppVersionFooterProps> = ({
  version,
  detailed = false,
  className = '',
}) => {
  const { t } = useLanguage();
  const { copy, isCopied } = useCopy();
  const { notify } = useToast();
  const info = resolveClientAppVersion(version);
  const copyTarget = info.fullVersion || info.displayVersion;

  const handleCopy = async () => {
    const ok = await copy(copyTarget, 'footer-app-version');
    if (ok) {
      notify(t('version.copied'), 'success');
    }
  };

  return (
    <footer
      aria-label={t('version.title')}
      className={`mt-4 pt-3 border-t border-line/50 flex items-center justify-center gap-2 text-[11px] text-ink-muted/85 ${className}`}
    >
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${channelDotClass(info.channel)}`}
        />
        <bdi dir="ltr" className="font-mono tnum text-ink-soft">
          {info.displayVersion}
        </bdi>
      </span>

      {detailed && info.commit ? (
        <>
          <span className="opacity-35" aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            onClick={() => void handleCopy()}
            title={t('version.copyBuildId')}
            className="press rs-focus inline-flex h-5 items-center gap-1 rounded-full border border-line/80 bg-surface-2/80 px-2 font-mono tnum text-[10.5px] text-ink-muted hover:border-line-strong hover:text-ink cursor-pointer transition-colors"
          >
            <GitCommitHorizontal className="w-3 h-3 opacity-65 shrink-0" />
            <bdi dir="ltr">{info.commit}</bdi>
            {isCopied('footer-app-version') ? (
              <Check className="w-2.5 h-2.5 text-ok-fg shrink-0" />
            ) : (
              <Copy className="w-2.5 h-2.5 opacity-55 shrink-0" />
            )}
          </button>
        </>
      ) : null}
    </footer>
  );
};

interface AdminVersionCardProps {
  version?: AppVersionInfo | null;
}

/**
 * Clean, minimal build & release metadata card rendered in the Admin More & Settings (`ModulesTab`) view.
 */
export const AdminVersionCard: React.FC<AdminVersionCardProps> = ({ version }) => {
  const { t, locale } = useLanguage();
  const { copy, isCopied } = useCopy();
  const { notify } = useToast();
  const info = resolveClientAppVersion(version);

  const channelLabel =
    info.channel === 'dev'
      ? t('version.channelDev')
      : info.channel === 'prerelease'
        ? t('version.channelPrerelease')
        : t('version.channelStable');
  const branchLabel = channelShortTag(info);
  const fullBuildId = info.fullVersion || info.displayVersion;

  let formattedBuiltAt: string | null = null;
  if (info.builtAt) {
    const parsed = new Date(info.builtAt);
    if (!Number.isNaN(parsed.getTime())) {
      try {
        formattedBuiltAt = new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(parsed);
      } catch {
        formattedBuiltAt = parsed.toISOString();
      }
    }
  }

  const handleCopyVersion = async () => {
    const ok = await copy(fullBuildId, 'admin-version-card');
    if (ok) {
      notify(t('version.copied'), 'success');
    }
  };

  return (
    <Card padding="md" className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <IconTile
            tone={info.channel === 'dev' ? 'warn' : info.channel === 'prerelease' ? 'info' : 'ok'}
            size="md"
          >
            {info.channel === 'stable' ? <Tag /> : <GitBranch />}
          </IconTile>
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-[13.5px] font-bold text-ink m-0 leading-snug">
                {t('version.title')}
              </h3>
              <Badge variant={channelBadgeVariant(info.channel)} size="xs" dot>
                {channelLabel}
              </Badge>
            </div>
            <p className="text-[11px] text-ink-muted m-0 leading-relaxed">
              {t('version.subtitle')}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void handleCopyVersion()}
          className="press rs-focus inline-flex h-7 items-center gap-1.5 rounded-ctl border border-line bg-surface-2 px-2.5 text-[11px] font-medium text-ink-soft hover:border-line-strong hover:text-ink cursor-pointer transition-colors shrink-0"
        >
          {isCopied('admin-version-card') ? (
            <Check className="w-3.5 h-3.5 text-ok-fg shrink-0" />
          ) : (
            <Copy className="w-3.5 h-3.5 shrink-0" />
          )}
          <span>{t('version.copyBuildId')}</span>
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2.5 border-t border-line/70">
        <div className="rounded-tile border border-line/80 bg-surface-2/60 px-2.5 py-2 space-y-0.5">
          <div className="text-[10.5px] text-ink-muted">{t('version.label')}</div>
          <div className="text-xs font-semibold text-ink truncate">
            <bdi dir="ltr" className="font-mono tnum">
              {info.displayVersion}
            </bdi>
          </div>
        </div>

        <div className="rounded-tile border border-line/80 bg-surface-2/60 px-2.5 py-2 space-y-0.5">
          <div className="text-[10.5px] text-ink-muted">{t('version.branch')}</div>
          <div className="text-xs font-semibold text-ink truncate">
            <bdi dir="ltr" className="font-mono">
              {branchLabel}
            </bdi>
          </div>
        </div>

        <div className="rounded-tile border border-line/80 bg-surface-2/60 px-2.5 py-2 space-y-0.5">
          <div className="text-[10.5px] text-ink-muted">{t('version.commit')}</div>
          <div className="text-xs font-semibold text-ink truncate flex items-center gap-1">
            <bdi dir="ltr" className="font-mono tnum">
              {info.commit || '—'}
            </bdi>
            {info.dirty ? (
              <span className="text-[10px] font-normal text-warn-fg">
                ({t('version.dirtyTag')})
              </span>
            ) : null}
          </div>
        </div>

        <div className="rounded-tile border border-line/80 bg-surface-2/60 px-2.5 py-2 space-y-0.5">
          <div className="text-[10.5px] text-ink-muted">
            {formattedBuiltAt ? t('version.builtAt') : t('version.buildId')}
          </div>
          <div className="text-xs font-semibold text-ink truncate">
            {formattedBuiltAt ? (
              <span className="tnum">{formattedBuiltAt}</span>
            ) : (
              <bdi dir="ltr" className="font-mono tnum">
                {fullBuildId}
              </bdi>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
};
