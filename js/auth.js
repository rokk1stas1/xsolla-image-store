/* Сессия пользователя: хранение токенов, авто-refresh, модальное окно входа. */
(function () {
  const { store, toast, decodeJwt, profile, hex } = window.U;
  const { Login } = window.Xsolla;

  const listeners = new Set();
  let session = store.get('session', null); // { access_token, refresh_token, expires_at }
  let user = null;                            // кэш Get user details
  let refreshing = null;

  function emit() { listeners.forEach(fn => { try { fn(Auth.isLoggedIn()); } catch (e) { console.error(e); } }); }

  function saveTokens(t) {
    session = {
      access_token: t.access_token,
      refresh_token: t.refresh_token || (session && session.refresh_token) || null,
      expires_at: Date.now() + (Number(t.expires_in || 300) * 1000)
    };
    store.set('session', session);
    user = null;
    emit();
  }

  const Auth = {
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    isLoggedIn() { return Boolean(session && session.access_token); },
    claims() { return session ? decodeJwt(session.access_token) : null; },

    /** Действительный access_token (обновляет за 60 с до истечения). */
    async token() {
      if (!session) return null;
      if (Date.now() < session.expires_at - 60_000) return session.access_token;
      if (!session.refresh_token) { Auth.logout(); return null; }
      if (!refreshing) {
        refreshing = Login.refresh(session.refresh_token)
          .then(t => { saveTokens(t); return session.access_token; })
          .catch(err => { console.warn('refresh failed', err); Auth.logout(); toast('Сессия истекла, войдите снова', 'warn'); return null; })
          .finally(() => { refreshing = null; });
      }
      return refreshing;
    },

    async me(force = false) {
      if (user && !force) return user;
      const t = await Auth.token();
      if (!t) return null;
      user = await Login.me(t);
      return user;
    },

    async loginPassword(username, password) { saveTokens(await Login.password(username, password)); },
    async register(data) { return Login.register(data); },
    async loginGuest() {
      let id = store.get('device_id');
      if (!id) { id = hex(16); store.set('device_id', id); }
      const brands = (navigator.userAgentData && navigator.userAgentData.brands || []).map(b => b.brand).filter(b => !/not.?a.?brand/i.test(b));
      const name = brands.at(-1) || navigator.platform || 'Web browser';
      saveTokens(await Login.device(id, String(name).slice(0, 100)));
    },
    logout() { session = null; user = null; store.del('session'); emit(); }
  };

  /* -------- UI: кнопка в шапке и модалка -------- */
  const area = document.getElementById('auth-area');
  const modal = document.getElementById('auth-modal');
  const errBox = document.getElementById('auth-error');

  function renderHeader() {
    area.innerHTML = '';
    if (!Auth.isLoggedIn()) {
      const b = window.U.el('button', { class: 'btn btn-primary', id: 'btn-login', onClick: () => Auth.openModal() }, 'Войти');
      area.append(b);
      return;
    }
    const chip = window.U.el('a', { class: 'user-chip', href: '#/profile', title: 'Профиль' });
    const av = window.U.el('span', { class: 'avatar' }, '…');
    const nm = window.U.el('span', { class: 'name' }, 'Пользователь');
    chip.append(av, nm);
    area.append(chip, window.U.el('button', { class: 'btn btn-ghost btn-sm', onClick: () => { Auth.logout(); toast('Вы вышли из аккаунта'); } }, 'Выйти'));
    Auth.me().then(u => {
      if (!u) return;
      const label = u.nickname || u.username || u.email || (u.is_anonymous ? 'Гость' : u.id.slice(0, 8));
      nm.textContent = label;
      if (u.picture) { const img = document.createElement('img'); img.src = u.picture; img.alt = ''; av.replaceWith(img); }
      else av.textContent = label.slice(0, 1).toUpperCase();
    }).catch(() => {});
  }

  Auth.openModal = function (tab = 'login') {
    if (!Login.configured()) {
      toast(`Логин не настроен для профиля «${profile.title}»: впишите Login ID и OAuth client ID в config.js`, 'warn', 7000);
      return;
    }
    switchTab(tab);
    errBox.hidden = true;
    modal.hidden = false;
    setTimeout(() => modal.querySelector('.tab-panel:not([hidden]) input')?.focus(), 30);
  };
  Auth.closeModal = () => { modal.hidden = true; };

  function switchTab(name) {
    modal.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    modal.querySelectorAll('.tab-panel').forEach(p => { p.hidden = p.dataset.panel !== name; });
    errBox.hidden = true;
  }
  function showError(err) {
    errBox.textContent = err && err.message ? err.message : String(err);
    errBox.hidden = false;
  }
  async function busy(form, fn) {
    const btn = form.querySelector('button[type=submit], button');
    const old = btn.textContent; btn.disabled = true; btn.textContent = 'Подождите…';
    try { await fn(); } catch (e) { showError(e); } finally { btn.disabled = false; btn.textContent = old; }
  }

  modal.addEventListener('click', e => { if (e.target.hasAttribute('data-close')) Auth.closeModal(); });
  modal.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) Auth.closeModal(); });

  document.getElementById('form-login').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    busy(e.target, async () => {
      await Auth.loginPassword(f.get('username').trim(), f.get('password'));
      Auth.closeModal(); toast('Вы вошли в аккаунт', 'ok');
    });
  });
  document.getElementById('form-register').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    busy(e.target, async () => {
      const r = await Auth.register({ username: f.get('username').trim(), email: f.get('email').trim(), password: f.get('password') });
      if (r && r.login_url) {
        const code = new URL(r.login_url).searchParams.get('code');
        if (code) { saveTokens(await Login.exchangeCode(code)); Auth.closeModal(); toast('Аккаунт создан, вы вошли', 'ok'); return; }
      }
      Auth.closeModal();
      toast('Аккаунт создан. Подтвердите e-mail по ссылке из письма, затем войдите.', 'ok', 8000);
    });
  });
  document.getElementById('panel-guest').addEventListener('click', e => {
    if (e.target.id !== 'btn-guest') return;
    busy(e.currentTarget, async () => { await Auth.loginGuest(); Auth.closeModal(); toast('Вы вошли как гость', 'ok'); });
  });

  document.getElementById('auth-project-hint').textContent =
    `Xsolla Login project ${profile.login.projectId || '—'} · OAuth 2.0 client ${profile.login.clientId || '—'}`;

  Auth.onChange(renderHeader);
  renderHeader();
  window.Auth = Auth;
})();
