/**
 * Telegram file-URL resolution (infrastructure boundary).
 *
 * The WebApp admin route serves receipt photos by redirecting to the
 * Telegram-hosted file. Raw Bot API HTTP stays in `infra/` so layered
 * architecture checks keep passing for domain/webapp code.
 */
export async function getTelegramFileUrl(
  botToken: string,
  fileId: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const fileRes = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`
    );
    const fileData = (await fileRes.json()) as {
      ok?: boolean;
      result?: { file_path?: string };
    };
    const filePath = fileData.ok ? fileData.result?.file_path : undefined;
    if (!fileRes.ok || !filePath) {
      return { ok: false, error: 'Could not load receipt photo from Telegram' };
    }
    return { ok: true, url: `https://api.telegram.org/file/bot${botToken}/${filePath}` };
  } catch {
    return { ok: false, error: 'Could not load receipt photo from Telegram' };
  }
}
