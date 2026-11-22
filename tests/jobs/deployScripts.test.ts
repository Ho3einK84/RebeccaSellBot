import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const REPO_ROOT = process.cwd();
const RSBOT_PATH = path.join(REPO_ROOT, 'scripts/rsbot');
const INSTALL_SH_PATH = path.join(REPO_ROOT, 'install.sh');
const CHECK_ARCH_PATH = path.join(REPO_ROOT, 'scripts/check-architecture.mjs');

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Extract pure helper functions from install.sh and execute a bash test body under `set -Eeuo pipefail`. */
async function runInstallFunctions(body: string, extraEnv: Record<string, string> = {}) {
  const raw = await fs.readFile(INSTALL_SH_PATH, 'utf8');
  const lines = raw.split('\n');
  const sliceBetween = (startPattern: RegExp, endPattern: RegExp) => {
    const startIdx = lines.findIndex((l) => startPattern.test(l));
    const endIdx = lines.findIndex((l, idx) => idx > startIdx && endPattern.test(l));
    if (startIdx === -1 || endIdx === -1) {
      throw new Error(`Could not locate section for ${startPattern}`);
    }
    return lines.slice(startIdx, endIdx).join('\n');
  };

  const fns = [
    "RED='' GREEN='' YELLOW='' CYAN='' PURPLE='' BOLD='' DIM='' RESET=''",
    'die() { printf "Error: %s\\n" "$*" >&2; exit 1; }',
    'warn() { printf "Warn: %s\\n" "$*" >&2; }',
    'validate_instance() { [[ "$1" =~ ^[a-z0-9][a-z0-9_-]{0,31}$ ]]; }',
    'prompt_default() { printf "%s" "$2"; }',
    sliceBetween(/^is_port_in_use\(\)/, /^cleanup_workspaces\(\)/),
    sliceBetween(/^load_config_file\(\)/, /^if \[\[ -n "\$BACKUP_INPUT"/),
    sliceBetween(/^resolve_instance_name\(\)/, /^configure_environment\(\)/),
  ].join('\n\n');

  const script = `#!/usr/bin/env bash\nset -Eeuo pipefail\n${fns}\n${body}`;
  return execFileAsync('bash', ['-c', script], {
    env: { ...process.env, ...extraEnv },
  });
}

/** Build a sandboxed PATH containing a deterministic `docker` CLI stub for full rsbot CLI runs. */
async function createDockerStubBin(
  options: {
    runningServices?: string[];
    composeValid?: boolean;
    dbStatus?: string;
    botStatus?: string;
    pgReady?: boolean;
    healthCode?: string;
    expectedHealthUrlFile?: string;
  } = {}
): Promise<string> {
  const binDir = await makeTempDir('rsbot-bin-');
  const {
    runningServices = ['bot', 'db'],
    composeValid = true,
    dbStatus = 'Up 5 minutes (healthy)',
    botStatus = 'Up 5 minutes (healthy)',
    pgReady = true,
    healthCode = '200',
    expectedHealthUrlFile = '',
  } = options;

  const dockerScript = `#!/usr/bin/env bash
set -euo pipefail
cmd="\${1:-}"
if [[ "$cmd" == "info" ]]; then
  exit 0
fi
if [[ "$cmd" == "network" || "$cmd" == "volume" ]]; then
  exit 0
fi
if [[ "$cmd" == "compose" ]]; then
  # Skip compose global options (--env-file X -p Y -f Z)
  shift
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --env-file|-p|-f) shift 2 ;;
      *) break ;;
    esac
  done
  sub="\${1:-}"
  shift || true
  case "$sub" in
    config)
      [[ "${composeValid ? '1' : '0'}" == "1" ]]
      exit $?
      ;;
    ps)
      if [[ "$*" == *"--status running --quiet"* ]]; then
        for s in ${runningServices.map((s) => `"${s}"`).join(' ')}; do
          printf '%s\\n' "$s"
        done
        exit 0
      fi
      if [[ "$*" == *" db" ]]; then
        printf '%s\\n' "${dbStatus}"
        exit 0
      fi
      if [[ "$*" == *" bot" ]]; then
        printf '%s\\n' "${botStatus}"
        exit 0
      fi
      ;;
    exec)
      shift || true # -T
      svc="\${1:-}"
      shift || true
      if [[ "$svc" == "db" && "\${1:-}" == "pg_isready" ]]; then
        [[ "${pgReady ? '1' : '0'}" == "1" ]]
        exit $?
      fi
      if [[ "$svc" == "db" && "\${1:-}" == "psql" ]]; then
        printf '23\\n'
        exit 0
      fi
      if [[ "$svc" == "bot" && "\${1:-}" == "node" ]]; then
        if [[ -n "${expectedHealthUrlFile}" ]]; then
          printf '%s' "$*" > "${expectedHealthUrlFile}"
        fi
        printf '%s\\n' "${healthCode}"
        exit 0
      fi
      ;;
  esac
fi
exit 0
`;
  const dockerPath = path.join(binDir, 'docker');
  await fs.writeFile(dockerPath, dockerScript, { mode: 0o755 });
  return binDir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => {}))
  );
});

describe('scripts/rsbot — full CLI execution under set -Eeuo pipefail', () => {
  it('prints help even when Docker is unavailable', async () => {
    const emptyBin = await makeTempDir('empty-bin-');
    const { stdout } = await execFileAsync('/usr/bin/env', ['bash', RSBOT_PATH, '--help'], {
      env: { PATH: `${emptyBin}:/bin:/usr/bin` },
    });
    expect(stdout).toContain('rsbot — RebeccaSellBot multi-instance manager');
  });

  it('runs `rsbot list` end-to-end with RSBOT_BASE_PATH without failing on env_value_from_file ordering', async () => {
    const baseDir = await makeTempDir('rsbot-base-');
    const instA = path.join(baseDir, 'alpha');
    const instB = path.join(baseDir, 'beta');
    await fs.mkdir(instA, { recursive: true });
    await fs.mkdir(instB, { recursive: true });

    await fs.writeFile(
      path.join(instA, '.env'),
      'WEBAPP_HOST_PORT=4002\nWEBHOOK_HOST_PORT=4000\nBOT_DELIVERY_MODE=webhook\nWEBAPP_URL="https://alpha.example.com"\r\n'
    );
    await fs.writeFile(path.join(instA, 'docker-compose.yml'), 'services: {}\n');

    await fs.writeFile(path.join(instB, '.env'), 'BOT_DELIVERY_MODE=polling\n');
    await fs.writeFile(path.join(instB, 'docker-compose.yml'), 'services: {}\n');

    const binDir = await createDockerStubBin({ runningServices: ['bot', 'db'] });
    const { stdout } = await execFileAsync('bash', [RSBOT_PATH, 'list'], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
        RSBOT_BASE_PATH: baseDir,
      },
    });

    expect(stdout).toContain(
      'alpha (running) — webapp:4002 webhook:4000 [webhook] (https://alpha.example.com)'
    );
    expect(stdout).toContain('beta (running) — webapp:3002 webhook:3000 [polling]');

    // Verify default instance shorthand (`rsbot env` auto-selects sole/main instance) and `rsbot all env`
    const allEnv = await execFileAsync('bash', [RSBOT_PATH, 'all', 'env'], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
        RSBOT_BASE_PATH: baseDir,
      },
    });
    expect(allEnv.stdout).toContain("Configuration Summary for 'alpha'");
    expect(allEnv.stdout).toContain("Configuration Summary for 'beta'");
  });

  it('auto-resolves default instance (`main` or sole installed instance) when <instance> is omitted', async () => {
    const baseDir = await makeTempDir('rsbot-shorthand-');
    const instMain = path.join(baseDir, 'main');
    await fs.mkdir(instMain, { recursive: true });
    await fs.writeFile(
      path.join(instMain, '.env'),
      'BOT_TOKEN=123456789:ABCDEF_secret_token_1234567890\nDB_USER=rsbot_main\nDB_NAME=rsbot_main\nWEBAPP_HOST_PORT=3002\n',
      { mode: 0o600 }
    );
    await fs.writeFile(path.join(instMain, 'docker-compose.yml'), 'services: {}\n');

    const binDir = await createDockerStubBin();
    const { stdout } = await execFileAsync('bash', [RSBOT_PATH, 'env'], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
        RSBOT_BASE_PATH: baseDir,
      },
    });
    expect(stdout).toContain("Configuration Summary for 'main'");
    expect(stdout).toContain('1234...7890');
  });

  it('runs `rsbot <instance> verify` end-to-end for healthy instance (custom HEALTH_CHECK_PORT) and cleanly reports non-zero errors without early set -e crash', async () => {
    const baseDir = await makeTempDir('rsbot-verify-');
    const instOk = path.join(baseDir, 'prod');
    await fs.mkdir(instOk, { recursive: true });
    const envOk = path.join(instOk, '.env');
    await fs.writeFile(
      envOk,
      'DB_USER=rsbot\nDB_NAME=rsbot\nHEALTH_CHECK_PORT=4001\nWEBAPP_HOST_PORT=3102\nWEBHOOK_HOST_PORT=3100\n',
      { mode: 0o600 }
    );
    await fs.writeFile(path.join(instOk, 'docker-compose.yml'), 'services: {}\n');

    const probedCmdFile = path.join(baseDir, 'probed-node-args.txt');
    const okBin = await createDockerStubBin({ expectedHealthUrlFile: probedCmdFile });
    const okRes = await execFileAsync('bash', [RSBOT_PATH, 'prod', 'verify'], {
      env: {
        ...process.env,
        PATH: `${okBin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
        RSBOT_BASE_PATH: baseDir,
      },
    });
    expect(okRes.stdout).toContain('Verification Result: 0 error(s), 0 warning(s).');
    expect(await fs.readFile(probedCmdFile, 'utf8')).toContain('http://127.0.0.1:4001/readyz');

    // Regression: colliding peer instance + 0644 .env + stopped bot increments from 0 cleanly
    await fs.chmod(envOk, 0o644);
    const peerDir = path.join(baseDir, 'peer');
    await fs.mkdir(peerDir, { recursive: true });
    await fs.writeFile(
      path.join(peerDir, '.env'),
      'WEBAPP_HOST_PORT=3102\nWEBHOOK_HOST_PORT=3100\n'
    );
    await fs.writeFile(path.join(peerDir, 'docker-compose.yml'), 'services: {}\n');

    const badBin = await createDockerStubBin({ botStatus: 'Exited (1)', healthCode: 'err' });
    let exitCode = 0;
    let combinedOut = '';
    let combinedErr = '';
    try {
      await execFileAsync('bash', [RSBOT_PATH, 'prod', 'verify'], {
        env: {
          ...process.env,
          PATH: `${badBin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
          RSBOT_BASE_PATH: baseDir,
        },
      });
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      exitCode = e.code ?? 0;
      combinedOut = e.stdout ?? '';
      combinedErr = e.stderr ?? '';
    }

    expect(exitCode).toBe(1);
    expect(combinedErr).toContain('Port collision');
    expect(combinedOut).toContain('Verification Result: 3 error(s), 2 warning(s).');
  });
});

describe('install.sh — backup validation, config loading, and port discovery under set -Eeuo pipefail', () => {
  it('validates complete backup bundles and rejects symlinks and path traversal', async () => {
    const tmp = await makeTempDir('bundle-check-');
    const validBundle = path.join(tmp, 'valid.tar.gz');
    const srcValid = path.join(tmp, 'src-valid');
    await fs.mkdir(srcValid);
    await fs.writeFile(path.join(srcValid, 'manifest.txt'), 'format_version=1\ninstance=main\n');
    await fs.writeFile(path.join(srcValid, 'database.dump'), 'PGDMP');
    await execFileAsync('tar', [
      '-czf',
      validBundle,
      '-C',
      srcValid,
      'manifest.txt',
      'database.dump',
    ]);

    const symBundle = path.join(tmp, 'sym.tar.gz');
    const srcSym = path.join(tmp, 'src-sym');
    await fs.mkdir(srcSym);
    await fs.writeFile(path.join(srcSym, 'manifest.txt'), 'format_version=1\n');
    await fs.symlink('/etc/passwd', path.join(srcSym, 'database.dump'));
    await execFileAsync('tar', ['-czf', symBundle, '-C', srcSym, 'manifest.txt', 'database.dump']);

    const { stdout } = await runInstallFunctions(`
      is_complete_backup_bundle "${validBundle}" && printf 'valid:yes\\n' || printf 'valid:no\\n'
      is_complete_backup_bundle "${symBundle}" && printf 'sym:yes\\n' || printf 'sym:no\\n'
    `);
    expect(stdout).toContain('valid:yes');
    expect(stdout).toContain('sym:no');
  });

  it('loads and sanitizes install config files, preserves backup identity, and resolves free ports', async () => {
    const tmp = await makeTempDir('install-cfg-');
    const cfgFile = path.join(tmp, 'install.env');
    await fs.writeFile(
      cfgFile,
      [
        '# comment',
        'NODE_ENV=production',
        'INSTANCE_NAME=custom_inst',
        '  BOT_TOKEN = "12345678:abcDEF_12345678901234567890"  ',
        "ADMIN_IDS='1001, 2002'",
        'DATABASE_URL=postgres://pg_custom:secret_pass_1234@localhost:5432/db_custom',
        'PANEL_CREDENTIALS_KEY=replace_with_a_random_64_character_hex_value',
        'HEALTH_CHECK_PORT=3001',
        'WEBAPP_PORT=3002',
        'WEBAPP_HOST_PORT=13002\r',
      ].join('\n')
    );

    // Bind an ephemeral port to verify find_next_safe_port skips live listeners
    const blocker = net.createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', () => resolve()));
    const occupiedPort = (blocker.address() as net.AddressInfo).port;

    try {
      const { stdout } = await runInstallFunctions(`
        NON_INTERACTIVE=true
        INSTANCE_INPUT=""
        MANIFEST_INSTANCE="legacy_prod"
        load_config_file "${cfgFile}"
        printf 'BOT=%s|ADMINS=%s|WHOST=%s|INST=%s|DBU=%s|DBN=%s|PCK=%s|FREE=%s\\n' \
          "$BOT_TOKEN" "$ADMIN_IDS" "$WEBAPP_HOST_PORT" "$(resolve_instance_name)" "$DB_USER" "$DB_NAME" "\${PANEL_CREDENTIALS_KEY:-empty}" "$(find_next_safe_port ${occupiedPort} 1)"
      `);
      const match = stdout
        .trim()
        .match(
          /^BOT=(.*)\|ADMINS=(.*)\|WHOST=(.*)\|INST=(.*)\|DBU=(.*)\|DBN=(.*)\|PCK=(.*)\|FREE=(\d+)$/
        );
      expect(match).not.toBeNull();
      expect(match![1]).toBe('12345678:abcDEF_12345678901234567890');
      expect(match![2]).toBe('1001, 2002');
      expect(match![3]).toBe('13002');
      expect(match![4]).toBe('custom_inst');
      expect(match![5]).toBe('pg_custom');
      expect(match![6]).toBe('db_custom');
      expect(match![7]).toBe('empty');
      expect(Number(match![8])).toBeGreaterThan(occupiedPort);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});

describe('scripts/check-architecture.mjs — architectural dependency guardrails', () => {
  it('passes against the current repository layout', async () => {
    const { stdout } = await execFileAsync('node', [CHECK_ARCH_PATH], { cwd: REPO_ROOT });
    expect(stdout).toContain('Architecture check passed');
  });
});
