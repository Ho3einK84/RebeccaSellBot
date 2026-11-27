# Contributing to RebeccaSellBot

> **Last synced with version:** `v0.4.0`

Thank you for contributing to **RebeccaSellBot**. Keep changes focused, tested, and aligned with the project's layered architecture.

## Branching & Release Workflow

| Branch     | Purpose                                                                      |
| :--------- | :--------------------------------------------------------------------------- |
| `main`     | Production-ready releases only (`install.sh` and `rsbot update` track this). |
| `dev`      | Integration branch for upcoming changes before an official release.          |
| `<type>/*` | Short-lived work branches (e.g. `feat/promo-caps`, `fix/receipt-void`).      |
| `hotfix/*` | Urgent production fixes branched from `main` and merged back into `dev`.     |

1. Branch off `dev` for new features, fixes, documentation, or refactoring.
2. Open pull requests against **`dev`** (Dependabot PRs also target `dev`).
3. When cutting a release (`vX.Y.Z`) from `dev` into `main`, complete the **Release & Documentation Sync Checklist**:
   - Review all documentation files (`README.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `docs/*.md`) against new features, schema migrations, runtime settings, CLI flags, and HTTP/bot routes.
   - Bump `version` in `package.json` and `package-lock.json`, add the `## [X.Y.Z]` release section in [CHANGELOG.md](CHANGELOG.md), and update `> **Last synced with version:** \`vX.Y.Z\`` across all tracked documentation files.
   - Run `npm run verify` (`scripts/check-architecture.mjs` and `.github/workflows/release.yml` automatically fail if any tracked document's `Last synced with version` metadata or `CHANGELOG.md` release heading differs from `package.json`).
   - Merge `dev` into `main` and push an annotated SemVer tag (`vX.Y.Z`) to trigger the automated GitHub Release workflow.

## Commit Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(optional-scope): concise imperative summary
```

Common types: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `style`, `chore`, `ci`.

## Local Setup & Verification

Requires **Node.js 24** (`npm 11`) and **PostgreSQL 16** (for integration tests).

```bash
npm ci
cp .env.example .env
npm run dev
```

Before opening a pull request, ensure all relevant gates pass:

```bash
npm run verify:fast      # Cached static checks + changed tests (fast local loop)
npm run verify           # Full gate: architecture, typecheck, lint, format, tests, build
bash -n install.sh scripts/rsbot   # Required when touching deployment scripts
```

For schema, wallet, saga, or payment changes, also run the PostgreSQL integration suite:

```bash
TEST_DATABASE_URL=postgres://rsbot_test:rsbot_test@127.0.0.1:5432/rsbot_test \
  REQUIRE_INTEGRATION_DB=1 npm run test:integration
```

## Engineering Guidelines

- **Zero Direct Panel DB Touch:** Always communicate with Rebecca panels through `RebeccaService` (enforced by `npm run architecture:check`).
- **Layer Isolation:** Keep transport code (`src/telegram`, `src/webapp`) decoupled from direct database access; place business rules in `src/domain`.
- **Localization Parity:** Keep Persian (`fa`) and English (`en`) translations synchronized and preserve Persian digit (`۰-۹`) normalization.
- **Changelog & Documentation Sync:** Add a brief entry under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for notable user-facing changes, update affected guides in `README.md` / `docs/*.md`, and keep every tracked document's `> **Last synced with version:** \`vX.Y.Z\``header aligned with`package.json`on releases (enforced by`npm run architecture:check`).
- **No Secrets:** Never commit real Telegram tokens, Rebecca API keys, subscription URLs, or database dumps.

## Security

Do not report security vulnerabilities in public issues or pull requests. Follow [SECURITY.md](SECURITY.md) and submit a private report via GitHub Security Advisories.
