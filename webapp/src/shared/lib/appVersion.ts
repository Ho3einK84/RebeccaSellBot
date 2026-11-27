import type { AppVersionInfo } from '@/shared/types/api.js';

const FALLBACK_VERSION: AppVersionInfo = {
  name: 'RebeccaSellBot',
  version: '0.0.0',
  displayVersion: 'v0.0.0',
  fullVersion: 'v0.0.0',
  channel: 'stable',
  branch: 'main',
  commit: null,
  tag: null,
  commitsAhead: null,
  dirty: false,
  builtAt: null,
  repositoryUrl: 'https://github.com/Ho3einK84/RebeccaSellBot',
};

/** Return build-time version metadata injected by Vite (safe in Vitest / non-Vite environments). */
export function getBuildAppVersion(): AppVersionInfo {
  if (typeof __APP_VERSION_INFO__ !== 'undefined' && __APP_VERSION_INFO__) {
    return __APP_VERSION_INFO__;
  }
  return FALLBACK_VERSION;
}

/**
 * Merge runtime backend version with compile-time defaults, always preferring
 * the live server response as the authoritative source of truth.
 */
export function resolveClientAppVersion(serverVersion?: AppVersionInfo | null): AppVersionInfo {
  const buildInfo = getBuildAppVersion();
  if (!serverVersion) {
    return buildInfo;
  }
  return {
    ...buildInfo,
    ...serverVersion,
    name: serverVersion.name || buildInfo.name,
    version: serverVersion.version || buildInfo.version,
    displayVersion: serverVersion.displayVersion || buildInfo.displayVersion,
    channel: serverVersion.channel || buildInfo.channel,
  };
}

/** Build a GitHub release or commit URL when repository metadata is available. */
export function buildReleaseLink(info: AppVersionInfo): string | null {
  const base = info.repositoryUrl?.replace(/\/+$/u, '');
  if (!base || !base.startsWith('https://')) return null;
  if (info.channel === 'stable' && info.tag) {
    return `${base}/releases/tag/${encodeURIComponent(info.tag)}`;
  }
  if (info.commit) {
    return `${base}/commit/${encodeURIComponent(info.commit)}`;
  }
  if (info.channel === 'stable' && info.displayVersion) {
    return `${base}/releases/tag/${encodeURIComponent(info.displayVersion)}`;
  }
  return base;
}
