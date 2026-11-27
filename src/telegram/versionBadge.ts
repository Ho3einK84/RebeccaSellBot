import {
  getAppVersionInfo,
  type AppVersionInfo,
  type ReleaseChannel,
} from '../infra/appVersion.js';
import { buildAdminScreen, buildBreadcrumb, buildUserScreen } from './designSystem.js';
import { localizedDate, resolveContextLocale, t } from './locale.js';
import { escapeTelegramMarkdown, sanitizeTelegramInlineCode } from './rendering.js';
import type { ConversationContext } from './types.js';

function safeLabel(
  ctx: ConversationContext,
  key: string,
  faFallback: string,
  enFallback: string
): string {
  const translated = t(ctx, key);
  if (translated && translated !== key) {
    return translated;
  }
  return resolveContextLocale(ctx) === 'en' ? enFallback : faFallback;
}

function channelEmoji(channel: ReleaseChannel): string {
  if (channel === 'dev') return '🧪';
  if (channel === 'prerelease') return '🚧';
  return '🏷️';
}

export function localizedChannelName(ctx: ConversationContext, channel: ReleaseChannel): string {
  if (channel === 'dev') {
    return safeLabel(ctx, 'version_channel_dev', 'توسعه', 'Dev');
  }
  if (channel === 'prerelease') {
    return safeLabel(ctx, 'version_channel_prerelease', 'پیش‌انتشار', 'Pre-release');
  }
  return safeLabel(ctx, 'version_channel_stable', 'پایدار', 'Stable');
}

function inlineCode(value: string): string {
  return `\`${sanitizeTelegramInlineCode(value)}\``;
}

/**
 * Compact, subtle single-line version footer for user-facing Telegram screens.
 * Never exposes internal commit hashes or dirty flags to regular users.
 */
export function formatUserVersionFooter(
  ctx: ConversationContext,
  info: AppVersionInfo = getAppVersionInfo()
): string {
  const icon = channelEmoji(info.channel);
  const versionCode = inlineCode(info.displayVersion);
  if (info.channel === 'stable') {
    return `${icon} ${info.name} ${versionCode}`;
  }
  const channelLabel = escapeTelegramMarkdown(localizedChannelName(ctx, info.channel));
  const branchTag = info.branch ? ` (${inlineCode(info.branch)})` : '';
  return `${icon} ${info.name} ${versionCode} · ${channelLabel}${branchTag}`;
}

/**
 * Compact single-line version footer for Admin Home & Settings Hub screens.
 */
export function formatAdminVersionFooter(
  ctx: ConversationContext,
  info: AppVersionInfo = getAppVersionInfo()
): string {
  const icon = channelEmoji(info.channel);
  const versionCode = inlineCode(info.displayVersion);
  const channelLabel = escapeTelegramMarkdown(localizedChannelName(ctx, info.channel));
  const trackBranch = info.branch ?? (info.channel === 'stable' ? 'main' : null);
  const details: string[] = [];
  if (trackBranch) details.push(inlineCode(trackBranch));
  if (info.commit && info.channel !== 'stable') {
    details.push(inlineCode(info.commit));
  }
  const suffix = details.length > 0 ? ` (${details.join(' · ')})` : '';
  return `${icon} ${info.name} ${versionCode} · ${channelLabel}${suffix}`;
}

/**
 * Compact field value for the Admin Stats (`adm:stats`) Infrastructure Health section.
 */
export function formatAdminStatsVersionValue(
  ctx: ConversationContext,
  info: AppVersionInfo = getAppVersionInfo()
): string {
  const versionCode = inlineCode(info.displayVersion);
  const channelLabel = escapeTelegramMarkdown(localizedChannelName(ctx, info.channel));
  const trackBranch = info.branch ?? (info.channel === 'stable' ? 'main' : null);
  const metaParts: string[] = [];
  if (trackBranch) metaParts.push(inlineCode(trackBranch));
  if (info.commit) metaParts.push(inlineCode(info.commit));
  const metaSuffix = metaParts.length > 0 ? ` (${metaParts.join(' · ')})` : '';
  return `${versionCode} · ${channelLabel}${metaSuffix}`;
}

/**
 * Render the `/version` screen. Regular users receive clean release & channel details;
 * admins receive full build telemetry (branch, commit SHA, SemVer build ID, timestamp, runtime).
 */
export function buildVersionScreen(
  ctx: ConversationContext,
  options: { isAdmin: boolean; info?: AppVersionInfo }
): string {
  const info = options.info ?? getAppVersionInfo();
  const icon = channelEmoji(info.channel);
  const title = safeLabel(ctx, 'version_title', 'نسخه و اطلاعات ساخت', 'Version & Build Info');
  const subtitle = safeLabel(
    ctx,
    'version_subtitle',
    'اطلاعات نسخه و کانال انتشار RebeccaSellBot',
    'RebeccaSellBot release version and channel details'
  );
  const channelLabel = localizedChannelName(ctx, info.channel);
  const channelDisplay =
    info.channel === 'stable'
      ? `🟢 ${escapeTelegramMarkdown(channelLabel)}`
      : info.channel === 'dev'
        ? `🧪 ${escapeTelegramMarkdown(channelLabel)}`
        : `🚧 ${escapeTelegramMarkdown(channelLabel)}`;

  const trackBranch = info.branch ?? (info.channel === 'stable' ? 'main' : null);

  if (!options.isAdmin) {
    return buildUserScreen({
      emoji: icon,
      title,
      subtitle,
      primary: {
        label: safeLabel(ctx, 'version_version_label', 'نسخه', 'Version'),
        value: inlineCode(info.displayVersion),
        inline: true,
      },
      sections: [
        {
          fields: [
            {
              label: safeLabel(ctx, 'version_product_label', 'نرم‌افزار', 'Application'),
              value: info.name,
            },
            {
              label: safeLabel(ctx, 'version_channel_label', 'کانال انتشار', 'Release Channel'),
              value: trackBranch
                ? `${channelDisplay} (${inlineCode(trackBranch)})`
                : channelDisplay,
            },
          ],
        },
      ],
    });
  }

  const buildFields: Array<{ label: string; value: string }> = [
    {
      label: safeLabel(ctx, 'version_product_label', 'نرم‌افزار', 'Application'),
      value: info.name,
    },
    {
      label: safeLabel(ctx, 'version_channel_label', 'کانال انتشار', 'Release Channel'),
      value: channelDisplay,
    },
  ];

  if (trackBranch) {
    buildFields.push({
      label: safeLabel(ctx, 'version_branch_label', 'شاخه (Branch)', 'Branch'),
      value: inlineCode(trackBranch),
    });
  }
  if (info.commit) {
    const dirtySuffix = info.dirty
      ? ` · ${escapeTelegramMarkdown(safeLabel(ctx, 'version_dirty_tag', 'تغییرات محلی', 'local changes'))}`
      : '';
    buildFields.push({
      label: safeLabel(ctx, 'version_commit_label', 'کد کامیت', 'Commit'),
      value: `${inlineCode(info.commit)}${dirtySuffix}`,
    });
  }
  if (info.fullVersion !== info.displayVersion) {
    buildFields.push({
      label: safeLabel(ctx, 'version_full_label', 'شناسه کامل', 'Build ID'),
      value: inlineCode(info.fullVersion),
    });
  }
  if (info.builtAt) {
    const parsedDate = new Date(info.builtAt);
    const formattedDate = Number.isNaN(parsedDate.getTime())
      ? inlineCode(info.builtAt)
      : localizedDate(parsedDate, ctx);
    buildFields.push({
      label: safeLabel(ctx, 'version_built_at_label', 'زمان ساخت', 'Built At'),
      value: formattedDate,
    });
  }

  return buildAdminScreen({
    emoji: icon,
    title,
    breadcrumb: buildBreadcrumb(t(ctx, 'admin_home_title'), title),
    primary: {
      label: safeLabel(ctx, 'version_version_label', 'نسخه', 'Version'),
      value: inlineCode(info.displayVersion),
      inline: true,
    },
    sections: [
      {
        emoji: '📦',
        title: safeLabel(ctx, 'version_section_build', 'مشخصات نسخه', 'Release Metadata'),
        fields: buildFields,
      },
      {
        emoji: '⚙️',
        title: safeLabel(ctx, 'version_section_runtime', 'محیط اجرا', 'Runtime'),
        fields: [
          {
            label: safeLabel(ctx, 'version_runtime_label', 'موتور اجرا', 'Runtime'),
            value: inlineCode(`Node ${process.version}`),
          },
        ],
      },
    ],
  });
}
