import { describe, expect, it, vi } from 'vitest';
import { InlineKeyboard } from 'grammy';
import { buildSubscriptionActionKeyboard } from '../../src/telegram/features/subscriptions/routes.js';
import { renderHomeDashboard } from '../../src/telegram/keyboards/mainMenu.js';
import { validateTelegramMarkdown } from '../../src/telegram/rendering.js';
import type { ConversationContext, MenuContext, MyConversation } from '../../src/telegram/types.js';
import {
  USER_DIVIDER,
  backKeyboard,
  buildConfirmationKeyboard,
  buildHeader,
  buildScreen,
  buildSectionCard,
  buildStatusBadge,
  buildUserEmptyState,
  buildUserHeader,
  buildUserPromptScreen,
  buildUserScreen,
  buildUserSection,
  cleanChatUiMiddleware,
  dismissKeyboard,
  ensureEnglishLineDirection,
  ensurePersianLineDirection,
  forgetUiMessage,
  formatRtlLabeledValue,
  forwardConversationNavigation,
  isPersianScreen,
  normalizeInputDigits,
  promptInConversation,
  rememberArtifactMessage,
  rememberUiMessage,
  renderProgressBar,
  renderSleekProgressBar,
  renderUiScreen,
  safelyDeleteMessage,
  waitForCallbackInput,
  waitForPhotoInput,
  waitForTextInput,
} from '../../src/telegram/ui.js';

describe('Design System, Typography & Input Normalization', () => {
  it('renders visual emoji progress bars', () => {
    expect(renderProgressBar(0, 100, { barLength: 8 })).toBe('[⬜️⬜️⬜️⬜️⬜️⬜️⬜️⬜️] 0%');
    expect(renderProgressBar(50, 100, { barLength: 8 })).toBe('[🟩🟩🟩🟩⬜️⬜️⬜️⬜️] 50%');
    expect(renderProgressBar(75, 100, { barLength: 8 })).toBe('[🟨🟨🟨🟨🟨🟨⬜️⬜️] 75%');
    expect(renderProgressBar(90, 100, { barLength: 8 })).toBe('[🟥🟥🟥🟥🟥🟥🟥⬜️] 90%');
    expect(renderProgressBar(100, 100, { barLength: 8 })).toBe('[🟥🟥🟥🟥🟥🟥🟥🟥] 100%');
    expect(renderProgressBar(6, 10, { barLength: 5, theme: 'time' })).toBe('[🟪🟪🟪⬜️⬜️] 60%');
    expect(renderProgressBar(0, 0)).toBe('');
  });

  it('normalizes Persian and Arabic digits and strips separators', () => {
    expect(normalizeInputDigits('۵۰۰۰۰')).toBe('50000');
    expect(normalizeInputDigits('۵۰,۰۰۰')).toBe('50000');
    expect(normalizeInputDigits('۵۰،۰۰۰')).toBe('50000');
    expect(normalizeInputDigits('٥٠٠٠٠')).toBe('50000');
    expect(normalizeInputDigits(' 50 000 ')).toBe('50000');
    expect(normalizeInputDigits(' 50_000 ')).toBe('50000');
    expect(normalizeInputDigits('')).toBe('');
  });

  it('formats RTL labeled values and preserves directionality in Persian and English screens', () => {
    expect(formatRtlLabeledValue('لینک اتصال', 'https://example.com', '🔗')).toBe(
      '🔗 لینک اتصال: https://example.com'
    );
    expect(formatRtlLabeledValue('شناسه', 'abc_123')).toBe('شناسه: abc_123');

    const multiline =
      '👋 به ربات خوش آمدید!\n@username\nhttps://example.com\n🆔 شناسه: 123\nABC_456';
    expect(ensurePersianLineDirection(multiline)).toBe(
      '👋 به ربات خوش آمدید!\n\u200f@username\n\u200fhttps://example.com\n🆔 شناسه: 123\n\u200fABC_456'
    );

    const englishCleaned = ensureEnglishLineDirection(
      '\u200fStatus\n\u200fConnection\nسرور ایران\n🟢 Active'
    );
    expect(englishCleaned).not.toContain('\u200f');
    expect(englishCleaned).toContain('Status');
    expect(englishCleaned).toContain('\u200eسرور ایران');
  });

  it('builds headers without wrapping subtitles containing unescaped or escaped underscores', () => {
    expect(buildHeader('🏠', 'منوی اصلی', 'داشبورد کاربر')).toBe(
      '🏠 *منوی اصلی*\n_داشبورد کاربر_\n'
    );
    const subWithUnderscore = buildHeader('🎁', 'معرفی', 'referral\\_subtitle · فارسی');
    expect(subWithUnderscore).toBe('🎁 *معرفی*\nreferral\\_subtitle · فارسی\n');
    expect(validateTelegramMarkdown(subWithUnderscore).valid).toBe(true);

    expect(buildHeader('🚨', '🚨 Panel Connection Outage')).toBe('🚨 *Panel Connection Outage*\n');
    expect(buildHeader('🚨', '🚨 اختلال در اتصال پنل')).toBe('🚨 *اختلال در اتصال پنل*\n');
    expect(buildHeader('🔒', '🛠️ *Admin*')).toBe('🔒 *Admin*\n');
    expect(buildHeader('⚙️', '⚙️ تنظیمات')).toBe('⚙️ *تنظیمات*\n');
  });

  it('builds status badges, section cards, screens, and direction detection without duplicate emojis', () => {
    const ctx = {
      services: {
        translationService: {
          get: vi.fn(
            (key: string) =>
              ({
                ui_status_active: 'فعال',
                ui_status_inactive: 'غیرفعال',
                ui_status_pending: 'در انتظار',
                ui_status_expired: 'منقضی شده',
              })[key] ?? key
          ),
          resolveLocale: vi.fn(() => 'fa'),
        },
      },
    } as unknown as ConversationContext;

    expect(buildStatusBadge(ctx, 'active')).toBe('🟢 فعال');
    expect(buildStatusBadge(ctx, 'inactive')).toBe('⚪️ غیرفعال');
    expect(buildStatusBadge(ctx, 'pending')).toBe('⏳ در انتظار');
    expect(buildStatusBadge(ctx, 'expired')).toBe('⌛ منقضی شده');

    expect(
      buildSectionCard('اطلاعات سرویس', [
        { label: 'وضعیت', value: 'فعال', emoji: '🟢' },
        { label: 'شناسه', value: 'cfg_101', emoji: '🆔' },
      ])
    ).toBe('📌 *اطلاعات سرویس*\n\n🟢 *وضعیت:* فعال\n🆔 *شناسه:* cfg_101');

    expect(
      buildScreen({
        emoji: '🏠',
        title: 'Home',
        subtitle: 'At a glance',
        primary: { emoji: '👛', label: 'Balance', value: '100 Toman' },
        sections: [
          {
            emoji: '📱',
            title: 'Services',
            fields: [{ emoji: '🟢', label: 'Active', value: '1' }],
          },
        ],
        footer: 'Ready to go.',
      })
    ).toBe(
      '🏠 *Home*\n_At a glance_\n\n👛 *Balance*\n100 Toman\n\n📱 *Services*\n\n🟢 *Active:* 1\n\nReady to go.'
    );

    const noDupPrimary = buildScreen({
      emoji: '🖥️',
      title: 'Panel',
      primary: { emoji: '🟢', label: 'Status', value: '🟢 Active' },
    });
    expect(noDupPrimary).toContain('*Status*\n🟢 Active');
    expect(noDupPrimary).not.toContain('🟢 *Status*\n🟢 Active');
    expect(
      buildSectionCard('Status', [{ label: 'State', value: '🟢 Active', emoji: '🟢' }], '📱')
    ).toBe('📱 *Status*\n\n*State:* 🟢 Active');

    expect(isPersianScreen({ emoji: '🖥️', title: 'جزئیات پنل' })).toBe(true);
    expect(isPersianScreen({ emoji: '🖥️', title: 'Panel Details' })).toBe(false);
    expect(isPersianScreen({ emoji: '🏠', title: 'Home', direction: 'rtl' })).toBe(true);
    expect(isPersianScreen({ emoji: '🏠', title: 'منوی اصلی', direction: 'ltr' })).toBe(false);
  });

  it('keeps English labels LTR and Persian screens RTL', () => {
    const englishPanelScreen = buildScreen({
      emoji: '🖥️',
      title: 'Panel Details',
      subtitle: 'سرور ایران',
      primary: { emoji: '🟢', label: 'Status', value: '🟢 Enabled' },
      sections: [
        {
          emoji: '🔌',
          title: 'Connection',
          fields: [{ emoji: '🌐', label: 'Endpoint', value: 'https://hermes.netiva.pro:8642' }],
        },
      ],
      footer: 'Configure services below.',
    });
    expect(englishPanelScreen).not.toContain('\u200f*Status*');
    expect(englishPanelScreen).not.toContain('\u200f🌐 *Endpoint:*');
    expect(englishPanelScreen).toContain('\u200e_سرور ایران_');

    const persianPromoScreen = buildScreen({
      emoji: '🎟️',
      title: 'جزئیات کد تخفیف',
      subtitle: '`SUMMER2026`',
      primary: { emoji: '🟢', label: 'وضعیت', value: '🟢 فعال' },
      sections: [
        {
          emoji: '⚙️',
          title: 'تنظیمات',
          fields: [
            { emoji: '🏷️', label: 'نوع', value: 'تخفیف درصدی' },
            { emoji: '🔹', label: '[1] xray', value: '(پیش‌فرض)' },
          ],
        },
      ],
    });
    expect(persianPromoScreen).toContain('\u200f_`SUMMER2026`_');
    expect(persianPromoScreen).toContain('\u200f🔹 *[1] xray:* (پیش‌فرض)');
    expect(persianPromoScreen).toContain('\u200f*وضعیت*\n\u200f🟢 فعال');
  });

  it('builds confirmation keyboards for destructive admin actions with cancel callback', () => {
    const ctx = {
      services: {
        translationService: {
          get: vi.fn((key: string) => key),
          resolveLocale: vi.fn(() => 'fa'),
        },
      },
    } as unknown as ConversationContext;

    const confirmKb = buildConfirmationKeyboard(ctx, 'admin:orphans:baseline_confirm');
    expect(confirmKb).toBeInstanceOf(InlineKeyboard);
    const flatData = confirmKb.inline_keyboard
      .flat()
      .map((b) => (b as { callback_data?: string }).callback_data);
    expect(flatData).toContain('admin:orphans:baseline_confirm');
    expect(flatData).toContain('conversation:cancel');
  });
});

describe('Private-chat UI cleanup, message roles & screen rendering', () => {
  it('deletes stale screens/prompts while protecting artifacts created before or during the turn', async () => {
    const deleteMessage = vi.fn().mockResolvedValue(true);
    const session = {
      uiMessageIds: [10, 11],
      promptMessageIds: [12],
      artifactMessageIds: [11],
    };
    const ctx = {
      chat: { id: 123, type: 'private' },
      callbackQuery: { message: { message_id: 10 } },
      session,
      api: { deleteMessage, config: { use: vi.fn() } },
    } as unknown as MenuContext;

    const middleware = cleanChatUiMiddleware() as (
      ctx: MenuContext,
      next: () => Promise<unknown>
    ) => Promise<unknown>;

    await middleware(ctx, async () => {
      rememberUiMessage(ctx.session, 13, 'screen');
    });

    expect(deleteMessage).toHaveBeenCalledWith(123, 10);
    expect(deleteMessage).toHaveBeenCalledWith(123, 12);
    expect(deleteMessage).not.toHaveBeenCalledWith(123, 11);
    expect(ctx.session.uiMessageIds).toEqual([13]);

    // Artifact promoted mid-turn must also survive cleanup
    const promoteSession = {
      uiMessageIds: [20],
      promptMessageIds: [],
      artifactMessageIds: [] as number[],
    };
    const promoteCtx = {
      chat: { id: 123, type: 'private' },
      callbackQuery: { message: { message_id: 20 } },
      session: promoteSession,
      api: { deleteMessage: vi.fn().mockResolvedValue(true), config: { use: vi.fn() } },
    } as unknown as MenuContext;

    await middleware(promoteCtx, async () => {
      rememberArtifactMessage(promoteCtx.session, 20);
      rememberUiMessage(promoteCtx.session, 21, 'screen');
    });
    expect(promoteCtx.session.artifactMessageIds).toContain(20);
    expect(promoteCtx.session.uiMessageIds).toEqual([21]);
  });

  it('keeps ordinary user text, dismisses popovers via ui:dismiss, and keeps roles mutually exclusive', async () => {
    const deleteMessage = vi.fn().mockResolvedValue(true);
    const middleware = cleanChatUiMiddleware() as (
      ctx: MenuContext,
      next: () => Promise<unknown>
    ) => Promise<unknown>;

    const textCtx = {
      chat: { id: 123, type: 'private' },
      message: { message_id: 99, text: 'hello' },
      session: { uiMessageIds: [10] },
      api: { deleteMessage, config: { use: vi.fn() } },
    } as unknown as MenuContext;
    await middleware(textCtx, async () => undefined);
    expect(deleteMessage).toHaveBeenCalledWith(123, 10);
    expect(deleteMessage).not.toHaveBeenCalledWith(123, 99);

    const dismissDelete = vi.fn().mockResolvedValue(true);
    const dismissCtx = {
      chat: { id: 123, type: 'private' },
      callbackQuery: { data: 'ui:dismiss', message: { message_id: 100 } },
      session: { uiMessageIds: [50], artifactMessageIds: [100] },
      api: { deleteMessage: dismissDelete, config: { use: vi.fn() } },
    } as unknown as MenuContext;
    await middleware(dismissCtx, async () => {
      if (await safelyDeleteMessage(dismissCtx, 100)) forgetUiMessage(dismissCtx.session, 100);
    });
    expect(dismissDelete).toHaveBeenCalledWith(123, 100);
    expect(dismissCtx.session.uiMessageIds).toEqual([50]);
    expect(dismissCtx.session.artifactMessageIds).toEqual([]);

    const roleSession = {};
    rememberUiMessage(roleSession, 1, 'screen');
    rememberUiMessage(roleSession, 1, 'prompt');
    expect(roleSession).toEqual({ uiMessageIds: [], promptMessageIds: [1] });
    rememberArtifactMessage(roleSession, 1);
    rememberUiMessage(roleSession, 1, 'screen');
    expect(roleSession).toEqual({
      uiMessageIds: [],
      promptMessageIds: [],
      artifactMessageIds: [1],
    });
  });

  it('keeps transiently undeletable IDs and adopts untracked callback screens edited in place', async () => {
    const middleware = cleanChatUiMiddleware() as (
      ctx: MenuContext,
      next: () => Promise<unknown>
    ) => Promise<unknown>;

    const failCtx = {
      chat: { id: 123, type: 'private' },
      session: { uiMessageIds: [10] },
      api: {
        deleteMessage: vi.fn().mockRejectedValue(new Error('network unavailable')),
        config: { use: vi.fn() },
      },
    } as unknown as MenuContext;
    await middleware(failCtx, async () => undefined);
    expect(failCtx.session.uiMessageIds).toEqual([10]);

    const deleteMsg = vi.fn().mockResolvedValue(true);
    const adoptCtx = {
      chat: { id: 123, type: 'private' },
      callbackQuery: { message: { message_id: 15 } },
      session: {},
      api: { deleteMessage: deleteMsg, config: { use: vi.fn() } },
    } as unknown as MenuContext;
    await middleware(adoptCtx, async () => rememberUiMessage(adoptCtx.session, 15, 'screen'));
    expect(deleteMsg).not.toHaveBeenCalledWith(123, 15);
    expect(adoptCtx.session.uiMessageIds).toEqual([15]);
  });

  it('handles shared renderUiScreen in-place edits, no-op errors, artifact protection, and fallback replies', async () => {
    const unchangedCtx = {
      callbackQuery: { message: { message_id: 15 } },
      session: {},
      editMessageText: vi.fn().mockRejectedValue(new Error('Bad Request: message is not modified')),
      reply: vi.fn(),
    } as unknown as MenuContext;
    await expect(renderUiScreen(unchangedCtx, 'same screen')).resolves.toBe('unchanged');
    expect(unchangedCtx.reply).not.toHaveBeenCalled();

    const artifactCtx = {
      callbackQuery: { message: { message_id: 15 } },
      session: { artifactMessageIds: [15] },
      editMessageText: vi.fn(),
      reply: vi.fn().mockResolvedValue({ message_id: 16 }),
    } as unknown as MenuContext;
    await expect(renderUiScreen(artifactCtx, 'new screen')).resolves.toBe('replied');
    expect(artifactCtx.editMessageText).not.toHaveBeenCalled();
    expect(artifactCtx.session.uiMessageIds).toEqual([16]);

    const fallbackCtx = {
      callbackQuery: { message: { message_id: 15 } },
      session: { uiMessageIds: [15] },
      editMessageText: vi.fn().mockRejectedValue(new Error("Bad Request: message can't be edited")),
      reply: vi.fn().mockResolvedValue({ message_id: 17 }),
    } as unknown as MenuContext;
    await expect(renderUiScreen(fallbackCtx, 'replacement')).resolves.toBe('replied');
    expect(fallbackCtx.session.uiMessageIds).toEqual([17]);
  });
});

describe('Conversation input, escape navigation, and home/subscription UI primitives', () => {
  it('handles cancel button, text deletion on consume, photo document receipts, and invalid callback answers', async () => {
    const answerCallbackQuery = vi.fn().mockResolvedValue(true);
    const reply = vi.fn().mockResolvedValue({ message_id: 20 });
    const cancelInput = {
      from: { id: 123, is_bot: false, first_name: 'Test' },
      callbackQuery: { data: 'conversation:cancel' },
      answerCallbackQuery,
      reply,
      services: {
        translationService: { get: vi.fn((k: string) => k), resolveLocale: vi.fn(() => 'en') },
      },
    } as unknown as ConversationContext;
    const convCancel = {
      wait: vi.fn().mockResolvedValue(cancelInput),
      external: vi.fn(async (task: (ctx: { session: Record<string, unknown> }) => unknown) =>
        task({ session: {} })
      ),
    } as unknown as MyConversation;
    await expect(waitForTextInput(convCancel)).resolves.toBeUndefined();
    expect(reply).toHaveBeenCalledWith('operation_cancelled', expect.any(Object));

    const deleteMessage = vi.fn().mockResolvedValue(true);
    const convText = {
      wait: vi.fn().mockResolvedValue({
        from: { id: 123, is_bot: false, first_name: 'Test' },
        chat: { id: 123, type: 'private' },
        message: { message_id: 77, text: '250000' },
        api: { deleteMessage },
      }),
      external: vi.fn(
        async (
          task: (ctx: { from: { id: number }; session: Record<string, unknown> }) => unknown
        ) => task({ from: { id: 123 }, session: {} })
      ),
    } as unknown as MyConversation;
    await expect(waitForTextInput(convText)).resolves.toBe('250000');
    expect(deleteMessage).toHaveBeenCalledWith(123, 77);

    const convPhoto = {
      wait: vi.fn().mockResolvedValue({
        from: { id: 123, is_bot: false, first_name: 'Test' },
        message: { document: { file_id: 'image-file', mime_type: 'image/png' } },
      }),
      external: vi.fn(
        async (
          task: (ctx: { from: { id: number }; session: Record<string, unknown> }) => unknown
        ) => task({ from: { id: 123 }, session: {} })
      ),
    } as unknown as MyConversation;
    await expect(waitForPhotoInput(convPhoto)).resolves.toBe('image-file');

    const cbAnswer = vi.fn().mockResolvedValue(true);
    const convCb = {
      wait: vi
        .fn()
        .mockResolvedValueOnce({
          from: { id: 123, is_bot: false, first_name: 'Test' },
          callbackQuery: { data: 'other:choice' },
          answerCallbackQuery: cbAnswer,
          services: { translationService: { get: vi.fn((k: string) => k) } },
        })
        .mockResolvedValueOnce({
          from: { id: 123, is_bot: false, first_name: 'Test' },
          callbackQuery: { data: 'valid:choice' },
          answerCallbackQuery: cbAnswer,
        }),
      external: vi.fn(
        async (
          task: (ctx: { from: { id: number }; session: Record<string, unknown> }) => unknown
        ) => task({ from: { id: 123 }, session: {} })
      ),
    } as unknown as MyConversation;
    await expect(waitForCallbackInput(convCb, ['valid:'])).resolves.toBe('valid:choice');
    expect(cbAnswer).toHaveBeenNthCalledWith(1, { text: 'button_action_failed' });
  });

  it('forwards nav:* escape callbacks, builds destination back/dismiss keyboards, and preserves prompt keyboards', async () => {
    const halt = vi.fn().mockResolvedValue(undefined);
    await forwardConversationNavigation(
      { halt } as unknown as MyConversation,
      { callbackQuery: { data: 'nav:admin' } } as unknown as ConversationContext
    );
    expect(halt).toHaveBeenCalledWith({ next: true });

    const noHalt = vi.fn();
    await forwardConversationNavigation(
      { halt: noHalt } as unknown as MyConversation,
      { callbackQuery: { data: 'set-group:pricing' } } as unknown as ConversationContext
    );
    expect(noHalt).not.toHaveBeenCalled();

    const reply = vi.fn().mockResolvedValue({ message_id: 42 });
    const ctx = {
      reply,
      services: {
        translationService: { get: vi.fn((key: string) => key), resolveLocale: vi.fn(() => 'en') },
      },
    } as unknown as ConversationContext;
    const conv = {
      external: vi.fn(async (task: (ctx: { session: Record<string, unknown> }) => unknown) =>
        task({ session: {} })
      ),
    } as unknown as MyConversation;

    expect(backKeyboard(ctx, 'shop').inline_keyboard[0]?.[0]?.text).toBe('menu_back_shop');
    expect(backKeyboard(ctx, 'wallet').inline_keyboard[0]?.[0]?.text).toBe('menu_back_wallet');
    expect(backKeyboard(ctx, 'admin').inline_keyboard[0]?.[0]?.text).toBe(
      'admin_menu_back_to_admin'
    );

    const kb = dismissKeyboard(ctx);
    expect((kb.inline_keyboard.flat()[0] as { callback_data?: string })?.callback_data).toBe(
      'ui:dismiss'
    );

    const customKeyboard = new InlineKeyboard().text('Pricing', 'set-group:pricing');
    await promptInConversation(conv, ctx, 'pick', { reply_markup: customKeyboard });
    expect((reply.mock.calls[0]?.[1] as { reply_markup: InlineKeyboard }).reply_markup).toBe(
      customKeyboard
    );

    await promptInConversation(conv, ctx, 'enter');
    const bareButtons = (
      reply.mock.calls[1]?.[1] as { reply_markup: InlineKeyboard }
    ).reply_markup.inline_keyboard.flat();
    expect((bareButtons[0] as { callback_data?: string })?.callback_data).toBe(
      'conversation:cancel'
    );
  });

  it('renders home dashboard summary and 2-level subscription action hierarchy', async () => {
    const ctx = {
      from: { id: 10 },
      userLocale: 'fa',
      services: {
        walletService: { getBalance: vi.fn().mockResolvedValue(100000) },
        configService: {
          listConfigsForOwner: vi
            .fn()
            .mockResolvedValue([
              { id: 'c1', configUsername: 'user1', panelStatus: 'active', panelExpire: null },
            ]),
        },
        translationService: {
          get: vi.fn((key: string) => key),
          resolveLocale: vi.fn(() => 'fa'),
        },
      },
    } as unknown as MenuContext;

    const dashboard = await renderHomeDashboard(ctx);
    expect(dashboard).toContain('۱۰۰٬۰۰۰');
    expect(dashboard).toContain('۱');

    const compactKb = buildSubscriptionActionKeyboard(ctx, 'c1', 'active', false, false);
    expect((compactKb.inline_keyboard[0]![0] as { callback_data: string }).callback_data).toBe(
      'config:view:c1'
    );

    const detailRows = buildSubscriptionActionKeyboard(
      ctx,
      'c1',
      'active',
      false,
      true
    ).inline_keyboard;
    expect(detailRows).toHaveLength(5);
    expect(
      detailRows.map((row) => row.map((b) => (b as { callback_data?: string }).callback_data))
    ).toEqual([
      ['renew:open:c1', 'config:qr:c1'],
      ['config:refresh:c1', 'autorenew:on:c1'],
      ['config:set:off:c1', 'config:revoke_prompt:c1'],
      ['config:transfer:c1', 'config:delete_prompt:c1'],
      ['subs:page:1'],
    ]);
  });

  it('builds unified sleek user-facing screens, dividers, empty states, prompts, and progress bars without emoji duplication', () => {
    expect(renderSleekProgressBar(50, 100, { barLength: 8, locale: 'en' })).toBe(
      '🟩🟩🟩🟩⬜️⬜️⬜️⬜️ · 50%'
    );
    expect(renderSleekProgressBar(3, 6, { barLength: 4, theme: 'time', locale: 'fa' })).toBe(
      '🟪🟪⬜️⬜️ · ۵۰٪'
    );
    expect(renderSleekProgressBar(0, 0)).toBe('');

    const faHeader = buildUserHeader('🏠', 'نمای کلی حساب', 'وضعیت اعتبار و سرویس‌ها');
    expect(faHeader).toBe(`🏠 *نمای کلی حساب*\nوضعیت اعتبار و سرویس‌ها\n${USER_DIVIDER}`);
    expect(validateTelegramMarkdown(faHeader).valid).toBe(true);

    const underscoreHeader = buildUserHeader('🔑', 'تمدید', 'my\\_config\\_01');
    expect(underscoreHeader).toBe(`🔑 *تمدید*\nmy\\_config\\_01\n${USER_DIVIDER}`);
    expect(validateTelegramMarkdown(underscoreHeader).valid).toBe(true);

    expect(
      buildUserSection({
        title: 'جزئیات سفارش',
        fields: [
          { label: 'حجم', value: '۵۰ گیگابایت' },
          { label: 'وضعیت', value: '🟢 فعال', emoji: '🟢' },
        ],
      })
    ).toBe('*جزئیات سفارش*\n• *حجم:* ۵۰ گیگابایت\n*وضعیت:* 🟢 فعال');

    const userScreen = buildUserScreen({
      emoji: '🧾',
      title: 'Order Summary',
      subtitle: 'Review details before confirming',
      primary: {
        label: 'Total Payable',
        value: '120,000 Toman',
        emphasizeValue: true,
      },
      sections: [
        {
          fields: [
            { label: 'Service', value: '`usr_01`' },
            { label: 'Data', value: '50 GB' },
          ],
        },
      ],
      footer: 'Instant delivery after confirmation.',
    });
    expect(userScreen).toContain(USER_DIVIDER);
    expect(userScreen).toContain('*Total Payable*\n*120,000 Toman*');
    expect(userScreen).toContain('• *Service:* `usr_01`');
    expect(userScreen).toContain(`${USER_DIVIDER}\nInstant delivery after confirmation.`);
    expect(validateTelegramMarkdown(userScreen).valid).toBe(true);

    const empty = buildUserEmptyState(
      '⚠️',
      'انتقال موجودی',
      '⚠️ موجودی قابل انتقال کافی نیست.',
      'ابتدا کیف پول خود را شارژ کنید.'
    );
    expect(empty).toContain('⚠️ *انتقال موجودی*');
    expect(empty).not.toContain('⚠️ موجودی قابل انتقال');
    expect(empty).toContain('موجودی قابل انتقال کافی نیست.');
    expect(validateTelegramMarkdown(empty).valid).toBe(true);

    const prompt = buildUserPromptScreen(
      '🎟️',
      'کد تخفیف',
      'کد تخفیف را وارد کنید.',
      'اعمال کد روی خرید'
    );
    expect(prompt).toContain(`\u200f🎟️ *کد تخفیف*\n\u200fاعمال کد روی خرید\n\u200f${USER_DIVIDER}`);
    expect(prompt).toContain('کد تخفیف را وارد کنید.');
    expect(validateTelegramMarkdown(prompt).valid).toBe(true);

    const faDashboardScreen = buildUserScreen({
      emoji: '🏠',
      title: 'نمای کلی حساب',
      subtitle: 'وضعیت اعتبار و سرویس‌ها',
      primary: { label: 'موجودی کیف پول', value: '۱۰۰٬۰۰۰ تومان', emphasizeValue: true },
      sections: [
        {
          title: 'وضعیت سرویس‌ها',
          fields: [{ emoji: '🟢', label: 'سرویس‌های فعال', value: '🟢 ۱ سرویس' }],
        },
      ],
      footer: 'آمادهٔ استفاده',
    });
    expect(faDashboardScreen).toContain('*سرویس‌های فعال:* 🟢 ۱ سرویس');
    expect(faDashboardScreen).not.toContain('🟢 *سرویس‌های فعال:*');
    expect(validateTelegramMarkdown(faDashboardScreen).valid).toBe(true);
    expect(
      isPersianScreen({
        emoji: '🧾',
        title: 'سفارش',
        sections: [{ fields: [{ label: 'مبلغ', value: '۱۰٬۰۰۰' }] }],
      })
    ).toBe(true);
  });
});
