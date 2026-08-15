/** Public surface for the Admin Settings Center. */

export { adminEditSettingsConversation } from './settings/conversation.js';
export {
  SETTING_DEFINITIONS,
  SETTING_GROUPS,
  SETTING_KEYS,
  getSettingDefinition,
  getSettingGroup,
  type SettingDefinition,
  type SettingGroup,
  type SettingGroupId,
  type SettingKey,
} from './settings/catalog.js';
export {
  buildBooleanSettingKeyboard,
  buildCustomNamingTemplatePrompt,
  buildEditorNavigationKeyboard,
  buildSelectionKeyboard,
  buildSettingsGroupKeyboard,
  buildSettingsGroupPrompt,
  buildSettingsInGroupKeyboard,
  displayAdminSettingValue,
  truncateButtonLabel,
  type SelectionItem,
} from './settings/presentation.js';
export {
  buildPackageManagerKeyboard,
  generatePackageId,
  managePackages,
} from './settings/packageManager.js';
export {
  isValidNamingTemplate,
  normalizeSupportDestination,
  settingValidationMessage,
  validateAdminSetting,
} from './settings/validation.js';
