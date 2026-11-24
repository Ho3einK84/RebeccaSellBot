/**
 * ForcedJoinService — domain-layer mandatory Telegram channel membership policy,
 * short-lived in-memory cache, fail-safe verification, and channel CRUD.
 *
 * Layering: depends only on domain abstractions (TranslationService + injected
 * transport adapter). Never imports grammY or Telegram transport directly.
 */
import crypto from 'node:crypto';
import { logger } from '../../infra/logger.js';
import {
  FORCED_JOIN_SCOPES,
  forcedJoinScope,
  type ForcedJoinScope,
  type SettingReader,
} from './FeatureSettings.js';
import type { TranslationService } from './TranslationService.js';

export { FORCED_JOIN_SCOPES, forcedJoinScope, type ForcedJoinScope };

export type ForcedJoinAction = 'any' | 'trial' | 'purchase' | 'renewal';

export interface ForcedJoinChannelConfig {
  id: string;
  /** Numeric chat ID (e.g. `-1001234567890`) or public `@username`. */
  channelId: string;
  /** Human-readable channel title shown on buttons and lock screen. */
  title: string;
  /** Public or private invite URL (`https://t.me/...`). */
  inviteLink: string;
  enabled: boolean;
}

export interface ForcedJoinPublicChannel {
  id: string;
  channelId: string;
  title: string;
  inviteLink: string;
}

export interface ForcedJoinCheckResult {
  allowed: boolean;
  scope: ForcedJoinScope;
  missingChannels: ForcedJoinPublicChannel[];
  bypassedByAdmin?: boolean;
  failSafeSkippedCount?: number;
}

export interface ForcedJoinAccessTestResult {
  ok: boolean;
  isAdmin: boolean;
  channelId: string;
  status?: string;
  chatTitle?: string;
  inviteLink?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface TelegramChatMemberInfo {
  status: string;
  is_member?: boolean;
}

export interface TelegramChatInfo {
  id: number;
  title?: string;
  username?: string;
  invite_link?: string;
}

export interface ForcedJoinTelegramAdapter {
  getChatMember(chatId: string | number, userId: number): Promise<TelegramChatMemberInfo>;
  getMe?: () => Promise<{ id: number; username?: string }>;
  getChat?: (chatId: string | number) => Promise<TelegramChatInfo>;
}

export interface ForcedJoinServiceOptions {
  translationService: TranslationService;
  getAdapter?: () => ForcedJoinTelegramAdapter | undefined;
  isAdmin?: (telegramId: number) => boolean;
  cacheTtlMs?: number;
  now?: () => number;
}

export class ForcedJoinError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_SCOPE'
      | 'INVALID_CHANNEL_ID'
      | 'INVALID_TITLE'
      | 'INVALID_INVITE_LINK'
      | 'DUPLICATE_CHANNEL'
      | 'CHANNEL_LIMIT_REACHED'
      | 'CHANNEL_NOT_FOUND',
    message?: string
  ) {
    super(message ?? code);
    this.name = 'ForcedJoinError';
  }
}

export const MAX_FORCED_JOIN_CHANNELS = 10;
export const DEFAULT_FORCED_JOIN_CACHE_TTL_MS = 45_000;
const MAX_CACHE_ENTRIES = 20_000;
const CHANNEL_USERNAME_RE = /^@[A-Za-z][A-Za-z0-9_]{3,31}$/u;
const CHANNEL_NUMERIC_ID_RE = /^-\d{6,16}$/u;
const MAX_TITLE_LENGTH = 80;

function normalizeDigits(value: string): string {
  return value
    .replace(/[۰-۹]/gu, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x0660));
}

/**
 * Normalize a channel identifier from admin input:
 * - `@username` -> `@username`
 * - `https://t.me/username` or `t.me/username` (public) -> `@username`
 * - `-1001234567890` (including Persian/Arabic digits) -> `-1001234567890`
 */
export function normalizeForcedJoinChannelId(raw: string): string | null {
  const cleaned = normalizeDigits(raw)
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu, '')
    .trim();
  if (!cleaned) return null;

  // Handle full t.me / telegram.me public channel URLs (not +invite hashes)
  const urlMatch =
    /^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([A-Za-z][A-Za-z0-9_]{3,31})\/?$/iu.exec(cleaned);
  if (urlMatch && urlMatch[1] && urlMatch[1].toLowerCase() !== 'joinchat') {
    return `@${urlMatch[1]}`;
  }

  if (CHANNEL_USERNAME_RE.test(cleaned)) {
    return cleaned;
  }

  // Strip spaces/dashes inside numeric IDs except leading minus
  if (cleaned.startsWith('-')) {
    const compact = `-${cleaned.slice(1).replace(/\s+/gu, '')}`;
    if (CHANNEL_NUMERIC_ID_RE.test(compact)) {
      return compact;
    }
  }

  return null;
}

/**
 * Normalize a Telegram invite URL (`https://t.me/...` or `https://telegram.me/...`).
 * When empty and `channelId` is a public `@username`, derives `https://t.me/<username>`.
 */
export function normalizeForcedJoinInviteLink(
  raw: string | undefined | null,
  channelId?: string
): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    if (channelId && channelId.startsWith('@')) {
      return `https://t.me/${channelId.slice(1)}`;
    }
    return null;
  }

  let candidate = trimmed;
  if (/^(?:t\.me|telegram\.me)\//iu.test(candidate)) {
    candidate = `https://${candidate}`;
  } else if (/^http:\/\/(?:t\.me|telegram\.me)\//iu.test(candidate)) {
    candidate = `https://${candidate.slice('http://'.length)}`;
  }

  try {
    const parsed = new URL(candidate);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || (host !== 't.me' && host !== 'telegram.me')) {
      return null;
    }
    if (!parsed.pathname || parsed.pathname === '/' || parsed.pathname.length > 128) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function normalizeForcedJoinTitle(raw: string): string | null {
  const trimmed = raw.replace(/\s+/gu, ' ').trim();
  if (!trimmed || trimmed.length > MAX_TITLE_LENGTH) return null;
  return trimmed;
}

export function generateForcedJoinChannelId(existing: readonly ForcedJoinChannelConfig[]): string {
  const existingIds = new Set(existing.map((c) => c.id));
  for (let i = 0; i < 16; i += 1) {
    const id = `fjc_${crypto.randomBytes(4).toString('hex')}`;
    if (!existingIds.has(id)) return id;
  }
  return `fjc_${Date.now().toString(36)}`;
}

export function parseForcedJoinChannelsJson(raw: string): ForcedJoinChannelConfig[] {
  if (!raw || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const result: ForcedJoinChannelConfig[] = [];
  const seenIds = new Set<string>();
  const seenChannelIds = new Set<string>();

  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    const rawId = typeof obj.id === 'string' ? obj.id.trim() : '';
    const rawChannelId = typeof obj.channelId === 'string' ? obj.channelId : '';
    const rawTitle = typeof obj.title === 'string' ? obj.title : '';
    const rawInviteLink = typeof obj.inviteLink === 'string' ? obj.inviteLink : '';

    const channelId = normalizeForcedJoinChannelId(rawChannelId);
    const title = normalizeForcedJoinTitle(rawTitle);
    const inviteLink = normalizeForcedJoinInviteLink(rawInviteLink, channelId ?? undefined);
    if (!rawId || !channelId || !title || !inviteLink) continue;

    const dedupeKey = channelId.toLowerCase();
    if (seenIds.has(rawId) || seenChannelIds.has(dedupeKey)) continue;
    seenIds.add(rawId);
    seenChannelIds.add(dedupeKey);

    result.push({
      id: rawId,
      channelId,
      title,
      inviteLink,
      enabled: obj.enabled !== false,
    });
    if (result.length >= MAX_FORCED_JOIN_CHANNELS) break;
  }

  return result;
}

export function serializeForcedJoinChannelsJson(
  channels: readonly ForcedJoinChannelConfig[]
): string {
  return JSON.stringify(
    channels.slice(0, MAX_FORCED_JOIN_CHANNELS).map((c) => ({
      id: c.id,
      channelId: c.channelId,
      title: c.title,
      inviteLink: c.inviteLink,
      enabled: Boolean(c.enabled),
    }))
  );
}

/** Whether a given enforcement scope applies to a user action. */
export function doesForcedJoinScopeApply(
  scope: ForcedJoinScope,
  action: ForcedJoinAction
): boolean {
  switch (scope) {
    case 'off':
      return false;
    case 'all':
      return true;
    case 'trial_only':
      return action === 'trial';
    case 'purchase_and_trial':
      return action === 'trial' || action === 'purchase';
  }
}

export function isChatMemberJoined(member: TelegramChatMemberInfo | null | undefined): boolean {
  if (!member || typeof member.status !== 'string') return false;
  if (
    member.status === 'creator' ||
    member.status === 'administrator' ||
    member.status === 'member'
  ) {
    return true;
  }
  if (member.status === 'restricted') {
    return member.is_member === true;
  }
  return false;
}

function extractTelegramErrorDetails(err: unknown): {
  errorCode?: number;
  description: string;
} {
  if (typeof err === 'object' && err !== null) {
    const record = err as {
      error_code?: unknown;
      status?: unknown;
      description?: unknown;
      message?: unknown;
    };
    const errorCode =
      typeof record.error_code === 'number'
        ? record.error_code
        : typeof record.status === 'number'
          ? record.status
          : undefined;
    const description =
      typeof record.description === 'string'
        ? record.description
        : typeof record.message === 'string'
          ? record.message
          : String(err);
    return { errorCode, description };
  }
  return { description: String(err) };
}

interface CacheEntry {
  joined: boolean;
  expiresAt: number;
}

export class ForcedJoinService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private cachedBotId: number | null = null;

  constructor(private readonly options: ForcedJoinServiceOptions) {
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_FORCED_JOIN_CACHE_TTL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  getScope(settings: SettingReader = this.options.translationService): ForcedJoinScope {
    return forcedJoinScope(settings);
  }

  listChannels(
    settings: SettingReader = this.options.translationService
  ): ForcedJoinChannelConfig[] {
    return parseForcedJoinChannelsJson(settings.getSetting('forced_join_channels_json', '[]'));
  }

  getActiveChannels(
    settings: SettingReader = this.options.translationService
  ): ForcedJoinChannelConfig[] {
    return this.listChannels(settings).filter((ch) => ch.enabled);
  }

  getConfig(): {
    scope: ForcedJoinScope;
    channels: ForcedJoinChannelConfig[];
    activeCount: number;
  } {
    const scope = this.getScope();
    const channels = this.listChannels();
    return {
      scope,
      channels,
      activeCount: channels.filter((c) => c.enabled).length,
    };
  }

  async setScope(scope: ForcedJoinScope): Promise<ForcedJoinScope> {
    if (!FORCED_JOIN_SCOPES.includes(scope)) {
      throw new ForcedJoinError('INVALID_SCOPE', `Unsupported forced join scope: ${String(scope)}`);
    }
    await this.options.translationService.updateSetting('forced_join_scope', scope);
    this.invalidateAllCache();
    return scope;
  }

  async addChannel(input: {
    channelId: string;
    title: string;
    inviteLink?: string | null;
    enabled?: boolean;
  }): Promise<ForcedJoinChannelConfig> {
    const current = this.listChannels();
    if (current.length >= MAX_FORCED_JOIN_CHANNELS) {
      throw new ForcedJoinError('CHANNEL_LIMIT_REACHED', 'Maximum channel limit reached');
    }

    const channelId = normalizeForcedJoinChannelId(input.channelId);
    if (!channelId) {
      throw new ForcedJoinError('INVALID_CHANNEL_ID', 'Invalid channel ID or @username');
    }

    const title = normalizeForcedJoinTitle(input.title);
    if (!title) {
      throw new ForcedJoinError('INVALID_TITLE', 'Invalid channel title');
    }

    const inviteLink = normalizeForcedJoinInviteLink(input.inviteLink, channelId);
    if (!inviteLink) {
      throw new ForcedJoinError('INVALID_INVITE_LINK', 'Valid Telegram invite link is required');
    }

    const duplicate = current.some((ch) => ch.channelId.toLowerCase() === channelId.toLowerCase());
    if (duplicate) {
      throw new ForcedJoinError('DUPLICATE_CHANNEL', 'Channel is already configured');
    }

    const created: ForcedJoinChannelConfig = {
      id: generateForcedJoinChannelId(current),
      channelId,
      title,
      inviteLink,
      enabled: input.enabled ?? true,
    };

    await this.persistChannels([...current, created]);
    return created;
  }

  async updateChannel(
    id: string,
    patch: {
      channelId?: string;
      title?: string;
      inviteLink?: string | null;
      enabled?: boolean;
    }
  ): Promise<ForcedJoinChannelConfig> {
    const current = this.listChannels();
    const index = current.findIndex((c) => c.id === id);
    if (index === -1) {
      throw new ForcedJoinError('CHANNEL_NOT_FOUND', 'Channel not found');
    }
    const existing = current[index]!;

    const nextChannelId =
      patch.channelId !== undefined
        ? normalizeForcedJoinChannelId(patch.channelId)
        : existing.channelId;
    if (!nextChannelId) {
      throw new ForcedJoinError('INVALID_CHANNEL_ID', 'Invalid channel ID or @username');
    }

    const duplicate = current.some(
      (ch, idx) => idx !== index && ch.channelId.toLowerCase() === nextChannelId.toLowerCase()
    );
    if (duplicate) {
      throw new ForcedJoinError('DUPLICATE_CHANNEL', 'Channel is already configured');
    }

    const nextTitle =
      patch.title !== undefined ? normalizeForcedJoinTitle(patch.title) : existing.title;
    if (!nextTitle) {
      throw new ForcedJoinError('INVALID_TITLE', 'Invalid channel title');
    }

    const nextInviteLink =
      patch.inviteLink !== undefined
        ? normalizeForcedJoinInviteLink(patch.inviteLink, nextChannelId)
        : existing.inviteLink;
    if (!nextInviteLink) {
      throw new ForcedJoinError('INVALID_INVITE_LINK', 'Valid Telegram invite link is required');
    }

    const updated: ForcedJoinChannelConfig = {
      ...existing,
      channelId: nextChannelId,
      title: nextTitle,
      inviteLink: nextInviteLink,
      enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : existing.enabled,
    };

    const nextList = [...current];
    nextList[index] = updated;
    await this.persistChannels(nextList);
    return updated;
  }

  async toggleChannel(id: string, enabled?: boolean): Promise<ForcedJoinChannelConfig> {
    const current = this.listChannels();
    const existing = current.find((c) => c.id === id);
    if (!existing) {
      throw new ForcedJoinError('CHANNEL_NOT_FOUND', 'Channel not found');
    }
    return this.updateChannel(id, {
      enabled: enabled !== undefined ? enabled : !existing.enabled,
    });
  }

  async deleteChannel(id: string): Promise<boolean> {
    const current = this.listChannels();
    const nextList = current.filter((c) => c.id !== id);
    if (nextList.length === current.length) {
      return false;
    }
    await this.persistChannels(nextList);
    return true;
  }

  invalidateUserCache(telegramId: number): void {
    const prefix = `${telegramId}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  invalidateAllCache(): void {
    this.cache.clear();
  }

  /**
   * Check whether a user satisfies mandatory channel membership for `action`.
   * - Admins always bypass.
   * - Uses short-lived in-memory cache (default 45s) unless `bypassCache` is true.
   * - Fail-safe: Telegram 400/403 or transport errors are logged and never lock out users.
   */
  async checkMembership(
    telegramId: number,
    action: ForcedJoinAction,
    opts: { bypassCache?: boolean } = {}
  ): Promise<ForcedJoinCheckResult> {
    const scope = this.getScope();

    if (this.options.isAdmin?.(telegramId)) {
      return { allowed: true, scope, missingChannels: [], bypassedByAdmin: true };
    }

    if (!doesForcedJoinScopeApply(scope, action)) {
      return { allowed: true, scope, missingChannels: [] };
    }

    const activeChannels = this.getActiveChannels();
    if (activeChannels.length === 0) {
      return { allowed: true, scope, missingChannels: [] };
    }

    if (opts.bypassCache) {
      this.invalidateUserCache(telegramId);
    }

    const adapter = this.options.getAdapter?.();
    if (!adapter) {
      logger.warn(
        { telegramId, action, channelCount: activeChannels.length },
        'Forced join adapter unavailable; failing open safely'
      );
      return {
        allowed: true,
        scope,
        missingChannels: [],
        failSafeSkippedCount: activeChannels.length,
      };
    }

    const missingChannels: ForcedJoinPublicChannel[] = [];
    let failSafeSkippedCount = 0;

    for (const channel of activeChannels) {
      const check = await this.checkSingleChannel(adapter, telegramId, channel);
      if (check === 'fail_safe') {
        failSafeSkippedCount += 1;
        continue;
      }
      if (check === 'not_joined') {
        missingChannels.push({
          id: channel.id,
          channelId: channel.channelId,
          title: channel.title,
          inviteLink: channel.inviteLink,
        });
      }
    }

    return {
      allowed: missingChannels.length === 0,
      scope,
      missingChannels,
      ...(failSafeSkippedCount > 0 ? { failSafeSkippedCount } : {}),
    };
  }

  /**
   * Verify whether the bot is an administrator/creator in a target channel.
   * Used in the admin UI when adding or inspecting a channel.
   */
  async testChannelAccess(rawChannelId: string): Promise<ForcedJoinAccessTestResult> {
    const channelId = normalizeForcedJoinChannelId(rawChannelId);
    if (!channelId) {
      return {
        ok: false,
        isAdmin: false,
        channelId: rawChannelId.trim(),
        errorCode: 'INVALID_CHANNEL_ID',
        errorMessage: 'Invalid channel ID or @username',
      };
    }

    const adapter = this.options.getAdapter?.();
    if (!adapter) {
      return {
        ok: false,
        isAdmin: false,
        channelId,
        errorCode: 'ADAPTER_UNAVAILABLE',
        errorMessage: 'Telegram Bot API is unavailable',
      };
    }

    let chatTitle: string | undefined;
    let inviteLink: string | undefined;

    if (typeof adapter.getChat === 'function') {
      try {
        const chat = await adapter.getChat(channelId);
        chatTitle = chat.title?.trim() || undefined;
        if (chat.username) {
          inviteLink = `https://t.me/${chat.username}`;
        } else if (chat.invite_link) {
          inviteLink = chat.invite_link;
        }
      } catch (err) {
        const details = extractTelegramErrorDetails(err);
        return {
          ok: false,
          isAdmin: false,
          channelId,
          errorCode: details.errorCode === 400 ? 'CHAT_NOT_FOUND' : 'CHAT_ACCESS_ERROR',
          errorMessage: details.description,
        };
      }
    }

    let botId = this.cachedBotId;
    if (!botId && typeof adapter.getMe === 'function') {
      try {
        const me = await adapter.getMe();
        if (typeof me?.id === 'number' && Number.isSafeInteger(me.id)) {
          botId = me.id;
          this.cachedBotId = me.id;
        }
      } catch (err) {
        const details = extractTelegramErrorDetails(err);
        return {
          ok: false,
          isAdmin: false,
          channelId,
          chatTitle,
          inviteLink,
          errorCode: 'BOT_INFO_FAILED',
          errorMessage: details.description,
        };
      }
    }

    if (!botId) {
      return {
        ok: false,
        isAdmin: false,
        channelId,
        chatTitle,
        inviteLink,
        errorCode: 'BOT_ID_UNAVAILABLE',
        errorMessage: 'Could not determine bot user ID',
      };
    }

    try {
      const member = await adapter.getChatMember(channelId, botId);
      const isAdmin = member.status === 'administrator' || member.status === 'creator';
      return {
        ok: isAdmin,
        isAdmin,
        channelId,
        status: member.status,
        ...(chatTitle ? { chatTitle } : {}),
        ...(inviteLink ? { inviteLink } : {}),
        ...(!isAdmin
          ? {
              errorCode: 'BOT_NOT_ADMIN',
              errorMessage: `Bot status in channel is "${member.status}" instead of administrator`,
            }
          : {}),
      };
    } catch (err) {
      const details = extractTelegramErrorDetails(err);
      return {
        ok: false,
        isAdmin: false,
        channelId,
        ...(chatTitle ? { chatTitle } : {}),
        ...(inviteLink ? { inviteLink } : {}),
        errorCode:
          details.errorCode === 403
            ? 'BOT_NOT_ADMIN'
            : details.errorCode === 400
              ? 'CHAT_NOT_FOUND'
              : 'TELEGRAM_API_ERROR',
        errorMessage: details.description,
      };
    }
  }

  private async checkSingleChannel(
    adapter: ForcedJoinTelegramAdapter,
    telegramId: number,
    channel: ForcedJoinChannelConfig
  ): Promise<'joined' | 'not_joined' | 'fail_safe'> {
    const nowMs = this.now();
    const cacheKey = `${telegramId}:${channel.channelId.toLowerCase()}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > nowMs) {
      return cached.joined ? 'joined' : 'not_joined';
    }

    try {
      const member = await adapter.getChatMember(channel.channelId, telegramId);
      const joined = isChatMemberJoined(member);
      this.writeCache(cacheKey, joined, nowMs);
      return joined ? 'joined' : 'not_joined';
    } catch (err) {
      const details = extractTelegramErrorDetails(err);
      logger.warn(
        {
          telegramId,
          channelId: channel.channelId,
          channelTitle: channel.title,
          errorCode: details.errorCode,
          description: details.description,
        },
        'Forced join getChatMember failed; failing open for channel'
      );
      return 'fail_safe';
    }
  }

  private writeCache(key: string, joined: boolean, nowMs: number): void {
    if (this.cacheTtlMs <= 0) return;
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      for (const [entryKey, entry] of this.cache) {
        if (entry.expiresAt <= nowMs) {
          this.cache.delete(entryKey);
        }
      }
      if (this.cache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey !== undefined) this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, { joined, expiresAt: nowMs + this.cacheTtlMs });
  }

  private async persistChannels(channels: readonly ForcedJoinChannelConfig[]): Promise<void> {
    await this.options.translationService.updateSetting(
      'forced_join_channels_json',
      serializeForcedJoinChannelsJson(channels)
    );
    this.invalidateAllCache();
  }
}
