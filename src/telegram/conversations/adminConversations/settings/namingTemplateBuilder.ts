import { InlineKeyboard } from 'grammy';
import {
  getDateTokens,
  previewCustomNamingTemplate,
} from '../../../../domain/services/ConfigService.js';
import type { ConversationContext } from '../../../types.js';
import { localizedNumber, t, tm } from '../../../locale.js';
import { sanitizeTelegramInlineCode } from '../../../rendering.js';
import {
  buildAdminScreen,
  buildBreadcrumb,
  type AdminScreenNotice,
  type UserScreenSection,
} from '../../../ui.js';
import { appendAdminFooterNav } from '../../../admin/adminNav.js';
import {
  MAX_NAMING_TEMPLATE_LENGTH,
  validateNamingTemplateDetailed,
  type NamingTemplateValidationResult,
} from './validation.js';

export type NamingTemplateSeparator = '_' | '-' | '.' | '';

export interface NamingTemplateDraft {
  kind: 'naming_tmpl';
  /** Formula currently being composed/edited (empty string after Clear). */
  template: string;
  /** Separator inserted automatically when appending builder tokens. */
  separator: NamingTemplateSeparator;
  /** Preview seed so refresh generates new deterministic samples cleanly. */
  sampleId: number;
  sampleCounter: number;
}

export interface NamingTemplatePreset {
  readonly id: string;
  readonly template: string;
  readonly labelKey: string;
}

export const NAMING_TEMPLATE_PRESETS: readonly NamingTemplatePreset[] = [
  {
    id: 'prefix_tid_rand4',
    template: '{prefix}_{telegram_id}_{random4}',
    labelKey: 'admin_naming_preset_prefix_tid_rand4',
  },
  {
    id: 'prefix_tid_counter',
    template: '{prefix}_{telegram_id}_{counter}',
    labelKey: 'admin_naming_preset_prefix_tid_counter',
  },
  {
    id: 'prefix_rand6',
    template: '{prefix}_{random6}',
    labelKey: 'admin_naming_preset_prefix_rand6',
  },
  {
    id: 'prefix_jalali_counter',
    template: '{prefix}_{jyear}{jmonth}_{counter}',
    labelKey: 'admin_naming_preset_prefix_jalali_counter',
  },
  {
    id: 'prefix_date_counter',
    template: '{prefix}_{date}_{counter}',
    labelKey: 'admin_naming_preset_prefix_date_counter',
  },
  {
    id: 'prefix_counter_rand4',
    template: '{prefix}_{counter}_{random4}',
    labelKey: 'admin_naming_preset_prefix_counter_rand4',
  },
];

export interface NamingBuilderToken {
  readonly id: string;
  readonly token: string;
  readonly labelKey: string;
}

export const NAMING_BUILDER_TOKEN_ROWS: readonly (readonly NamingBuilderToken[])[] = [
  [
    { id: 'prefix', token: '{prefix}', labelKey: 'admin_naming_tb_prefix' },
    { id: 'telegram_id', token: '{telegram_id}', labelKey: 'admin_naming_tb_telegram_id' },
    { id: 'counter', token: '{counter}', labelKey: 'admin_naming_tb_counter' },
  ],
  [
    { id: 'random4', token: '{random4}', labelKey: 'admin_naming_tb_random4' },
    { id: 'random6', token: '{random6}', labelKey: 'admin_naming_tb_random6' },
    { id: 'random8', token: '{random8}', labelKey: 'admin_naming_tb_random8' },
  ],
  [
    { id: 'jyear', token: '{jyear}', labelKey: 'admin_naming_tb_jyear' },
    { id: 'jmonth', token: '{jmonth}', labelKey: 'admin_naming_tb_jmonth' },
    { id: 'jday', token: '{jday}', labelKey: 'admin_naming_tb_jday' },
  ],
  [
    { id: 'year', token: '{year}', labelKey: 'admin_naming_tb_year' },
    { id: 'month', token: '{month}', labelKey: 'admin_naming_tb_month' },
    { id: 'date', token: '{date}', labelKey: 'admin_naming_tb_date' },
  ],
];

const NAMING_BUILDER_TOKENS_BY_ID = new Map<string, NamingBuilderToken>(
  NAMING_BUILDER_TOKEN_ROWS.flat().map((item) => [item.id, item])
);

const SEPARATOR_CYCLE: readonly NamingTemplateSeparator[] = ['_', '-', '.', ''];

export function createNamingTemplateDraft(
  savedTemplate: string,
  sampleId = 6698253699,
  sampleCounter = 1
): NamingTemplateDraft {
  return {
    kind: 'naming_tmpl',
    template: savedTemplate,
    separator: '_',
    sampleId,
    sampleCounter,
  };
}

export function readNamingTemplateDraft(
  rawDraft: Record<string, unknown> | undefined,
  savedTemplate: string
): NamingTemplateDraft {
  if (rawDraft && rawDraft.kind === 'naming_tmpl' && typeof rawDraft.template === 'string') {
    const rawSep = rawDraft.separator;
    const separator: NamingTemplateSeparator =
      rawSep === '_' || rawSep === '-' || rawSep === '.' || rawSep === '' ? rawSep : '_';
    const sampleId =
      typeof rawDraft.sampleId === 'number' && Number.isFinite(rawDraft.sampleId)
        ? rawDraft.sampleId
        : 6698253699;
    const sampleCounter =
      typeof rawDraft.sampleCounter === 'number' && Number.isFinite(rawDraft.sampleCounter)
        ? rawDraft.sampleCounter
        : 1;
    return {
      kind: 'naming_tmpl',
      template: rawDraft.template,
      separator,
      sampleId,
      sampleCounter,
    };
  }
  return createNamingTemplateDraft(savedTemplate);
}

export function resolveBuilderToken(tokenId: string): NamingBuilderToken | undefined {
  return NAMING_BUILDER_TOKENS_BY_ID.get(tokenId);
}

export function nextNamingSeparator(current: NamingTemplateSeparator): NamingTemplateSeparator {
  const index = SEPARATOR_CYCLE.indexOf(current);
  return SEPARATOR_CYCLE[(index + 1) % SEPARATOR_CYCLE.length] ?? '_';
}

export function appendNamingToken(
  currentTemplate: string,
  token: string,
  separator: NamingTemplateSeparator
): { template: string; exceededMaxLength: boolean } {
  const needsSeparator =
    currentTemplate.length > 0 && separator.length > 0 && !/[_.-]$/u.test(currentTemplate);
  const next = `${currentTemplate}${needsSeparator ? separator : ''}${token}`;
  if (next.length > MAX_NAMING_TEMPLATE_LENGTH) {
    return { template: currentTemplate, exceededMaxLength: true };
  }
  return { template: next, exceededMaxLength: false };
}

/**
 * Remove the last `{token}` or literal segment along with any dangling separator
 * immediately before it (e.g. `{prefix}_{jyear}{jmonth}` → `{prefix}_{jyear}`,
 * `{prefix}_{telegram_id}_{random4}` → `{prefix}_{telegram_id}`).
 */
export function popLastNamingSegment(currentTemplate: string): string {
  if (!currentTemplate) return '';

  // If the user ended with trailing separator(s), strip them first.
  const withoutTrailingSep = currentTemplate.replace(/[_.-]+$/u, '');
  if (withoutTrailingSep.length < currentTemplate.length) {
    return withoutTrailingSep;
  }

  // Strip a trailing `{token}` block if present.
  const tokenMatch = /\{[a-z0-9_.-]*\}$/iu.exec(currentTemplate);
  let remaining: string;
  if (tokenMatch) {
    remaining = currentTemplate.slice(0, tokenMatch.index);
  } else {
    // Strip the trailing literal chunk up to the previous separator or closing brace.
    const literalMatch = /[a-z0-9]+$/iu.exec(currentTemplate);
    remaining = literalMatch
      ? currentTemplate.slice(0, literalMatch.index)
      : currentTemplate.slice(0, -1);
  }

  // Remove a single separator immediately preceding the removed segment.
  return remaining.replace(/[_.-]$/u, '');
}

export function formatNamingTemplateValidationError(
  ctx: ConversationContext,
  result: Extract<NamingTemplateValidationResult, { valid: false }>
): string {
  switch (result.reason) {
    case 'empty':
      return t(ctx, 'admin_naming_err_empty');
    case 'too_long':
      return t(ctx, 'admin_naming_err_too_long', {
        max: localizedNumber(MAX_NAMING_TEMPLATE_LENGTH, ctx),
      });
    case 'invalid_chars':
      return t(ctx, 'admin_naming_err_invalid_chars');
    case 'unknown_token':
      return tm(
        ctx,
        'admin_naming_err_unknown_token',
        { code: sanitizeTelegramInlineCode(result.unknownToken ?? '') },
        ['code']
      );
    case 'unbalanced_braces':
      return t(ctx, 'admin_naming_err_unbalanced_braces');
    case 'no_content':
      return t(ctx, 'admin_naming_err_no_content');
  }
}

function formatLtrInlineCode(value: string): string {
  return `\u200e\`${sanitizeTelegramInlineCode(value)}\`\u200e`;
}

export function buildAdvancedNamingTemplateScreen(
  ctx: ConversationContext,
  options: {
    savedTemplate: string;
    draft: NamingTemplateDraft;
    prefix: string;
    notice?: AdminScreenNotice;
    now?: Date;
  }
): string {
  const { savedTemplate, draft, prefix, notice, now = new Date() } = options;
  const isDirty = draft.template !== savedTemplate;
  const hasDraft = draft.template.length > 0;
  const validation = hasDraft ? validateNamingTemplateDetailed(draft.template) : undefined;
  const isDraftValid = Boolean(validation?.valid);
  const previewResult = isDraftValid
    ? previewCustomNamingTemplate(draft.template, prefix, draft.sampleId, draft.sampleCounter, now)
    : undefined;

  const dt = getDateTokens(now);
  const gregorianSample = `${dt.year}/${dt.month}/${dt.day}`;
  const jalaliSample = `${dt.jyear}/${dt.jmonth}/${dt.jday}`;

  const formulaSectionTitle = isDirty
    ? t(ctx, 'admin_naming_draft_label')
    : t(ctx, 'admin_naming_current_formula_label');

  const formulaFields: UserScreenSection['fields'] = [
    {
      bullet: '',
      value: hasDraft
        ? formatLtrInlineCode(draft.template)
        : t(ctx, 'admin_naming_draft_empty_label'),
    },
  ];
  if (previewResult?.autoCounterAppended) {
    formulaFields.push({ bullet: '', value: t(ctx, 'admin_naming_auto_counter_hint') });
  }
  if (previewResult?.truncated) {
    formulaFields.push({ bullet: '', value: t(ctx, 'admin_naming_truncated_hint') });
  }

  const variableFields: UserScreenSection['fields'] = [
    {
      value: `${formatLtrInlineCode('{prefix}')} — ${tm(
        ctx,
        'admin_naming_var_prefix',
        { prefix_value: sanitizeTelegramInlineCode(prefix) },
        ['prefix_value']
      )}`,
    },
    {
      value: `${formatLtrInlineCode('{telegram_id}')} — ${t(ctx, 'admin_naming_var_telegram_id')}`,
    },
    {
      value: `${formatLtrInlineCode('{counter}')} — ${t(ctx, 'admin_naming_var_counter')}`,
    },
    {
      value: `${formatLtrInlineCode('{random4}')} · ${formatLtrInlineCode('{random6}')} · ${formatLtrInlineCode('{random8}')} — ${t(ctx, 'admin_naming_var_random')}`,
    },
    {
      value: `${formatLtrInlineCode('{year}')} · ${formatLtrInlineCode('{yy}')} · ${formatLtrInlineCode('{month}')} · ${formatLtrInlineCode('{day}')} · ${formatLtrInlineCode('{date}')} — ${tm(
        ctx,
        'admin_naming_var_gregorian',
        { date: gregorianSample },
        ['date']
      )}`,
    },
    {
      value: `${formatLtrInlineCode('{jyear}')} · ${formatLtrInlineCode('{jmonth}')} · ${formatLtrInlineCode('{jday}')} — ${tm(
        ctx,
        'admin_naming_var_jalali',
        { date: jalaliSample },
        ['date']
      )}`,
    },
  ];

  return buildAdminScreen({
    emoji: '⚙️',
    title: t(ctx, 'admin_naming_advanced_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_menu_settings'),
      t(ctx, 'admin_cfg_service_button'),
      t(ctx, 'admin_setting_custom_naming_template')
    ),
    notice,
    ...(previewResult
      ? {
          primary: {
            emoji: '✨',
            label: t(ctx, 'admin_naming_preview_label'),
            value: formatLtrInlineCode(previewResult.preview),
            inline: false,
          },
        }
      : {}),
    sections: [
      {
        emoji: isDirty ? '🛠️' : '🧩',
        title: formulaSectionTitle,
        fields: formulaFields,
      },
      {
        emoji: '📘',
        title: t(ctx, 'admin_naming_variables_section'),
        fields: variableFields,
      },
    ],
    footer: t(ctx, 'admin_naming_advanced_cta'),
  });
}

export function buildAdvancedNamingTemplateKeyboard(
  ctx: ConversationContext,
  options: {
    savedTemplate: string;
    draft: NamingTemplateDraft;
    namingMode?: string;
  }
): InlineKeyboard {
  const { savedTemplate, draft, namingMode = 'custom' } = options;
  const isDirty = draft.template !== savedTemplate;
  const canSave =
    (isDirty || namingMode !== 'custom') && validateNamingTemplateDetailed(draft.template).valid;

  const kb = new InlineKeyboard();
  if (canSave) {
    kb.text(t(ctx, 'admin_naming_tb_save'), 'adm:cfg:svc:tb:save').row();
  }

  for (const row of NAMING_BUILDER_TOKEN_ROWS) {
    for (const item of row) {
      kb.text(t(ctx, item.labelKey), `adm:cfg:svc:tb:add:${item.id}`);
    }
    kb.row();
  }

  const sepLabel = draft.separator === '' ? t(ctx, 'admin_naming_tb_sep_none') : draft.separator;
  kb.text(t(ctx, 'admin_naming_tb_sep', { current: sepLabel }), 'adm:cfg:svc:tb:sep')
    .text(t(ctx, 'admin_naming_tb_undo'), 'adm:cfg:svc:tb:undo')
    .text(t(ctx, 'admin_naming_tb_clear'), 'adm:cfg:svc:tb:clear')
    .row();

  kb.text(t(ctx, 'admin_naming_tb_presets'), 'adm:cfg:svc:tpls')
    .text(t(ctx, 'admin_naming_btn_refresh_preview'), 'adm:cfg:svc:tb:ref')
    .row();

  if (isDirty) {
    kb.text(t(ctx, 'admin_naming_tb_reset'), 'adm:cfg:svc:tb:reset').text(
      t(ctx, 'admin_naming_back_to_naming'),
      'adm:cfg:svc'
    );
  } else {
    appendAdminFooterNav(kb, ctx, {
      backCallback: 'adm:cfg:svc',
      backLabel: t(ctx, 'admin_naming_back_to_naming'),
      showHome: true,
    });
  }

  return kb;
}

export function buildNamingPresetsScreen(
  ctx: ConversationContext,
  options: {
    savedTemplate: string;
    prefix: string;
    now?: Date;
  }
): string {
  const { savedTemplate, prefix, now = new Date() } = options;
  const fields: UserScreenSection['fields'] = NAMING_TEMPLATE_PRESETS.map((preset) => {
    const sample = previewCustomNamingTemplate(preset.template, prefix, 6698253699, 1, now).preview;
    const isCurrent = preset.template === savedTemplate;
    return {
      bullet: '',
      value: `${isCurrent ? '✅ ' : '• '}*${t(ctx, preset.labelKey)}*\n\u200e\`${sanitizeTelegramInlineCode(preset.template)}\` → \`${sanitizeTelegramInlineCode(sample)}\`\u200e`,
    };
  });

  return buildAdminScreen({
    emoji: '📋',
    title: t(ctx, 'admin_naming_presets_title'),
    breadcrumb: buildBreadcrumb(
      t(ctx, 'admin_menu_settings'),
      t(ctx, 'admin_cfg_service_button'),
      t(ctx, 'admin_naming_presets_title')
    ),
    subtitle: t(ctx, 'admin_naming_presets_subtitle'),
    sections: [{ fields }],
  });
}

export function buildNamingPresetsKeyboard(
  ctx: ConversationContext,
  savedTemplate: string
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const preset of NAMING_TEMPLATE_PRESETS) {
    const isCurrent = preset.template === savedTemplate;
    kb.text(
      `${isCurrent ? '✅ ' : ''}${t(ctx, preset.labelKey)}`,
      `adm:cfg:svc:tpl:${preset.id}`
    ).row();
  }
  appendAdminFooterNav(kb, ctx, {
    backCallback: 'adm:cfg:svc:tmpl',
    backLabel: t(ctx, 'admin_naming_tb_back_builder'),
    showHome: true,
  });
  return kb;
}
