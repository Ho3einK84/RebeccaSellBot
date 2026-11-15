/**
 * Telegram file-URL resolution and download (infrastructure boundary).
 *
 * The WebApp admin route serves receipt photos by streaming the Telegram-hosted
 * file directly so `BOT_TOKEN` never leaves the server. Raw Bot API HTTP stays
 * in `infra/` so layered architecture checks keep passing for domain/webapp code.
 */
const DEFAULT_TELEGRAM_FILE_TIMEOUT_MS = 10_000;
const DEFAULT_TELEGRAM_FILE_MAX_BYTES = 20 * 1024 * 1024;

const ALLOWED_INLINE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export interface TelegramFileRequestOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

function normalizeTimeoutMs(timeoutMs?: number): number {
  return typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_TELEGRAM_FILE_TIMEOUT_MS;
}

function normalizeMaxBytes(maxBytes?: number): number {
  return typeof maxBytes === 'number' && Number.isFinite(maxBytes) && maxBytes > 0
    ? maxBytes
    : DEFAULT_TELEGRAM_FILE_MAX_BYTES;
}

async function cancelBodySafely(res: Response): Promise<void> {
  try {
    await res.body?.cancel?.();
  } catch {
    // Ignore cancellation failures on mocked or already-closed streams.
  }
}

function isSafeTelegramFilePath(filePath: string | undefined): filePath is string {
  if (!filePath || typeof filePath !== 'string') return false;
  const trimmed = filePath.trim();
  if (!trimmed || trimmed.startsWith('/')) return false;
  const segments = trimmed.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return false;
  }
  return !/[\s\0]/.test(trimmed);
}

function resolveSafeContentType(headerValue: string | null, buffer: Buffer): string {
  const normalizedHeader = headerValue?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (ALLOWED_INLINE_IMAGE_TYPES.has(normalizedHeader)) {
    return normalizedHeader;
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buffer.length >= 6) {
    const header = buffer.subarray(0, 6).toString('ascii');
    if (header === 'GIF87a' || header === 'GIF89a') {
      return 'image/gif';
    }
  }
  return 'application/octet-stream';
}

export async function getTelegramFileUrl(
  botToken: string,
  fileId: string,
  options?: Pick<TelegramFileRequestOptions, 'timeoutMs'>
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const token = botToken.trim();
  const id = fileId.trim();
  if (!token || !id) {
    return { ok: false, error: 'Could not load receipt photo from Telegram' };
  }

  try {
    const fileRes = await fetch(
      `https://api.telegram.org/bot${encodeURIComponent(token)}/getFile?file_id=${encodeURIComponent(id)}`,
      { signal: AbortSignal.timeout(normalizeTimeoutMs(options?.timeoutMs)) }
    );
    if (!fileRes.ok) {
      await cancelBodySafely(fileRes);
      return { ok: false, error: 'Could not load receipt photo from Telegram' };
    }
    const fileData = (await fileRes.json()) as {
      ok?: boolean;
      result?: { file_path?: string };
    };
    const filePath = fileData.ok ? fileData.result?.file_path : undefined;
    if (!isSafeTelegramFilePath(filePath)) {
      return { ok: false, error: 'Could not load receipt photo from Telegram' };
    }
    return {
      ok: true,
      url: `https://api.telegram.org/file/bot${encodeURIComponent(token)}/${filePath}`,
    };
  } catch {
    return { ok: false, error: 'Could not load receipt photo from Telegram' };
  }
}

export async function downloadTelegramFile(
  botToken: string,
  fileId: string,
  options?: TelegramFileRequestOptions
): Promise<{ ok: true; buffer: Buffer; contentType: string } | { ok: false; error: string }> {
  const timeoutMs = normalizeTimeoutMs(options?.timeoutMs);
  const maxBytes = normalizeMaxBytes(options?.maxBytes);

  try {
    const resolved = await getTelegramFileUrl(botToken, fileId, { timeoutMs });
    if (!resolved.ok) {
      return resolved;
    }
    const res = await fetch(resolved.url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      await cancelBodySafely(res);
      return { ok: false, error: 'Failed to download receipt from Telegram' };
    }

    const declaredLength = Number(res.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      await cancelBodySafely(res);
      return { ok: false, error: 'Failed to download receipt from Telegram' };
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      return { ok: false, error: 'Failed to download receipt from Telegram' };
    }

    const contentType = resolveSafeContentType(res.headers.get('content-type'), buffer);
    return { ok: true, buffer, contentType };
  } catch {
    return { ok: false, error: 'Failed to download receipt from Telegram' };
  }
}
