/**
 * Validate and normalize the Rebecca API base URL.
 *
 * Rebecca endpoints are built by appending fixed API paths to this value, so
 * accepting a dashboard path, query string, fragment, or embedded credentials
 * would make the configured connection ambiguous or unsafe. Keep this as the
 * single source of truth for both runtime configuration and admin input.
 */
export function validateRebeccaBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:') {
    throw new Error('REBECCA_API_URL must use HTTPS');
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('REBECCA_API_URL must be a clean HTTPS origin URL');
  }
  return parsed.origin;
}
