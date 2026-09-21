/* Таймеры разблокировки и локальные (клиентские) награды.
 * Состояние живёт в localStorage; реальная выдача — через Store API «free item», когда SKU бесплатный. */
(function () {
  const { store, profile, toast } = window.U;
  const { Store } = window.Xsolla;

  // Момент первого визита — от него отсчитываются таймеры (config.timedUnlock[].lockSeconds).
  let firstSeen = store.get('first_seen');
  if (!firstSeen) { firstSeen = Date.now(); store.set('first_seen', firstSeen); }

  const rules = new Map((profile.timedUnlock || []).map(r => [r.sku, r]));

  const Unlock = {
    /** ms до разблокировки (<= 0 — открыто); null — товар не под таймером. */
    remaining(sku) {
      const r = rules.get(sku);
      if (!r) return null;
      if (Unlock.isUnlocked(sku)) return 0;
      return firstSeen + r.lockSeconds * 1000 - Date.now();
    },
    isTimed(sku) { return rules.has(sku); },
    isUnlocked(sku) { return store.get('unlocked', {})[sku] === true; },
    markUnlocked(sku) { const u = store.get('unlocked', {}); u[sku] = true; store.set('unlocked', u); },

    /** Локальные награды (когда реальная выдача через Store API невозможна). */
    localRewards() { return store.get('local_rewards', []); },
    addLocalReward(sku, source) {
      const list = Unlock.localRewards();
      if (!list.some(x => x.sku === sku)) { list.push({ sku, source, at: new Date().toISOString() }); store.set('local_rewards', list); }
    },
    hasLocalReward(sku) { return Unlock.localRewards().some(x => x.sku === sku); },

    /**
     * Выдать награду за sku. Если товар бесплатный в каталоге и пользователь вошёл —
     * настоящий заказ через Store API (POST /free/item/{sku}); иначе — локальная пометка.
     * @returns {'real'|'local'}
     */
    async grant(item, source) {
      const sku = item.sku;
      if (item.is_free && window.Auth.isLoggedIn()) {
        const token = await window.Auth.token();
        try {
          const r = await Store.createFreeOrder(sku, token);
          Unlock.markUnlocked(sku);
          toast(`«${item.name}» добавлена в инвентарь (заказ #${r.order_id})`, 'ok', 6000);
          return 'real';
        } catch (e) {
          console.warn('free order failed', e);
          toast(`Не удалось выдать через Store API: ${e.message}. Награда сохранена локально.`, 'warn', 7000);
        }
      }
      Unlock.markUnlocked(sku);
      Unlock.addLocalReward(sku, source);
      return 'local';
    },

    /** Сброс таймеров и локальных наград (для демонстрации). */
    reset() { store.del('first_seen'); store.del('unlocked'); store.del('local_rewards'); location.reload(); }
  };

  window.Unlock = Unlock;
})();
