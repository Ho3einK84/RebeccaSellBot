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
  toman: string;
  currency: string;
  language: string;
  switchLang: string;

  // User Coming Soon
  greeting: string;
  telegramId: string;
  portalTitle: string;
  portalDesc: string;
  backToBot: string;
  guestUser: string;

  // Admin Dashboard
  adminTitle: string;
  adminWelcome: string;
  adminRole: string;

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

  // Users
  usersTitle: string;
  usersSearchPlaceholder: string;
  usersSearchBtn: string;
  usersSearching: string;
  usersNotFound: string;
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
    refresh: '🔄 به‌روزرسانی',
    cancel: 'انصراف',
    toman: 'تومان',
    currency: 'تومان',
    language: 'زبان',
    switchLang: 'English',

    // User Coming Soon
    greeting: 'سلام، {name}!',
    telegramId: 'شناسه تلگرام:',
    portalTitle: '🚀 پورتال کاربری به زودی فعال می‌شود',
    portalDesc:
      'امکانات خرید، مدیریت کانفیگ‌ها، کیف پول و پیگیری سفارشات از طریق مینی‌اپ در دست توسعه است. در حال حاضر می‌توانید کلیه خدمات را به راحتی از طریق ربات تلگرام انجام دهید.',
    backToBot: 'بازگشت به ربات تلگرام',
    guestUser: 'کاربر گرامی',

    // Admin Dashboard
    adminTitle: '🛠️ پنل مدیریت RebeccaSellBot',
    adminWelcome: 'خوش آمدید، {name} (شناسه: {id}) · سطح دسترسی: مدیر سیستم',
    adminRole: 'مدیر سیستم',

    // Tabs
    tabOverview: '📊 آمار و وضعیت',
    tabReceipts: '🧾 رسیدهای واریز',
    tabUsers: '👥 مدیریت کاربران',
    tabPanels: '🖥️ وضعیت پنل‌ها',
    tabComingSoon: '🧩 ماژول‌های به زودی',

    // Overview Stats
    statsLoading: 'در حال بارگذاری آمار...',
    statPendingReceipts: '🧾 رسیدهای در انتظار',
    statPendingReceiptsSub: 'نیاز به بررسی مدیر',
    statTotalUsers: '👥 کل کاربران',
    statTotalUsersSub: 'حساب ثبت‌شده در ربات',
    statTotalSales: '💰 کل فروش سیستم',
    statTotalSalesSub: 'مجموع خرید کاربران',
    statDailyRevenue: '📅 درآمد امروز',
    statDailyRevenueSub: 'از ساعت ۰۰:۰۰ امروز',
    statWeeklyRevenue: '🗓️ درآمد این هفته',
    statWeeklyRevenueSub: '۷ روز اخیر',
    statMonthlyRevenue: '📆 درآمد این ماه',
    statMonthlyRevenueSub: '۳۰ روز اخیر',
    statActiveSubs: '🟢 سرویس‌های فعال',
    statActiveSubsSub: 'کانفیگ دارای اعتبار',
    statInactiveSubs: '⚪️ سرویس‌های منقضی/غیرفعال',
    statInactiveSubsSub: 'اتمام حجم یا تاریخ',
    statReferralBonus: '🎁 پاداش‌های ارجاع',
    statReferralBonusSub: 'پرداخت شده به معرف‌ها',
    statCashback: '💸 کش‌بک پرداختی',
    statCashbackSub: 'بازگشت نقدی خریدها',
    panelHealthTitle: '🩺 سلامت پنل‌های ربکا',
    panelHealthOk: '🟢 سالم',
    panelHealthError: '⚠️ خطای پنل',
    panelHealthSub: '{healthy} از {configured} پنل در دسترس',

    // Receipts
    receiptsQueueTitle: '🧾 صف تایید رسیدهای کارت‌به‌کارت',
    receiptsLoading: 'در حال دریافت رسیدها...',
    receiptsEmpty: '📭 هیچ رسیدی در انتظار بررسی وجود ندارد.',
    receiptAmount: 'مبلغ: {amount} تومان',
    receiptUser: 'شناسه کاربر: {id} · کد رسید: {recId}',
    receiptDate: 'تاریخ ثبت: {date}',
    receiptApprove: '✅ تایید و شارژ',
    receiptReject: '❌ رد رسید',

    // Users
    usersTitle: '👥 جستجو و مدیریت کاربران',
    usersSearchPlaceholder: 'جستجو با شناسه تلگرام، نام کاربری، نام، لینک یا نام کانفیگ...',
    usersSearchBtn: '🔍 جستجو',
    usersSearching: 'در حال جستجو...',
    usersNotFound: 'کاربری یافت نشد.',
    colId: 'شناسه',
    colUsername: 'نام کاربری',
    colName: 'نام',
    colBalance: 'موجودی',
    colActiveSubs: 'سرویس فعال',
    colActions: 'عملیات',
    activeSubsCount: '{count} سرویس',
    btnDetails: '📋 جزئیات',
    btnChangeBalance: '💰 تغییر موجودی',
    inspectLoading: 'در حال بارگذاری گزارش کامل کاربر...',
    userDetailsTitle: 'گزارش کامل کاربر: {id} ({username})',
    noUsername: 'بدون یوزرنیم',
    btnCloseReport: 'بستن گزارش',
    userCurBalance: 'موجودی فعلی',
    userTotalDeposit: 'کل واریزها',
    userTotalSpend: 'کل هزینه خرید',
    userActiveConfigs: 'سرویس‌های فعال',
    userApprovedReceipts: 'کل رسیدهای تایید شده',
    userAuditEvents: 'کل رویدادهای لاگ',

    // Panels
    panelsFleetTitle: '🖥️ ناوگان پنل‌های ربکا',
    panelsLoading: 'در حال بارگذاری لیست پنل‌ها...',
    panelsEmpty: 'هیچ پنلی ثبت نشده است.',
    panelDefault: '⭐ پیش‌فرض',
    panelActive: 'فعال',
    panelInactive: 'غیرفعال',
    panelAuthMode: 'حالت احراز:',
    panelAddress: 'آدرس پنل:',
    panelConnectedServices: 'سرویس‌های متصل:',
    panelDefaultService: '· پیش‌فرض',

    // Coming Soon Modules
    modulesTitle: '🧩 ماژول‌های مدیریتی (در دست آماده‌سازی وب)',
    modulesDesc:
      'این سرویس‌ها دارای سرویس‌های فعال دامنه در ربات تلگرام هستند و در فازهای بعدی به مینی‌اپ متصل خواهند شد:',
    tagComingSoon: 'به زودی',
    modBroadcast: 'ارسال همگانی',
    modBroadcastSub: 'ارسال پیام به تمام کاربران (Broadcast)',
    modPlans: 'مدیریت پلن‌ها و قیمت‌گذاری',
    modPlansSub: 'تعریف و ویرایش تعرفه‌ها (Plans & Rates)',
    modPromo: 'کدهای تخفیف',
    modPromoSub: 'مدیریت کدهای تخفیف و پروموشن (Promo Codes)',
    modGateways: 'تنظیمات درگاه و شماره کارت‌ها',
    modGatewaysSub: 'مدیریت روش‌های پرداخت و کارت‌ها (Payment Gateways)',
    modBackups: 'بک‌آپ‌گیری و لاگ سیستم',
    modBackupsSub: 'پشتیبان‌گیری دیتابیس و رویدادها (Backups & Logs)',
    modWheel: 'مدیریت گردونه شانس',
    modWheelSub: 'تنظیمات جوایز و شانس‌ها (Lucky Wheel)',
    modTrial: 'سرویس تست',
    modTrialSub: 'مدیریت کانفیگ‌های تست رایگان (Trial Service)',

    // Modals
    modalRejectTitle: 'رد رسید واریز',
    modalRejectConfirm: 'آیا از رد رسید {id} متعلق به کاربر {userId} اطمینان دارید؟',
    modalRejectReasonLabel: 'دلیل رد رسید (اختیاری):',
    modalRejectReasonPlaceholder: 'مثلاً: تصویر ناخوانا یا واریز نشدن وجه',
    modalRejectSubmit: 'تایید رد رسید',
    modalRejectSubmitting: 'در حال ثبت...',

    modalBalanceTitle: 'تغییر موجودی کاربر',
    modalBalanceUser: 'کاربر: {userId} · موجودی فعلی: {balance} تومان',
    modalBalanceOpLabel: 'نوع عملیات:',
    modalBalanceOpAdd: '➕ افزایش موجودی (Add)',
    modalBalanceOpDeduct: '➖ کاهش موجودی (Deduct)',
    modalBalanceOpSet: '✏️ تنظیم دقیق موجودی (Set)',
    modalBalanceAmountLabel: 'مبلغ (تومان):',
    modalBalanceAmountPlaceholder: 'مبلغ به تومان',
    modalBalanceReasonLabel: 'دلیل تغییر (الزامی برای ثبت در لاگ حسابرسی):',
    modalBalanceReasonPlaceholder: 'مثلاً: جبران خسارت قطعی، شارژ دستی تستی',
    modalBalanceSubmit: 'ثبت تغییر موجودی',
    modalBalanceSubmitting: 'در حال اعمال...',

    // Notifications
    notifyStatsError: 'خطا در بارگذاری آمار داشبورد',
    notifyReceiptsError: 'خطا در دریافت رسیدها',
    notifyReceiptApproved: 'رسید با موفقیت تایید شد و کیف پول کاربر شارژ گردید',
    notifyReceiptRejected: 'رسید با موفقیت رد شد',
    notifyReceiptActionFailed: 'عملیات روی رسید ناموفق بود',
    notifyUsersError: 'خطا در جستجوی کاربران',
    notifyUserReportError: 'خطا در دریافت گزارش کاربر',
    notifyBalanceSuccess: 'موجودی کاربر با موفقیت تغییر کرد (موجودی جدید: {balance} تومان)',
    notifyBalanceFailed: 'تغییر موجودی ناموفق بود',
    notifyPanelsError: 'خطا در دریافت لیست پنل‌ها',
    notifyNetworkError: 'خطا در برقراری ارتباط با سرور',
    langChangeSuccess: 'زبان با موفقیت تغییر کرد',
    langChangeFailed: 'خطا در تغییر زبان',
    betaBadge: 'آزمایشی (Beta)',
    betaNotice: 'این سامانه در نسخه آزمایشی (Beta) قرار دارد و ویژگی‌های آن در حال تکمیل است.',
  },
  en: {
    // Common
    loading: 'Connecting securely to server...',
    authError: 'Authentication Error',
    telegramOnly: 'Access is only allowed via Telegram bot.',
    authFailed: 'Unable to authenticate with Telegram.',
    closeWindow: 'Close Window',
    networkError: 'Network error connecting to server',
    refresh: '🔄 Refresh',
    cancel: 'Cancel',
    toman: 'Toman',
    currency: 'Toman',
    language: 'Language',
    switchLang: 'فارسی',

    // User Coming Soon
    greeting: 'Hello, {name}!',
    telegramId: 'Telegram ID:',
    portalTitle: '🚀 User Portal Coming Soon',
    portalDesc:
      'Features for purchasing, subscription management, wallet top-up, and order tracking via Mini App are under active development. You can currently access all services via the Telegram bot.',
    backToBot: 'Back to Telegram Bot',
    guestUser: 'Dear User',

    // Admin Dashboard
    adminTitle: '🛠️ RebeccaSellBot Admin Dashboard',
    adminWelcome: 'Welcome, {name} (ID: {id}) · Role: System Admin',
    adminRole: 'System Admin',

    // Tabs
    tabOverview: '📊 Stats & Overview',
    tabReceipts: '🧾 Receipts',
    tabUsers: '👥 Users',
    tabPanels: '🖥️ Panels',
    tabComingSoon: '🧩 Coming Soon',

    // Overview Stats
    statsLoading: 'Loading statistics...',
    statPendingReceipts: '🧾 Pending Receipts',
    statPendingReceiptsSub: 'Needs admin review',
    statTotalUsers: '👥 Total Users',
    statTotalUsersSub: 'Registered bot accounts',
    statTotalSales: '💰 Total Sales',
    statTotalSalesSub: 'Cumulative user purchases',
    statDailyRevenue: "📅 Today's Revenue",
    statDailyRevenueSub: 'Since 00:00 today',
    statWeeklyRevenue: '🗓️ Weekly Revenue',
    statWeeklyRevenueSub: 'Past 7 days',
    statMonthlyRevenue: '📆 Monthly Revenue',
    statMonthlyRevenueSub: 'Past 30 days',
    statActiveSubs: '🟢 Active Subscriptions',
    statActiveSubsSub: 'Active valid configs',
    statInactiveSubs: '⚪️ Expired / Inactive',
    statInactiveSubsSub: 'Quota or time expired',
    statReferralBonus: '🎁 Referral Bonuses',
    statReferralBonusSub: 'Paid to referrers',
    statCashback: '💸 Cashback Paid',
    statCashbackSub: 'Purchase cashback rewards',
    panelHealthTitle: '🩺 Rebecca Panels Health',
    panelHealthOk: '🟢 Healthy',
    panelHealthError: '⚠️ Panel Error',
    panelHealthSub: '{healthy} of {configured} panels available',

    // Receipts
    receiptsQueueTitle: '🧾 Deposit Receipts Queue',
    receiptsLoading: 'Loading receipts...',
    receiptsEmpty: '📭 No pending receipts to review.',
    receiptAmount: 'Amount: {amount} Toman',
    receiptUser: 'User ID: {id} · Receipt ID: {recId}',
    receiptDate: 'Date: {date}',
    receiptApprove: '✅ Approve & Credit',
    receiptReject: '❌ Reject Receipt',

    // Users
    usersTitle: '👥 User Management & Search',
    usersSearchPlaceholder: 'Search by Telegram ID, username, name, sub URL or config name...',
    usersSearchBtn: '🔍 Search',
    usersSearching: 'Searching...',
    usersNotFound: 'No users found.',
    colId: 'ID',
    colUsername: 'Username',
    colName: 'Name',
    colBalance: 'Balance',
    colActiveSubs: 'Active Subs',
    colActions: 'Actions',
    activeSubsCount: '{count} Services',
    btnDetails: '📋 Details',
    btnChangeBalance: '💰 Adjust Balance',
    inspectLoading: 'Loading user report...',
    userDetailsTitle: 'User Report: {id} ({username})',
    noUsername: 'No username',
    btnCloseReport: 'Close Report',
    userCurBalance: 'Current Balance',
    userTotalDeposit: 'Total Deposits',
    userTotalSpend: 'Total Spend',
    userActiveConfigs: 'Active Subscriptions',
    userApprovedReceipts: 'Approved Receipts',
    userAuditEvents: 'Audit Log Events',

    // Panels
    panelsFleetTitle: '🖥️ Rebecca Panels Fleet',
    panelsLoading: 'Loading panels list...',
    panelsEmpty: 'No panels registered.',
    panelDefault: '⭐ Default',
    panelActive: 'Active',
    panelInactive: 'Inactive',
    panelAuthMode: 'Auth Mode:',
    panelAddress: 'Panel URL:',
    panelConnectedServices: 'Connected Services:',
    panelDefaultService: '· Default',

    // Coming Soon Modules
    modulesTitle: '🧩 Admin Modules (Web Portal in Progress)',
    modulesDesc:
      'These domain services are active in the bot and will be integrated into the Mini App in upcoming phases:',
    tagComingSoon: 'Coming Soon',
    modBroadcast: 'Broadcast / Mass Messaging',
    modBroadcastSub: 'Send messages to all bot users',
    modPlans: 'Plans & Pricing Management',
    modPlansSub: 'Define and update service plans and rates',
    modPromo: 'Discount & Promo Codes',
    modPromoSub: 'Manage discount codes and promotions',
    modGateways: 'Payment Gateways & Card Config',
    modGatewaysSub: 'Manage card numbers and payment gateways',
    modBackups: 'Backup & System Logs',
    modBackupsSub: 'Database backups and audit event tracking',
    modWheel: 'Lucky Wheel Management',
    modWheelSub: 'Prize rates and wheel chances',
    modTrial: 'Trial Service',
    modTrialSub: 'Manage free trial subscriptions and quotas',

    // Modals
    modalRejectTitle: 'Reject Deposit Receipt',
    modalRejectConfirm: 'Are you sure you want to reject receipt {id} for user {userId}?',
    modalRejectReasonLabel: 'Rejection reason (optional):',
    modalRejectReasonPlaceholder: 'e.g. illegible screenshot or unverified transfer',
    modalRejectSubmit: 'Confirm Rejection',
    modalRejectSubmitting: 'Processing...',

    modalBalanceTitle: 'Adjust User Balance',
    modalBalanceUser: 'User: {userId} · Current Balance: {balance} Toman',
    modalBalanceOpLabel: 'Operation Type:',
    modalBalanceOpAdd: '➕ Add to Balance',
    modalBalanceOpDeduct: '➖ Deduct from Balance',
    modalBalanceOpSet: '✏️ Set Exact Balance',
    modalBalanceAmountLabel: 'Amount (Toman):',
    modalBalanceAmountPlaceholder: 'Amount in Toman',
    modalBalanceReasonLabel: 'Reason (Required for audit log):',
    modalBalanceReasonPlaceholder: 'e.g. compensation, manual adjustment',
    modalBalanceSubmit: 'Apply Balance Change',
    modalBalanceSubmitting: 'Applying...',

    // Notifications
    notifyStatsError: 'Failed to load dashboard statistics',
    notifyReceiptsError: 'Failed to load receipts',
    notifyReceiptApproved: 'Receipt approved successfully and user wallet credited',
    notifyReceiptRejected: 'Receipt rejected successfully',
    notifyReceiptActionFailed: 'Receipt action failed',
    notifyUsersError: 'Failed to search users',
    notifyUserReportError: 'Failed to load user report',
    notifyBalanceSuccess: 'User balance updated successfully (New balance: {balance} Toman)',
    notifyBalanceFailed: 'Failed to update balance',
    notifyPanelsError: 'Failed to load panels list',
    notifyNetworkError: 'Network error connecting to server',
    langChangeSuccess: 'Language updated successfully',
    langChangeFailed: 'Failed to update language',
    betaBadge: 'Beta',
    betaNotice: 'This platform is currently in Beta and features are actively being expanded.',
  },
};
