/* Общие утилиты: профиль конфига, DOM, localStorage, тосты. */
(function () {
  const C = window.APP_CONFIG;

  // Выбор профиля: ?profile=... в URL имеет приоритет над config.activeProfile.
  const qs = new URLSearchParams(location.search);
  const profileKey = C.profiles[qs.get('profile')] ? qs.get('profile') : C.activeProfile;
  const profile = C.profiles[profileKey];

  const storagePrefix = 'xis:' + profileKey + ':';
  const store = {
    get(key, def) {
      try { const v = localStorage.getItem(storagePrefix + key); return v === null ? def : JSON.parse(v); }
      catch { return def; }
    },
    set(key, val) { localStorage.setItem(storagePrefix + key, JSON.stringify(val)); },
    del(key) { localStorage.removeItem(storagePrefix + key); }
  };

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const ch of children.flat()) {
      if (ch === null || ch === undefined || ch === false) continue;
      node.append(ch instanceof Node ? ch : document.createTextNode(String(ch)));
    }
    return node;
  }

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function toast(msg, kind = '', ms = 4200) {
    const box = document.getElementById('toasts');
    const t = el('div', { class: 'toast ' + kind }, msg);
    box.append(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, ms);
  }

  function fmtPrice(p) {
    if (!p) return null;
    const amount = Number(p.amount);
    try { return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: p.currency }).format(amount); }
    catch { return amount + ' ' + p.currency; }
  }

  function fmtCountdown(ms) {
    if (ms <= 0) return '00:00';
    const s = Math.ceil(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('ru-RU'); } catch { return iso; }
  }

  function decodeJwt(token) {
    try {
      const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(part))));
    } catch { return null; }
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
  }

  function hex(n) {
    const b = crypto.getRandomValues(new Uint8Array(n / 2));
    return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  }

  window.U = { C, profile, profileKey, store, el, esc, toast, fmtPrice, fmtCountdown, fmtDate, decodeJwt, uuid, hex };
})();
