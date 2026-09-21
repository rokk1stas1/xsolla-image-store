/* ============================================================================
 *  Xsolla Image Store — конфигурация
 *  Единственный файл, который нужно править при переключении проекта.
 *  Секретов здесь НЕТ и быть не должно: всё, что ниже, — публичные идентификаторы.
 * ==========================================================================*/
window.APP_CONFIG = {
  /* Активный профиль: 'demo' | 'stas'.
   * 'demo' — публичный демо-проект Xsolla (Store 77640 + Login 026201e3-…, OAuth-клиент 57):
   *          работает end-to-end без каких-либо секретов.
   * 'stas' — песочница Стаса (Merchant 53105, Store 314739). Чтобы включить логин/инвентарь,
   *          впишите Login ID (UUID) и ID публичного OAuth 2.0-клиента ниже и поменяйте
   *          activeProfile на 'stas'. Можно переключить и без правки: ?profile=stas в URL. */
  activeProfile: 'demo',

  profiles: {
    demo: {
      title: 'Xsolla demo project',
      merchantId: null,
      projectId: 77640,
      login: {
        projectId: '026201e3-7e40-11ea-a85b-42010aa80004',
        clientId: 57,
        // redirect_uri для OAuth 2.0 code-flow. Мы не переходим по нему — code
        // забирается из ответа API и сразу обменивается на токен. Должен быть
        // разрешён в Callback URLs клиента; /api/blank у демо-клиента разрешён.
        redirectUri: 'https://login.xsolla.com/api/blank'
      },
      /* Товары, «закрытые по таймеру». lockSeconds отсчитывается от первого
       * открытия витрины на этом устройстве (хранится в localStorage). */
      timedUnlock: [
        { sku: 'secret_lvl_1',  lockSeconds: 90 },
        { sku: 'sp_event',      lockSeconds: 300 },
        { sku: 'battle_droid_skin', lockSeconds: 3600 }
      ],
      /* Квест «посмотри видео — получи картинку». */
      quest: {
        videoId: '_tyhMXjDpO0',          // Xsolla: Communicate Directly with Your Players — Pay Station
        minWatchSeconds: 30,             // засчитываем, если досмотрено до конца ИЛИ ≥ N секунд
        rewardSku: 'glasses_1'           // в demo-проекте нет бесплатных SKU → награда выдаётся локально
      },
      /* Какие товары считать «картинками» на витрине: [] = все virtual_items. */
      skuAllowlist: []
    },

    stas: {
      title: 'Xsolla sandbox · project 314739',
      merchantId: 53105,
      projectId: 314739,
      login: {
        projectId: '',      // TODO: Login ID (UUID) из Publisher Account → Players → Login
        clientId: 0,        // TODO: ID публичного OAuth 2.0-клиента этого Login-проекта
        redirectUri: 'https://login.xsolla.com/api/blank'
      },
      timedUnlock: [
        { sku: 'demopaid_4', lockSeconds: 90 },
        { sku: 'demofree_2', lockSeconds: 180 }   // бесплатный SKU → при разблокировке выдаётся реально (/free/item)
      ],
      quest: {
        videoId: '_tyhMXjDpO0',
        minWatchSeconds: 30,
        rewardSku: 'demofree_1'                   // бесплатный SKU → реальная выдача через Store API
      },
      skuAllowlist: []
    }
  },

  /* Режим песочницы: sandbox:true в заказе + sandbox-secure.xsolla.com у Pay Station. */
  sandbox: true,

  /* Язык каталога (Store API ?locale=) и платёжного UI (settings.language). */
  locale: 'ru',

  /* Тема Pay Station 4: 'default' | 'default_dark' | ID кастомной темы. */
  payStationTheme: 'default_dark',

  /* Внешние скрипты. */
  payStationWidgetUrl: 'https://cdn.xsolla.net/embed/paystation/1.2.7/widget.min.js',

  /* Базовые URL API (менять не нужно). */
  api: {
    store: 'https://store.xsolla.com/api/v2',
    login: 'https://login.xsolla.com/api'
  }
};
