/* Тонкий клиент Xsolla Store API (v2) и Login API (OAuth 2.0).
 * Всё вызывается из браузера, без секретов — только публичные ID + JWT пользователя. */
(function () {
  const { C, profile } = window.U;
  const STORE = `${C.api.store}/project/${profile.projectId}`;
  const LOGIN = C.api.login;

  class ApiError extends Error {
    constructor(status, body, url) {
      const msg = (body && (body.errorMessage || (body.error && body.error.description) || body.message)) || `HTTP ${status}`;
      super(msg);
      this.status = status; this.body = body; this.url = url;
      this.code = body && (body.errorCode || (body.error && body.error.code));
    }
  }

  async function request(url, { method = 'GET', headers = {}, body, form, token } = {}) {
    const h = { Accept: 'application/json', ...headers };
    let payload;
    if (form) { h['Content-Type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString(); }
    else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    if (token) h['Authorization'] = 'Bearer ' + token;
    const res = await fetch(url, { method, headers: h, body: payload });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) throw new ApiError(res.status, data, url);
    return data;
  }

  /* ---------------- Store API (каталог, заказы, инвентарь) ---------------- */
  const Store = {
    /** Get virtual items list — публичный, без авторизации. */
    async virtualItems({ token } = {}) {
      const items = [];
      let offset = 0;
      for (;;) {
        const q = new URLSearchParams({ limit: '50', offset: String(offset), locale: C.locale });
        q.append('additional_fields[]', 'long_description');
        q.append('additional_fields[]', 'media_list');
        const d = await request(`${STORE}/items/virtual_items?${q}`, { token });
        items.push(...d.items);
        if (!d.has_more) break;
        offset += 50;
      }
      return items;
    },
    async groups() {
      const d = await request(`${STORE}/items/groups?locale=${C.locale}`);
      return d.groups || [];
    },
    /** Create order with specified item (fast purchase by SKU) → { token, order_id }. */
    async createOrder(sku, token, { quantity = 1 } = {}) {
      return request(`${STORE}/payment/item/${encodeURIComponent(sku)}`, {
        method: 'POST', token,
        body: {
          sandbox: !!C.sandbox,
          quantity,
          settings: { language: C.locale, ui: { theme: C.payStationTheme, size: 'medium' } }
        }
      });
    },
    /** Create order with specified free item → { order_id } (сразу done). */
    async createFreeOrder(sku, token) {
      return request(`${STORE}/free/item/${encodeURIComponent(sku)}`, { method: 'POST', token, body: { quantity: 1 } });
    },
    /** Get order → { order_id, status: new|paid|done|canceled|expired, content } */
    async getOrder(orderId, token) {
      return request(`${STORE}/order/${orderId}`, { token });
    },
    /** Get the current user's inventory → { items: [...] } */
    async inventory(token) {
      const d = await request(`${STORE}/user/inventory/items?limit=50&platform=xsolla`, { token });
      return d.items || [];
    }
  };

  /* ---------------- Login API (OAuth 2.0, публичный клиент) ---------------- */
  const L = profile.login;
  const oauthQuery = (extra = {}) => new URLSearchParams({
    client_id: String(L.clientId), response_type: 'code', redirect_uri: L.redirectUri,
    state: window.U.hex(32), scope: 'offline', ...extra
  }).toString();

  const Login = {
    configured() { return Boolean(L.projectId && L.clientId); },

    /** [OAuth 2.0] JWT auth by username and password → { access_token, refresh_token, expires_in } */
    async password(username, password) {
      return request(`${LOGIN}/oauth2/login/token?client_id=${L.clientId}&scope=offline`, {
        method: 'POST', body: { username, password }
      });
    },
    /** [OAuth 2.0] Register new user → 204 (письмо с подтверждением) или { login_url } */
    async register({ username, email, password }) {
      return request(`${LOGIN}/oauth2/user?${oauthQuery()}`, {
        method: 'POST', body: { username, email, password, accept_consent: true }
      });
    },
    /** [OAuth 2.0] Auth via device ID → { login_url: "...?code=..." }; code обменивается на токен. */
    async device(deviceId, deviceName) {
      const d = await request(`${LOGIN}/oauth2/login/device/android?${oauthQuery()}`, {
        method: 'POST', body: { device: deviceName, device_id: deviceId }
      });
      const code = new URL(d.login_url).searchParams.get('code');
      return Login.exchangeCode(code);
    },
    /** [OAuth 2.0] Generate JWT (grant_type=authorization_code) */
    async exchangeCode(code) {
      return request(`${LOGIN}/oauth2/token`, {
        method: 'POST', form: { grant_type: 'authorization_code', client_id: L.clientId, code, redirect_uri: L.redirectUri }
      });
    },
    /** [OAuth 2.0] Generate JWT (grant_type=refresh_token) */
    async refresh(refreshToken) {
      return request(`${LOGIN}/oauth2/token`, {
        method: 'POST', form: { grant_type: 'refresh_token', client_id: L.clientId, refresh_token: refreshToken }
      });
    },
    /** Get user details */
    async me(token) { return request(`${LOGIN}/users/me`, { token }); },
    /** Update user details (nickname и т.п.) */
    async updateMe(token, patch) { return request(`${LOGIN}/users/me`, { method: 'PATCH', token, body: patch }); }
  };

  window.Xsolla = { Store, Login, ApiError, STORE_BASE: STORE };
})();
