/* Покупка: Store API «Create order with specified item» → токен → Pay Station (sandbox) во встроенном
 * виджете (lightbox) → отслеживание заказа short-polling GET /order/{id} → обновление инвентаря. */
(function () {
  const { C, toast, el } = window.U;
  const { Store } = window.Xsolla;

  let widgetPromise = null;
  function loadWidget() {
    if (window.XPayStationWidget) return Promise.resolve(window.XPayStationWidget);
    if (!widgetPromise) {
      widgetPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = C.payStationWidgetUrl; s.async = true;
        s.onload = () => resolve(window.XPayStationWidget);
        s.onerror = () => reject(new Error('Не удалось загрузить Pay Station widget'));
        document.head.appendChild(s);
      });
    }
    return widgetPromise;
  }

  const listeners = new Set();
  function emit(evt) { listeners.forEach(fn => fn(evt)); }

  /** Ожидание терминального статуса заказа: polling каждые 3 с, максимум 10 минут. */
  async function trackOrder(orderId, token, { onStatus } = {}) {
    const started = Date.now();
    let last = null;
    while (Date.now() - started < 10 * 60_000) {
      try {
        const o = await Store.getOrder(orderId, token);
        if (o.status !== last) { last = o.status; onStatus && onStatus(o); emit({ type: 'order', order: o }); }
        if (['done', 'canceled', 'expired'].includes(o.status)) return o;
      } catch (e) { console.warn('getOrder', e); }
      await new Promise(r => setTimeout(r, 3000));
    }
    return { order_id: orderId, status: last || 'unknown' };
  }

  const Payment = {
    onEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /**
     * Купить товар. Без входа заказ создаётся анонимно, если проект это разрешает
     * (в 314739 — разрешает), но тогда покупка не попадёт в инвентарь пользователя.
     */
    async buy(item, { requireLogin = true } = {}) {
      const token = window.Auth.isLoggedIn() ? await window.Auth.token() : null;
      if (!token && requireLogin && window.Xsolla.Login.configured()) {
        toast('Войдите, чтобы купленная картинка попала в ваш инвентарь', 'warn');
        window.Auth.openModal();
        return null;
      }
      let order;
      try {
        order = await Store.createOrder(item.sku, token);
      } catch (e) {
        toast(`Не удалось создать заказ: ${e.message}`, 'err', 7000);
        throw e;
      }
      emit({ type: 'created', order, item });

      const W = await loadWidget();
      W.init({
        access_token: order.token,
        sandbox: !!C.sandbox,
        lightbox: { width: '740px', height: '760px', zIndex: 1000, overlayOpacity: '.7', overlayBackground: '#000', closeByClick: false, spinner: 'round', spinnerColor: '#6e7bf7' },
        childWindow: { target: '_blank' }
      });
      let closed = false;
      const onClose = () => { closed = true; emit({ type: 'closed', order, item }); };
      W.on(W.eventTypes.CLOSE, onClose);
      W.on(W.eventTypes.STATUS, (evt, data) => emit({ type: 'status', order, item, data }));
      W.open();

      // Отслеживаем заказ параллельно с виджетом — независимо от того, закрыл ли его пользователь.
      if (token) {
        const result = await trackOrder(order.order_id, token, {
          onStatus: o => {
            if (o.status === 'paid') toast(`Оплата #${o.order_id} прошла, ждём выдачу…`, 'ok');
            if (o.status === 'done') toast(`«${item.name}» теперь в вашем инвентаре 🎉`, 'ok', 7000);
            if (o.status === 'canceled' || o.status === 'expired') toast(`Заказ #${o.order_id}: ${o.status}`, 'warn');
          }
        });
        emit({ type: 'final', order: result, item });
        return result;
      }
      // Гостевой заказ: статус заказа без JWT недоступен — полагаемся на события виджета.
      return order;
    }
  };

  window.Payment = Payment;
})();
