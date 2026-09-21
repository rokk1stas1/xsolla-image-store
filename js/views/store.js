/* Витрина: живой каталог Store API, фильтр по группам, таймеры, покупка. */
(function () {
  const { el, toast, fmtPrice, fmtCountdown, profile, C } = window.U;
  const { Store } = window.Xsolla;

  let catalogCache = null;
  let inventorySkus = new Set();
  let currentGroup = 'all';
  let tickTimer = null;

  async function loadCatalog(force) {
    if (catalogCache && !force) return catalogCache;
    const token = window.Auth.isLoggedIn() ? await window.Auth.token() : null;
    let items = await Store.virtualItems({ token }); // с JWT — персональные лимиты
    if (profile.skuAllowlist && profile.skuAllowlist.length) items = items.filter(i => profile.skuAllowlist.includes(i.sku));
    catalogCache = items;
    return items;
  }
  async function loadInventory() {
    inventorySkus = new Set();
    if (!window.Auth.isLoggedIn()) return;
    try {
      const token = await window.Auth.token();
      const inv = await Store.inventory(token);
      inventorySkus = new Set(inv.map(i => i.sku));
    } catch (e) { console.warn('inventory', e); }
  }

  function priceLabel(item) {
    if (item.price) return fmtPrice(item.price);
    if (item.is_free) return 'Бесплатно';
    if (item.virtual_prices && item.virtual_prices.length) {
      const vp = item.virtual_prices[0];
      return `${vp.amount} ${vp.name || vp.sku}`;
    }
    return '—';
  }

  function renderCard(item) {
    const remaining = window.Unlock.remaining(item.sku);
    const locked = remaining !== null && remaining > 0;
    const owned = inventorySkus.has(item.sku) || window.Unlock.hasLocalReward(item.sku);
    const card = el('article', { class: 'card' + (locked ? ' locked' : ''), dataset: { sku: item.sku } });

    const tags = el('div', { class: 'card-tags' });
    if (owned) tags.append(el('span', { class: 'badge badge-ok' }, inventorySkus.has(item.sku) ? 'в инвентаре' : 'получено локально'));
    if (item.is_free) tags.append(el('span', { class: 'badge badge-accent' }, 'free'));
    if (remaining === 0 && window.Unlock.isTimed(item.sku)) tags.append(el('span', { class: 'badge badge-muted' }, 'открыто по таймеру'));

    const imgWrap = el('div', { class: 'card-img' }, tags,
      el('img', { src: item.image_url, alt: item.name, loading: 'lazy' }));
    if (locked) {
      imgWrap.append(el('div', { class: 'lock-overlay' },
        el('div', { class: 'lock-icon', html: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>' }),
        el('div', { class: 'timer', dataset: { timer: item.sku } }, fmtCountdown(remaining)),
        el('div', { class: 'lock-label' }, 'откроется через')));
    }

    const foot = el('div', { class: 'card-foot' });
    foot.append(el('span', { class: 'price' }, priceLabel(item)));

    if (locked) {
      foot.append(el('button', { class: 'btn btn-sm', disabled: true }, 'Закрыто'));
    } else if (window.Unlock.isTimed(item.sku) && !window.Unlock.isUnlocked(item.sku) && item.is_free) {
      foot.append(el('button', { class: 'btn btn-sm btn-primary', onClick: async (e) => {
        e.target.disabled = true;
        if (!window.Auth.isLoggedIn()) { toast('Войдите, чтобы получить картинку в инвентарь', 'warn'); window.Auth.openModal(); e.target.disabled = false; return; }
        await window.Unlock.grant(item, 'timer');
        await refresh();
      } }, 'Забрать'));
    } else if (item.price) {
      foot.append(el('button', { class: 'btn btn-sm btn-primary', onClick: (e) => buy(item, e.target) }, owned ? 'Купить ещё' : 'Купить'));
    } else if (item.is_free) {
      foot.append(el('button', { class: 'btn btn-sm btn-primary', onClick: async (e) => {
        e.target.disabled = true;
        if (!window.Auth.isLoggedIn()) { toast('Войдите, чтобы получить картинку', 'warn'); window.Auth.openModal(); e.target.disabled = false; return; }
        try { const t = await window.Auth.token(); const r = await Store.createFreeOrder(item.sku, t); toast(`Получено! Заказ #${r.order_id}`, 'ok'); await refresh(); }
        catch (err) { toast(`Не удалось: ${err.message}`, 'err', 6000); e.target.disabled = false; }
      } }, 'Получить'));
    } else {
      foot.append(el('button', { class: 'btn btn-sm', disabled: true, title: 'Цена только в виртуальной валюте' }, 'За валюту'));
    }

    card.append(imgWrap, el('div', { class: 'card-body' },
      el('h3', { class: 'card-title' }, item.name),
      el('p', { class: 'card-desc' }, item.description || ''),
      foot));
    return card;
  }

  async function buy(item, btn) {
    btn.disabled = true; const old = btn.textContent; btn.textContent = 'Создаём заказ…';
    try {
      await window.Payment.buy(item);
      await refresh();
    } catch (e) { /* toast уже показан */ }
    finally { btn.disabled = false; btn.textContent = old; }
  }

  function startTicker(root) {
    clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      let needRerender = false;
      root.querySelectorAll('[data-timer]').forEach(node => {
        const rem = window.Unlock.remaining(node.dataset.timer);
        if (rem <= 0) needRerender = true;
        else node.textContent = fmtCountdown(rem);
      });
      if (needRerender) {
        // Таймер истёк: авто-выдача бесплатных SKU вошедшему пользователю, иначе просто открываем картинку.
        const expired = [...root.querySelectorAll('[data-timer]')].map(n => n.dataset.timer).filter(s => window.Unlock.remaining(s) <= 0);
        (async () => {
          for (const sku of expired) {
            const item = (catalogCache || []).find(i => i.sku === sku);
            if (!item) continue;
            if (item.is_free && window.Auth.isLoggedIn()) await window.Unlock.grant(item, 'timer');
            else toast(`«${item.name}» разблокирована!`, 'ok');
          }
          await refresh();
        })();
      }
    }, 1000);
  }

  let rootEl = null;
  async function refresh() {
    if (!rootEl || !document.body.contains(rootEl)) return;
    await loadInventory();
    renderGrid();
  }

  function renderGrid() {
    const grid = rootEl.querySelector('#grid');
    if (!grid) return;
    grid.innerHTML = '';
    const items = (catalogCache || []).filter(i => currentGroup === 'all' || (i.groups || []).some(g => g.external_id === currentGroup));
    if (!items.length) { grid.append(el('div', { class: 'empty' }, 'В этой группе пока нет картинок')); return; }
    items.forEach(i => grid.append(renderCard(i)));
    startTicker(grid);
  }

  window.Views = window.Views || {};
  window.Views.store = async function (root) {
    rootEl = root;
    root.innerHTML = '';
    root.append(el('div', { class: 'loading' }, 'Загружаем каталог из Xsolla Store API…'));
    let items, groups = [];
    try {
      [items] = await Promise.all([loadCatalog(true), loadInventory()]);
      try { groups = await Store.groups(); } catch {}
    } catch (e) {
      root.innerHTML = '';
      root.append(el('div', { class: 'notice warn' }, `Не удалось загрузить каталог проекта ${profile.projectId}: ${e.message}`));
      return;
    }
    const usedGroups = groups.filter(g => items.some(i => (i.groups || []).some(x => x.external_id === g.external_id)));

    root.innerHTML = '';
    const head = el('div', { class: 'page-head' },
      el('div', null,
        el('h1', null, 'Картинки на продажу'),
        el('p', null, `Живой каталог Xsolla Store API · проект ${profile.projectId} · ${items.length} товаров · оплата в песочнице Pay Station`)),
      el('div', { class: 'filters' },
        el('button', { class: 'chip' + (currentGroup === 'all' ? ' active' : ''), onClick: () => { currentGroup = 'all'; window.Views.store(root); } }, 'Все'),
        ...usedGroups.map(g => el('button', { class: 'chip' + (currentGroup === g.external_id ? ' active' : ''), onClick: () => { currentGroup = g.external_id; window.Views.store(root); } }, g.name))));
    root.append(head);

    if (!window.Xsolla.Login.configured()) {
      root.append(el('div', { class: 'notice warn', style: 'margin-bottom:18px' },
        `Для профиля «${profile.title}» не задан Login ID — вход и инвентарь недоступны, покупка идёт как гостевая (анонимный заказ Store API). Впишите UUID Login-проекта в config.js.`));
    }
    root.append(el('div', { class: 'grid', id: 'grid' }));
    renderGrid();
  };

  window.Views.storeRefresh = refresh;
  window.Auth.onChange(() => { catalogCache = null; if (rootEl && document.body.contains(rootEl) && location.hash.replace('#', '') in { '': 1, '/': 1 }) window.Views.store(rootEl); });
})();
