import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { console, process } = globalThis;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binDir = path.join(repoRoot, 'node_modules', '.bin');
const cacheRoot = path.join(repoRoot, 'node_modules', '.cache');
const binExt = process.platform === 'win32' ? '.cmd' : '';

const args = new Set(process.argv.slice(2));
const onlyArg = process.argv.slice(2).find((arg) => arg.startsWith('--only='));
const onlyMode = onlyArg ? onlyArg.slice('--only='.length) : null;
const changedOnly = args.has('--changed');
const noCache = args.has('--no-cache');

function bin(name) {
  return path.join(binDir, `${name}${binExt}`);
}

function formatDuration(ms) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

function runCommand(label, command, cmdArgs, options = {}) {
  const { inherit = false } = options;
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const child = spawn(command, cmdArgs, {
      cwd: repoRoot,
      env: process.env,
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    if (!inherit) {
      child.stdout?.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
      });
    }

    child.on('error', (error) => {
      resolve({
        label,
        code: 1,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
      });
    });

    child.on('close', (code) => {
      resolve({
        label,
        code: code ?? 1,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      });
    });
  });
}

async function prepareCaches() {
  if (noCache) {
    await Promise.all([
      rm(path.join(cacheRoot, 'tsc'), { recursive: true, force: true }),
      rm(path.join(cacheRoot, 'eslint'), { recursive: true, force: true }),
      rm(path.join(cacheRoot, 'prettier'), { recursive: true, force: true }),
    ]);
    return;
  }

  await Promise.all([
    mkdir(path.join(cacheRoot, 'tsc'), { recursive: true }),
    mkdir(path.join(cacheRoot, 'eslint'), { recursive: true }),
    mkdir(path.join(cacheRoot, 'prettier'), { recursive: true }),
  ]);
}

function buildStaticTasks() {
  const tscRootArgs = noCache
    ? ['--noEmit']
    : [
        '--noEmit',
        '--incremental',
        '--tsBuildInfoFile',
        path.join(cacheRoot, 'tsc', 'root.tsbuildinfo'),
      ];

  const tscWebappArgs = noCache
    ? ['-p', 'webapp/tsconfig.json', '--noEmit']
    : [
        '-p',
        'webapp/tsconfig.json',
        '--noEmit',
        '--incremental',
        '--tsBuildInfoFile',
        path.join(cacheRoot, 'tsc', 'webapp.tsbuildinfo'),
      ];

  const eslintArgs = noCache
    ? ['.']
    : ['--cache', '--cache-location', path.join(cacheRoot, 'eslint', '.eslintcache'), '.'];

  const prettierArgs = noCache
    ? ['--check', '.']
    : [
        '--check',
        '--cache',
        '--cache-location',
        path.join(cacheRoot, 'prettier', '.prettiercache'),
        '.',
      ];

  return {
    architecture: {
      label: 'architecture:check',
      command: process.execPath,
      args: [path.join(repoRoot, 'scripts', 'check-architecture.mjs')],
    },
    typecheckRoot: {
      label: 'typecheck:root',
      command: bin('tsc'),
      args: tscRootArgs,
    },
    typecheckWebapp: {
      label: 'typecheck:webapp',
      command: bin('tsc'),
      args: tscWebappArgs,
    },
    lint: {
      label: 'lint',
      command: bin('eslint'),
      args: eslintArgs,
    },
    format: {
      label: 'format:check',
      command: bin('prettier'),
      args: prettierArgs,
    },
  };
}

async function runParallelGroup(groupName, tasks) {
  const startedAt = Date.now();
  const results = await Promise.all(
    tasks.map(async (task) => {
      const result = await runCommand(task.label, task.command, task.args);
      const marker = result.code === 0 ? 'PASS' : 'FAIL';
      console.log(`[${marker}] ${result.label} (${formatDuration(result.durationMs)})`);
      return result;
    })
  );

  const failed = results.filter((result) => result.code !== 0);
  if (failed.length > 0) {
    for (const failure of failed) {
      console.error(`\n--- ${failure.label} failed (exit ${failure.code}) ---`);
      if (failure.stdout.trim()) console.error(failure.stdout.trimEnd());
      if (failure.stderr.trim()) console.error(failure.stderr.trimEnd());
    }
    console.error(`\n${groupName} failed in ${formatDuration(Date.now() - startedAt)}.`);
    return false;
  }

  console.log(`${groupName} passed in ${formatDuration(Date.now() - startedAt)}.`);
  return true;
}

const totalStart = Date.now();
await prepareCaches();
const staticTasks = buildStaticTasks();

if (onlyMode === 'typecheck') {
  const ok = await runParallelGroup('Typecheck', [
    staticTasks.typecheckRoot,
    staticTasks.typecheckWebapp,
  ]);
  process.exit(ok ? 0 : 1);
}

// Phase 1: independent static checks in parallel across CPU cores
const staticOk = await runParallelGroup('Static checks', [
  staticTasks.architecture,
  staticTasks.typecheckRoot,
  staticTasks.typecheckWebapp,
  staticTasks.lint,
  staticTasks.format,
]);
if (!staticOk) {
  process.exit(1);
}

// Phase 2: tests with full CPU/memory headroom (and no dist/webapp race with build)
const vitestArgs = changedOnly ? ['run', '--changed'] : ['run'];
console.log(`\nRunning tests (vitest ${vitestArgs.join(' ')})...`);
const testResult = await runCommand('test', bin('vitest'), vitestArgs, { inherit: true });
if (testResult.code !== 0) {
  console.error(`\nTests failed in ${formatDuration(testResult.durationMs)}.`);
  process.exit(testResult.code);
}
console.log(`[PASS] test (${formatDuration(testResult.durationMs)})`);

// Phase 3: sequential build (webapp cleans dist/webapp before server esbuild writes dist/webapp/server)
if (!changedOnly) {
  const buildWeb = await runCommand(
    'build:webapp',
    bin('vite'),
    ['build', '--config', 'webapp/vite.config.ts'],
    { inherit: false }
  );
  if (buildWeb.code !== 0) {
    console.error(`\n--- build:webapp failed (exit ${buildWeb.code}) ---`);
    if (buildWeb.stdout.trim()) console.error(buildWeb.stdout.trimEnd());
    if (buildWeb.stderr.trim()) console.error(buildWeb.stderr.trimEnd());
    process.exit(buildWeb.code);
  }
  console.log(`[PASS] build:webapp (${formatDuration(buildWeb.durationMs)})`);

  const buildSrv = await runCommand(
    'build:server',
    process.execPath,
    [path.join(repoRoot, 'scripts', 'build.mjs')],
    { inherit: false }
  );
  if (buildSrv.code !== 0) {
    console.error(`\n--- build:server failed (exit ${buildSrv.code}) ---`);
    if (buildSrv.stdout.trim()) console.error(buildSrv.stdout.trimEnd());
    if (buildSrv.stderr.trim()) console.error(buildSrv.stderr.trimEnd());
    process.exit(buildSrv.code);
  }
  console.log(`[PASS] build:server (${formatDuration(buildSrv.durationMs)})`);
}

console.log(`\nVerify completed in ${formatDuration(Date.now() - totalStart)}.`);
