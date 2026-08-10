# Security Policy

## Reporting a vulnerability

Please do not disclose suspected vulnerabilities, credentials, subscription URLs, database dumps, or access tokens in a public issue. Use GitHub Private Vulnerability Reporting for this repository when it is enabled; otherwise contact the maintainers through an established private channel and include only the minimum reproduction data required.

A useful report includes the affected commit/version, impact, prerequisites, reproduction steps, and whether any real customer or production data may have been exposed. Replace live credentials and subscription URLs with synthetic values.

## Secrets and deployment

- Keep `.env`, Git credentials, deploy keys, database dumps, and panel credentials outside the Docker build context.
- Prefer a fine-grained GitHub token or a dedicated deploy key with the minimum repository permissions required.
- Treat Rebecca subscription URLs as credentials; do not paste them into logs or public reports.
- Rotate any secret immediately if it was committed, copied into an image layer, or exposed in CI output. Removing it from the latest Git commit is not sufficient because historical objects and image layers may retain it.

## Database integrity migration

Migration `0005_data_integrity_hardening.sql` adds new status, range, and safe-integer checks as `NOT VALID`. PostgreSQL enforces those constraints for new or updated rows without blocking deployment on legacy data, but existing rows are not proven compliant until the constraints are validated.

Before validating the constraints in production, inspect legacy rows for invalid statuses, negative financial values, or `bigint` values outside JavaScript's safe-integer range (`-9007199254740991` through `9007199254740991`). After cleanup, validate each constraint with `ALTER TABLE ... VALIDATE CONSTRAINT ...` during a controlled maintenance window.

## Supported code

Security fixes are applied to the current maintained branch. Older snapshots should be upgraded before reporting behavior that has already been corrected upstream.
