export const SETTING_KEYS = [
  'bot_enabled',
  'language_selection_enabled',
  'default_locale',
  'packages_json',
  'low_traffic_threshold_gb',
  'expiry_warning_days',
  'refund_window_hours',
  'custom_volume_enabled',
  'price_per_gb',
  'custom_default_days',
  'card_number',
  'card_holder',
  'wallet_transfer_enabled',
  'wallet_transfer_min_amount',
  'support_destination',
  'support_enabled',
  'trial_enabled',
  'trial_gb',
  'trial_days',
  'referral_bonus_toman',
  'cashback_percent',
  'naming_mode',
  'naming_prefix',
  'custom_naming_template',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];
export type SettingGroupId =
  'system' | 'pricing' | 'custom_volume' | 'payment' | 'support' | 'trial' | 'referral' | 'naming';

export type SettingEditor =
  | { type: 'packages' }
  | { type: 'boolean' }
  | { type: 'locale' }
  | { type: 'integer'; minimum: number; maximum: number }
  | { type: 'decimal'; minimum: number; maximum: number }
  | { type: 'card_number' }
  | { type: 'text'; minimumLength: number; maximumLength: number }
  | { type: 'support' }
  | { type: 'naming_mode' }
  | { type: 'naming_prefix' }
  | { type: 'naming_template' };

export type SettingDefinition = {
  key: SettingKey;
  group: SettingGroupId;
  labelKey: string;
  editor: SettingEditor;
};

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  {
    key: 'bot_enabled',
    group: 'system',
    labelKey: 'admin_setting_bot_enabled',
    editor: { type: 'boolean' },
  },
  {
    key: 'language_selection_enabled',
    group: 'system',
    labelKey: 'admin_setting_language_selection_enabled',
    editor: { type: 'boolean' },
  },
  {
    key: 'default_locale',
    group: 'system',
    labelKey: 'admin_setting_default_locale',
    editor: { type: 'locale' },
  },
  {
    key: 'packages_json',
    group: 'pricing',
    labelKey: 'admin_setting_packages_json',
    editor: { type: 'packages' },
  },
  {
    key: 'low_traffic_threshold_gb',
    group: 'pricing',
    labelKey: 'admin_setting_low_traffic_threshold_gb',
    editor: { type: 'decimal', minimum: 0, maximum: 100_000 },
  },
  {
    key: 'expiry_warning_days',
    group: 'pricing',
    labelKey: 'admin_setting_expiry_warning_days',
    editor: { type: 'integer', minimum: 0, maximum: 3_650 },
  },
  {
    key: 'refund_window_hours',
    group: 'pricing',
    labelKey: 'admin_setting_refund_window_hours',
    editor: { type: 'integer', minimum: 0, maximum: 8_760 },
  },
  {
    key: 'custom_volume_enabled',
    group: 'custom_volume',
    labelKey: 'admin_setting_custom_volume_enabled',
    editor: { type: 'boolean' },
  },
  {
    key: 'price_per_gb',
    group: 'custom_volume',
    labelKey: 'admin_setting_price_per_gb',
    editor: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
  },
  {
    key: 'custom_default_days',
    group: 'custom_volume',
    labelKey: 'admin_setting_custom_default_days',
    editor: { type: 'integer', minimum: 1, maximum: 3_650 },
  },
  {
    key: 'card_number',
    group: 'payment',
    labelKey: 'admin_setting_card_number',
    editor: { type: 'card_number' },
  },
  {
    key: 'card_holder',
    group: 'payment',
    labelKey: 'admin_setting_card_holder',
    editor: { type: 'text', minimumLength: 1, maximumLength: 120 },
  },
  {
    key: 'wallet_transfer_enabled',
    group: 'payment',
    labelKey: 'admin_setting_wallet_transfer_enabled',
    editor: { type: 'boolean' },
  },
  {
    key: 'wallet_transfer_min_amount',
    group: 'payment',
    labelKey: 'admin_setting_wallet_transfer_min_amount',
    editor: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
  },
  {
    key: 'support_destination',
    group: 'support',
    labelKey: 'admin_setting_support_destination',
    editor: { type: 'support' },
  },
  {
    key: 'support_enabled',
    group: 'support',
    labelKey: 'admin_setting_support_enabled',
    editor: { type: 'boolean' },
  },
  {
    key: 'trial_enabled',
    group: 'trial',
    labelKey: 'admin_setting_trial_enabled',
    editor: { type: 'boolean' },
  },
  {
    key: 'trial_gb',
    group: 'trial',
    labelKey: 'admin_setting_trial_gb',
    editor: { type: 'integer', minimum: 1, maximum: 10_000 },
  },
  {
    key: 'trial_days',
    group: 'trial',
    labelKey: 'admin_setting_trial_days',
    editor: { type: 'integer', minimum: 1, maximum: 3_650 },
  },
  {
    key: 'referral_bonus_toman',
    group: 'referral',
    labelKey: 'admin_setting_referral_bonus_toman',
    editor: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  },
  {
    key: 'cashback_percent',
    group: 'referral',
    labelKey: 'admin_setting_cashback_percent',
    editor: { type: 'integer', minimum: 0, maximum: 100 },
  },
  {
    key: 'naming_mode',
    group: 'naming',
    labelKey: 'admin_setting_naming_mode',
    editor: { type: 'naming_mode' },
  },
  {
    key: 'naming_prefix',
    group: 'naming',
    labelKey: 'admin_setting_naming_prefix',
    editor: { type: 'naming_prefix' },
  },
  {
    key: 'custom_naming_template',
    group: 'naming',
    labelKey: 'admin_setting_custom_naming_template',
    editor: { type: 'naming_template' },
  },
];

export type SettingGroup = {
  id: SettingGroupId;
  labelKey: string;
  descriptionKey: string;
  settings: readonly SettingKey[];
};

export const SETTING_GROUPS: readonly SettingGroup[] = [
  settingGroup('system', 'admin_setting_group_system', 'admin_setting_group_system_desc'),
  settingGroup('pricing', 'admin_setting_group_pricing', 'admin_setting_group_pricing_desc'),
  settingGroup(
    'custom_volume',
    'admin_setting_group_custom_volume',
    'admin_setting_group_custom_volume_desc'
  ),
  settingGroup('payment', 'admin_setting_group_payment', 'admin_setting_group_payment_desc'),
  settingGroup('support', 'admin_setting_group_support', 'admin_setting_group_support_desc'),
  settingGroup('trial', 'admin_setting_group_trial', 'admin_setting_group_trial_desc'),
  settingGroup('referral', 'admin_setting_group_referral', 'admin_setting_group_referral_desc'),
  settingGroup('naming', 'admin_setting_group_naming', 'admin_setting_group_naming_desc'),
];

export const SETTING_LABELS: Readonly<Record<SettingKey, string>> = Object.fromEntries(
  SETTING_DEFINITIONS.map((definition) => [definition.key, definition.labelKey])
) as Record<SettingKey, string>;

export function getSettingDefinition(key: string): SettingDefinition | undefined {
  return SETTING_DEFINITIONS.find((definition) => definition.key === key);
}

export function getSettingGroup(id: string): SettingGroup | undefined {
  return SETTING_GROUPS.find((group) => group.id === id);
}

export function isSecretSetting(key: string): boolean {
  return /(?:api[_-]?key|token|password|secret)/iu.test(key);
}

export function isNamingSetting(key: SettingKey): boolean {
  return key === 'naming_mode' || key === 'naming_prefix' || key === 'custom_naming_template';
}

function settingGroup(id: SettingGroupId, labelKey: string, descriptionKey: string): SettingGroup {
  return {
    id,
    labelKey,
    descriptionKey,
    settings: SETTING_DEFINITIONS.filter((definition) => definition.group === id).map(
      (definition) => definition.key
    ),
  };
}
