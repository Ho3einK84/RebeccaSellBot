# Security Policy

## Reporting a vulnerability

Please do not disclose suspected vulnerabilities, credentials, subscription URLs, database dumps, or access tokens in a public issue. Use GitHub Private Vulnerability Reporting for this repository when it is enabled; otherwise contact the maintainers through an established private channel and include only the minimum reproduction data required.

A useful report includes the affected commit/version, impact, prerequisites, reproduction steps, and whether any real customer or production data may have been exposed. Replace live credentials and subscription URLs with synthetic values.

## Secrets and deployment

- Keep `.env`, Git credentials, deploy keys, database dumps, and panel credentials outside the Docker build context.
- Prefer a fine-grained GitHub token or a dedicated deploy key with the minimum repository permissions required.
- Treat Rebecca subscription URLs as credentials; do not paste them into logs or public reports.
- Rotate any secret immediately if it was committed, copied into an image layer, or exposed in CI output. Removing it from the latest Git commit is not sufficient because historical objects and image layers may retain it.

## Database integrity

The database schema enforces data integrity at the database layer with check constraints, safe-integer bounds (`-9007199254740991` through `9007199254740991`), non-negative financial values, and state machine validations.

For production migrations or maintenance, ensure any custom queries adhere to safe integer ranges and status invariants defined in `drizzle/0000_initial_schema.sql`.

## Supported code

Security fixes are applied to the current maintained branch. Older snapshots should be upgraded before reporting behavior that has already been corrected upstream.
