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

    // User Coming Soon
    greeting: 'سلام، {name}!',
    telegramId: 'شناسه تلگرام:',
    portalTitle: 'پورتال کاربری به زودی فعال می‌شود',
    portalDesc:
      'امکانات خرید، مدیریت کانفیگ‌ها، کیف پول و پیگیری سفارشات از طریق مینی‌اپ در دست توسعه است. در حال حاضر می‌توانید کلیه خدمات را به راحتی از طریق ربات تلگرام انجام دهید.',
    backToBot: 'بازگشت به ربات تلگرام',
    guestUser: 'کاربر گرامی',

    // Admin Dashboard
    adminTitle: 'پنل مدیریت RebeccaSellBot',
    adminWelcome: 'خوش آمدید، {name} (شناسه: {id}) · سطح دسترسی: مدیر سیستم',
    adminRole: 'مدیر سیستم',

    // Tabs
    tabOverview: 'آمار و وضعیت',
    tabReceipts: 'رسیدهای واریز',
    tabUsers: 'مدیریت کاربران',
    tabPanels: 'وضعیت پنل‌ها',
    tabComingSoon: 'سایر ماژول‌ها',

    // Overview Stats
    statsLoading: 'در حال بارگذاری آمار...',
    statPendingReceipts: 'رسیدهای در انتظار',
    statPendingReceiptsSub: 'نیاز به بررسی مدیر',
    statTotalUsers: 'کل کاربران',
    statTotalUsersSub: 'حساب ثبت‌شده در ربات',
    statTotalSales: 'کل فروش سیستم',
    statTotalSalesSub: 'مجموع خرید کاربران',
    statDailyRevenue: 'درآمد امروز',
    statDailyRevenueSub: 'از ساعت ۰۰:۰۰ امروز',
    statWeeklyRevenue: 'درآمد این هفته',
    statWeeklyRevenueSub: '۷ روز اخیر',
    statMonthlyRevenue: 'درآمد این ماه',
    statMonthlyRevenueSub: '۳۰ روز اخیر',
    statActiveSubs: 'سرویس‌های فعال',
    statActiveSubsSub: 'کانفیگ دارای اعتبار',
    statInactiveSubs: 'سرویس‌های منقضی/غیرفعال',
    statInactiveSubsSub: 'اتمام حجم یا تاریخ',
    statReferralBonus: 'پاداش‌های ارجاع',
    statReferralBonusSub: 'پرداخت شده به معرف‌ها',
    statCashback: 'کش‌بک پرداختی',
    statCashbackSub: 'بازگشت نقدی خریدها',
    panelHealthTitle: 'سلامت پنل‌های ربکا',
    panelHealthOk: 'سالم',
    panelHealthError: 'خطای پنل',
    panelHealthSub: '{healthy} از {configured} پنل در دسترس',

    // Receipts
    receiptsQueueTitle: 'صف تایید رسیدهای کارت‌به‌کارت',
    receiptsLoading: 'در حال دریافت رسیدها...',
    receiptsEmpty: 'هیچ رسیدی در انتظار بررسی وجود ندارد.',
    receiptAmount: 'مبلغ: {amount} تومان',
    receiptUser: 'شناسه کاربر: {id} · کد رسید: {recId}',
    receiptDate: 'تاریخ ثبت: {date}',
    receiptApprove: 'تایید و شارژ',
    receiptReject: 'رد رسید',
    receiptViewPhoto: 'مشاهده تصویر رسید',
    receiptNoPhoto: 'رسید فاقد فایل تصویر است',
    receiptPhotoModalTitle: 'تصویر رسید پرداخت',
    receiptApproveConfirmTitle: 'تأیید رسید پرداخت',
    receiptApproveConfirmBody:
      'آیا از تأیید این رسید به مبلغ {amount} مطمئن هستید؟ موجودی کاربر فوراً شارژ خواهد شد.',
    receiptApproveConfirmBtn: 'بله، شارژ شود',
    reasonPresetUnclear: 'رسید ناخوانا یا مخدوش است',
    reasonPresetNotReceived: 'مبلغ به حساب واریز نشده است',
    reasonPresetDuplicate: 'رسید تکراری است',
    reasonPresetMismatch: 'مغایرت در مبلغ واریزی',
    reasonPresetOther: 'سایر دلایل (یادداشت دستی)',

    // Users
    usersTitle: 'جستجو و مدیریت کاربران',
    usersSearchPlaceholder: 'جستجو با شناسه تلگرام، نام کاربری یا نام...',
    usersSearchBtn: 'جستجو',
    usersSearching: 'در حال جستجو...',
    usersNotFound: 'کاربری یافت نشد.',
    usersTotalCount: 'مجموع {count} کاربر ثبت‌شده',
    paginationPrev: 'قبلی',
    paginationNext: 'بعدی',
    paginationPage: 'صفحه {page} از {totalPages}',
    colId: 'شناسه',
    colUsername: 'نام کاربری',
    colName: 'نام',
    colBalance: 'موجودی',
    colActiveSubs: 'سرویس فعال',
    colActions: 'عملیات',
    activeSubsCount: '{count} سرویس',
    btnDetails: 'جزئیات',
    btnChangeBalance: 'تغییر موجودی',
    inspectLoading: 'در حال بارگذاری اطلاعات کامل کاربر...',
    userDetailsTitle: 'پرونده کاربر: {id} ({username})',
    noUsername: 'بدون یوزرنیم',
    btnCloseReport: 'بستن پرونده',
    userCurBalance: 'موجودی فعلی',
    userTotalDeposit: 'کل واریزها',
    userTotalSpend: 'کل هزینه خرید',
    userActiveConfigs: 'سرویس‌های فعال',
    userApprovedReceipts: 'رسیدهای تایید شده',
    userAuditEvents: 'رویدادهای لاگ',
    userTabFinances: 'خلاصه مالی و سرویس‌ها',
    userTabOrders: 'سفارش‌های اخیر',
    userTabReceipts: 'رسیدهای پرداخت',
    noOrders: 'هیچ سفارشی ثبت نشده است.',
    noReceipts: 'هیچ رسیدی یافت نشد.',
    orderPackage: 'پکیج:',
    orderAmount: 'مبلغ:',
    orderDate: 'تاریخ:',
    orderStatus: 'وضعیت:',
    balanceCurLabel: 'موجودی فعلی کاربر:',
    balancePreviewLabel: 'موجودی نهایی پس از اعمال:',
    quickReasonCard: 'واریز کارت به کارت',
    quickReasonCompensation: 'جبران قطعی سرویس',
    quickReasonAdjustment: 'اصلاح شارژ حساب',

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
    panelTesting: 'در حال پینگ...',
    panelLatency: '{ms} میلی‌ثانیه',
    panelOnline: 'آنلاین و پاسخگو',
    panelOffline: 'آفلاین / عدم پاسخگویی',
    panelConfigsCount: '{count} کانفیگ فعال',
    panelFleetStatusOk: 'تمام پنل‌های متصل در وضعیت آنلاین و سالم قرار دارند',
    panelFleetStatusWarning: 'یک یا چند پنل با اختلال در اتصال یا قطعی مواجه هستند',

    // Coming Soon Modules
    modulesTitle: 'ماژول‌های مدیریتی (در دست توسعه وب)',
    modulesDesc:
      'این سرویس‌ها در هسته ربات تلگرام فعال هستند و در نسخه‌های آتی مستقیماً به پنل وب‌اپ افزوده خواهند شد:',
    tagComingSoon: 'به زودی',
    modBroadcast: 'ارسال همگانی',
    modBroadcastSub: 'ارسال پیام و اعلان به تمام کاربران',
    modPlans: 'مدیریت تعرفه‌ها',
    modPlansSub: 'تعریف، قیمت‌گذاری و ویرایش پلن‌ها',
    modPromo: 'کدهای تخفیف',
    modPromoSub: 'ساخت و مدیریت کدهای تخفیف و پروموشن',
    modGateways: 'تنظیمات درگاه و کارت',
    modGatewaysSub: 'مدیریت شماره کارت‌ها و درگاه‌های پرداخت',
    modBackups: 'پشتیبان‌گیری و امنیت',
    modBackupsSub: 'بک‌آپ‌گیری دیتابیس و مدیریت فایل‌ها',
    modWheel: 'گردونه شانس',
    modWheelSub: 'تنظیمات جوایز، شانس‌ها و کش‌بک گردونه',
    modTrial: 'سرویس تست رایگان',
    modTrialSub: 'مدیریت حجم و مهلت کانفیگ‌های تست',

    // Modals
    modalRejectTitle: 'رد رسید واریز',
    modalRejectConfirm: 'آیا از رد رسید {id} متعلق به کاربر {userId} اطمینان دارید؟',
    modalRejectReasonLabel: 'دلیل رد رسید:',
    modalRejectReasonPlaceholder: 'توضیحات تکمیلی برای کاربر...',
    modalRejectSubmit: 'تایید رد رسید',
    modalRejectSubmitting: 'در حال ثبت...',

    modalBalanceTitle: 'تغییر موجودی کیف پول کاربر',
    modalBalanceUser: 'کاربر: {userId} · موجودی فعلی: {balance} تومان',
    modalBalanceOpLabel: 'نوع عملیات:',
    modalBalanceOpAdd: 'افزایش موجودی (+)',
    modalBalanceOpDeduct: 'کاهش موجودی (-)',
    modalBalanceOpSet: 'تنظیم دقیق مقدار (=)',
    modalBalanceAmountLabel: 'مبلغ (تومان):',
    modalBalanceAmountPlaceholder: 'مبلغ به تومان وارد کنید',
    modalBalanceReasonLabel: 'دلیل تغییر (الزامی برای لاگ سیستم):',
    modalBalanceReasonPlaceholder: 'دلیل تغییر موجودی...',
    modalBalanceSubmit: 'ثبت تغییر موجودی',
    modalBalanceSubmitting: 'در حال اعمال...',

    // Notifications
    notifyStatsError: 'خطا در دریافت آمار سیستم',
    notifyReceiptsError: 'خطا در دریافت لیست رسیدها',
    notifyReceiptApproved: 'رسید با موفقیت تایید و حساب کاربر شارژ شد',
    notifyReceiptRejected: 'رسید با موفقیت رد شد',
    notifyReceiptActionFailed: 'عملیات روی رسید ناموفق بود',
    notifyUsersError: 'خطا در دریافت اطلاعات کاربران',
    notifyUserReportError: 'خطا در دریافت گزارش کاربر',
    notifyBalanceSuccess: 'موجودی کاربر با موفقیت تغییر کرد (موجودی جدید: {balance} تومان)',
    notifyBalanceFailed: 'تغییر موجودی ناموفق بود',
    notifyPanelsError: 'خطا در دریافت لیست پنل‌ها',
    notifyPanelTestSuccess: 'ارتباط با پنل موفقیت‌آمیز بود (تاخیر: {ms}ms)',
    notifyPanelTestFailed: 'خطا در برقراری ارتباط با پنل',
    notifyNetworkError: 'خطا در برقراری ارتباط با سرور',
    langChangeSuccess: 'زبان با موفقیت تغییر کرد',
    langChangeFailed: 'خطا در تغییر زبان',
    betaBadge: 'نسخه ۲.۰',
    betaNotice: 'این پنل برای مدیریت بهینه، سریع و امن فروشگاه مجهز به daisyUI ۵ طراحی شده است.',
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

    // User Coming Soon
    greeting: 'Hello, {name}!',
    telegramId: 'Telegram ID:',
    portalTitle: 'User Portal Coming Soon',
    portalDesc:
      'Features for purchasing, subscription management, wallet top-up, and order tracking via Mini App are under active development. You can currently access all services via the Telegram bot.',
    backToBot: 'Back to Telegram Bot',
    guestUser: 'Dear User',

    // Admin Dashboard
    adminTitle: 'RebeccaSellBot Admin Dashboard',
    adminWelcome: 'Welcome, {name} (ID: {id}) · Role: System Admin',
    adminRole: 'System Admin',

    // Tabs
    tabOverview: 'Overview',
    tabReceipts: 'Receipts',
    tabUsers: 'Users',
    tabPanels: 'Panels',
    tabComingSoon: 'Modules',

    // Overview Stats
    statsLoading: 'Loading statistics...',
    statPendingReceipts: 'Pending Receipts',
    statPendingReceiptsSub: 'Needs admin review',
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
    statInactiveSubsSub: 'Quota or time expired',
    statReferralBonus: 'Referral Bonuses',
    statReferralBonusSub: 'Paid to referrers',
    statCashback: 'Cashback Paid',
    statCashbackSub: 'Purchase cashback rewards',
    panelHealthTitle: 'Rebecca Panels Health',
    panelHealthOk: 'Healthy',
    panelHealthError: 'Panel Error',
    panelHealthSub: '{healthy} of {configured} panels available',

    // Receipts
    receiptsQueueTitle: 'Deposit Receipts Queue',
    receiptsLoading: 'Loading receipts...',
    receiptsEmpty: 'No pending receipts to review.',
    receiptAmount: 'Amount: {amount} Toman',
    receiptUser: 'User ID: {id} · Receipt ID: {recId}',
    receiptDate: 'Date: {date}',
    receiptApprove: 'Approve & Credit',
    receiptReject: 'Reject Receipt',
    receiptViewPhoto: 'View Receipt Image',
    receiptNoPhoto: 'No image file attached',
    receiptPhotoModalTitle: 'Payment Receipt Image',
    receiptApproveConfirmTitle: 'Approve Receipt',
    receiptApproveConfirmBody:
      'Are you sure you want to approve this receipt for {amount} Toman? The user wallet will be credited immediately.',
    receiptApproveConfirmBtn: 'Yes, Credit Wallet',
    reasonPresetUnclear: 'Receipt image is unreadable or blurry',
    reasonPresetNotReceived: 'Payment not received in bank account',
    reasonPresetDuplicate: 'Duplicate payment receipt',
    reasonPresetMismatch: 'Amount mismatch with bank deposit',
    reasonPresetOther: 'Other reason (manual note)',

    // Users
    usersTitle: 'User Management & Search',
    usersSearchPlaceholder: 'Search by Telegram ID, username, or name...',
    usersSearchBtn: 'Search',
    usersSearching: 'Searching...',
    usersNotFound: 'No users found.',
    usersTotalCount: 'Total {count} registered users',
    paginationPrev: 'Previous',
    paginationNext: 'Next',
    paginationPage: 'Page {page} of {totalPages}',
    colId: 'ID',
    colUsername: 'Username',
    colName: 'Name',
    colBalance: 'Balance',
    colActiveSubs: 'Active Subs',
    colActions: 'Actions',
    activeSubsCount: '{count} Services',
    btnDetails: 'Details',
    btnChangeBalance: 'Adjust Balance',
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
    userTabFinances: 'Finances & Subscriptions',
    userTabOrders: 'Recent Orders',
    userTabReceipts: 'Payment Receipts',
    noOrders: 'No orders recorded yet.',
    noReceipts: 'No receipts found.',
    orderPackage: 'Package:',
    orderAmount: 'Amount:',
    orderDate: 'Date:',
    orderStatus: 'Status:',
    balanceCurLabel: 'Current Balance:',
    balancePreviewLabel: 'New Balance after change:',
    quickReasonCard: 'Card transfer deposit',
    quickReasonCompensation: 'Service downtime compensation',
    quickReasonAdjustment: 'Account balance adjustment',

    // Panels
    panelsFleetTitle: 'Rebecca Panels Fleet Status',
    panelsLoading: 'Loading panels list...',
    panelsEmpty: 'No panels registered.',
    panelDefault: 'Default',
    panelActive: 'Active',
    panelInactive: 'Inactive',
    panelAuthMode: 'Auth Mode:',
    panelAddress: 'Panel URL:',
    panelConnectedServices: 'Connected Services:',
    panelDefaultService: 'Default',
    panelTestBtn: 'Test Connection',
    panelTesting: 'Pinging...',
    panelLatency: '{ms}ms',
    panelOnline: 'Online & Responsive',
    panelOffline: 'Offline / Unreachable',
    panelConfigsCount: '{count} active configs',
    panelFleetStatusOk: 'All connected panels are healthy and responsive',
    panelFleetStatusWarning: 'One or more panels are experiencing connectivity issues',

    // Coming Soon Modules
    modulesTitle: 'Admin Modules (Web Portal in Progress)',
    modulesDesc:
      'These domain services are active in the bot core and will be integrated into the Mini App in upcoming updates:',
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
    modalRejectReasonLabel: 'Rejection reason:',
    modalRejectReasonPlaceholder: 'Additional explanation for the user...',
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
    modalBalanceReasonPlaceholder: 'Reason for balance change...',
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
    notifyPanelTestSuccess: 'Panel connection test successful (Latency: {ms}ms)',
    notifyPanelTestFailed: 'Failed to reach panel',
    notifyNetworkError: 'Network error connecting to server',
    langChangeSuccess: 'Language updated successfully',
    langChangeFailed: 'Failed to update language',
    betaBadge: 'v2.0',
    betaNotice:
      'This dashboard is powered by daisyUI 5 for optimal speed, mobile UX, and security.',
  },
};
