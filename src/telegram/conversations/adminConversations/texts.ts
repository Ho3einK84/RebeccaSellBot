/** Public surface for the Admin Bot Texts editor. */

export {
  adminEditTextsConversation,
  type EditorState,
  type ListState,
} from './texts/conversation.js';
export {
  alternateLocale,
  classifyTranslationKey,
  ESSENTIAL_USER_TEXTS,
  getEssentialTextItem,
  getSamplePlaceholderValues,
  getTextCategory,
  localeDisplayLabel,
  PLACEHOLDER_DESCRIPTIONS,
  PLACEHOLDER_METADATA,
  TEXT_CATEGORIES,
  type EssentialTextItem,
  type PlaceholderMeta,
  type TextCategory,
  type TextCategoryId,
} from './texts/catalog.js';
export {
  buildCategoryKeyboard,
  buildHubKeyboard,
  buildHubScreen,
  buildKeyDetailKeyboard,
  buildKeyDetailScreen,
  buildKeyListKeyboard,
  buildKeyListScreen,
  decodeTextKeyCallback,
  encodeTextKeyCallback,
  formatKeyListButtonLabels,
  KEYS_PER_PAGE,
  type KeyDetailViewData,
  type KeyListEntry,
  type KeyListScreenSpec,
  type ScreenNotice,
} from './texts/presentation.js';
export {
  composeLivePreviewPayload,
  formatValidationError,
  validateTemplateMarkdown,
} from './texts/actions.js';
