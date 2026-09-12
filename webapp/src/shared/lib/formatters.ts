export function toPersianDigits(value: string | number): string {
  const str = String(value);
  const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return str.replace(/[0-9]/g, (d) => persianDigits[Number(d)] ?? d);
}

export function formatMoney(amount: number, locale: string = 'fa'): string {
  const rounded = Math.round(amount);
  if (locale === 'fa') {
    const formatted = rounded.toLocaleString('en-US');
    return toPersianDigits(formatted.replace(/,/g, '٬'));
  }
  return rounded.toLocaleString('en-US');
}

export function formatNumber(num: number, locale: string = 'fa'): string {
  if (locale === 'fa') {
    const formatted = Math.round(num).toLocaleString('en-US');
    return toPersianDigits(formatted.replace(/,/g, '٬'));
  }
  return num.toLocaleString('en-US');
}

export function getAvatarChar(name?: string | null, username?: string | null): string {
  const raw = (name || username || '').trim();
  if (!raw) return '👤';
  const clean = raw.replace(/[\u200B-\u200F\uFEFF\u00AD\u2060-\u206F\uFFF0-\uFFFF]/g, '').trim();
  if (!clean) return '👤';
  const match = clean.match(/\p{L}|\p{N}/u);
  if (match) return match[0].toUpperCase();
  const chars = Array.from(clean);
  return chars[0] || '👤';
}

export function sanitizeDisplayName(
  firstName?: string | null,
  lastName?: string | null,
  fallback = 'کاربر'
): { displayName: string; isMeaningful: boolean; initials: string } {
  const rawName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const isMeaningful = rawName.replace(/[\s.,_\-!?:;~*#@^&()[\]{}|/\\]/g, '').length > 0;
  const displayName = isMeaningful ? rawName : fallback;
  const initials = isMeaningful
    ? ((firstName?.trim()?.[0] || '') + (lastName?.trim()?.[0] || '')).toUpperCase()
    : '';

  return { displayName, isMeaningful, initials };
}

export function legacyCopy(text: string): boolean {
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textarea);
    return successful;
  } catch {
    return false;
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return legacyCopy(text);
    }
  }
  return legacyCopy(text);
}

export function formatIsoDate(isoString?: string | null, locale: string = 'fa'): string {
  if (!isoString) return '-';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return isoString;
  }
}

export function formatBytes(bytes?: number | null, locale: string = 'fa'): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '-';
  if (bytes === 0) return locale === 'fa' ? '۰ بایت' : '0 B';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    const formatted = gb.toFixed(1).replace(/\.0$/, '');
    return locale === 'fa' ? `${toPersianDigits(formatted)} گیگابایت` : `${formatted} GB`;
  }
  const mb = bytes / (1024 * 1024);
  const formatted = mb.toFixed(0);
  return locale === 'fa' ? `${toPersianDigits(formatted)} مگابایت` : `${formatted} MB`;
}
