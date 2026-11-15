/**
 * Pure Telegram formatting helpers shared inside the domain layer so domain
 * services never depend on the Telegram transport adapter (`src/telegram/` or `grammy`).
 */

/** Escape untrusted values interpolated into Telegram legacy Markdown text. */
export function escapeTelegramMarkdown(value: string | number): string {
  return String(value).replace(/([\\_*[\x60])/gu, '\\$1');
}

/** Strip backticks from values embedded inside Telegram Markdown inline-code spans. */
export function sanitizeTelegramInlineCode(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/`/gu, '');
}

export interface WebhookAlertScreenInput {
  emoji: string;
  title: string;
  subtitle?: string;
  primary: { emoji?: string; label: string; value: string | number };
}

/** Compose a webhook alert screen matching the bot's directional Markdown convention. */
export function formatWebhookAlertScreen(input: WebhookAlertScreenInput): string {
  const cleanTitle = input.title
    .trim()
    .replace(/^\*+|\*+$/g, '')
    .trim();
  const headerLine = input.emoji ? `${input.emoji} *${cleanTitle}*` : `*${cleanTitle}*`;
  const trimmedSubtitle = input.subtitle?.trim();
  const headerBlock = trimmedSubtitle
    ? trimmedSubtitle.startsWith('_') && trimmedSubtitle.endsWith('_')
      ? `${headerLine}\n${trimmedSubtitle}`
      : trimmedSubtitle.includes('_')
        ? `${headerLine}\n${trimmedSubtitle}`
        : `${headerLine}\n_${trimmedSubtitle}_`
    : headerLine;

  const primaryValue = String(input.primary.value);
  const icon =
    input.primary.emoji && !primaryValue.trimStart().startsWith(input.primary.emoji)
      ? `${input.primary.emoji} `
      : '';
  const primaryBlock = `${icon}*${input.primary.label}*\n${primaryValue}`;

  const content = `${headerBlock}\n\n${primaryBlock}`;
  const isRtl =
    /[\u0600-\u06ff]/u.test(input.title) || /[\u0600-\u06ff]/u.test(String(input.primary.label));

  if (isRtl) {
    const rlm = '\u200f';
    const lrm = '\u200e';
    return content
      .split('\n')
      .map((line) => (!line || line.startsWith(rlm) || line.includes(lrm) ? line : `${rlm}${line}`))
      .join('\n');
  }

  const lrm = '\u200e';
  const rlm = '\u200f';
  return content
    .split('\n')
    .map((line) => {
      if (!line) return line;
      const clean = line.replaceAll(rlm, '');
      if (clean.startsWith(lrm)) return clean;
      return /[\u0600-\u06ff]/u.test(clean) ? `${lrm}${clean}` : clean;
    })
    .join('\n');
}
