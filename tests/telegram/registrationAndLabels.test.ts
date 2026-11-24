import { describe, expect, it, vi } from 'vitest';
import { Bot, type StorageAdapter } from 'grammy';
import type { Update } from 'grammy/types';
import { configureBotRuntime } from '../../src/telegram/botRuntime.js';
import { registerBaseRoutes } from '../../src/telegram/features/baseRoutes.js';
import {
  buildSubscriptionActionKeyboard,
  registerSubscriptionRoutes,
  showUserSubscriptions,
} from '../../src/telegram/features/subscriptions/routes.js';
import { editConfigLabelConversation } from '../../src/telegram/conversations/userConversations.js';
import type { BotServices, MenuContext, SessionData } from '../../src/telegram/types.js';
import {
  createMockServices,
  extractCallbackDataList,
  type RecordedApiCall,
} from './helpers/botHarness.js';
import { createConversationHarness } from './helpers/conversationHarness.js';

class InMemorySessionStorage implements StorageAdapter<SessionData> {
  private readonly store = new Map<string, SessionData>();
  read(key: string) {
    return this.store.get(key);
  }
  write(key: string, value: SessionData) {
    this.store.set(key, value);
  }
  delete(key: string) {
    this.store.delete(key);
  }
}

function createRuntimeBot(services: BotServices) {
  const apiCalls: RecordedApiCall[] = [];
  let nextMessageId = 500;
  let nextUpdateId = 1;

  const customFetch = vi.fn(async (url: unknown, init?: { body?: unknown }) => {
    const method = String(url).split('/').pop() ?? 'unknown';
    const payload =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    apiCalls.push({ method, payload });
    if (method === 'sendMessage') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: {
            message_id: ++nextMessageId,
            date: Math.floor(Date.now() / 1000),
            chat: { id: payload.chat_id ?? 100, type: 'private' },
            text: payload.text,
          },
        }),
      };
    }
    if (method === 'getMe') {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: bot.botInfo }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
  });

  const bot = new Bot<MenuContext>('123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11', {
    client: { fetch: customFetch as unknown as typeof fetch },
  });
  bot.botInfo = {
    id: 123456,
    is_bot: true,
    first_name: 'TestBot',
    username: 'rebecca_test_bot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
  };
  configureBotRuntime(bot, services, { sessionStorage: new InMemorySessionStorage() });
  registerBaseRoutes(bot, services);

  const dispatchText = async (text: string, userId: number) => {
    const entities = text.startsWith('/')
      ? [{ offset: 0, length: text.split(/\s/u)[0]!.length, type: 'bot_command' as const }]
      : undefined;
    const update: Update = {
      update_id: nextUpdateId++,
      message: {
        message_id: ++nextMessageId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: userId, type: 'private' },
        from: { id: userId, is_bot: false, first_name: 'Test', username: `u_${userId}` },
        text,
        ...(entities ? { entities } : {}),
      } as unknown as NonNullable<Update['message']>,
    };
    await bot.handleUpdate(update);
  };

  const dispatchCallback = async (data: string, userId: number, messageId = 777) => {
    const update: Update = {
      update_id: nextUpdateId++,
      callback_query: {
        id: `cb_${nextUpdateId}`,
        from: { id: userId, is_bot: false, first_name: 'Test', username: `u_${userId}` },
        chat_instance: 'ci',
        data,
        message: {
          message_id: messageId,
          date: Math.floor(Date.now() / 1000),
          chat: { id: userId, type: 'private' },
          text: 'msg',
        },
      } as unknown as NonNullable<Update['callback_query']>,
    };
    await bot.handleUpdate(update);
  };

  return { bot, apiCalls, dispatchText, dispatchCallback };
}

describe('Telegram Registration Mode, ui:dismiss Cancellation & Personal Labels', () => {
  it('enforces registration_mode across botRuntime & /start while sparing admins and existing users, and cancels deletion on ui:dismiss', async () => {
    let regMode = 'closed';
    const existingIds = new Set([55555]);
    const getOrCreateUser = vi.fn(async (telegramId: number) => ({
      telegramId,
      locale: 'fa',
      localeManual: false,
      isBanned: false,
      balance: 0,
      reservedBalance: 0,
      totalSpend: 0,
    }));
    const cancelForMessage = vi.fn(async () => true);

    const services = createMockServices({
      adminIds: [1],
      userService: {
        exists: vi.fn(async (id: number) => existingIds.has(id)),
      },
      walletService: { getOrCreateUser },
      referralService: {
        resolveReferrerId: vi.fn(async (code?: string) =>
          code === 'ref_valid' ? 55555 : undefined
        ),
      },
      scheduledMessageDeletionService: {
        cancelForMessage,
      } as never,
      translationService: {
        getSetting: vi.fn((key: string, fb = '') => {
          if (key === 'registration_mode') return regMode;
          if (key === 'forced_join_scope') return 'off';
          return fb;
        }),
        getSettingBool: vi.fn((key: string, fb = false) => {
          if (key === 'bot_enabled') return true;
          if (key === 'support_enabled') return false;
          if (key === 'language_selection_enabled') return true;
          return fb;
        }),
        get: vi.fn((key: string) => key),
      },
    });

    const rt = createRuntimeBot(services);

    // 1. Closed mode blocks unregistered /start & arbitrary messages before getOrCreateUser
    await rt.dispatchText('/start', 9001);
    expect(getOrCreateUser).not.toHaveBeenCalled();
    expect(String(rt.apiCalls.at(-1)?.payload.text)).toContain('registration_closed_title');

    await rt.dispatchText('hello bot', 9001);
    expect(getOrCreateUser).not.toHaveBeenCalled();

    // Existing user and admin pass cleanly even in closed mode
    await rt.dispatchText('/start', 55555);
    expect(getOrCreateUser).toHaveBeenCalledWith(
      55555,
      'u_55555',
      'Test',
      null,
      undefined,
      'fa',
      'telegram_start'
    );
    await rt.dispatchText('/start', 1);
    expect(getOrCreateUser).toHaveBeenCalledWith(
      1,
      'u_1',
      'Test',
      null,
      undefined,
      'fa',
      'telegram_start'
    );

    // 2. Invite-only rejects invalid or missing referral, allows valid referral
    regMode = 'invite_only';
    getOrCreateUser.mockClear();

    await rt.dispatchText('/start', 9002);
    expect(getOrCreateUser).not.toHaveBeenCalled();
    expect(String(rt.apiCalls.at(-1)?.payload.text)).toContain('registration_invite_only_title');

    await rt.dispatchText('/start ref_bogus', 9002);
    expect(getOrCreateUser).not.toHaveBeenCalled();

    await rt.dispatchText('/start ref_valid', 9002);
    expect(getOrCreateUser).toHaveBeenCalledWith(
      9002,
      'u_9002',
      'Test',
      null,
      'ref_valid',
      'fa',
      'telegram_referral_start'
    );

    // 3. `ui:dismiss` deletes the message and cancels any pending scheduled auto-deletion
    await rt.dispatchCallback('ui:dismiss', 55555, 888);
    expect(cancelForMessage).toHaveBeenCalledWith(55555, 888);
  });

  it('displays userLabel in subscription list, detail view, and action keyboard (< 64 bytes), and routes config:label:<id>', async () => {
    const ownedCfg = {
      id: 'cfg_abc_1',
      telegramId: 100,
      panelId: 'legacy',
      serviceId: 1,
      configUsername: 'u100_srv1',
      userLabel: 'گوشی شخصی',
      subUrl: 'https://sub.example/u100_srv1',
      panelStatus: 'active',
      panelDataLimit: 50 * 1024 ** 3,
      panelUsedTraffic: 5 * 1024 ** 3,
      panelExpire: Math.floor(Date.now() / 1000) + 10 * 86_400,
      autoRenewEnabled: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };

    const services = createMockServices({
      configService: {
        listConfigsForOwner: vi.fn().mockResolvedValue([ownedCfg]),
        getOwnedConfigById: vi.fn(async (_uid: number, cid: string) =>
          cid === 'cfg_abc_1' ? ownedCfg : undefined
        ),
        getRemoteConfigDetail: vi.fn().mockResolvedValue({
          username: 'u100_srv1',
          status: 'active',
          used_traffic: 5 * 1024 ** 3,
          data_limit: 50 * 1024 ** 3,
          expire: Math.floor(Date.now() / 1000) + 10 * 86_400,
          created_at: '2026-01-01T00:00:00Z',
          subscription_url: 'https://sub.example/u100_srv1',
        }),
      },
    });

    const harness = createConversationHarness({
      services,
      defaultLocale: 'fa',
      conversations: [['editConfigLabelConversation', editConfigLabelConversation]],
    });
    registerSubscriptionRoutes(harness.bot);

    // Verify detail keyboard includes callback_data `config:label:cfg_abc_1` within 64 bytes
    const kb = buildSubscriptionActionKeyboard(
      { userLocale: 'fa', services } as unknown as MenuContext,
      'cfg_abc_1',
      'active',
      false,
      true
    );
    const cbs = extractCallbackDataList(kb);
    expect(cbs).toContain('config:label:cfg_abc_1');
    expect(Buffer.byteLength('config:label:cfg_abc_1', 'utf8')).toBeLessThanOrEqual(64);

    // Trigger list view via callback
    await harness.sendCallback('subs:page:1', { userId: 100 });
    const listCall = harness.callsFor('editMessageText').at(-1);
    expect(String(listCall?.payload.text)).toContain('`u100_srv1` (گوشی شخصی)');
    const firstBtn = (
      listCall?.payload.reply_markup as { inline_keyboard: Array<Array<{ text: string }>> }
    ).inline_keyboard[0]?.[0];
    expect(firstBtn?.text).toContain('گوشی شخصی (u100_srv1)');

    // Trigger detail view
    await harness.sendCallback('config:view:cfg_abc_1', { userId: 100 });
    const detailText = String(harness.callsFor('editMessageText').at(-1)?.payload.text);
    expect(detailText).toContain('subscription_label_field');
    expect(detailText).toContain('گوشی شخصی');

    // Trigger config:label callback -> enters editConfigLabelConversation and renders prompt
    await harness.sendCallback('config:label:cfg_abc_1', { userId: 100 });
    const labelPrompt = String(
      (harness.callsFor('editMessageText').at(-1) ?? harness.callsFor('sendMessage').at(-1))
        ?.payload.text
    );
    expect(labelPrompt).toContain('subscription_label_prompt_title');

    // Direct invocation check for showUserSubscriptions fallback
    const directReply = vi.fn(async () => ({ message_id: 200 }));
    await showUserSubscriptions({
      from: { id: 100 },
      chat: { id: 100, type: 'private' },
      services,
      userLocale: 'fa',
      session: {},
      reply: directReply,
    } as unknown as MenuContext);
    expect(directReply).toHaveBeenCalled();
  });

  it('completes editConfigLabelConversation: validates 40-char max, saves sanitized ZWNJ label, and supports label:clear', async () => {
    const ownedCfg = {
      id: 'cfg_1',
      telegramId: 100,
      panelId: 'legacy',
      serviceId: 1,
      configUsername: 'u100_1',
      userLabel: 'قدیمی',
    };
    const setUserLabel = vi.fn(async (_tid: number, _cid: string, raw: string | null) => ({
      id: 'cfg_1',
      configUsername: 'u100_1',
      userLabel: raw,
    }));

    const services = createMockServices({
      configService: {
        getOwnedConfigById: vi.fn(async () => ownedCfg),
        setUserLabel,
      },
    });

    const harness = createConversationHarness({
      services,
      defaultLocale: 'fa',
      conversations: [['editConfigLabelConversation', editConfigLabelConversation]],
    });
    harness.bot.command('editlabel', async (ctx) => {
      ctx.session.labelConfigId = 'cfg_1';
      await ctx.conversation.enter('editConfigLabelConversation');
    });

    // 1. Save flow with too-long rejection then valid ZWNJ Persian input
    await harness.sendText('/editlabel', { userId: 100 });
    expect(String(harness.callsFor('sendMessage').at(-1)?.payload.text)).toContain(
      'subscription_label_prompt_title'
    );

    await harness.sendText('x'.repeat(41), { userId: 100 });
    expect(String(harness.callsFor('sendMessage').at(-1)?.payload.text)).toContain(
      'subscription_label_too_long'
    );
    expect(setUserLabel).not.toHaveBeenCalled();

    await harness.sendText('  موبایل\u200cمن  ', { userId: 100 });
    expect(setUserLabel).toHaveBeenCalledWith(100, 'cfg_1', 'موبایل\u200cمن', {
      allowAdminOverride: false,
    });
    expect(String(harness.callsFor('sendMessage').at(-1)?.payload.text)).toContain(
      'subscription_label_saved'
    );

    // 2. Clear flow via `label:clear` callback button
    setUserLabel.mockClear();
    await harness.sendText('/editlabel', { userId: 100 });
    await harness.sendCallback('label:clear', { userId: 100 });
    expect(setUserLabel).toHaveBeenCalledWith(100, 'cfg_1', null, {
      allowAdminOverride: false,
    });
    expect(String(harness.callsFor('sendMessage').at(-1)?.payload.text)).toContain(
      'subscription_label_cleared'
    );
  });
});
