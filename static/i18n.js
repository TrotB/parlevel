/** Lightweight i18n — English inline, other langs lazy-loaded once and cached. */
(function (global) {
  const APP_NAME = 'Inventi';
  const APP_TAGLINE = 'Inventory, minimal.';
  const STORAGE_LANG = 'parlevel_lang';
  const STORAGE_THEME = 'parlevel_theme';
  const RTL = new Set(['ar', 'ur', 'fa', 'he']);

  const LANGS = [
    { code: 'en', label: 'English', native: 'English' },
    { code: 'es', label: 'Spanish', native: 'Español' },
    { code: 'fr', label: 'French', native: 'Français' },
    { code: 'zh', label: 'Chinese', native: '中文' },
    { code: 'ja', label: 'Japanese', native: '日本語' },
    { code: 'ko', label: 'Korean', native: '한국어' },
    { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
    { code: 'vi', label: 'Vietnamese', native: 'Tiếng Việt' },
    { code: 'tl', label: 'Tagalog', native: 'Tagalog' },
    { code: 'ar', label: 'Arabic', native: 'العربية' },
    { code: 'ur', label: 'Urdu', native: 'اردو' },
    { code: 'pa', label: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
    { code: 'fa', label: 'Persian', native: 'فارسی' },
    { code: 'tr', label: 'Turkish', native: 'Türkçe' },
    { code: 'he', label: 'Hebrew', native: 'עברית' },
  ];

  const EN = {
    'nav.home': 'Home', 'nav.items': 'Items', 'nav.scan': 'Scan', 'nav.low': 'Low',
    'nav.order': 'Order', 'nav.signOut': 'Sign out', 'nav.settings': 'Settings',
    'auth.signIn': 'Sign in', 'auth.newStore': 'New store',
    'auth.tagline': 'Inventory, minimal. Sign in to your store from any device.',
    'auth.storeCode': 'Store code', 'auth.pin': 'PIN',
    'auth.rememberCode': 'Remember store code on this device',
    'auth.keepSignedIn': 'Keep me signed in (90 days)',
    'auth.autoSignIn': 'Auto sign-in on this device',
    'auth.securityNote': 'Your PIN is never saved on this device. Auto sign-in uses a secure server session.',
    'auth.demo': 'Demo store:', 'auth.storeName': 'Store name',
    'auth.storeCodeHint': 'Store code (unique login)', 'auth.pinHint': 'PIN (4+ digits, share with staff)',
    'auth.businessType': 'Business type', 'auth.convenience': 'Convenience store',
    'auth.restaurantSoon': 'Restaurant (coming soon)', 'auth.consent': 'I agree to the Privacy Policy and Terms (required under Canadian law — PIPEDA)',
    'auth.createStore': 'Create store', 'auth.encrypted': 'Encrypted in transit (HTTPS)',
    'dash.title': 'Dashboard', 'dash.subtitle': 'Your store at a glance.',
    'dash.totalItems': 'Total items', 'dash.lowStock': 'Low stock', 'dash.stockHealth': 'Stock health',
    'dash.categories': 'Categories', 'dash.scan': 'Scan barcode', 'dash.manual': 'Manual input',
    'dash.manage': 'Manage items', 'dash.reorder': 'Reorder sheet', 'dash.account': 'Account & privacy',
    'dash.settings': 'Settings', 'dash.item': 'Item', 'dash.onHand': 'On hand', 'dash.par': 'Par',
    'dash.status': 'Status', 'dash.need': 'Need', 'dash.excess': 'Over', 'dash.ok': 'OK',
    'dash.allAbovePar': 'All items above par level', 'dash.overstock': 'Overstock',
    'dash.alertSettings': 'Alert settings', 'dash.saveAlerts': 'Save alerts',
    'items.title': 'Items', 'items.viewBy': 'View by', 'items.productType': 'Product type',
    'items.aisle': 'Aisle', 'items.search': 'Search name, barcode, aisle…', 'items.add': 'Add',
    'items.scan': 'Scan', 'items.manual': 'Manual input', 'items.noItems': 'No items yet. Add your first SKU or scan a barcode.',
    'items.filterAll': 'All', 'items.filterCategory': 'All categories', 'items.filterAisle': 'All aisles',
    'scan.title': 'Find item', 'scan.subtitle': 'Scan a barcode or type it manually.',
    'scan.camera': 'Camera scan', 'scan.manual': 'Manual input',
    'scan.hint': 'Works best on phone with rear camera', 'scan.barcodeLabel': 'Barcode number',
    'scan.lookup': 'Look up', 'scan.enterBarcode': 'Enter a barcode number',
    'scan.notFound': 'No item with this barcode', 'scan.delivery': 'Delivery', 'scan.setCount': 'Set count',
    'scan.torch': 'Light', 'scan.torchOff': 'Light off', 'scan.resume': 'Scan next',
    'scan.scanning': 'Point at barcode — hold steady', 'scan.found': 'Found', 'scan.paused': 'Scanner paused — tap Scan next',
    'scan.noCamera': 'Camera unavailable. Allow camera access or use manual input.',
    'scan.torchFail': 'Flash not supported on this device',
    'low.title': 'Low stock', 'low.subtitle': 'Items at or below par level.',
    'reorder.title': 'Reorder sheet', 'reorder.subtitle': 'Print or screenshot for your supplier run.',
    'reorder.print': 'Print', 'reorder.itemsToOrder': '{n} items to order', 'reorder.nothing': 'Nothing to reorder',
    'reorder.notes': 'Notes', 'reorder.category': 'Category', 'reorder.unit': 'Unit', 'reorder.order': 'Order',
    'settings.title': 'Settings', 'settings.subtitle': 'Language, appearance, and alerts.',
    'settings.language': 'Language', 'settings.languageHint': 'Translations load on demand — English stays instant.',
    'settings.appearance': 'Appearance', 'settings.themeLight': 'Light', 'settings.themeDark': 'Dark',
    'settings.themeSystem': 'System', 'settings.alerts': 'Alerts',     'settings.alertsHint': 'Get notified when stock runs low or over par.',
    'settings.alertsEnable': 'Enable low-stock alerts', 'settings.alertsLowCount': 'Alert when this many items (or more) are low',
    'settings.alertsOverstock': 'Overstock alerts', 'settings.alertsOverstockEnable': 'Alert when items exceed par level',
    'settings.alertsOverstockRatio': 'Overstock threshold (× par level)', 'settings.alertsOverstockCount': 'Alert when this many items (or more) are overstocked',
    'settings.alertsBrowser': 'Browser notifications', 'settings.alertsDaily': 'Daily summary',
    'settings.alertsDailyHour': 'Summary hour (24h)', 'settings.saveAlerts': 'Save alert settings',
    'settings.saved': 'Settings saved', 'settings.requestNotify': 'Allow notifications to receive alerts on this device.',
    'settings.notifyGranted': 'Notifications enabled', 'settings.notifyDenied': 'Notifications blocked — enable in browser settings',
    'alert.low_stock': '{count} items are low on stock — check your reorder list.',
    'alert.overstock': '{count} items are overstocked — review shelf space.',
    'alert.daily_summary': 'Daily summary: {low} low-stock items, {over} overstocked, {total} total SKUs.',
    'aisles.title': 'Edit aisles', 'aisles.hint': 'Assign each item to an aisle or location in your store.',
    'aisles.search': 'Search items…', 'aisles.save': 'Save aisle changes', 'aisles.saved': 'Aisles updated',
    'items.editAisles': 'Edit aisles',
    'account.title': 'Account & privacy', 'account.intro': 'Your data is encrypted in transit (TLS/HTTPS). PINs are hashed with bcrypt.',
    'account.autoSignIn': 'Auto sign-in on this device', 'account.export': 'Download my data (PIPEDA)',
    'account.forgetDevice': 'Remove trusted device', 'account.deleteStore': 'Delete store & all data',
    'account.deleteTitle': 'Delete store permanently', 'account.deleteWarn': 'This permanently deletes your store, inventory, and all sessions.',
    'account.deleteConfirm': 'Type DELETE to confirm', 'account.deleteBtn': 'Delete everything',
    'install.banner': 'Install Inventi on your phone for quick access', 'install.btn': 'Install',
    'toast.welcome': 'Welcome back', 'toast.storeCreated': 'Store created', 'toast.signedOut': 'Signed out',
    'toast.autoLogin': 'Signed in automatically', 'toast.organizedAisle': 'Organized by aisle',
    'toast.organizedCategory': 'Organized by product type', 'toast.autoSignInOff': 'Auto sign-in disabled on this device',
    'toast.autoSignInOn': 'Sign in once with "Keep me signed in" to enable auto sign-in',
    'toast.exported': 'Data exported', 'toast.deviceRemoved': 'Trusted device removed', 'toast.accountDeleted': 'Account deleted',
    'toast.sessionExpired': 'Session expired — please sign in again',
    'common.close': 'Close', 'common.privacy': 'Privacy', 'common.terms': 'Terms',
  };

  let active = EN;
  let activeCode = 'en';
  const cache = { en: EN };
  const loading = {};

  function readLang() {
    try { return localStorage.getItem(STORAGE_LANG) || 'en'; } catch { return 'en'; }
  }

  function readTheme() {
    try { return localStorage.getItem(STORAGE_THEME) || 'system'; } catch { return 'system'; }
  }

  function t(key, vars) {
    let s = active[key] ?? EN[key] ?? key;
    if (vars) {
      Object.entries(vars).forEach(([k, v]) => {
        s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      });
    }
    return s;
  }

  function applyDocument() {
    document.documentElement.lang = activeCode === 'zh' ? 'zh-Hans' : activeCode;
    document.documentElement.dir = RTL.has(activeCode) ? 'rtl' : 'ltr';
  }

  function applyTheme(mode) {
    const m = mode || readTheme();
    try { localStorage.setItem(STORAGE_THEME, m); } catch { /* ignore */ }
    let dark = m === 'dark';
    if (m === 'system') {
      dark = global.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#0f0f0f' : '#0a0a0a';
  }

  async function loadLanguage(code) {
    if (!code || code === 'en') {
      active = EN;
      activeCode = 'en';
      try { localStorage.setItem(STORAGE_LANG, 'en'); } catch { /* ignore */ }
      applyDocument();
      return;
    }
    if (cache[code]) {
      active = cache[code];
      activeCode = code;
      try { localStorage.setItem(STORAGE_LANG, code); } catch { /* ignore */ }
      applyDocument();
      return;
    }
    if (!loading[code]) {
      loading[code] = fetch(`/static/i18n/${code}.json`)
        .then(r => { if (!r.ok) throw new Error('lang'); return r.json(); })
        .then(json => { cache[code] = { ...EN, ...json }; })
        .catch(() => { cache[code] = EN; });
    }
    await loading[code];
    active = cache[code];
    activeCode = code;
    try { localStorage.setItem(STORAGE_LANG, code); } catch { /* ignore */ }
    applyDocument();
  }

  async function initPrefs() {
    applyTheme(readTheme());
    global.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (readTheme() === 'system') applyTheme('system');
    });
    const lang = readLang();
    if (lang !== 'en') await loadLanguage(lang);
    else applyDocument();
  }

  global.InventiPrefs = {
    APP_NAME, APP_TAGLINE, LANGS, t, loadLanguage, initPrefs, applyTheme, readTheme, readLang,
    isRtl: () => RTL.has(activeCode),
  };
  global.ParlevelPrefs = global.InventiPrefs;
})(window);
