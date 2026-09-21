# Анализ Xsolla AI Kit на задаче «магазин картинок»

Дата: 21.09.2026. Источник: `github.com/xsolla/xsolla-ai-kit`, коммит `4126ae0` (2026-08-19).
Проверялись skills `shop-setup`, `catalog-design` (+ `references/catalog-client.md`,
`purchase-and-tracking.md`, `items.md`), `login-setup` (+ `references/integration-modes.md`,
`auth-flows.md`, `user-management.md`), `headless-checkout-integration` (+ `references/initialization.md`),
`merchant-setup`; `webhooks-impl`, `login-styling`, `production` — по grep.
Все вызовы API ниже прогнаны живьём (curl из контейнера + headless Chromium на локальной сборке сайта).

## Контекст и блокеры

| Блокер | Что произошло | Следствие |
|--------|---------------|-----------|
| **Admin API через egress-proxy** | Ключ проекта 314739 доступен только как непрозрачный sentinel, который прокси подставляет в открытом тексте URL/заголовков/тела для `api.xsolla.com` и `store.xsolla.com`. Admin API требует `Authorization: Basic base64(project_id:key)` — внутри base64 подстановка не происходит → `GET /api/v2/project/314739/admin/items/virtual_items` = **401** (проверено 1 запросом, больше не повторяли). | Ничего из «Phase 0» kit'а (создание/правка каталога, серверный токен, чтение настроек проекта) выполнить нельзя. |
| **Неизвестен Login ID проекта 314739** | Login-проект (UUID) и OAuth 2.0-клиент читаются только из Publisher Account/Admin API. Публичные подсказки не нашлись: `POST /payment/item/{sku}` без JWT на 314739 возвращает **200** (анонимные заказы разрешены), `GET /user/inventory/items` без токена — 401 без деталей, `GET /project/314739/settings|login|project` — 403, `login.xsolla.com/api/projects/{uuid}/...` требует сам UUID. | Логин/инвентарь для 314739 не поднять. Реализован fallback на публичный демо-проект Xsolla (Store 77640 + Login `026201e3-7e40-11ea-a85b-42010aa80004` + OAuth client 57 — оба живые: JWKS 200, «Wrong username or password» на неверные креды, device-auth выдаёт JWT). Переключение — одна строка в `config.js`. |
| **Кросс-проектный JWT** | JWT демо-Login принимается Store 314739 только на чтение инвентаря (200, пусто); `POST /payment/item` и `POST /free/item` на 314739 с ним → **401 «Authorization failed»**. | Подтверждает, что Store проверяет привязку Login-проекта — обойти нельзя. |
| **CORS у Login API** | JWT-протокол (`/api/login`, `/api/user`, `/api/login/device/*`) на preflight **не отдаёт** `Access-Control-Allow-Origin`; OAuth 2.0-эндпоинты (`/api/oauth2/*`, `/api/users/me`) отдают origin `https://rokk1stas1.github.io`. | Из браузера работает только OAuth 2.0 — совпадает с рекомендацией kit'а («Default to OAuth 2.0»), но сам факт CORS-различия в kit'е не описан. |
| **Headless Chromium в контейнере** | `HTTPS_PROXY` с credentials в URL не понимается Chromium → рендер зависает; нужен `--no-proxy-server`. | Только процедурный gotcha, на продукт не влияет. |

## Покрытие по 6 требованиям

### 1. Витрина (каталог картинок) — ✅ покрыто полностью
- **Kit:** `shop-setup` → Phase 1 «Catalog (Store API, read-only)»; `catalog-design` шаг 3 + `references/catalog-client.md`
  (таблица эндпоинтов по типам, «не передавать `country`», `locale`, `additional_fields`, пагинация).
- **Использовано:** `GET https://store.xsolla.com/api/v2/project/{id}/items/virtual_items?locale=ru&additional_fields[]=long_description`,
  `GET …/items/groups`. Без авторизации, CORS `*`. С JWT — персональные лимиты (per-user limits у `demofree_*`).
- **Чего не хватает:** ничего существенного. Товары демо-каталогов — иконки предметов, а не «картинки»; kit
  описывает создание своих товаров только через Admin API (`items.md`), который у нас заблокирован.

### 2. Логин (регистрация, вход, JWT) — ✅ покрыто (с оговорками)
- **Kit:** `login-setup` шаги 2–3, `references/integration-modes.md` (Widget vs API, JWT vs OAuth 2.0, `client_id` в query),
  `references/auth-flows.md` §1 classic, §5 device ID, §8 refresh/logout.
- **Использовано (OAuth 2.0, публичный клиент):** `POST /api/oauth2/login/token?client_id&scope=offline` (логин+пароль),
  `POST /api/oauth2/user?client_id&response_type=code&redirect_uri&state&scope` (регистрация → 204 + письмо),
  `POST /api/oauth2/login/device/android?…` → `login_url?code=` → `POST /api/oauth2/token` (`authorization_code`),
  `POST /api/oauth2/token` (`refresh_token`). Access-токен живёт **299 с** — refresh обязателен (kit предупреждает про refresh, но
  указывает «default 24 h», что для этого клиента неверно).
- **Не покрыто kit'ом:** (а) Login Widget (`@xsolla/login-sdk`) — «default» по kit'у, но требует npm-сборку и whitelisted
  callback URL, которого у нас нет для GitHub Pages; (б) отсутствие CORS у JWT-протокола; (в) `state` должен быть ≥ 8 символов
  (ошибка `010-022`) и `device_id` для `android` — 16 hex / для `ios` — UUID (`002-027` иначе) — форматов в kit'е нет
  («verify via MCP»); (г) `login-styling` неприменим — у нас своя форма, не виджет.

### 3. Профиль (данные пользователя + инвентарь) — ✅ покрыто
- **Kit:** `login-setup/references/user-management.md` («Get user details» — `GET /api/users/me`, Bearer; «Update user details»);
  `shop-setup` Phase 4 «Inventory / unclaimed rewards» (упомянуто одной строкой).
- **Использовано:** `GET https://login.xsolla.com/api/users/me`, `PATCH …/users/me` (nickname), claims JWT (`sub`, `exp`,
  `xsolla_login_project_id`), `GET https://store.xsolla.com/api/v2/project/{id}/user/inventory/items?platform=xsolla` (Bearer).
- **Не покрыто:** эндпоинт инвентаря в kit'е **не описан** — `catalog-design` явно выносит «player inventory» в out of scope,
  а `webhooks-impl` исходит из того, что инвентарь — у партнёра на сервере. Параметры/схема взяты из ответа API.

### 4. Покупка через Pay Station (sandbox) — 🟡 частично
- **Kit:** `shop-setup` Phase 5 (три метода токена; Method 1 — браузер → Store API, «no partner backend needed»;
  `settings.language`), `catalog-design/references/purchase-and-tracking.md` (fast purchase by SKU, `sandbox: true`,
  `sandbox-secure.xsolla.com/paystation4/?token=`, статусы `new→paid→done`, polling `GET /order/{id}` каждые 3 с ≤ 10 мин,
  тест-карты), `headless-checkout-integration` (+ `initialization.md`).
- **Использовано:** `POST /api/v2/project/{id}/payment/item/{sku}` с `{sandbox:true, settings:{language:'ru', ui:{theme:'default_dark'}}}`
  и Bearer JWT → `{token, order_id}` (200); Pay Station **widget** (`cdn.xsolla.net/embed/paystation/1.2.7/widget.min.js`,
  `sandbox:true`, lightbox) — это «Pay Station (fallback)» из kit'а; отслеживание — short-polling `GET /order/{order_id}`.
- **Чего не хватает до «настоящего headless»:** kit требует `npm install @xsolla/pay-station-sdk` и загрузку `dist/main.js`
  (UMD), затем `headlessCheckout.init({sandbox:true})` → `setToken(token)` → `form.init({paymentMethodId, returnUrl})` →
  свои `psdk-*` компоненты → диспетчер `onNextAction` (`show_fields`, `3DS`, `redirect`, `check_status`, `status_updated`) →
  return-page для 3DS (`references/credit-card-form.md`, `redirect-flow.md`, `payment-status.md`). **Сервер не нужен**: токен
  берётся тем же клиентским Method 1, так что headless реализуем на GitHub Pages — не сделан из-за объёма (kit сам
  оценивает это как многофазную интеграцию «one payment method at a time»). Сервер/ключ понадобятся только для Method 2/3
  и вебхуков `order_paid` (`webhooks-impl`) — вместо них используем клиентский polling, который kit допускает для «projects
  without their own server».
- **Расхождение с kit'ом:** `initialization.md` для первого шага предлагает Method 3 (Merchant API, Basic-auth ключом) —
  у нас недоступен из-за прокси; Method 1 работает без ключа вообще.

### 5. Таймеры «откроется через…» — 🟡 частично (клиентская логика + free item)
- **Kit:** `catalog-design/references/items.md` — у товара есть `periods` (окна показа, ISO 8601) и `limits.recurrent_schedule`
  (per-user лимиты со сбросом); `catalog-client.md` — `show_inactive_time_limited_items=1`. Всё это настраивается **только
  Admin API** (заблокирован). Free items: `purchase-and-tracking.md` — «Create order with specified free item» → сразу `done`.
- **Использовано:** таймеры в `config.js` (`timedUnlock[]`), отсчёт от первого визита, состояние в `localStorage`; по истечении —
  `POST /api/v2/project/{id}/free/item/{sku}` (Bearer) для бесплатных SKU (`demofree_1/2` в 314739; в 77640 бесплатных SKU нет →
  `422 «Item is not free»`, награда локальная).
- **Не покрыто:** серверного «расписания доступности на пользователя» в Store API нет — только `periods` на весь каталог
  и лимиты с расписанием. Kit не описывает механику «локальных» разблокировок — это наша надстройка.

### 6. Квест «посмотри видео → картинка» — 🔴 не покрыто kit'ом (реализовано своими средствами)
- **Kit:** ни одного упоминания квестов, YouTube/видео или «событий прогресса» (grep по всем skills — только
  `video/webm|mp4` в CSP-списке `login-styling`). Продукт **Xsolla Quests** в kit'е отсутствует; публичного API для него в kit'е нет.
  Ближайшее: `shop-setup` Phase 4 — «Reward chains, free items» одной строкой, без эндпоинтов.
- **Использовано:** YouTube IFrame Player API (`onStateChange` → `ENDED` / накопленный `getCurrentTime()` ≥ N с); награда —
  `POST /free/item/{sku}` при бесплатном SKU, иначе локальная пометка (честно показана в профиле как «выдано локально»).
- **Что нужно для честной серверной реализации:** партнёрский бэкенд, который валидирует факт просмотра и выдаёт предмет
  через Admin API / серверный токен (kit: `webhooks-impl` — «grant in partner's system»), либо API Xsolla Quests/Reward chains,
  которых в kit'е нет.

## Проверка end-to-end (что реально прошло)

Живой прогон 21.09.2026 на demo-профиле (Store 77640 / Login 026201e3 / client 57), headless Chromium:
device-auth → JWT → `POST /payment/item/key_1` (`sandbox:true`) → `{token, order_id: 735262705}` →
`sandbox-secure.xsolla.com/paystation4/?token=…` → карта `4242 4242 4242 4242`, `12/40`, CVV `123` →
`/paystation4/status/success` («Payment successful», транзакция #2161081258) → `GET /order/735262705` = `done` →
`GET /user/inventory/items` содержит `key_1` → карточка в разделе «Мои картинки». Скриншоты: `docs/screenshots/`.

## Сводка

| Требование | Статус | Skill / эндпоинт kit'а | Что не покрыто |
|---|---|---|---|
| 1. Витрина | ✅ покрыто | shop-setup Ph.1; catalog-design/catalog-client.md — `GET /items/virtual_items`, `/items/groups` | создание «картинок» как товаров — только Admin API |
| 2. Логин | ✅ покрыто | login-setup: integration-modes.md, auth-flows.md — `/oauth2/login/token`, `/oauth2/user`, `/oauth2/login/device/*`, `/oauth2/token` | CORS JWT-протокола, форматы `device_id`/`state`, TTL 5 мин, Widget без callback |
| 3. Профиль | ✅ покрыто | login-setup/user-management.md — `GET /users/me`; shop-setup Ph.4 | эндпоинт инвентаря `GET /user/inventory/items` в kit'е не описан |
| 4. Покупка sandbox | 🟡 частично | shop-setup Ph.5 Method 1 — `POST /payment/item/{sku}`; purchase-and-tracking.md — `GET /order/{id}`; headless-checkout-integration | сделан Pay Station widget (fallback), не Headless SDK; вебхуков нет (нет сервера) |
| 5. Таймеры | 🟡 частично | items.md `periods`/`limits`; purchase-and-tracking.md — `POST /free/item/{sku}` | per-user расписание — только клиентское; настройка `periods` требует Admin API |
| 6. Квест-видео | 🔴 не покрыто | — (Xsolla Quests в kit отсутствует) | реализовано YouTube API + free item/локально |

**Итого: покрыто — 3, частично — 2, не покрыто — 1** (из 6).

## Что нужно от Стаса, чтобы включить проект 314739 целиком
1. **Login ID** (UUID Login-проекта, привязанного к Store 314739) и **ID публичного OAuth 2.0-клиента** с callback
   `https://login.xsolla.com/api/blank` (или добавить `https://rokk1stas1.github.io/xsolla-image-store/` в Callback URLs /
   Allowed origins). Вписать в `config.js → profiles.stas.login`, поставить `activeProfile: 'stas'`.
2. (Опционально) чтобы агент мог ходить в Admin API через egress-proxy: секрет в виде **уже закодированной** строки
   `base64(314739:<api_key>)` (тогда прокси подставит её в заголовок `Authorization: Basic <sentinel>` в открытом виде).
   Это откроет Phase 0 kit'а: сделать реальные «картинки» товарами, задать `periods`, бесплатные SKU-награды, серверный токен.
