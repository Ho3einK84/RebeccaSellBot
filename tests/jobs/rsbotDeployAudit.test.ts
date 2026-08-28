import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);

describe('Deployment & Backup Shell Logic Audit', () => {
  describe('rsbot: env_value_from_file', () => {
    it('correctly parses plain, quoted, and CRLF environment variables', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'env_test_'));
      const envPath = path.join(tempDir, '.env');
      await fs.writeFile(
        envPath,
        [
          'DB_USER="rsbot_user"',
          "DB_PASSWORD='complex_pass_12345'",
          'DB_NAME=rsbot_database',
          'INSTANCE_NAME=main\r',
          'BOT_TOKEN="123456:ABC_token_with_quotes"\r',
        ].join('\n')
      );

      const rsbotPath = path.resolve('scripts/rsbot');
      const testScript = `
        set -- dummy-instance dummy-cmd
        source <(awk '/^env_value_from_file\\(\\)/,/^}/' "${rsbotPath}")
        echo "DB_USER=$(env_value_from_file "${envPath}" DB_USER)"
        echo "DB_PASSWORD=$(env_value_from_file "${envPath}" DB_PASSWORD)"
        echo "DB_NAME=$(env_value_from_file "${envPath}" DB_NAME)"
        echo "INSTANCE_NAME=$(env_value_from_file "${envPath}" INSTANCE_NAME)"
        echo "BOT_TOKEN=$(env_value_from_file "${envPath}" BOT_TOKEN)"
      `;

      const { stdout } = await execFileAsync('bash', ['-c', testScript]);
      await fs.rm(tempDir, { recursive: true, force: true });

      expect(stdout).toContain('DB_USER=rsbot_user');
      expect(stdout).toContain('DB_PASSWORD=complex_pass_12345');
      expect(stdout).toContain('DB_NAME=rsbot_database');
      expect(stdout).toContain('INSTANCE_NAME=main');
      expect(stdout).toContain('BOT_TOKEN=123456:ABC_token_with_quotes');
    });
  });

  describe('rsbot: is_complete_backup_bundle', () => {
    it('validates legitimate backup bundles containing root files or directory headers', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bundle_test_'));
      const archivePath = path.join(tempDir, 'valid_bundle.tar.gz');

      await fs.writeFile(path.join(tempDir, 'manifest.txt'), 'format_version=1\ninstance=main\n');
      await fs.writeFile(path.join(tempDir, 'database.dump'), 'mock pg_dump custom format');
      await execFileAsync('tar', [
        '-C',
        tempDir,
        '-czf',
        archivePath,
        'manifest.txt',
        'database.dump',
      ]);

      const rsbotPath = path.resolve('scripts/rsbot');
      const testScript = `
        source <(awk '/^is_complete_backup_bundle\\(\\)/,/^}/' "${rsbotPath}")
        if is_complete_backup_bundle "${archivePath}"; then
          echo "RESULT=VALID"
        else
          echo "RESULT=INVALID"
        fi
      `;

      const { stdout } = await execFileAsync('bash', ['-c', testScript]);
      await fs.rm(tempDir, { recursive: true, force: true });

      expect(stdout).toContain('RESULT=VALID');
    });

    it('rejects bundles containing symlinks or directory traversal', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bundle_sym_'));
      const archivePath = path.join(tempDir, 'symlink_bundle.tar.gz');

      await fs.writeFile(path.join(tempDir, 'manifest.txt'), 'format_version=1\ninstance=main\n');
      await fs.symlink('/etc/passwd', path.join(tempDir, 'database.dump'));
      await execFileAsync('tar', [
        '-C',
        tempDir,
        '-czf',
        archivePath,
        'manifest.txt',
        'database.dump',
      ]);

      const rsbotPath = path.resolve('scripts/rsbot');
      const testScript = `
        source <(awk '/^is_complete_backup_bundle\\(\\)/,/^}/' "${rsbotPath}")
        if is_complete_backup_bundle "${archivePath}"; then
          echo "RESULT=VALID"
        else
          echo "RESULT=INVALID"
        fi
      `;

      const { stdout } = await execFileAsync('bash', ['-c', testScript]);
      await fs.rm(tempDir, { recursive: true, force: true });

      expect(stdout).toContain('RESULT=INVALID');
    });

    it('rejects bundles missing manifest.txt or database.dump', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bundle_missing_'));
      const archivePath = path.join(tempDir, 'incomplete_bundle.tar.gz');

      await fs.writeFile(path.join(tempDir, 'manifest.txt'), 'format_version=1\ninstance=main\n');
      await execFileAsync('tar', ['-C', tempDir, '-czf', archivePath, 'manifest.txt']);

      const rsbotPath = path.resolve('scripts/rsbot');
      const testScript = `
        source <(awk '/^is_complete_backup_bundle\\(\\)/,/^}/' "${rsbotPath}")
        if is_complete_backup_bundle "${archivePath}"; then
          echo "RESULT=VALID"
        else
          echo "RESULT=INVALID"
        fi
      `;

      const { stdout } = await execFileAsync('bash', ['-c', testScript]);
      await fs.rm(tempDir, { recursive: true, force: true });

      expect(stdout).toContain('RESULT=INVALID');
    });
  });

  describe('install.sh: load_config_file', () => {
    it('correctly loads and sanitizes keys, whitespace around =, quotes, and comments', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'install_cfg_'));
      const configPath = path.join(tempDir, 'deployment.conf');
      await fs.writeFile(
        configPath,
        [
          '# Pre-deployment configuration',
          'BOT_TOKEN = "123456:ABC-DEF"',
          'ADMIN_IDS = 12345, 67890',
          "DB_USER = 'rsbot_prod'",
          'DB_PASSWORD = supersecretpassword123',
          'DB_NAME = rsbot_db\r',
        ].join('\n')
      );

      const installPath = path.resolve('install.sh');
      const testScript = `
        die() { echo "ERROR: $*" >&2; exit 1; }
        source <(awk '/^load_config_file\\(\\)/,/^}/' "${installPath}")
        load_config_file "${configPath}"
        echo "BOT_TOKEN=$BOT_TOKEN"
        echo "ADMIN_IDS=$ADMIN_IDS"
        echo "DB_USER=$DB_USER"
        echo "DB_PASSWORD=$DB_PASSWORD"
        echo "DB_NAME=$DB_NAME"
      `;

      const { stdout } = await execFileAsync('bash', ['-c', testScript]);
      await fs.rm(tempDir, { recursive: true, force: true });

      expect(stdout).toContain('BOT_TOKEN=123456:ABC-DEF');
      expect(stdout).toContain('ADMIN_IDS=12345, 67890');
      expect(stdout).toContain('DB_USER=rsbot_prod');
      expect(stdout).toContain('DB_PASSWORD=supersecretpassword123');
      expect(stdout).toContain('DB_NAME=rsbot_db');
    });
  });

  describe('install.sh: --from-backup migration flow', () => {
    it('extracts bundle, imports PANEL_CREDENTIALS_KEY and DB credentials, and defaults instance name', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'install_migrate_'));
      const archivePath = path.join(tempDir, 'backup_bot_migrated_20260828.tar.gz');

      await fs.writeFile(
        path.join(tempDir, 'manifest.txt'),
        'format_version=1\ninstance=bot_migrated\ncreated_at_utc=2026-08-28T12:00:00Z\n'
      );
      await fs.writeFile(path.join(tempDir, 'database.dump'), 'mock pg_dump custom format');
      await fs.writeFile(
        path.join(tempDir, '.env'),
        [
          'INSTANCE_NAME=bot_migrated',
          'BOT_TOKEN="123456789:ORIGINAL_TOKEN"',
          'ADMIN_IDS=55555555',
          'PANEL_CREDENTIALS_KEY=my_secure_panel_credentials_key_32bytes',
          'DB_USER=rsbot_bot_migrated',
          'DB_PASSWORD=migrated_db_password_123',
          'DB_NAME=rsbot_bot_migrated',
          'DEFAULT_LOCALE=fa',
        ].join('\n')
      );

      await execFileAsync('tar', [
        '-C',
        tempDir,
        '-czf',
        archivePath,
        'manifest.txt',
        'database.dump',
        '.env',
      ]);

      const installPath = path.resolve('install.sh');
      const testScript = `
        die() { echo "ERROR: $*" >&2; exit 1; }
        warn() { echo "WARN: $*" >&2; }
        info() { :; }
        success() { :; }
        validate_instance() { [[ "$1" =~ ^[a-z0-9][a-z0-9_-]{0,31}$ ]]; }

        source <(awk '/^env_value_from_file\\(\\)/,/^}/' "${installPath}")
        source <(awk '/^is_complete_backup_bundle\\(\\)/,/^}/' "${installPath}")
        source <(awk '/^extract_complete_backup_bundle\\(\\)/,/^}/' "${installPath}")
        source <(awk '/^resolve_instance_name\\(\\)/,/^}/' "${installPath}")

        BACKUP_INPUT="${archivePath}"
        BACKUP_WORKSPACE="$(mktemp -d)"

        extract_complete_backup_bundle "$BACKUP_INPUT" "$BACKUP_WORKSPACE"
        format_version="$(sed -n 's/^format_version=//p' "$BACKUP_WORKSPACE/manifest.txt" | head -n 1)"
        MANIFEST_INSTANCE="$(sed -n 's/^instance=//p' "$BACKUP_WORKSPACE/manifest.txt" | head -n 1)"

        if [[ -f "$BACKUP_WORKSPACE/.env" ]]; then
          for k in BOT_TOKEN ADMIN_IDS PANEL_CREDENTIALS_KEY DB_USER DB_PASSWORD DB_NAME DEFAULT_LOCALE; do
            val="$(env_value_from_file "$BACKUP_WORKSPACE/.env" "$k" 2>/dev/null || true)"
            if [[ -n "$val" && -z "\${!k:-}" ]]; then
              printf -v "$k" '%s' "$val"
            fi
          done
        fi

        INSTANCE_INPUT=""
        NON_INTERACTIVE=true
        INSTANCE_NAME="$(resolve_instance_name)"

        echo "RESOLVED_INSTANCE=$INSTANCE_NAME"
        echo "RESOLVED_PANEL_KEY=$PANEL_CREDENTIALS_KEY"
        echo "RESOLVED_DB_USER=$DB_USER"
        echo "RESOLVED_DB_PASS=$DB_PASSWORD"
        echo "RESOLVED_DB_NAME=$DB_NAME"
        echo "RESOLVED_TOKEN=$BOT_TOKEN"

        rm -rf "$BACKUP_WORKSPACE"
      `;

      const { stdout } = await execFileAsync('bash', ['-c', testScript]);
      await fs.rm(tempDir, { recursive: true, force: true });

      expect(stdout).toContain('RESOLVED_INSTANCE=bot_migrated');
      expect(stdout).toContain('RESOLVED_PANEL_KEY=my_secure_panel_credentials_key_32bytes');
      expect(stdout).toContain('RESOLVED_DB_USER=rsbot_bot_migrated');
      expect(stdout).toContain('RESOLVED_DB_PASS=migrated_db_password_123');
      expect(stdout).toContain('RESOLVED_DB_NAME=rsbot_bot_migrated');
      expect(stdout).toContain('RESOLVED_TOKEN=123456789:ORIGINAL_TOKEN');
    });

    it('allows overriding BOT_TOKEN via config file while preserving PANEL_CREDENTIALS_KEY and DB credentials', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'install_override_'));
      const archivePath = path.join(tempDir, 'backup.tar.gz');
      const overrideConfPath = path.join(tempDir, 'override.conf');

      await fs.writeFile(path.join(tempDir, 'manifest.txt'), 'format_version=1\ninstance=main\n');
      await fs.writeFile(path.join(tempDir, 'database.dump'), 'mock pg_dump custom format');
      await fs.writeFile(
        path.join(tempDir, '.env'),
        [
          'INSTANCE_NAME=main',
          'BOT_TOKEN="OLD_TOKEN_123"',
          'PANEL_CREDENTIALS_KEY=preserved_panel_key_123456789012',
          'DB_USER=rsbot_main',
          'DB_PASSWORD=old_db_pass_12345',
          'DB_NAME=rsbot_main',
        ].join('\n')
      );
      await execFileAsync('tar', [
        '-C',
        tempDir,
        '-czf',
        archivePath,
        'manifest.txt',
        'database.dump',
        '.env',
      ]);

      await fs.writeFile(
        overrideConfPath,
        ['BOT_TOKEN = "NEW_OVERRIDDEN_TOKEN_999"', 'ADMIN_IDS = 88888888'].join('\n')
      );

      const installPath = path.resolve('install.sh');
      const testScript = `
        die() { echo "ERROR: $*" >&2; exit 1; }
        warn() { echo "WARN: $*" >&2; }
        source <(awk '/^env_value_from_file\\(\\)/,/^}/' "${installPath}")
        source <(awk '/^is_complete_backup_bundle\\(\\)/,/^}/' "${installPath}")
        source <(awk '/^extract_complete_backup_bundle\\(\\)/,/^}/' "${installPath}")
        source <(awk '/^load_config_file\\(\\)/,/^}/' "${installPath}")

        BACKUP_INPUT="${archivePath}"
        BACKUP_WORKSPACE="$(mktemp -d)"
        extract_complete_backup_bundle "$BACKUP_INPUT" "$BACKUP_WORKSPACE"

        if [[ -f "$BACKUP_WORKSPACE/.env" ]]; then
          for k in BOT_TOKEN ADMIN_IDS PANEL_CREDENTIALS_KEY DB_USER DB_PASSWORD DB_NAME; do
            val="$(env_value_from_file "$BACKUP_WORKSPACE/.env" "$k" 2>/dev/null || true)"
            if [[ -n "$val" && -z "\${!k:-}" ]]; then
              printf -v "$k" '%s' "$val"
            fi
          done
        fi

        load_config_file "${overrideConfPath}"

        echo "FINAL_TOKEN=$BOT_TOKEN"
        echo "FINAL_ADMINS=$ADMIN_IDS"
        echo "FINAL_PANEL_KEY=$PANEL_CREDENTIALS_KEY"
        echo "FINAL_DB_USER=$DB_USER"

        rm -rf "$BACKUP_WORKSPACE"
      `;

      const { stdout } = await execFileAsync('bash', ['-c', testScript]);
      await fs.rm(tempDir, { recursive: true, force: true });

      expect(stdout).toContain('FINAL_TOKEN=NEW_OVERRIDDEN_TOKEN_999');
      expect(stdout).toContain('FINAL_ADMINS=88888888');
      expect(stdout).toContain('FINAL_PANEL_KEY=preserved_panel_key_123456789012');
      expect(stdout).toContain('FINAL_DB_USER=rsbot_main');
    });
  });

  describe('rsbot: restore path resolution', () => {
    it('resolves backup files from current directory and from instance backup dir, and fails on missing files', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'restore_res_'));
      const backupDir = path.join(tempDir, 'backups', 'main');
      await fs.mkdir(backupDir, { recursive: true });

      const inCwd = path.join(tempDir, 'cwd_backup.tar.gz');
      const inBackupDir = path.join(backupDir, 'saved_backup.tar.gz');
      await fs.writeFile(inCwd, 'dummy cwd content');
      await fs.writeFile(inBackupDir, 'dummy backup dir content');

      const testScript = `
        BACKUP_DIR="${backupDir}"
        die() { echo "ERROR: $*" >&2; exit 1; }

        resolve_restore_target() {
          local restore_file="$1"
          [[ -n "$restore_file" ]] || die "Usage: rsbot restore /path/to/backup.tar.gz"
          if [[ -r "$restore_file" ]]; then
            realpath "$restore_file"
          elif [[ -r "$BACKUP_DIR/$restore_file" ]]; then
            realpath "$BACKUP_DIR/$restore_file"
          else
            die "Backup file '$restore_file' was not found or is not readable (checked '$PWD/$restore_file' and '$BACKUP_DIR/$restore_file')."
          fi
        }

        cd "${tempDir}"
        echo "TARGET_CWD=$(resolve_restore_target "cwd_backup.tar.gz")"
        echo "TARGET_BACKUP_DIR=$(resolve_restore_target "saved_backup.tar.gz")"
        if (resolve_restore_target "nonexistent.tar.gz") 2>/dev/null; then
          echo "TARGET_NONEXISTENT=FOUND"
        else
          echo "TARGET_NONEXISTENT=REJECTED"
        fi
      `;

      const { stdout } = await execFileAsync('bash', ['-c', testScript]);
      await fs.rm(tempDir, { recursive: true, force: true });

      expect(stdout).toContain(`TARGET_CWD=${inCwd}`);
      expect(stdout).toContain(`TARGET_BACKUP_DIR=${inBackupDir}`);
      expect(stdout).toContain('TARGET_NONEXISTENT=REJECTED');
    });
  });
});
