import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { process } = globalThis;
const DEFAULT_REPOSITORY_URL = 'https://github.com/Ho3einK84/RebeccaSellBot';
const PRODUCT_NAME = 'RebeccaSellBot';

/**
 * Normalize a Git branch name, stripping ref prefixes and treating detached HEAD as null.
 */
function normalizeBranch(raw) {
  if (typeof raw !== 'string') return null;
  let value = raw.trim();
  if (!value || value === 'HEAD') return null;
  value = value.replace(/^refs\/heads\//u, '').replace(/^origin\//u, '');
  return value || null;
}

/**
 * Normalize a Git commit SHA into a 7-character lowercase short hash.
 */
function normalizeCommit(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/u.test(value)) return null;
  return value.slice(0, 7);
}

/**
 * Normalize a Git tag name (e.g. `refs/tags/v0.3.0` -> `v0.3.0`).
 */
function normalizeTag(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().replace(/^refs\/tags\//u, '');
  return value || null;
}

/**
 * Normalize a non-negative integer commits-ahead counter.
 */
function normalizeCommitsAhead(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw).trim(), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed;
}

/**
 * Normalize explicit release channel override.
 */
function normalizeChannelOverride(raw) {
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
 * Pure SemVer 2.0.0 + release-channel resolver shared by build scripts and Vite.
 */
export function resolveVersionMetadata(input = {}) {
  const rawVersion =
    typeof input.version === 'string' && input.version.trim()
      ? input.version.trim().replace(/^v/i, '')
      : '0.0.0';
  const semverMatch = /^(\d+\.\d+\.\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/u.exec(
    rawVersion
  );
  const baseVersion = semverMatch ? semverMatch[1] : rawVersion.split('+')[0];
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
  let channel;
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

  let displayVersion;
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

  const buildMetaParts = [];
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

function runGit(repoRoot, args) {
  try {
    return execFileSync('git', ['-C', repoRoot, '-c', `safe.directory=${repoRoot}`, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Collect version metadata at build time from package.json, build env vars, and local Git.
 */
export function collectBuildVersionInfo(options = {}) {
  const repoRoot =
    options.repoRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const env = options.env ?? process.env;

  let packageVersion = '0.0.0';
  let repositoryUrl = DEFAULT_REPOSITORY_URL;
  try {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    if (typeof pkg.version === 'string' && pkg.version.trim()) {
      packageVersion = pkg.version.trim();
    }
    if (typeof pkg.repository?.url === 'string' && pkg.repository.url.trim()) {
      repositoryUrl = pkg.repository.url.trim();
    }
  } catch {
    // Keep fallback defaults if package.json is unavailable
  }

  const envBranch =
    env.APP_GIT_BRANCH || (env.GITHUB_REF_TYPE === 'branch' ? env.GITHUB_REF_NAME : '') || '';
  const envCommit = env.APP_GIT_SHA || env.GITHUB_SHA || '';
  const envTag =
    env.APP_GIT_TAG || (env.GITHUB_REF_TYPE === 'tag' ? env.GITHUB_REF_NAME : '') || '';
  const envCommitsAhead = env.APP_GIT_COMMITS_AHEAD ?? '';
  const envDirty = env.APP_GIT_DIRTY ?? '';

  const branch = envBranch || runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const commit = envCommit || runGit(repoRoot, ['rev-parse', '--short=7', 'HEAD']);
  const tag = envTag || runGit(repoRoot, ['describe', '--tags', '--exact-match', 'HEAD']);

  let commitsAhead = envCommitsAhead;
  if (commitsAhead === '' && commit) {
    const nearestTag = runGit(repoRoot, ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*']);
    if (nearestTag) {
      commitsAhead = runGit(repoRoot, ['rev-list', '--count', `${nearestTag}..HEAD`]);
    }
  }

  let dirty = envDirty;
  if (dirty === '') {
    const status = runGit(repoRoot, ['status', '--porcelain', '--untracked-files=no']);
    dirty = status.length > 0 ? 'true' : 'false';
  }

  const builtAt = env.APP_BUILD_TIME?.trim() || new Date().toISOString();

  return resolveVersionMetadata({
    version: env.APP_VERSION || packageVersion,
    channel: env.APP_RELEASE_CHANNEL,
    branch,
    commit,
    tag,
    commitsAhead,
    dirty,
    builtAt,
    repositoryUrl,
  });
}
