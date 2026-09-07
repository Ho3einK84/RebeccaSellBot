export type SupportedLocale = 'fa' | 'en';

export interface Translations {
  // Common
  loading: string;
  authError: string;
  telegramOnly: string;
  authFailed: string;
  closeWindow: string;
  networkError: string;
  refresh: string;
  cancel: string;
  confirm: string;
  toman: string;
  currency: string;
  language: string;
  switchLang: string;
  close: string;
  copy: string;
  copied: string;
  all: string;
  active: string;
  inactive: string;
  welcome: string;
  invalidAmount: string;
  reasonRequired: string;
  receiptCode: string;
  userCode: string;
  zeroActive: string;
  panelsActiveCount: string;

  // User Coming Soon
  greeting: string;
  telegramId: string;
  portalTitle: string;
  portalDesc: string;
  backToBot: string;
  guestUser: string;
  userPortalBadge: string;
  inDevelopmentStatus: string;
  serviceOnlineStatus: string;
  currentServicesReadyTitle: string;
  currentServicesReadyDesc: string;
  upcomingFeaturesTitle: string;
  featurePurchaseTitle: string;
  featurePurchaseDesc: string;
  featureTrafficTitle: string;
  featureTrafficDesc: string;
  featureConfigsTitle: string;
  featureConfigsDesc: string;
  featureWalletTitle: string;
  featureWalletDesc: string;
  copiedId: string;
  premiumUserBadge: string;
  closeMiniAppHint: string;
  themeToggle: string;
  themeDark: string;
  themeLight: string;

  // Admin Dashboard
  adminTitle: string;
  adminWelcome: string;
  adminRole: string;
  adminExit: string;

  // Tabs
  tabOverview: string;
  tabReceipts: string;
  tabUsers: string;
  tabPanels: string;
  tabComingSoon: string;

  // Overview Stats
  statsLoading: string;
  statPendingReceipts: string;
  statPendingReceiptsSub: string;
  statTotalUsers: string;
  statTotalUsersSub: string;
  statTotalSales: string;
  statTotalSalesSub: string;
  statDailyRevenue: string;
  statDailyRevenueSub: string;
  statWeeklyRevenue: string;
  statWeeklyRevenueSub: string;
  statMonthlyRevenue: string;
  statMonthlyRevenueSub: string;
  statActiveSubs: string;
  statActiveSubsSub: string;
  statInactiveSubs: string;
  statInactiveSubsSub: string;
  statReferralBonus: string;
  statReferralBonusSub: string;
  statCashback: string;
  statCashbackSub: string;
  panelHealthTitle: string;
  panelHealthOk: string;
  panelHealthError: string;
  panelHealthSub: string;

  // Receipts
  receiptsQueueTitle: string;
  receiptsLoading: string;
  receiptsEmpty: string;
  receiptAmount: string;
  receiptUser: string;
  receiptDate: string;
  receiptApprove: string;
  receiptReject: string;
  receiptViewPhoto: string;
  receiptNoPhoto: string;
  receiptPhotoModalTitle: string;
  receiptApproveConfirmTitle: string;
  receiptApproveConfirmBody: string;
  receiptApproveConfirmBtn: string;
  reasonPresetUnclear: string;
  reasonPresetNotReceived: string;
  reasonPresetDuplicate: string;
  reasonPresetMismatch: string;
  reasonPresetOther: string;

  // Users
  usersTitle: string;
  usersSearchPlaceholder: string;
  usersSearchBtn: string;
  usersSearching: string;
  usersNotFound: string;
  usersTotalCount: string;
  paginationPrev: string;
  paginationNext: string;
  paginationPage: string;
  colId: string;
  colUsername: string;
  colName: string;
  colBalance: string;
  colActiveSubs: string;
  colActions: string;
  activeSubsCount: string;
  btnDetails: string;
  btnChangeBalance: string;
  inspectLoading: string;
  userDetailsTitle: string;
  noUsername: string;
  btnCloseReport: string;
  userCurBalance: string;
  userTotalDeposit: string;
  userTotalSpend: string;
  userActiveConfigs: string;
  userApprovedReceipts: string;
  userAuditEvents: string;
  userTabFinances: string;
  userTabOrders: string;
  userTabReceipts: string;
  noOrders: string;
  noReceipts: string;
  orderPackage: string;
  orderAmount: string;
  orderDate: string;
  orderStatus: string;
  balanceCurLabel: string;
  balancePreviewLabel: string;
  quickReasonCard: string;
  quickReasonCompensation: string;
  quickReasonAdjustment: string;

  // Panels
  panelsFleetTitle: string;
  panelsLoading: string;
  panelsEmpty: string;
  panelDefault: string;
  panelActive: string;
  panelInactive: string;
  panelAuthMode: string;
  panelAddress: string;
  panelConnectedServices: string;
  panelDefaultService: string;
  panelTestBtn: string;
  panelTesting: string;
  panelLatency: string;
  panelOnline: string;
  panelOffline: string;
  panelConfigsCount: string;
  panelFleetStatusOk: string;
  panelFleetStatusWarning: string;

  // Coming Soon Modules
  modulesTitle: string;
  modulesDesc: string;
  tagComingSoon: string;
  modBroadcast: string;
  modBroadcastSub: string;
  modPlans: string;
  modPlansSub: string;
  modPromo: string;
  modPromoSub: string;
  modGateways: string;
  modGatewaysSub: string;
  modBackups: string;
  modBackupsSub: string;
  modWheel: string;
  modWheelSub: string;
  modTrial: string;
  modTrialSub: string;

  // Modals
  modalRejectTitle: string;
  modalRejectConfirm: string;
  modalRejectReasonLabel: string;
  modalRejectReasonPlaceholder: string;
  modalRejectSubmit: string;
  modalRejectSubmitting: string;

  modalBalanceTitle: string;
  modalBalanceUser: string;
  modalBalanceOpLabel: string;
  modalBalanceOpAdd: string;
  modalBalanceOpDeduct: string;
  modalBalanceOpSet: string;
  modalBalanceAmountLabel: string;
  modalBalanceAmountPlaceholder: string;
  modalBalanceReasonLabel: string;
  modalBalanceReasonPlaceholder: string;
  modalBalanceSubmit: string;
  modalBalanceSubmitting: string;

  // Notifications
  notifyStatsError: string;
  notifyReceiptsError: string;
  notifyReceiptApproved: string;
  notifyReceiptRejected: string;
  notifyReceiptActionFailed: string;
  notifyUsersError: string;
  notifyUserReportError: string;
  notifyBalanceSuccess: string;
  notifyBalanceFailed: string;
  notifyPanelsError: string;
  notifyPanelTestSuccess: string;
  notifyPanelTestFailed: string;
  notifyNetworkError: string;
  langChangeSuccess: string;
  langChangeFailed: string;
  betaBadge: string;
  betaNotice: string;
}

export type TranslationKey = keyof Translations;

export const translations: Record<SupportedLocale, Translations> = {
  fa: {
    // Common
    loading: 'در حال برقراری ارتباط امن با سرور...',
    authError: 'خطای احراز هویت',
    telegramOnly: 'دسترسی فقط از طریق ربات تلگرام مجاز است.',
    authFailed: 'امکان احراز هویت تلگرام وجود ندارد.',
    closeWindow: 'بستن پنجره',
    networkError: 'خطای ارتباط با سرور',
    refresh: 'به‌روزرسانی',
    cancel: 'انصراف',
    confirm: 'تأیید',
    toman: 'تومان',
    currency: 'تومان',
    language: 'زبان',
    switchLang: 'English',
    close: 'بستن',
    copy: 'کپی',
    copied: 'کپی شد',
    all: 'همه',
    active: 'فعال',
    inactive: 'غیرفعال',
    welcome: 'خوش آمدید،',
    invalidAmount: 'مبلغ نامعتبر است',
    reasonRequired: 'ثبت دلیل الزامی است',
    receiptCode: 'کد رسید:',
    userCode: 'شناسه کاربر:',
    zeroActive: '۰ سرویس فعال',
    panelsActiveCount: '{healthy} از {total} پنل فعال و پاسخگو',

    // User Coming Soon
    greeting: 'سلام، {name}!',
    telegramId: 'شناسه:',
    portalTitle: 'مینی اپ فعلا در دسترس نیست! و به زودی تکمیل می شود...',
    portalDesc:
      'خرید و تمدید اشتراک، مشاهده حجم مصرفی، دریافت کانفیگ و شارژ کیف پول به زودی از طریق مینی اپ در دسترس خواهد بود. در حال حاضر می توانید از دکمه های داخل ربات استفاده نمایید.',
    backToBot: 'بازگشت به ربات',
    guestUser: 'کاربر گرامی',
    userPortalBadge: 'مینی اپ',
    inDevelopmentStatus: 'به زودی',
    serviceOnlineStatus: 'ربات فعال است',
    currentServicesReadyTitle: 'خدمات در ربات فعال است',
    currentServicesReadyDesc:
      'همین حالا می توانید از دکمه های داخل ربات برای خرید، بررسی اشتراک یا شارژ کیف پول استفاده کنید.',
    upcomingFeaturesTitle: 'امکانات مینی اپ',
    featurePurchaseTitle: 'خرید و تمدید اشتراک',
    featurePurchaseDesc: 'خرید آسان سرویس و تمدید سریع بسته ها',
    featureTrafficTitle: 'وضعیت و حجم مصرفی',
    featureTrafficDesc: 'مشاهده حجم باقی مانده و روزهای اشتراک',
    featureConfigsTitle: 'کانفیگ ها و QR Code',
    featureConfigsDesc: 'دریافت آسان لینک های اتصال و اسکن بارکد',
    featureWalletTitle: 'کیف پول و دعوت دوستان',
    featureWalletDesc: 'افزایش موجودی و کسب درآمد از معرفی',
    copiedId: 'کپی شد',
    premiumUserBadge: 'پرمیوم',
    closeMiniAppHint: 'برای بستن، به پایین بکشید',
    themeToggle: 'تغییر پوسته',
    themeDark: 'حالت تاریک',
    themeLight: 'حالت روشن',

    // Admin Dashboard (Aligend with Telegram bot tone and catalog)
    adminTitle: 'مدیریت',
    adminWelcome: 'خوش آمدید، {name} (شناسه: {id}) · مدیر سیستم',
    adminRole: 'مدیر سیستم',
    adminExit: 'خروج از پنل',

    // Tabs
    tabOverview: 'آمار کلی',
    tabReceipts: 'فیش‌های واریزی',
    tabUsers: 'کاربران',
    tabPanels: 'پنل‌ها',
    tabComingSoon: 'ماژول‌ها',

    // Overview Stats
    statsLoading: 'در حال بارگذاری آمار...',
    statPendingReceipts: 'رسیدهای در انتظار بررسی',
    statPendingReceiptsSub: 'نیاز به بررسی و تأیید مدیر',
    statTotalUsers: 'کل کاربران',
    statTotalUsersSub: 'حساب‌های ثبت‌شده در ربات',
    statTotalSales: 'کل فروش',
    statTotalSalesSub: 'مجموع خریدهای موفق کاربران',
    statDailyRevenue: 'درآمد امروز',
    statDailyRevenueSub: 'از ساعت ۰۰:۰۰ بامداد',
    statWeeklyRevenue: 'درآمد این هفته',
    statWeeklyRevenueSub: '۷ روز اخیر',
    statMonthlyRevenue: 'درآمد این ماه',
    statMonthlyRevenueSub: '۳۰ روز اخیر',
    statActiveSubs: 'سرویس‌های فعال',
    statActiveSubsSub: 'کانفیگ‌های دارای اعتبار',
    statInactiveSubs: 'غیرفعال یا منقضی',
    statInactiveSubsSub: 'اتمام زمان یا حجم سرویس',
    statReferralBonus: 'پاداش معرفی پرداخت‌شده',
    statReferralBonusSub: 'پرداخت‌شده به معرف‌ها',
    statCashback: 'کش‌بک پرداخت‌شده',
    statCashbackSub: 'بازگشت نقدی به کیف پول',
    panelHealthTitle: 'وضعیت سلامت پنل‌ها',
    panelHealthOk: 'سالم و در دسترس',
    panelHealthError: 'خطای اتصال',
    panelHealthSub: '{healthy} از {configured} پنل در دسترس',

    // Receipts
    receiptsQueueTitle: 'مدیریت فیش‌های واریزی',
    receiptsLoading: 'در حال دریافت فیش‌ها...',
    receiptsEmpty: 'در حال حاضر هیچ فیش در انتظار بررسی در سیستم وجود ندارد.',
    receiptAmount: 'مبلغ: {amount} تومان',
    receiptUser: 'شناسه مشتری: {id} · کد رسید: {recId}',
    receiptDate: 'زمان ثبت: {date}',
    receiptApprove: 'تأیید و شارژ',
    receiptReject: 'رد رسید',
    receiptViewPhoto: 'مشاهده تصویر فیش',
    receiptNoPhoto: 'فیش فاقد تصویر است',
    receiptPhotoModalTitle: 'تصویر فیش واریزی',
    receiptApproveConfirmTitle: 'تأیید فیش واریزی',
    receiptApproveConfirmBody:
      'آیا از تأیید این فیش به مبلغ {amount} مطمئن هستید؟ مبلغ بلافاصله به کیف پول مشتری واریز می‌شود.',
    receiptApproveConfirmBtn: 'تأیید و واریز به کیف پول',
    reasonPresetUnclear: '📸 تصویر ناخوانا / نامعتبر',
    reasonPresetNotReceived: '💳 عدم واریز به حساب',
    reasonPresetDuplicate: '⚠️ فیش تکراری',
    reasonPresetMismatch: '🔢 عدم تطابق مبلغ',
    reasonPresetOther: '❓ سایر / اطلاعات ناقص',

    // Users
    usersTitle: 'کاربران',
    usersSearchPlaceholder: 'شناسه عددی تلگرام، @نام کاربری یا نام...',
    usersSearchBtn: 'جست‌وجو',
    usersSearching: 'در حال جست‌وجو...',
    usersNotFound: 'کاربری با این مشخصات پیدا نشد.',
    usersTotalCount: 'مجموع {count} کاربر ثبت‌شده',
    paginationPrev: '‹ قبلی',
    paginationNext: 'بعدی ›',
    paginationPage: 'صفحه {page} از {totalPages}',
    colId: 'شناسه تلگرام',
    colUsername: 'نام کاربری',
    colName: 'نام',
    colBalance: 'موجودی',
    colActiveSubs: 'سرویس‌های فعال',
    colActions: 'عملیات',
    activeSubsCount: '{count} سرویس فعال',
    btnDetails: 'پروفایل',
    btnChangeBalance: 'تغییر موجودی',
    inspectLoading: 'در حال دریافت اطلاعات پرونده کاربر...',
    userDetailsTitle: 'پروفایل مشتری: {id} ({username})',
    noUsername: 'بدون نام کاربری',
    btnCloseReport: 'بستن',
    userCurBalance: 'موجودی فعلی کیف پول',
    userTotalDeposit: 'مجموع کل واریزی‌ها',
    userTotalSpend: 'مجموع کل خریدها',
    userActiveConfigs: 'سرویس‌های فعال',
    userApprovedReceipts: 'فیش‌های تأییدشده',
    userAuditEvents: 'رویدادهای ثبت‌شده در لاگ',
    userTabFinances: 'خلاصه مالی و سرویس‌ها',
    userTabOrders: 'سفارش‌های اخیر',
    userTabReceipts: 'فیش‌های واریزی',
    noOrders: 'هیچ سفارشی ثبت نشده است.',
    noReceipts: 'هیچ فیشی یافت نشد.',
    orderPackage: 'سرویس:',
    orderAmount: 'مبلغ:',
    orderDate: 'تاریخ:',
    orderStatus: 'وضعیت:',
    balanceCurLabel: 'موجودی فعلی کیف پول:',
    balancePreviewLabel: 'موجودی جدید پس از اعمال:',
    quickReasonCard: 'واریز کارت به کارت',
    quickReasonCompensation: 'جبران قطعی سرویس',
    quickReasonAdjustment: 'اصلاح موجودی حساب',

    // Panels
    panelsFleetTitle: 'وضعیت ناوگان پنل‌های ربکا',
    panelsLoading: 'در حال دریافت اطلاعات پنل‌ها...',
    panelsEmpty: 'هیچ پنلی ثبت نشده است.',
    panelDefault: 'پیش‌فرض',
    panelActive: 'فعال',
    panelInactive: 'غیرفعال',
    panelAuthMode: 'حالت اتصال:',
    panelAddress: 'آدرس پنل:',
    panelConnectedServices: 'سرویس‌های متصل:',
    panelDefaultService: 'پیش‌فرض',
    panelTestBtn: 'تست اتصال',
    panelTesting: 'در حال تست اتصال...',
    panelLatency: '{ms} میلی‌ثانیه',
    panelOnline: 'سالم و پاسخگو',
    panelOffline: 'آفلاین / عدم پاسخگویی',
    panelConfigsCount: '{count} کانفیگ فعال',
    panelFleetStatusOk: 'تمام پنل‌های متصل در وضعیت سالم و پاسخگو قرار دارند.',
    panelFleetStatusWarning: 'یک یا چند پنل با اختلال در اتصال یا قطعی مواجه هستند.',

    // Coming Soon Modules
    modulesTitle: 'ماژول‌های مدیریتی ربات',
    modulesDesc:
      'این بخش‌ها در هسته اصلی ربات تلگرام فعال هستند و در به‌روزرسانی‌های آتی به پنل وب افزوده خواهند شد:',
    tagComingSoon: 'به زودی',
    modBroadcast: 'ارسال پیام همگانی',
    modBroadcastSub: 'ارسال پیام و اعلان به تمام کاربران ربات',
    modPlans: 'مدیریت تعرفه‌ها و بسته‌ها',
    modPlansSub: 'تعریف، قیمت‌گذاری و ویرایش بسته‌های فروش',
    modPromo: 'کدهای تخفیف و هدیه',
    modPromoSub: 'ساخت و مدیریت کدهای تخفیف و پروموشن',
    modGateways: 'تنظیمات پرداخت و کارت‌ها',
    modGatewaysSub: 'مدیریت شماره کارت‌ها و درگاه‌های پرداخت',
    modBackups: 'بکاپ خودکار و پایگاه داده',
    modBackupsSub: 'پشتیبان‌گیری از دیتابیس و مدیریت فایل‌ها',
    modWheel: 'گردونه شانس و جوایز',
    modWheelSub: 'تنظیمات جوایز، شانس‌ها و کش‌بک گردونه',
    modTrial: 'سرویس تست رایگان',
    modTrialSub: 'مدیریت حجم و مهلت کانفیگ‌های تست',

    // Modals
    modalRejectTitle: 'رد فیش واریزی',
    modalRejectConfirm: 'آیا از رد فیش {id} متعلق به کاربر {userId} اطمینان دارید؟',
    modalRejectReasonLabel: 'علت رد فیش:',
    modalRejectReasonPlaceholder: 'علت یا توضیحات برای مشتری...',
    modalRejectSubmit: 'تأیید رد فیش',
    modalRejectSubmitting: 'در حال ثبت...',

    modalBalanceTitle: 'تغییر موجودی کیف پول',
    modalBalanceUser: 'کاربر: {userId} · موجودی فعلی: {balance} تومان',
    modalBalanceOpLabel: 'نوع تغییر موجودی:',
    modalBalanceOpAdd: 'افزایش موجودی (+)',
    modalBalanceOpDeduct: 'کسر از موجودی (-)',
    modalBalanceOpSet: 'تنظیم دقیق موجودی (=)',
    modalBalanceAmountLabel: 'مبلغ (تومان):',
    modalBalanceAmountPlaceholder: 'مبلغ را به تومان وارد کنید',
    modalBalanceReasonLabel: 'علت تغییر (جهت ثبت در لاگ سیستم):',
    modalBalanceReasonPlaceholder: 'علت تغییر موجودی...',
    modalBalanceSubmit: 'ثبت تغییر موجودی',
    modalBalanceSubmitting: 'در حال اعمال...',

    // Notifications
    notifyStatsError: 'خطا در دریافت آمار سیستم',
    notifyReceiptsError: 'خطا در دریافت لیست فیش‌ها',
    notifyReceiptApproved: 'فیش با موفقیت تأیید شد و کیف پول مشتری شارژ گردید.',
    notifyReceiptRejected: 'فیش با موفقیت رد شد.',
    notifyReceiptActionFailed: 'عملیات روی فیش ناموفق بود.',
    notifyUsersError: 'خطا در دریافت اطلاعات کاربران',
    notifyUserReportError: 'خطا در دریافت پرونده کاربر',
    notifyBalanceSuccess: 'موجودی کاربر با موفقیت تغییر کرد (موجودی جدید: {balance} تومان)',
    notifyBalanceFailed: 'تغییر موجودی انجام نشد.',
    notifyPanelsError: 'خطا در دریافت لیست پنل‌ها',
    notifyPanelTestSuccess: 'اتصال با پنل موفقیت‌آمیز بود (تأخیر: {ms} میلی‌ثانیه)',
    notifyPanelTestFailed: 'خطا در برقراری ارتباط با پنل',
    notifyNetworkError: 'خطای ارتباط با سرور',
    langChangeSuccess: 'زبان با موفقیت تغییر کرد',
    langChangeFailed: 'خطا در تغییر زبان',
    betaBadge: 'نسخه آزمایشی',
    betaNotice: 'این پنل برای مدیریت بهینه، سریع و امن ربات مجهز به daisyUI ۵ طراحی شده است.',
  },
  en: {
    // Common
    loading: 'Connecting securely to server...',
    authError: 'Authentication Error',
    telegramOnly: 'Access is only allowed via Telegram bot.',
    authFailed: 'Unable to authenticate with Telegram.',
    closeWindow: 'Close Window',
    networkError: 'Network error connecting to server',
    refresh: 'Refresh',
    cancel: 'Cancel',
    confirm: 'Confirm',
    toman: 'Toman',
    currency: 'Toman',
    language: 'Language',
    switchLang: 'فارسی',
    close: 'Close',
    copy: 'Copy',
    copied: 'Copied',
    all: 'All',
    active: 'Active',
    inactive: 'Inactive',
    welcome: 'Welcome,',
    invalidAmount: 'Invalid amount',
    reasonRequired: 'Reason is required',
    receiptCode: 'Receipt ID:',
    userCode: 'User ID:',
    zeroActive: '0 active',
    panelsActiveCount: '{healthy} of {total} panels active',

    // User Coming Soon
    greeting: 'Hello, {name}!',
    telegramId: 'ID:',
    portalTitle: 'User Mini App is not available yet and will be ready soon...',
    portalDesc:
      'Buying and renewing plans, checking usage, downloading configs, and topping up your wallet will be available soon. Please use the bot buttons for now.',
    backToBot: 'Back to Bot',
    guestUser: 'Dear User',
    userPortalBadge: 'Mini App',
    inDevelopmentStatus: 'Coming Soon',
    serviceOnlineStatus: 'Bot Online',
    currentServicesReadyTitle: 'All Services Active in Bot',
    currentServicesReadyDesc:
      'You can easily purchase plans, check remaining usage, or top up your wallet using the bot menu buttons.',
    upcomingFeaturesTitle: 'Upcoming Features',
    featurePurchaseTitle: 'Buy & Renew Plans',
    featurePurchaseDesc: 'Instant purchase and renewal with fast checkout',
    featureTrafficTitle: 'Usage & Traffic Status',
    featureTrafficDesc: 'Real-time remaining bandwidth and validity days',
    featureConfigsTitle: 'Configs & QR Codes',
    featureConfigsDesc: 'Quick connection links and QR codes for all clients',
    featureWalletTitle: 'Wallet & Referrals',
    featureWalletDesc: 'Instant balance top-up and invite commissions',
    copiedId: 'Copied',
    premiumUserBadge: 'Premium',
    closeMiniAppHint: 'Swipe down to close',
    themeToggle: 'Toggle Theme',
    themeDark: 'Dark Mode',
    themeLight: 'Light Mode',

    // Admin Dashboard
    adminTitle: 'Management',
    adminWelcome: 'Welcome, {name} (ID: {id}) · System Admin',
    adminRole: 'System Admin',
    adminExit: 'Exit Dashboard',

    // Tabs
    tabOverview: 'Overview',
    tabReceipts: 'Deposit Receipts',
    tabUsers: 'Users',
    tabPanels: 'Panels',
    tabComingSoon: 'Modules',

    // Overview Stats
    statsLoading: 'Loading statistics...',
    statPendingReceipts: 'Pending Receipts',
    statPendingReceiptsSub: 'Requires admin review',
    statTotalUsers: 'Total Users',
    statTotalUsersSub: 'Registered bot accounts',
    statTotalSales: 'Total Sales',
    statTotalSalesSub: 'Cumulative user purchases',
    statDailyRevenue: "Today's Revenue",
    statDailyRevenueSub: 'Since 00:00 today',
    statWeeklyRevenue: 'Weekly Revenue',
    statWeeklyRevenueSub: 'Past 7 days',
    statMonthlyRevenue: 'Monthly Revenue',
    statMonthlyRevenueSub: 'Past 30 days',
    statActiveSubs: 'Active Subscriptions',
    statActiveSubsSub: 'Active valid configs',
    statInactiveSubs: 'Expired / Inactive',
    statInactiveSubsSub: 'Expired duration or data quota',
    statReferralBonus: 'Referral Bonuses',
    statReferralBonusSub: 'Paid to referrers',
    statCashback: 'Cashback Paid',
    statCashbackSub: 'Returned to wallets',
    panelHealthTitle: 'Panels Health',
    panelHealthOk: 'Healthy & Online',
    panelHealthError: 'Connection Error',
    panelHealthSub: '{healthy} of {configured} panels available',

    // Receipts
    receiptsQueueTitle: 'Deposit Receipts Management',
    receiptsLoading: 'Loading deposit receipts...',
    receiptsEmpty: 'No pending receipts in queue.',
    receiptAmount: 'Amount: {amount} Toman',
    receiptUser: 'Customer ID: {id} · Receipt: {recId}',
    receiptDate: 'Date: {date}',
    receiptApprove: 'Approve & Credit',
    receiptReject: 'Reject Receipt',
    receiptViewPhoto: 'View Receipt Image',
    receiptNoPhoto: 'No image file attached',
    receiptPhotoModalTitle: 'Payment Receipt Image',
    receiptApproveConfirmTitle: 'Approve Payment Receipt',
    receiptApproveConfirmBody:
      'Are you sure you want to approve this receipt for {amount} Toman? Customer wallet will be credited immediately.',
    receiptApproveConfirmBtn: 'Approve & Credit Wallet',
    reasonPresetUnclear: '📸 Unreadable / Invalid image',
    reasonPresetNotReceived: '💳 Payment not received in bank',
    reasonPresetDuplicate: '⚠️ Duplicate receipt',
    reasonPresetMismatch: '🔢 Amount mismatch',
    reasonPresetOther: '❓ Other / Incomplete details',

    // Users
    usersTitle: 'Users',
    usersSearchPlaceholder: 'Telegram numeric ID, @username, or name...',
    usersSearchBtn: 'Search',
    usersSearching: 'Searching...',
    usersNotFound: 'No user found matching these details.',
    usersTotalCount: 'Total {count} registered users',
    paginationPrev: '‹ Prev',
    paginationNext: 'Next ›',
    paginationPage: 'Page {page} of {totalPages}',
    colId: 'Telegram ID',
    colUsername: 'Username',
    colName: 'Name',
    colBalance: 'Balance',
    colActiveSubs: 'Active Subs',
    colActions: 'Actions',
    activeSubsCount: '{count} Active Services',
    btnDetails: 'Profile',
    btnChangeBalance: 'Adjust Balance',
    inspectLoading: 'Loading user details...',
    userDetailsTitle: 'Customer Profile: {id} ({username})',
    noUsername: 'No username',
    btnCloseReport: 'Close',
    userCurBalance: 'Current Wallet Balance',
    userTotalDeposit: 'Total Deposits',
    userTotalSpend: 'Total Purchases',
    userActiveConfigs: 'Active Subscriptions',
    userApprovedReceipts: 'Approved Receipts',
    userAuditEvents: 'System Audit Logs',
    userTabFinances: 'Financial & Services Summary',
    userTabOrders: 'Recent Orders',
    userTabReceipts: 'Deposit Receipts',
    noOrders: 'No orders recorded yet.',
    noReceipts: 'No deposit receipts found.',
    orderPackage: 'Service:',
    orderAmount: 'Amount:',
    orderDate: 'Date:',
    orderStatus: 'Status:',
    balanceCurLabel: 'Current Balance:',
    balancePreviewLabel: 'New Balance after adjustment:',
    quickReasonCard: 'Card transfer deposit',
    quickReasonCompensation: 'Service outage compensation',
    quickReasonAdjustment: 'Account balance adjustment',

    // Panels
    panelsFleetTitle: 'Rebecca Panels Fleet Status',
    panelsLoading: 'Loading panels...',
    panelsEmpty: 'No panels registered.',
    panelDefault: 'Default',
    panelActive: 'Active',
    panelInactive: 'Inactive',
    panelAuthMode: 'Auth Mode:',
    panelAddress: 'Panel URL:',
    panelConnectedServices: 'Connected Services:',
    panelDefaultService: 'Default',
    panelTestBtn: 'Test Connection',
    panelTesting: 'Testing connection...',
    panelLatency: '{ms}ms',
    panelOnline: 'Healthy & Responsive',
    panelOffline: 'Offline / Unreachable',
    panelConfigsCount: '{count} active configs',
    panelFleetStatusOk: 'All connected panels are healthy and responsive.',
    panelFleetStatusWarning: 'One or more panels are experiencing connectivity issues.',

    // Coming Soon Modules
    modulesTitle: 'Bot Management Modules',
    modulesDesc:
      'These modules are active in the bot core and will be added to the web panel in future updates:',
    tagComingSoon: 'Coming Soon',
    modBroadcast: 'Broadcast Messaging',
    modBroadcastSub: 'Send messages and announcements to all users',
    modPlans: 'Plans & Pricing',
    modPlansSub: 'Define, price, and update subscription packages',
    modPromo: 'Promo & Gift Codes',
    modPromoSub: 'Create and manage discount codes and gift campaigns',
    modGateways: 'Payment & Cards',
    modGatewaysSub: 'Manage bank card numbers and payment gateways',
    modBackups: 'Automated Backups',
    modBackupsSub: 'Database backups and system audit files',
    modWheel: 'Lucky Wheel & Rewards',
    modWheelSub: 'Configure prize rates, wheel chances, and cashback',
    modTrial: 'Free Trial Service',
    modTrialSub: 'Manage duration and quotas for test subscriptions',

    // Modals
    modalRejectTitle: 'Reject Deposit Receipt',
    modalRejectConfirm: 'Are you sure you want to reject receipt {id} for user {userId}?',
    modalRejectReasonLabel: 'Rejection reason:',
    modalRejectReasonPlaceholder: 'Reason or notes for customer...',
    modalRejectSubmit: 'Confirm Rejection',
    modalRejectSubmitting: 'Processing...',

    modalBalanceTitle: 'Adjust User Wallet Balance',
    modalBalanceUser: 'User: {userId} · Current Balance: {balance} Toman',
    modalBalanceOpLabel: 'Operation Type:',
    modalBalanceOpAdd: 'Add to Balance (+)',
    modalBalanceOpDeduct: 'Deduct from Balance (-)',
    modalBalanceOpSet: 'Set Exact Balance (=)',
    modalBalanceAmountLabel: 'Amount (Toman):',
    modalBalanceAmountPlaceholder: 'Enter amount in Toman',
    modalBalanceReasonLabel: 'Reason (Required for audit log):',
    modalBalanceReasonPlaceholder: 'Reason for balance adjustment...',
    modalBalanceSubmit: 'Apply Balance Change',
    modalBalanceSubmitting: 'Applying...',

    // Notifications
    notifyStatsError: 'Failed to load dashboard statistics',
    notifyReceiptsError: 'Failed to load receipts list',
    notifyReceiptApproved: 'Receipt approved and customer wallet credited successfully.',
    notifyReceiptRejected: 'Receipt rejected successfully.',
    notifyReceiptActionFailed: 'Receipt action failed.',
    notifyUsersError: 'Failed to search users',
    notifyUserReportError: 'Failed to load user report',
    notifyBalanceSuccess: 'User balance updated successfully (New balance: {balance} Toman)',
    notifyBalanceFailed: 'Failed to update balance.',
    notifyPanelsError: 'Failed to load panels list',
    notifyPanelTestSuccess: 'Panel connection test successful (Latency: {ms}ms)',
    notifyPanelTestFailed: 'Failed to reach panel',
    notifyNetworkError: 'Network error connecting to server',
    langChangeSuccess: 'Language updated successfully',
    langChangeFailed: 'Failed to update language',
    betaBadge: 'Beta / Preview',
    betaNotice: 'This dashboard is powered by daisyUI 5 for optimal speed and mobile UX.',
  },
};
