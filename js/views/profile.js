/* Профиль: данные пользователя (Login «Get user details» + claims JWT) и инвентарь (Store «Get user inventory»). */
(function () {
  const { el, fmtDate, profile, toast } = window.U;
  const { Store } = window.Xsolla;

  window.Views = window.Views || {};
  window.Views.profile = async function (root) {
    root.innerHTML = '';
    if (!window.Auth.isLoggedIn()) {
      root.append(el('div', { class: 'page-head' }, el('div', null, el('h1', null, 'Профиль'), el('p', null, 'Войдите, чтобы увидеть свои данные и купленные картинки'))));
      root.append(el('div', { class: 'empty' },
        el('p', null, 'Вы не вошли в аккаунт.'),
        el('button', { class: 'btn btn-primary', onClick: () => window.Auth.openModal() }, 'Войти')));
      return;
    }

    root.append(el('div', { class: 'loading' }, 'Загружаем профиль и инвентарь…'));
    const token = await window.Auth.token();
    if (!token) { root.innerHTML = ''; root.append(el('div', { class: 'empty' }, 'Сессия истекла, войдите снова')); return; }

    const [user, inv, catalog] = await Promise.all([
      window.Auth.me(true).catch(e => ({ _error: e })),
      Store.inventory(token).catch(e => ({ _error: e })),
      Store.virtualItems().catch(() => [])
    ]);
    const claims = window.Auth.claims() || {};
    const bySku = new Map(catalog.map(i => [i.sku, i]));

    root.innerHTML = '';
    root.append(el('div', { class: 'page-head' }, el('div', null, el('h1', null, 'Профиль'), el('p', null, 'Данные из Xsolla Login и инвентарь из Xsolla Store'))));

    /* --- Карточка пользователя --- */
    const label = user && !user._error ? (user.nickname || user.username || user.email || (user.is_anonymous ? 'Гость' : 'Пользователь')) : 'Пользователь';
    const av = el('div', { class: 'avatar-lg' }, user && user.picture ? el('img', { src: user.picture, alt: '' }) : label.slice(0, 1).toUpperCase());
    const kv = el('dl', { class: 'kv' });
    const row = (k, v) => kv.append(el('dt', null, k), el('dd', null, v ?? '—'));
    if (user && !user._error) {
      row('Имя', label);
      row('User ID (sub)', user.id);
      row('E-mail', user.email || (user.is_anonymous ? 'гость (device ID)' : '—'));
      row('Тип аккаунта', user.is_anonymous ? 'анонимный (device ID)' : 'полный');
      row('Зарегистрирован', fmtDate(user.registered));
      row('Последний вход', fmtDate(user.last_login));
      if (user.devices && user.devices.length) row('Устройства', user.devices.map(d => `${d.device} (${d.type})`).join(', '));
    } else {
      row('Ошибка', user && user._error ? user._error.message : 'нет данных');
    }
    row('Login project', claims.xsolla_login_project_id || profile.login.projectId);
    row('JWT истекает', claims.exp ? fmtDate(claims.exp * 1000) : '—');

    const userPanel = el('div', { class: 'panel' }, av, el('h2', null, label), kv);
    if (user && !user._error && !user.is_anonymous) {
      const form = el('form', { style: 'margin-top:14px', onSubmit: async (e) => {
        e.preventDefault();
        const nick = new FormData(e.target).get('nickname').trim();
        try { await window.Xsolla.Login.updateMe(await window.Auth.token(), { nickname: nick }); toast('Никнейм обновлён', 'ok'); window.Views.profile(root); }
        catch (err) { toast(`Не удалось обновить: ${err.message}`, 'err'); }
      } });
      form.append(el('label', { class: 'hint' }, 'Никнейм', el('input', { name: 'nickname', value: user.nickname || '', style: 'display:block;width:100%;margin-top:4px;padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:var(--bg-2);color:var(--text)' })),
        el('button', { class: 'btn btn-sm', style: 'margin-top:8px', type: 'submit' }, 'Сохранить'));
      userPanel.append(form);
    }
    userPanel.append(el('button', { class: 'btn btn-ghost btn-sm', style: 'margin-top:14px', onClick: () => { window.Auth.logout(); location.hash = '#/'; } }, 'Выйти'));

    /* --- Инвентарь --- */
    const invPanel = el('div', { class: 'panel' });
    const head = el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px' },
      el('h2', { style: 'margin:0' }, 'Мои картинки'),
      el('button', { class: 'btn btn-sm', onClick: () => window.Views.profile(root) }, '↻ Обновить'));
    invPanel.append(head);

    if (inv._error) {
      invPanel.append(el('div', { class: 'notice warn' }, `Инвентарь недоступен: ${inv._error.message}`));
    } else if (!inv.length) {
      invPanel.append(el('div', { class: 'empty' }, 'Пока пусто. Купите картинку на витрине — после оплаты в песочнице она появится здесь.'));
    } else {
      const grid = el('div', { class: 'grid' });
      inv.forEach(it => {
        const cat = bySku.get(it.sku);
        grid.append(el('article', { class: 'card' },
          el('div', { class: 'card-img' }, el('img', { src: it.image_url || (cat && cat.image_url) || '', alt: it.name })),
          el('div', { class: 'card-body' },
            el('h3', { class: 'card-title' }, it.name || it.sku),
            el('p', { class: 'card-desc' }, it.description || (cat && cat.description) || ''),
            el('div', { class: 'card-foot' },
              el('span', { class: 'badge badge-ok' }, `× ${it.quantity ?? 1}`),
              el('span', { class: 'hint', style: 'margin:0' }, it.sku)))));
      });
      invPanel.append(grid);
    }

    /* --- Локальные награды (квест / таймеры без реальной выдачи) --- */
    const local = window.Unlock.localRewards();
    if (local.length) {
      const lp = el('div', { class: 'panel' }, el('h2', null, 'Награды, выданные локально'),
        el('div', { class: 'notice', style: 'margin-bottom:12px' }, 'В этом проекте у SKU-награды нет бесплатной цены, поэтому Store API не может её выдать (POST /free/item → «Item is not free»). Награда хранится в localStorage этого браузера.'));
      const grid = el('div', { class: 'grid' });
      local.forEach(r => {
        const cat = bySku.get(r.sku);
        grid.append(el('article', { class: 'card' },
          el('div', { class: 'card-img' }, el('img', { src: cat ? cat.image_url : '', alt: r.sku })),
          el('div', { class: 'card-body' },
            el('h3', { class: 'card-title' }, cat ? cat.name : r.sku),
            el('p', { class: 'card-desc' }, `Источник: ${r.source === 'quest' ? 'квест (видео)' : 'таймер'} · ${fmtDate(r.at)}`))));
      });
      lp.append(grid, el('button', { class: 'btn btn-ghost btn-sm', style: 'margin-top:12px', onClick: () => window.Unlock.reset() }, 'Сбросить локальные награды и таймеры'));
      root.append(el('div', { class: 'two-col' }, userPanel, el('div', null, invPanel, lp)));
      return;
    }

    root.append(el('div', { class: 'two-col' }, userPanel, invPanel));
  };
})();
