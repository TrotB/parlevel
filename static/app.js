const main = document.getElementById('main');
const topbar = document.getElementById('topbar');
const navEl = document.getElementById('nav');
const bottomNav = document.getElementById('bottom-nav');
const appFooter = document.getElementById('app-footer');
const businessNameEl = document.getElementById('business-name');
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const toasts = document.getElementById('toasts');
const loader = document.getElementById('loader');

const installBanner = document.getElementById('install-banner');
const installBtn = document.getElementById('install-btn');
const installDismiss = document.getElementById('install-dismiss');

const topbarSettingsBtn = document.getElementById('topbar-settings');

const t = (key, vars) => InventiPrefs.t(key, vars);

let state = {
  view: 'dashboard',
  business: null,
  authenticated: false,
  initializing: true,
  items: [],
  categories: [],
  aisles: [],
  stats: null,
  organizeBy: 'category',
  alertSettings: null,
  search: '',
  categoryFilter: '',
  aisleFilter: '',
  authTab: 'login',
  scanMode: 'camera',
};

const PREFS = {
  saveStoreCode: 'parlevel_save_store_code',
  storeCode: 'parlevel_store_code',
  rememberMe: 'parlevel_remember_me',
  autoLogin: 'parlevel_auto_login',
};

function readPref(key, fallback = '') {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* private browsing */ }
}

function prefBool(key, fallback = false) {
  return readPref(key, fallback ? '1' : '0') === '1';
}

function setPrefBool(key, on) {
  writePref(key, on ? '1' : '0');
}

let deferredInstall = null;

let scanner = null;
let scanTorchOn = false;
let lastScanCode = '';
let lastScanAt = 0;
let scanPaused = false;
let loadingCount = 0;
let searchTimer = null;

const VIEWS = [
  { id: 'dashboard', labelKey: 'nav.home', icon: '⌂' },
  { id: 'items', labelKey: 'nav.items', icon: '☰' },
  { id: 'scan', labelKey: 'nav.scan', icon: '▣', scan: true },
  { id: 'low-stock', labelKey: 'nav.low', icon: '↓' },
  { id: 'reorder', labelKey: 'nav.order', icon: '☑' },
];

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast${type ? ` ${type}` : ''}`;
  el.textContent = msg;
  toasts.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function haptic() {
  if (navigator.vibrate) navigator.vibrate(12);
}

function setLoading(on) {
  loadingCount += on ? 1 : -1;
  loader.hidden = loadingCount <= 0;
}

async function api(path, options = {}) {
  setLoading(true);
  try {
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.includes('/auth/')) {
      if (!state.initializing) {
        state.authenticated = false;
        state.business = null;
        await render();
      }
      throw new Error('Session expired — please sign in again');
    }
    if (!res.ok) {
      const msg = typeof data.detail === 'string' ? data.detail : 'Request failed';
      throw new Error(msg);
    }
    return data;
  } finally {
    setLoading(false);
  }
}

function showModal(title, html) {
  modalTitle.textContent = title;
  modalBody.innerHTML = html;
  modal.hidden = false;
}

function hideModal() {
  modal.hidden = true;
  modalBody.innerHTML = '';
}

modal.addEventListener('click', e => {
  if (e.target.dataset.close !== undefined) hideModal();
});

async function loadSession() {
  const data = await api('/api/auth/me');
  state.authenticated = data.authenticated;
  state.business = data.business;
  return data;
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' });
  state.authenticated = false;
  state.business = null;
  toast(t('toast.signedOut'));
  await render();
}

async function loadBusiness() {
  const data = await api('/api/business');
  state.business = data.business;
  return data;
}

async function loadStats() {
  try {
    state.stats = await api('/api/stats');
  } catch {
    state.stats = null;
  }
}

async function loadItems() {
  const params = new URLSearchParams();
  if (state.search) params.set('q', state.search);
  if (state.categoryFilter) params.set('category', state.categoryFilter);
  if (state.aisleFilter) params.set('aisle', state.aisleFilter);
  const qs = params.toString();
  const data = await api(`/api/items${qs ? `?${qs}` : ''}`);
  state.items = data.items;
  return data;
}

async function loadCategories() {
  const data = await api('/api/categories');
  state.categories = data.categories;
}

async function loadAisles() {
  const data = await api('/api/aisles');
  state.aisles = data.aisles;
}

async function loadSettings() {
  const data = await api('/api/settings');
  state.organizeBy = data.organize_by || 'category';
  state.alertSettings = mergeAlerts(data.alerts);
  if (state.business) {
    state.business.organize_by = state.organizeBy;
    state.business.alert_settings = state.alertSettings;
  }
}

async function saveAlertSettings(alerts) {
  const data = await api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({ alerts }),
  });
  state.alertSettings = mergeAlerts(data.alerts);
  if (state.business) state.business.alert_settings = data.alerts;
  toast(t('settings.saved'), 'success');
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') {
    toast(t('settings.notifyDenied'), 'error');
    return false;
  }
  const result = await Notification.requestPermission();
  if (result === 'granted') {
    toast(t('settings.notifyGranted'), 'success');
    return true;
  }
  toast(t('settings.notifyDenied'), 'error');
  return false;
}

function pushBrowserNotification(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, icon: '/static/logo.jfif', tag: 'parlevel-alert' });
  } catch { /* ignore */ }
}

function checkAlerts() {
  const a = mergeAlerts(state.alertSettings);
  if (!a.enabled && !a.overstock_enabled) return;
  const low = state.stats?.low_count ?? 0;
  const over = state.stats?.overstock_count ?? 0;
  const total = state.stats?.total_items ?? state.items.length;

  if (a.enabled) {
    const threshold = a.low_stock_count ?? 5;
    if (low >= threshold) {
      const sig = `low-${low}-${threshold}`;
      const last = sessionStorage.getItem('parlevel_alert_sig');
      if (last !== sig) {
        sessionStorage.setItem('parlevel_alert_sig', sig);
        const msg = t('alert.low_stock', { count: low });
        toast(msg, 'error');
        if (a.browser_push) pushBrowserNotification(InventiPrefs.APP_NAME, msg);
      }
    }
  }

  if (a.overstock_enabled) {
    const threshold = a.overstock_alert_count ?? 3;
    if (over >= threshold) {
      const sig = `over-${over}-${threshold}`;
      const last = sessionStorage.getItem('parlevel_overstock_sig');
      if (last !== sig) {
        sessionStorage.setItem('parlevel_overstock_sig', sig);
        const msg = t('alert.overstock', { count: over });
        toast(msg, 'warn');
        if (a.browser_push) pushBrowserNotification(InventiPrefs.APP_NAME, msg);
      }
    }
  }

  if (a.enabled && a.daily_digest) {
    const hour = new Date().getHours();
    const today = new Date().toISOString().slice(0, 10);
    const lastDay = localStorage.getItem('parlevel_digest_day');
    if (hour === (a.digest_hour ?? 8) && lastDay !== today && state.stats) {
      localStorage.setItem('parlevel_digest_day', today);
      const msg = t('alert.daily_summary', { low, over, total });
      toast(msg);
      if (a.browser_push) pushBrowserNotification(InventiPrefs.APP_NAME, msg);
    }
  }
}

async function saveOrganizeBy(mode) {
  const data = await api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({ organize_by: mode }),
  });
  state.organizeBy = data.organize_by;
  if (state.business) state.business.organize_by = data.organize_by;
  toast(mode === 'aisle' ? t('toast.organizedAisle') : t('toast.organizedCategory'), 'success');
}

function healthClass(pct) {
  if (pct >= 70) return '';
  if (pct >= 40) return 'warn';
  return 'bad';
}

function alertDefaults() {
  return {
    enabled: false,
    low_stock_count: 5,
    browser_push: true,
    daily_digest: false,
    digest_hour: 8,
    overstock_enabled: false,
    overstock_ratio: 1.5,
    overstock_alert_count: 3,
  };
}

function mergeAlerts(a) {
  return { ...alertDefaults(), ...(a || {}) };
}

function itemCardClass(item) {
  if (item.low) return 'low';
  if (item.overstock) return 'overstock';
  return '';
}

function itemStatusBadge(item) {
  if (item.low) return `<span class="badge badge-low">${t('dash.need')} ${item.need}</span>`;
  if (item.overstock) return `<span class="badge badge-overstock">${t('dash.excess')} ${item.excess}</span>`;
  return `<span class="badge badge-ok">${t('dash.ok')}</span>`;
}

function syncItemCard(card, item) {
  if (!card || !item) return;
  card.classList.remove('low', 'overstock');
  const cls = itemCardClass(item);
  if (cls) card.classList.add(cls);
  const badge = card.querySelector('.badge');
  if (badge) {
    badge.outerHTML = itemStatusBadge(item);
  }
}

function alertSettingsHtml(a, prefix, compact = false) {
  const p = prefix ? `${prefix}-` : '';
  return `
    <label class="check-row">
      <input type="checkbox" id="${p}alert-enabled" ${a.enabled ? 'checked' : ''}>
      <span>${t('settings.alertsEnable')}</span>
    </label>
    <div class="settings-row">
      <label for="${p}alert-threshold">${t('settings.alertsLowCount')}</label>
      <input type="number" id="${p}alert-threshold" min="1" max="500" value="${a.low_stock_count}">
    </div>
    <div class="alert-subsection">
      <label class="check-row">
        <input type="checkbox" id="${p}alert-overstock" ${a.overstock_enabled ? 'checked' : ''}>
        <span>${t('settings.alertsOverstockEnable')}</span>
      </label>
      <div class="settings-row">
        <label for="${p}alert-overstock-ratio">${t('settings.alertsOverstockRatio')}</label>
        <input type="number" id="${p}alert-overstock-ratio" min="1.1" max="5" step="0.1" value="${a.overstock_ratio}">
      </div>
      <div class="settings-row">
        <label for="${p}alert-overstock-count">${t('settings.alertsOverstockCount')}</label>
        <input type="number" id="${p}alert-overstock-count" min="1" max="500" value="${a.overstock_alert_count}">
      </div>
    </div>
    ${compact ? '' : `
      <label class="check-row">
        <input type="checkbox" id="${p}alert-browser" ${a.browser_push ? 'checked' : ''}>
        <span>${t('settings.alertsBrowser')}</span>
      </label>
      <label class="check-row">
        <input type="checkbox" id="${p}alert-daily" ${a.daily_digest ? 'checked' : ''}>
        <span>${t('settings.alertsDaily')}</span>
      </label>
      <div class="settings-row">
        <label for="${p}alert-hour">${t('settings.alertsDailyHour')}</label>
        <input type="number" id="${p}alert-hour" min="0" max="23" value="${a.digest_hour}">
      </div>
    `}
  `;
}

function collectAlertSettings(prefix) {
  const p = prefix ? `${prefix}-` : '';
  const base = {
    enabled: document.getElementById(`${p}alert-enabled`)?.checked ?? false,
    low_stock_count: parseInt(document.getElementById(`${p}alert-threshold`)?.value, 10) || 5,
    overstock_enabled: document.getElementById(`${p}alert-overstock`)?.checked ?? false,
    overstock_ratio: parseFloat(document.getElementById(`${p}alert-overstock-ratio`)?.value) || 1.5,
    overstock_alert_count: parseInt(document.getElementById(`${p}alert-overstock-count`)?.value, 10) || 3,
  };
  const browserEl = document.getElementById(`${p}alert-browser`);
  if (browserEl) {
    return {
      ...base,
      browser_push: browserEl.checked,
      daily_digest: document.getElementById(`${p}alert-daily`)?.checked ?? false,
      digest_hour: parseInt(document.getElementById(`${p}alert-hour`)?.value, 10) || 8,
    };
  }
  const current = mergeAlerts(state.alertSettings);
  return {
    ...current,
    ...base,
  };
}

async function bindAlertSave(btnId, prefix) {
  document.getElementById(btnId)?.addEventListener('click', async () => {
    const collected = collectAlertSettings(prefix);
    if (collected.enabled && collected.browser_push && Notification.permission === 'default') {
      const ok = await requestNotificationPermission();
      if (!ok && Notification.permission !== 'granted') {
        toast(t('settings.requestNotify'));
      }
    }
    await saveAlertSettings(collected);
    await loadStats();
    await loadItems();
    checkAlerts();
    if (state.view === 'dashboard') {
      const data = await loadBusiness();
      renderDashboard(data);
    }
  });
}

function renderNav() {
  const btns = VIEWS.map(v => `
    <button class="${state.view === v.id ? 'active' : ''}${v.scan ? ' scan-btn' : ''}" data-view="${v.id}">
      <span class="nav-icon">${v.icon}</span>
      ${t(v.labelKey)}
    </button>
  `).join('');

  navEl.innerHTML = VIEWS.filter(v => !v.scan).map(v => `
    <button class="${state.view === v.id ? 'active' : ''}" data-view="${v.id}">${t(v.labelKey)}</button>
  `).join('') + `<button class="logout-btn" id="logout-btn">${t('nav.signOut')}</button>`;

  bottomNav.innerHTML = btns;
  if (topbarSettingsBtn) topbarSettingsBtn.hidden = false;
  const ibSpan = installBanner?.querySelector('span');
  if (ibSpan) ibSpan.textContent = t('install.banner');
  if (installBtn) installBtn.textContent = t('install.btn');

  [...navEl.querySelectorAll('[data-view]'), ...bottomNav.querySelectorAll('[data-view]')].forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.view === 'scan') state.scanMode = 'camera';
      navigate(btn.dataset.view);
    });
  });
  document.getElementById('logout-btn')?.addEventListener('click', logout);
  topbarSettingsBtn?.addEventListener('click', () => navigate('settings'));
}

function renderAuth() {
  topbar.hidden = true;
  bottomNav.hidden = true;
  appFooter.hidden = false;
  const isLogin = state.authTab === 'login';
  const savedCode = prefBool(PREFS.saveStoreCode) ? readPref(PREFS.storeCode) : '';
  const rememberChecked = prefBool(PREFS.rememberMe);
  const autoLoginEnabled = prefBool(PREFS.autoLogin, true);
  main.innerHTML = `
    <section class="setup">
      <div class="card setup-card">
        <div class="setup-brand">
          <img src="/static/logo.jfif" alt="Inventi">
          <div>
            <h1>${InventiPrefs.APP_NAME}</h1>
            <span class="brand-tagline">${InventiPrefs.APP_TAGLINE}</span>
            <span style="font-size:.8rem;color:var(--gray-600)">by shavi labs</span>
          </div>
        </div>
        <p class="tagline">${t('auth.tagline')}</p>
        <div class="auth-tabs">
          <button type="button" class="${isLogin ? 'active' : ''}" data-tab="login">${t('auth.signIn')}</button>
          <button type="button" class="${!isLogin ? 'active' : ''}" data-tab="register">${t('auth.newStore')}</button>
        </div>
        ${isLogin ? `
          <form id="login-form" class="form-grid">
            <label>${t('auth.storeCode')}
              <input name="store_code" required placeholder="cornershop" autocapitalize="none" autocomplete="username" value="${esc(savedCode)}">
            </label>
            <label>${t('auth.pin')}
              <input name="pin" type="password" required placeholder="••••" inputmode="numeric" autocomplete="current-password">
            </label>
            <div class="auth-options">
              <label class="check-row">
                <input type="checkbox" name="save_store_code" ${prefBool(PREFS.saveStoreCode) ? 'checked' : ''}>
                <span>${t('auth.rememberCode')}</span>
              </label>
              <label class="check-row">
                <input type="checkbox" name="remember_me" ${rememberChecked ? 'checked' : ''}>
                <span>${t('auth.keepSignedIn')}</span>
              </label>
              <label class="check-row">
                <input type="checkbox" name="auto_login" ${autoLoginEnabled ? 'checked' : ''}>
                <span>${t('auth.autoSignIn')}</span>
              </label>
            </div>
            <p class="auth-security-note">${t('auth.securityNote')}</p>
            <button class="btn btn-primary" type="submit">${t('auth.signIn')}</button>
          </form>
          <div class="auth-demo">
            <strong>${t('auth.demo')}</strong> code <code>cornershop</code> · PIN <code>1234</code>
          </div>
        ` : `
          <form id="register-form" class="form-grid">
            <label>${t('auth.storeName')}
              <input name="name" required placeholder="My Convenience Store">
            </label>
            <label>${t('auth.storeCodeHint')}
              <input name="store_code" required placeholder="mystore" autocapitalize="none" pattern="[a-zA-Z0-9]+">
            </label>
            <label>${t('auth.pinHint')}
              <input name="pin" type="password" required minlength="4" inputmode="numeric">
            </label>
            <label>${t('auth.businessType')}
              <select name="type">
                <option value="convenience">${t('auth.convenience')}</option>
                <option value="restaurant" disabled>${t('auth.restaurantSoon')}</option>
              </select>
            </label>
            <label class="check-row consent-row">
              <input type="checkbox" name="privacy_consent" required>
              <span>${t('auth.consent')}</span>
            </label>
            <button class="btn btn-primary" type="submit">${t('auth.createStore')}</button>
          </form>
        `}
        <div class="auth-legal">
          <a href="/privacy">${t('common.privacy')}</a> · <a href="/terms">${t('common.terms')}</a> · ${t('auth.encrypted')}
        </div>
      </div>
    </section>
  `;

  main.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.authTab = btn.dataset.tab;
      renderAuth();
    });
  });

  if (isLogin) {
    document.getElementById('login-form').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const fd = new FormData(e.target);
        const saveCode = fd.get('save_store_code') === 'on';
        const rememberMe = fd.get('remember_me') === 'on';
        const autoLogin = fd.get('auto_login') === 'on';
        const storeCode = String(fd.get('store_code') || '').trim();

        setPrefBool(PREFS.saveStoreCode, saveCode);
        if (saveCode) writePref(PREFS.storeCode, storeCode);
        else writePref(PREFS.storeCode, null);
        setPrefBool(PREFS.rememberMe, rememberMe);
        setPrefBool(PREFS.autoLogin, autoLogin);

        if (!autoLogin) {
          await api('/api/auth/forget-device', { method: 'POST' }).catch(() => {});
        }

        await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            store_code: storeCode,
            pin: String(fd.get('pin') || ''),
            remember_me: rememberMe && autoLogin,
          }),
        });
        toast(t('toast.welcome'), 'success');
        await init();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  } else {
    document.getElementById('register-form').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const fd = new FormData(e.target);
        await api('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            name: String(fd.get('name') || ''),
            store_code: String(fd.get('store_code') || ''),
            pin: String(fd.get('pin') || ''),
            type: String(fd.get('type') || 'convenience'),
            currency: 'CAD',
            privacy_consent: fd.get('privacy_consent') === 'on',
          }),
        });
        toast(t('toast.storeCreated'), 'success');
        await init();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }
}

function renderDashboard(data) {
  const s = state.stats;
  const health = s?.stock_health ?? 100;
  const a = mergeAlerts(state.alertSettings);
  const overCount = s?.overstock_count ?? data.overstock_count ?? 0;
  main.innerHTML = `
    <section class="page">
      <div class="page-header">
        <h1>${t('dash.title')}</h1>
        <p>${t('dash.subtitle')}</p>
      </div>
      <div class="stats">
        <div class="stat">
          <div class="stat-label">${t('dash.totalItems')}</div>
          <div class="stat-value">${data.item_count}</div>
        </div>
        <div class="stat">
          <div class="stat-label">${t('dash.lowStock')}</div>
          <div class="stat-value ${data.low_count ? 'bad' : 'good'}">${data.low_count}</div>
        </div>
        <div class="stat">
          <div class="stat-label">${t('dash.overstock')}</div>
          <div class="stat-value ${overCount ? 'over' : 'good'}">${overCount}</div>
        </div>
        <div class="stat">
          <div class="stat-label">${t('dash.stockHealth')}</div>
          <div class="stat-value ${health >= 70 ? 'good' : 'bad'}">${health}%</div>
          <div class="health-bar"><div class="health-fill ${healthClass(health)}" style="width:${health}%"></div></div>
        </div>
        <div class="stat">
          <div class="stat-label">${t('dash.categories')}</div>
          <div class="stat-value">${s?.category_count ?? '—'}</div>
        </div>
      </div>
      <div class="toolbar no-print">
        <button class="btn btn-ghost" data-view="scan">${t('dash.scan')}</button>
        <button class="btn btn-ghost" id="manual-input-btn">${t('dash.manual')}</button>
        <button class="btn btn-ghost" data-view="items">${t('dash.manage')}</button>
        <button class="btn btn-ghost" data-view="reorder">${t('dash.reorder')}</button>
        <button class="btn btn-ghost" data-view="settings">${t('dash.settings')}</button>
        <button class="btn btn-ghost" id="account-btn">${t('dash.account')}</button>
      </div>
      <div class="card dashboard-alerts no-print">
        <div class="settings-section">
          <h2>${t('dash.alertSettings')}</h2>
          <p class="settings-hint">${t('settings.alertsHint')}</p>
          ${alertSettingsHtml(a, 'dash', true)}
          <button class="btn btn-primary" id="dash-save-alerts-btn" style="margin-top:.75rem">${t('dash.saveAlerts')}</button>
        </div>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>${t('dash.item')}</th><th>${t('dash.onHand')}</th><th class="hide-sm">${t('dash.par')}</th><th>${t('dash.status')}</th></tr></thead>
            <tbody>
              ${state.items.filter(i => i.low).slice(0, 10).map(item => `
                <tr class="clickable" data-goto-item="${item.id}">
                  <td>${esc(item.name)}</td>
                  <td>${item.on_hand}</td>
                  <td class="hide-sm">${item.par}</td>
                  <td>${itemStatusBadge(item)}</td>
                </tr>
              `).join('') || `<tr><td colspan="4"><div class="empty"><div class="empty-icon">✓</div>${t('dash.allAbovePar')}</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
  bindViewButtons();
  bindAlertSave('dash-save-alerts-btn', 'dash');
  document.getElementById('account-btn')?.addEventListener('click', showAccountModal);
  document.getElementById('manual-input-btn')?.addEventListener('click', () => openManualInput());
  main.querySelectorAll('[data-goto-item]').forEach(row => {
    row.addEventListener('click', () => {
      state.view = 'items';
      state.search = '';
      render().then(() => {
        const card = document.querySelector(`[data-id="${row.dataset.gotoItem}"]`);
        card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card?.classList.add('low');
      });
    });
  });
}

function itemCard(item) {
  return `
    <article class="item-card ${itemCardClass(item)}" data-id="${item.id}">
      <div class="item-card-head">
        <div>
          <h3>${esc(item.name)}</h3>
          <div class="item-meta">${esc(item.category)}${item.aisle ? ` · ${esc(item.aisle)}` : ''} · ${esc(item.unit)}${item.barcode ? ` · ${esc(item.barcode)}` : ''}</div>
        </div>
        ${itemStatusBadge(item)}
      </div>
      <div class="qty-row">
        <button class="btn btn-ghost btn-sm btn-icon" data-adjust="${item.id}" data-delta="-1" aria-label="Decrease">−</button>
        <span class="qty" id="qty-${item.id}">${item.on_hand}</span>
        <button class="btn btn-ghost btn-sm btn-icon" data-adjust="${item.id}" data-delta="1" aria-label="Increase">+</button>
        <span class="item-meta">par ${item.par}</span>
      </div>
      <div class="actions">
        <button class="btn btn-ghost btn-sm" data-set="${item.id}">Set count</button>
        <button class="btn btn-ghost btn-sm" data-delivery="${item.id}">+ Delivery</button>
        <button class="btn btn-ghost btn-sm" data-edit="${item.id}">Edit</button>
      </div>
    </article>
  `;
}

function groupItems(items) {
  const key = state.organizeBy === 'aisle' ? 'aisle' : 'category';
  const groups = new Map();
  for (const item of items) {
    const label = item[key] || (key === 'aisle' ? 'No aisle' : 'Uncategorized');
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(item);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function renderGroupedItems(items) {
  if (!items.length) {
    return '<div class="empty card"><div class="empty-icon">+</div>No items yet. Add your first SKU or scan a barcode.</div>';
  }
  const heading = state.organizeBy === 'aisle' ? 'Aisle' : 'Product type';
  return groupItems(items).map(([label, groupItemsList]) => `
    <div class="item-group">
      <h2 class="group-heading">${heading}: ${esc(label)} <span class="group-count">${groupItemsList.length}</span></h2>
      <div class="item-grid">${groupItemsList.map(itemCard).join('')}</div>
    </div>
  `).join('');
}

function renderItems() {
  const filterLabel = state.organizeBy === 'aisle' ? 'All aisles' : 'All categories';
  const filterOptions = state.organizeBy === 'aisle'
    ? state.aisles.map(a => `
        <option value="${esc(a.aisle)}" ${state.aisleFilter === a.aisle ? 'selected' : ''}>
          ${esc(a.aisle)} (${a.count})
        </option>
      `).join('')
    : state.categories.map(c => `
        <option value="${esc(c.category)}" ${state.categoryFilter === c.category ? 'selected' : ''}>
          ${esc(c.category)} (${c.count})
        </option>
      `).join('');

  main.innerHTML = `
    <section class="page">
      <div class="page-header">
        <h1>Items</h1>
        <p>Organize your store how you work — by aisle or product type.</p>
      </div>
      <div class="organize-bar no-print">
        <span class="organize-label">View by</span>
        <button type="button" class="organize-btn ${state.organizeBy === 'category' ? 'active' : ''}" data-organize="category">Product type</button>
        <button type="button" class="organize-btn ${state.organizeBy === 'aisle' ? 'active' : ''}" data-organize="aisle">Aisle</button>
      </div>
      <div class="toolbar no-print">
        <input class="search" id="search" placeholder="Search name, barcode, aisle…" value="${esc(state.search)}">
        <select id="group-filter">
          <option value="">${filterLabel}</option>
          ${filterOptions}
        </select>
        <button class="btn btn-primary" id="add-item">Add</button>
        <button class="btn btn-ghost" id="edit-aisles-btn">${t('items.editAisles')}</button>
        <button class="btn btn-ghost" id="scan-shortcut">Scan</button>
        <button class="btn btn-ghost" id="manual-shortcut">Manual input</button>
      </div>
      <div id="item-groups">${renderGroupedItems(state.items)}</div>
    </section>
  `;

  main.querySelectorAll('[data-organize]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.organize === state.organizeBy) return;
      state.categoryFilter = '';
      state.aisleFilter = '';
      await saveOrganizeBy(btn.dataset.organize);
      await loadItems();
      if (state.organizeBy === 'aisle') await loadAisles();
      else await loadCategories();
      renderItems();
    });
  });

  document.getElementById('search').addEventListener('input', e => {
    state.search = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      await loadItems();
      document.getElementById('item-groups').innerHTML = renderGroupedItems(state.items);
      bindItemActions();
    }, 280);
  });

  document.getElementById('group-filter').addEventListener('change', async e => {
    if (state.organizeBy === 'aisle') {
      state.aisleFilter = e.target.value;
      state.categoryFilter = '';
    } else {
      state.categoryFilter = e.target.value;
      state.aisleFilter = '';
    }
    await loadItems();
    renderItems();
  });

  document.getElementById('add-item').addEventListener('click', () => openItemForm());
  document.getElementById('edit-aisles-btn')?.addEventListener('click', () => openAisleManager());
  document.getElementById('scan-shortcut').addEventListener('click', () => {
    state.scanMode = 'camera';
    navigate('scan');
  });
  document.getElementById('manual-shortcut').addEventListener('click', () => openManualInput());
  bindItemActions();
}

async function adjustItem(id, payload) {
  const data = await api(`/api/items/${id}/adjust`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const qtyEl = document.getElementById(`qty-${id}`);
  if (qtyEl) {
    qtyEl.textContent = data.item.on_hand;
    qtyEl.classList.add('bump');
    setTimeout(() => qtyEl.classList.remove('bump'), 300);
  }
  haptic();
  toast(`Updated: ${data.item.on_hand} on hand`, 'success');
  await loadStats();
  return data.item;
}

function bindItemActions() {
  main.querySelectorAll('[data-adjust]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await adjustItem(btn.dataset.adjust, {
          delta: Number(btn.dataset.delta),
          reason: 'manual',
        });
        const card = btn.closest('.item-card');
        const item = state.items.find(i => i.id === Number(btn.dataset.adjust));
        if (item && card) {
          item.on_hand = Number(document.getElementById(`qty-${item.id}`).textContent);
          item.low = item.par > 0 && item.on_hand <= item.par;
          const ratio = mergeAlerts(state.alertSettings).overstock_ratio;
          item.overstock = item.par > 0 && item.on_hand > item.par * ratio;
          item.need = item.low ? Math.max(item.par - item.on_hand, 0) : 0;
          item.excess = item.overstock ? Math.round((item.on_hand - item.par * ratio) * 10) / 10 : 0;
          syncItemCard(card, item);
        }
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });

  main.querySelectorAll('[data-set]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.set;
      const item = state.items.find(i => i.id === Number(id));
      showModal('Set count', `
        <form id="set-form" class="form-grid">
          <label>New on-hand quantity
            <input name="set_to" type="number" min="0" step="1" value="${item.on_hand}" required inputmode="numeric">
          </label>
          <button class="btn btn-primary" type="submit">Save count</button>
        </form>
      `);
      document.getElementById('set-form').addEventListener('submit', async e => {
        e.preventDefault();
        try {
          await adjustItem(id, { set_to: Number(new FormData(e.target).get('set_to')), reason: 'count' });
          hideModal();
          await loadItems();
          renderItems();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
  });

  main.querySelectorAll('[data-delivery]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.delivery;
      showModal('Received delivery', `
        <form id="delivery-form" class="form-grid">
          <label>Quantity received
            <input name="delta" type="number" min="1" step="1" required autofocus inputmode="numeric">
          </label>
          <button class="btn btn-primary" type="submit">Add to stock</button>
        </form>
      `);
      document.getElementById('delivery-form').addEventListener('submit', async e => {
        e.preventDefault();
        try {
          await adjustItem(id, { delta: Number(new FormData(e.target).get('delta')), reason: 'delivery' });
          hideModal();
          await loadItems();
          renderItems();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
  });

  main.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      openItemForm(state.items.find(i => i.id === Number(btn.dataset.edit)));
    });
  });
}

function openAisleManager() {
  const knownAisles = [...new Set([
    ...state.aisles.map(a => a.aisle),
    ...state.items.map(i => i.aisle).filter(Boolean),
  ])].sort();
  const datalist = knownAisles.map(a => `<option value="${esc(a)}">`).join('');

  showModal(t('aisles.title'), `
    <p class="settings-hint">${t('aisles.hint')}</p>
    <input class="search" id="aisle-search" placeholder="${t('aisles.search')}">
    <div class="aisle-manager-list" id="aisle-list">
      ${state.items.map(item => `
        <div class="aisle-row" data-name="${esc(item.name.toLowerCase())}">
          <span class="aisle-name">${esc(item.name)}</span>
          <input class="aisle-input" list="aisle-options" value="${esc(item.aisle || '')}" data-id="${item.id}">
        </div>
      `).join('')}
    </div>
    <datalist id="aisle-options">${datalist}</datalist>
    <button class="btn btn-primary" id="save-aisles">${t('aisles.save')}</button>
  `);

  document.getElementById('aisle-search')?.addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('#aisle-list .aisle-row').forEach(row => {
      row.hidden = q && !row.dataset.name.includes(q);
    });
  });

  document.getElementById('save-aisles')?.addEventListener('click', async () => {
    try {
      const updates = [...document.querySelectorAll('.aisle-input')].map(input => ({
        item_id: Number(input.dataset.id),
        aisle: input.value.trim() || null,
      }));
      const data = await api('/api/items/bulk-aisle', {
        method: 'POST',
        body: JSON.stringify({ updates }),
      });
      state.items = data.items;
      await loadAisles();
      toast(t('aisles.saved'), 'success');
      hideModal();
      if (state.view === 'items') renderItems();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function openItemForm(item = null, presetBarcode = '') {
  const isEdit = Boolean(item);
  showModal(isEdit ? 'Edit item' : 'Add item', `
    <form id="item-form" class="form-grid">
      <label>Name<input name="name" required value="${isEdit ? esc(item.name) : ''}"></label>
      <label>Product type<input name="category" required value="${isEdit ? esc(item.category) : ''}" placeholder="Snacks, Drinks…"></label>
      <label>Aisle / location<input name="aisle" value="${isEdit ? esc(item.aisle || '') : ''}" placeholder="Aisle 3, Counter, Freezer…"></label>
      <label>Barcode (optional)<input name="barcode" value="${isEdit ? esc(item.barcode || '') : esc(presetBarcode)}" inputmode="numeric"></label>
      <label>Unit
        <select name="unit">
          ${['each', 'case', 'pack'].map(u => `<option ${isEdit && item.unit === u ? 'selected' : ''}>${u}</option>`).join('')}
        </select>
      </label>
      <label>On hand<input name="on_hand" type="number" min="0" step="1" value="${isEdit ? item.on_hand : 0}" inputmode="numeric"></label>
      <label>Par (reorder point)<input name="par" type="number" min="0" step="1" value="${isEdit ? item.par : 0}" inputmode="numeric"></label>
      <button class="btn btn-primary" type="submit">${isEdit ? 'Save changes' : 'Add item'}</button>
      ${isEdit ? '<button type="button" class="btn btn-danger" id="delete-item">Delete item</button>' : ''}
    </form>
  `);

  document.getElementById('item-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const body = Object.fromEntries(new FormData(e.target));
      body.on_hand = Number(body.on_hand);
      body.par = Number(body.par);
      if (isEdit) {
        await api(`/api/items/${item.id}`, { method: 'PUT', body: JSON.stringify(body) });
        toast('Item updated', 'success');
      } else {
        await api('/api/items', { method: 'POST', body: JSON.stringify(body) });
        toast('Item added', 'success');
      }
      hideModal();
      await loadItems();
      await loadCategories();
      await loadAisles();
      await loadStats();
      if (state.view === 'items') renderItems();
      else await render();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  if (isEdit) {
    document.getElementById('delete-item').addEventListener('click', async () => {
      if (!confirm('Delete this item?')) return;
      try {
        await api(`/api/items/${item.id}`, { method: 'DELETE' });
        toast('Item deleted', 'success');
        hideModal();
        await loadItems();
        await loadCategories();
        renderItems();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }
}

function renderScanResult(item) {
  return `
    <div class="scan-result card item-card ${item.low ? 'low' : ''}" style="padding:1.25rem">
      <div class="item-card-head">
        <div>
          <h3>${esc(item.name)}</h3>
          <div class="item-meta">${esc(item.category)} · ${esc(item.barcode || '')}</div>
        </div>
        <span class="badge ${item.low ? 'badge-low' : 'badge-ok'}">${item.low ? 'Low' : 'OK'}</span>
      </div>
      <div class="qty-row">
        <button class="btn btn-ghost btn-sm btn-icon" id="scan-minus">−</button>
        <span class="qty" id="scan-qty">${item.on_hand}</span>
        <button class="btn btn-ghost btn-sm btn-icon" id="scan-plus">+</button>
        <span class="item-meta">par ${item.par}</span>
      </div>
      <div class="actions">
        <button class="btn btn-primary btn-sm" id="scan-delivery">+ Delivery</button>
        <button class="btn btn-ghost btn-sm" id="scan-set">Set count</button>
      </div>
    </div>
  `;
}

function normalizeBarcode(raw) {
  return String(raw ?? '').trim().replace(/[\s\-]/g, '');
}

function beepScan() {
  haptic();
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.value = 0.06;
    o.start();
    o.stop(ctx.currentTime + 0.08);
  } catch { /* silent fallback */ }
}

async function pauseScannerAfterScan() {
  if (!scanner || state.scanMode !== 'camera') return;
  try {
    await scanner.pause(true);
    scanPaused = true;
    document.getElementById('scan-resume-btn')?.removeAttribute('hidden');
    const hint = document.getElementById('scan-live-hint');
    if (hint) hint.textContent = t('scan.paused');
  } catch { /* ignore */ }
}

async function resumeScannerScan() {
  if (!scanner) return;
  try {
    await scanner.resume();
    scanPaused = false;
    document.getElementById('scan-resume-btn')?.setAttribute('hidden', '');
    const hint = document.getElementById('scan-live-hint');
    if (hint) hint.textContent = t('scan.scanning');
  } catch { /* ignore */ }
}

async function toggleScanTorch() {
  if (!scanner) return;
  try {
    scanTorchOn = !scanTorchOn;
    await scanner.applyVideoConstraints({
      advanced: [{ torch: scanTorchOn }],
    });
    const btn = document.getElementById('scan-torch-btn');
    if (btn) btn.textContent = scanTorchOn ? t('scan.torchOff') : t('scan.torch');
  } catch {
    toast(t('scan.torchFail'), 'error');
  }
}

async function handleBarcode(rawCode) {
  const code = normalizeBarcode(rawCode);
  if (!code) return;

  const now = Date.now();
  if (code === lastScanCode && now - lastScanAt < 2500) return;
  lastScanCode = code;
  lastScanAt = now;

  beepScan();
  await pauseScannerAfterScan();

  const lastEl = document.getElementById('scan-last-code');
  if (lastEl) lastEl.textContent = code;

  try {
    const data = await api(`/api/items/barcode/${encodeURIComponent(code)}`);
    document.getElementById('scan-output').innerHTML = renderScanResult(data.item);
    toast(`${t('scan.found')}: ${data.item.name}`, 'success');

    document.getElementById('scan-minus').onclick = async () => {
      const updated = await adjustItem(data.item.id, { delta: -1, reason: 'manual' });
      document.getElementById('scan-qty').textContent = updated.on_hand;
    };
    document.getElementById('scan-plus').onclick = async () => {
      const updated = await adjustItem(data.item.id, { delta: 1, reason: 'manual' });
      document.getElementById('scan-qty').textContent = updated.on_hand;
    };
    document.getElementById('scan-delivery').onclick = () => {
      showModal('Received delivery', `
        <form id="scan-del-form" class="form-grid">
          <label>Quantity for ${esc(data.item.name)}
            <input name="delta" type="number" min="1" step="1" required inputmode="numeric">
          </label>
          <button class="btn btn-primary" type="submit">Add to stock</button>
        </form>
      `);
      document.getElementById('scan-del-form').addEventListener('submit', async e => {
        e.preventDefault();
        const updated = await adjustItem(data.item.id, {
          delta: Number(new FormData(e.target).get('delta')),
          reason: 'delivery',
        });
        hideModal();
        document.getElementById('scan-qty').textContent = updated.on_hand;
      });
    };
    document.getElementById('scan-set').onclick = () => {
      showModal('Set count', `
        <form id="scan-set-form" class="form-grid">
          <label>New quantity
            <input name="set_to" type="number" min="0" value="${data.item.on_hand}" required inputmode="numeric">
          </label>
          <button class="btn btn-primary" type="submit">Save</button>
        </form>
      `);
      document.getElementById('scan-set-form').addEventListener('submit', async e => {
        e.preventDefault();
        const updated = await adjustItem(data.item.id, {
          set_to: Number(new FormData(e.target).get('set_to')),
          reason: 'count',
        });
        hideModal();
        document.getElementById('scan-qty').textContent = updated.on_hand;
      });
    };
  } catch {
    document.getElementById('scan-output').innerHTML = `
      <div class="empty card">
        <div class="empty-icon">?</div>
        <p>No item for barcode <strong>${esc(code)}</strong></p>
        <button class="btn btn-primary" id="add-from-scan" style="margin-top:1rem">Add this item</button>
      </div>
    `;
    document.getElementById('add-from-scan').onclick = () => openItemForm(null, code);
    toast('Barcode not in catalog', 'error');
  }
}

async function stopScanner() {
  if (!scanner) return;
  try { await scanner.stop(); } catch { /* ignore */ }
  try { scanner.clear(); } catch { /* ignore */ }
  scanner = null;
  scanTorchOn = false;
  scanPaused = false;
}

async function pickRearCameraId() {
  try {
    const cams = await Html5Qrcode.getCameras();
    if (!cams?.length) return { facingMode: 'environment' };
    const back = cams.find(c =>
      /back|rear|environment|wide|camera2 0/i.test(c.label)
    );
    return back?.id || cams[cams.length - 1].id;
  } catch {
    return { facingMode: 'environment' };
  }
}

async function startScanner() {
  if (typeof Html5Qrcode === 'undefined') {
    document.getElementById('scanner').innerHTML = `<div class="empty scan-error">${t('scan.noCamera')}</div>`;
    return;
  }

  await stopScanner();
  scanPaused = false;

  const formats = window.Html5QrcodeSupportedFormats
    ? [
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.QR_CODE,
      ]
    : undefined;

  scanner = new Html5Qrcode('scanner', {
    formatsToSupport: formats,
    verbose: false,
  });

  const config = {
    fps: 15,
    qrbox: (w, h) => {
      const width = Math.min(Math.floor(w * 0.92), 420);
      const height = Math.min(Math.floor(width * 0.42), 200);
      return { width, height };
    },
    aspectRatio: 1.777778,
    experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    disableFlip: false,
  };

  const cameraId = await pickRearCameraId();

  try {
    await scanner.start(
      cameraId,
      config,
      decoded => { if (decoded) handleBarcode(decoded); },
      () => {}
    );
    const hint = document.getElementById('scan-live-hint');
    if (hint) hint.textContent = t('scan.scanning');
  } catch {
    document.getElementById('scanner').innerHTML = `<div class="empty scan-error">${t('scan.noCamera')}</div>`;
  }
}

function openManualInput() {
  state.scanMode = 'manual';
  navigate('scan');
}

function renderScan() {
  const manual = state.scanMode === 'manual';
  main.innerHTML = `
    <section class="page scan-page">
      <div class="page-header">
        <h1>${t('scan.title')}</h1>
        <p>${t('scan.subtitle')}</p>
      </div>
      <div class="scan-mode-tabs no-print">
        <button type="button" class="scan-mode-btn ${manual ? '' : 'active'}" data-scan-mode="camera">${t('scan.camera')}</button>
        <button type="button" class="scan-mode-btn ${manual ? 'active' : ''}" data-scan-mode="manual">${t('scan.manual')}</button>
      </div>
      <div id="scan-camera-section" ${manual ? 'hidden' : ''}>
        <p class="scan-hint" id="scan-live-hint">${t('scan.scanning')}</p>
        <div class="scanner-wrap">
          <div id="scanner"></div>
          <div class="scan-target" aria-hidden="true"></div>
        </div>
        <div class="scan-controls no-print">
          <button type="button" class="btn btn-ghost btn-sm" id="scan-torch-btn">${t('scan.torch')}</button>
          <button type="button" class="btn btn-primary btn-sm" id="scan-resume-btn" hidden>${t('scan.resume')}</button>
          <span class="scan-last" id="scan-last-wrap">Last: <code id="scan-last-code">—</code></span>
        </div>
      </div>
      <div class="scan-manual no-print ${manual ? 'scan-manual-prominent' : ''}">
        <label class="scan-manual-label" for="manual-barcode">${t('scan.barcodeLabel')}</label>
        <div class="scan-manual-row">
          <input id="manual-barcode" placeholder="e.g. 02820000401" inputmode="numeric" autocomplete="off">
          <button class="btn btn-primary" id="manual-lookup">${t('scan.lookup')}</button>
        </div>
      </div>
      <div id="scan-output" style="margin-top:1rem"></div>
    </section>
  `;

  main.querySelectorAll('[data-scan-mode]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.scanMode;
      if (mode === state.scanMode) return;
      state.scanMode = mode;
      await stopScanner();
      renderScan();
    });
  });

  document.getElementById('manual-lookup').addEventListener('click', () => {
    const code = document.getElementById('manual-barcode').value.trim();
    if (code) handleBarcode(code);
    else toast(t('scan.enterBarcode'), 'error');
  });

  document.getElementById('manual-barcode').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const code = e.target.value.trim();
      if (code) handleBarcode(code);
    }
  });

  document.getElementById('scan-torch-btn')?.addEventListener('click', toggleScanTorch);
  document.getElementById('scan-resume-btn')?.addEventListener('click', async () => {
    lastScanCode = '';
    await resumeScannerScan();
  });

  if (manual) {
    document.getElementById('manual-barcode').focus();
  } else {
    startScanner();
  }
}

async function renderLowStock() {
  const data = await api('/api/low-stock');
  main.innerHTML = `
    <section class="page">
      <div class="page-header">
        <h1>Low stock</h1>
        <p>${data.count} item${data.count === 1 ? '' : 's'} need attention.</p>
      </div>
      <div class="card table-wrap">
        <table>
          <thead>
            <tr><th>Item</th><th class="hide-sm">Category</th><th>On hand</th><th>Need</th></tr>
          </thead>
          <tbody>
            ${data.items.map(item => {
              const pct = item.par > 0 ? Math.min(100, (item.need / item.par) * 100) : 100;
              return `
                <tr class="clickable" data-goto-item="${item.id}">
                  <td>${esc(item.name)}</td>
                  <td class="hide-sm">${esc(item.category)}</td>
                  <td>${item.on_hand} <span style="color:var(--gray-400)">/ ${item.par}</span></td>
                  <td>
                    <div class="urgency">
                      <strong>${item.need}</strong>
                      <div class="urgency-bar"><div class="urgency-fill" style="width:${pct}%"></div></div>
                    </div>
                  </td>
                </tr>
              `;
            }).join('') || '<tr><td colspan="4"><div class="empty"><div class="empty-icon">✓</div>Nothing low right now</div></td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;
  main.querySelectorAll('[data-goto-item]').forEach(row => {
    row.addEventListener('click', () => navigate('items'));
  });
}

async function renderReorder() {
  const data = await api('/api/reorder');
  const date = new Date(data.generated_at).toLocaleString();
  main.innerHTML = `
    <section class="page">
      <div class="page-header">
        <h1>Reorder sheet</h1>
        <p>Print or screenshot for your supplier run.</p>
      </div>
      <div class="toolbar no-print">
        <button class="btn btn-primary" onclick="window.print()">Print</button>
        <span class="item-meta" style="align-self:center">${data.items.length} items to order</span>
      </div>
      <div class="card table-wrap">
        <table>
          <thead>
            <tr><th>Item</th><th>Category</th><th>Unit</th><th>On hand</th><th>Order</th><th>Notes</th></tr>
          </thead>
          <tbody>
            ${data.items.map(item => `
              <tr>
                <td>${esc(item.name)}</td>
                <td>${esc(item.category)}</td>
                <td>${esc(item.unit)}</td>
                <td>${item.on_hand}</td>
                <td><strong>${item.need}</strong></td>
                <td></td>
              </tr>
            `).join('') || '<tr><td colspan="6"><div class="empty">Nothing to reorder</div></td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="print-area">
        <h2>${esc(data.business.name)} — Reorder list</h2>
        <p>Generated ${date} · ${InventiPrefs.APP_NAME} by shavi labs</p>
      </div>
    </section>
  `;
}

function renderSettings() {
  const lang = InventiPrefs.readLang();
  const theme = InventiPrefs.readTheme();
  const a = mergeAlerts(state.alertSettings);
  const langOptions = InventiPrefs.LANGS.map(l =>
    `<option value="${l.code}" ${l.code === lang ? 'selected' : ''}>${l.native}</option>`
  ).join('');

  main.innerHTML = `
    <section class="page settings-page">
      <div class="page-header">
        <h1>${t('settings.title')}</h1>
        <p>${t('settings.subtitle')}</p>
      </div>

      <div class="card" style="padding:1.25rem">
        <div class="settings-section">
          <h2>${t('settings.language')}</h2>
          <p class="settings-hint">${t('settings.languageHint')}</p>
          <div class="settings-row">
            <select id="lang-select">${langOptions}</select>
          </div>
        </div>

        <div class="settings-section">
          <h2>${t('settings.appearance')}</h2>
          <div class="theme-picker">
            <button type="button" class="theme-opt ${theme === 'light' ? 'active' : ''}" data-theme="light">${t('settings.themeLight')}</button>
            <button type="button" class="theme-opt ${theme === 'dark' ? 'active' : ''}" data-theme="dark">${t('settings.themeDark')}</button>
            <button type="button" class="theme-opt ${theme === 'system' ? 'active' : ''}" data-theme="system">${t('settings.themeSystem')}</button>
          </div>
        </div>

        <div class="settings-section">
          <h2>${t('settings.alerts')}</h2>
          <p class="settings-hint">${t('settings.alertsHint')}</p>
          ${alertSettingsHtml(a, 'settings', false)}
          <button class="btn btn-primary" id="save-alerts-btn" style="margin-top:.75rem">${t('settings.saveAlerts')}</button>
        </div>

        <div class="settings-section">
          <button class="btn btn-ghost" id="settings-account-btn">${t('dash.account')}</button>
        </div>
      </div>
    </section>
  `;

  document.getElementById('lang-select')?.addEventListener('change', async e => {
    await InventiPrefs.loadLanguage(e.target.value);
    await render();
  });

  main.querySelectorAll('[data-theme]').forEach(btn => {
    btn.addEventListener('click', async () => {
      InventiPrefs.applyTheme(btn.dataset.theme);
      await render();
    });
  });

  bindAlertSave('save-alerts-btn', 'settings');

  document.getElementById('settings-account-btn')?.addEventListener('click', showAccountModal);
}

function showAccountModal() {
  const autoLogin = prefBool(PREFS.autoLogin, true);
  showModal(t('account.title'), `
    <div class="account-panel">
      <p class="account-intro">${t('account.intro')}</p>
      <label class="check-row">
        <input type="checkbox" id="acct-auto-login" ${autoLogin ? 'checked' : ''}>
        <span>${t('account.autoSignIn')}</span>
      </label>
      <div class="account-actions">
        <button class="btn btn-ghost" id="export-data-btn">${t('account.export')}</button>
        <button class="btn btn-ghost" id="forget-device-btn">${t('account.forgetDevice')}</button>
        <button class="btn btn-ghost danger" id="delete-account-btn">${t('account.deleteStore')}</button>
      </div>
      <p class="auth-legal" style="margin-top:1rem">
        <a href="/privacy" target="_blank" rel="noopener">${t('common.privacy')}</a> ·
        <a href="/terms" target="_blank" rel="noopener">${t('common.terms')}</a>
      </p>
    </div>
  `);

  document.getElementById('acct-auto-login')?.addEventListener('change', async e => {
    const on = e.target.checked;
    setPrefBool(PREFS.autoLogin, on);
    if (!on) {
      await api('/api/auth/forget-device', { method: 'POST' });
      toast(t('toast.autoSignInOff'), 'success');
    } else {
      toast(t('toast.autoSignInOn'), 'success');
    }
  });

  document.getElementById('export-data-btn')?.addEventListener('click', async () => {
    try {
      const data = await api('/api/privacy/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `inventi-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast(t('toast.exported'), 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('forget-device-btn')?.addEventListener('click', async () => {
    try {
      await api('/api/auth/forget-device', { method: 'POST' });
      setPrefBool(PREFS.autoLogin, false);
      toast(t('toast.deviceRemoved'), 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('delete-account-btn')?.addEventListener('click', () => {
    hideModal();
    showModal(t('account.deleteTitle'), `
      <form id="delete-account-form" class="form-grid">
        <p class="account-intro danger-text">${t('account.deleteWarn')}</p>
        <label>${t('auth.pin')}
          <input name="pin" type="password" required inputmode="numeric">
        </label>
        <label>${t('account.deleteConfirm')}
          <input name="confirm" required placeholder="DELETE">
        </label>
        <button class="btn btn-primary danger" type="submit">${t('account.deleteBtn')}</button>
      </form>
    `);
    document.getElementById('delete-account-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const fd = new FormData(e.target);
        await api('/api/privacy/delete-account', {
          method: 'POST',
          body: JSON.stringify({
            pin: String(fd.get('pin') || ''),
            confirm: String(fd.get('confirm') || ''),
          }),
        });
        hideModal();
        writePref(PREFS.storeCode, null);
        setPrefBool(PREFS.saveStoreCode, false);
        state.authenticated = false;
        state.business = null;
        toast(t('toast.accountDeleted'), 'success');
        await render();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

function bindViewButtons() {
  main.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.view));
  });
}

async function render() {
  if (!state.authenticated || !state.business) {
    await stopScanner();
    if (topbarSettingsBtn) topbarSettingsBtn.hidden = true;
    renderAuth();
    return;
  }

  topbar.hidden = false;
  bottomNav.hidden = false;
  appFooter.hidden = false;
  businessNameEl.textContent = state.business.name;
  renderNav();
  maybeShowInstallBanner();

  if (state.view !== 'scan') await stopScanner();

  if (state.view === 'dashboard') {
    const data = await loadBusiness();
    await loadStats();
    await loadItems();
    renderDashboard(data);
    checkAlerts();
  } else if (state.view === 'items') {
    await loadSettings();
    await loadCategories();
    await loadAisles();
    await loadItems();
    renderItems();
  } else if (state.view === 'scan') {
    renderScan();
  } else if (state.view === 'low-stock') {
    await renderLowStock();
  } else if (state.view === 'reorder') {
    await renderReorder();
  } else if (state.view === 'settings') {
    await loadSettings();
    renderSettings();
  }
}

async function navigate(view) {
  state.view = view;
  await render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function init() {
  await InventiPrefs.initPrefs();
  state.initializing = true;
  try {
    if (!prefBool(PREFS.autoLogin, true)) {
      await api('/api/auth/forget-device', { method: 'POST' }).catch(() => {});
    }
    const data = await loadSession();
    if (data.auto_login) {
      toast(t('toast.autoLogin'), 'success');
    }
  } catch {
    state.authenticated = false;
    state.business = null;
  } finally {
    state.initializing = false;
  }
  if (state.authenticated) {
    await loadSettings();
    await loadStats();
    await loadItems();
    state.view = 'dashboard';
  }
  await render();
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstall = e;
  maybeShowInstallBanner();
});

installBtn?.addEventListener('click', async () => {
  if (deferredInstall) {
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    installBanner.hidden = true;
  } else if (/iphone|ipad/i.test(navigator.userAgent)) {
    toast('Tap Share → Add to Home Screen');
  }
});

installDismiss?.addEventListener('click', () => {
  installBanner.hidden = true;
  sessionStorage.setItem('install-dismissed', '1');
});

function maybeShowInstallBanner() {
  if (!state.authenticated || sessionStorage.getItem('install-dismissed')) return;
  const standalone = window.matchMedia('(display-mode: standalone)').matches;
  if (!standalone && (deferredInstall || /iphone|ipad|android/i.test(navigator.userAgent))) {
    installBanner.hidden = false;
  }
}

init().catch(err => {
  main.innerHTML = `<section class="page"><div class="empty card">Failed to load: ${esc(err.message)}</div></section>`;
});
