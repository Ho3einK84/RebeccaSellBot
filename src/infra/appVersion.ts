import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type ReleaseChannel = 'stable' | 'dev' | 'prerelease';

export interface AppVersionInfo {
  name: string;
  version: string;
  displayVersion: string;
  fullVersion: string;
  channel: ReleaseChannel;
  branch: string | null;
  commit: string | null;
  tag: string | null;
  commitsAhead: number | null;
  dirty: boolean;
  builtAt: string | null;
  repositoryUrl: string;
}

/** Sanitized version summary safe for public/end-user surfaces. */
export interface PublicAppVersionInfo {
  name: string;
  version: string;
  displayVersion: string;
  channel: ReleaseChannel;
  branch: string | null;
}

export interface ResolveAppVersionInput {
  version?: string | null;
  channel?: string | null;
  branch?: string | null;
  commit?: string | null;
  tag?: string | null;
  commitsAhead?: number | string | null;
  dirty?: boolean | string | null;
  builtAt?: string | null;
  repositoryUrl?: string | null;
}

const PRODUCT_NAME = 'RebeccaSellBot';
const DEFAULT_REPOSITORY_URL = 'https://github.com/Ho3einK84/RebeccaSellBot';

function normalizeBranch(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw
    .trim()
    .replace(/^refs\/heads\//u, '')
    .replace(/^origin\//u, '');
  if (!value || value === 'HEAD') return null;
  return value;
}

function normalizeCommit(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/u.test(value)) return null;
  return value.slice(0, 7);
}

function normalizeTag(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().replace(/^refs\/tags\//u, '');
  return value || null;
}

function normalizeCommitsAhead(raw: number | string | null | undefined): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw).trim(), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function normalizeChannelOverride(raw: string | null | undefined): ReleaseChannel | null {
  if (typeof raw !== 'string') return null;
  const lower = raw.trim().toLowerCase();
  if (lower === 'stable' || lower === 'main') return 'stable';
  if (lower === 'dev' || lower === 'development') return 'dev';
  if (lower === 'prerelease' || lower === 'rc' || lower === 'beta' || lower === 'alpha') {
    return 'prerelease';
  }
  return null;
}

/**
 * Pure SemVer 2.0.0 + release-channel resolver.
 *
 * Conventions:
 * - Official `main` release (`0.3.0` on `main` or bare release build):
 *   `channel: 'stable'`, `displayVersion: 'v0.3.0'`, `fullVersion: 'v0.3.0+6d9c285'`
 * - Development branch (`0.3.0` on `dev` / feature branch, N commits ahead):
 *   `channel: 'dev'`, `displayVersion: 'v0.3.0-dev'` or `'v0.3.0-dev.N'`, `fullVersion: 'v0.3.0-dev.N+a1b2c3d'`
 * - Explicit prerelease in package.json (`0.4.0-dev.1`, `0.4.0-rc.1`):
 *   Preserves exact SemVer prerelease identifier and classifies `-dev` vs other prereleases.
 */
export function resolveAppVersionInfo(input: ResolveAppVersionInput = {}): AppVersionInfo {
  const rawVersion =
    typeof input.version === 'string' && input.version.trim()
      ? input.version.trim().replace(/^v/i, '')
      : '0.0.0';
  const semverMatch = /^(\d+\.\d+\.\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/u.exec(
    rawVersion
  );
  const baseVersion = semverMatch ? semverMatch[1]! : rawVersion.split('+')[0]!;
  const prerelease = semverMatch?.[2] ?? null;

  const branch = normalizeBranch(input.branch);
  const commit = normalizeCommit(input.commit);
  const tag = normalizeTag(input.tag);
  const commitsAhead = normalizeCommitsAhead(input.commitsAhead);
  const dirty = input.dirty === true || input.dirty === 'true' || input.dirty === '1';
  const builtAt =
    typeof input.builtAt === 'string' && input.builtAt.trim() ? input.builtAt.trim() : null;
  const repositoryUrl =
    typeof input.repositoryUrl === 'string' && input.repositoryUrl.trim()
      ? input.repositoryUrl
          .trim()
          .replace(/\.git$/u, '')
          .replace(/#readme$/u, '')
      : DEFAULT_REPOSITORY_URL;

  const overrideChannel = normalizeChannelOverride(input.channel);
  let channel: ReleaseChannel;
  if (overrideChannel) {
    channel = overrideChannel;
  } else if (prerelease) {
    channel = /(^|\.)dev(\.|$)/i.test(prerelease) ? 'dev' : 'prerelease';
  } else if (branch) {
    channel = branch === 'main' || branch === 'master' ? 'stable' : 'dev';
  } else if (tag && tag.includes('-')) {
    channel = /-dev(\.|$)/i.test(tag) ? 'dev' : 'prerelease';
  } else {
    channel = 'stable';
  }

  let displayVersion: string;
  if (prerelease) {
    displayVersion = `v${baseVersion}-${prerelease}`;
  } else if (channel === 'dev') {
    const devSuffix = commitsAhead !== null && commitsAhead > 0 ? `dev.${commitsAhead}` : 'dev';
    displayVersion = `v${baseVersion}-${devSuffix}`;
  } else if (channel === 'prerelease') {
    displayVersion = `v${baseVersion}-pre`;
  } else {
    displayVersion = `v${baseVersion}`;
  }

  const buildMetaParts: string[] = [];
  if (commit) buildMetaParts.push(commit);
  if (dirty) buildMetaParts.push('dirty');
  const fullVersion =
    buildMetaParts.length > 0 ? `${displayVersion}+${buildMetaParts.join('.')}` : displayVersion;

  return {
    name: PRODUCT_NAME,
    version: rawVersion,
    displayVersion,
    fullVersion,
    channel,
    branch,
    commit,
    tag,
    commitsAhead,
    dirty,
    builtAt,
    repositoryUrl,
  };
}

/** Project an AppVersionInfo down to clean public/end-user fields. */
export function toPublicAppVersion(info: AppVersionInfo): PublicAppVersionInfo {
  return {
    name: info.name,
    version: info.version,
    displayVersion: info.displayVersion,
    channel: info.channel,
    branch: info.channel === 'stable' ? (info.branch ?? 'main') : info.branch,
  };
}

function runGitSafe(repoRoot: string, args: string[]): string {
  try {
    return execFileSync('git', ['-C', repoRoot, '-c', `safe.directory=${repoRoot}`, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1_500,
    }).trim();
  } catch {
    return '';
  }
}

function readBakedBuildInfo(): AppVersionInfo | null {
  try {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    // Only exists alongside compiled `dist/infra/appVersion.js` -> `dist/build-info.json`.
    // In `src/` (tsx dev / vitest), this file does not exist so live metadata is computed instead.
    const buildInfoPath = path.resolve(moduleDir, '..', 'build-info.json');
    if (!fs.existsSync(buildInfoPath)) return null;
    const raw = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8')) as ResolveAppVersionInput;
    if (!raw || typeof raw !== 'object' || typeof raw.version !== 'string') return null;
    return resolveAppVersionInfo(raw);
  } catch {
    return null;
  }
}

function readPackageJsonMetadata(repoRoot: string): {
  version: string;
  repositoryUrl: string;
} {
  try {
    const pkgPath = path.join(repoRoot, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      version?: unknown;
      repository?: { url?: unknown };
    };
    return {
      version: typeof pkg.version === 'string' && pkg.version.trim() ? pkg.version.trim() : '0.0.0',
      repositoryUrl:
        typeof pkg.repository?.url === 'string' && pkg.repository.url.trim()
          ? pkg.repository.url.trim()
          : DEFAULT_REPOSITORY_URL,
    };
  } catch {
    return { version: '0.0.0', repositoryUrl: DEFAULT_REPOSITORY_URL };
  }
}

function computeRuntimeAppVersionInfo(): AppVersionInfo {
  const baked = readBakedBuildInfo();
  if (baked) return baked;

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidateRoot = path.resolve(moduleDir, '..', '..');
  const repoRoot = fs.existsSync(path.join(candidateRoot, 'package.json'))
    ? candidateRoot
    : process.cwd();
  const { version: packageVersion, repositoryUrl } = readPackageJsonMetadata(repoRoot);

  const env = process.env;
  const envBranch =
    env.APP_GIT_BRANCH || (env.GITHUB_REF_TYPE === 'branch' ? env.GITHUB_REF_NAME : '') || '';
  const envCommit = env.APP_GIT_SHA || env.GITHUB_SHA || '';
  const envTag =
    env.APP_GIT_TAG || (env.GITHUB_REF_TYPE === 'tag' ? env.GITHUB_REF_NAME : '') || '';
  const envCommitsAhead = env.APP_GIT_COMMITS_AHEAD ?? '';
  const envDirty = env.APP_GIT_DIRTY ?? '';

  const branch = envBranch || runGitSafe(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const commit = envCommit || runGitSafe(repoRoot, ['rev-parse', '--short=7', 'HEAD']);
  const tag = envTag || runGitSafe(repoRoot, ['describe', '--tags', '--exact-match', 'HEAD']);

  let commitsAhead = envCommitsAhead;
  if (commitsAhead === '' && commit) {
    const nearestTag = runGitSafe(repoRoot, [
      'describe',
      '--tags',
      '--abbrev=0',
      '--match',
      'v[0-9]*',
    ]);
    if (nearestTag) {
      commitsAhead = runGitSafe(repoRoot, ['rev-list', '--count', `${nearestTag}..HEAD`]);
    }
  }

  let dirty = envDirty;
  if (dirty === '') {
    const status = runGitSafe(repoRoot, ['status', '--porcelain', '--untracked-files=no']);
    dirty = status.length > 0 ? 'true' : 'false';
  }

  return resolveAppVersionInfo({
    version: env.APP_VERSION || packageVersion,
    channel: env.APP_RELEASE_CHANNEL,
    branch,
    commit,
    tag,
    commitsAhead,
    dirty,
    builtAt: env.APP_BUILD_TIME || null,
    repositoryUrl,
  });
}

let cachedVersionInfo: AppVersionInfo | null = null;

/** Return cached RebeccaSellBot version & release-channel metadata. */
export function getAppVersionInfo(): AppVersionInfo {
  if (!cachedVersionInfo) {
    cachedVersionInfo = computeRuntimeAppVersionInfo();
  }
  return cachedVersionInfo;
}

/** Override or clear cached version info in unit tests. */
export function setAppVersionInfoForTests(override: AppVersionInfo | null): void {
  cachedVersionInfo = override;
}

/** Reset cached version info in unit tests. */
export function resetAppVersionCacheForTests(): void {
  cachedVersionInfo = null;
}
