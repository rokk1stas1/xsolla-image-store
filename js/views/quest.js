/* Квест «Посмотри видео — получи картинку»: YouTube IFrame Player API → событие ENDED
 * или ≥ minWatchSeconds просмотра → выдача награды (реальная через Store free item, иначе локальная). */
(function () {
  const { el, toast, profile, store } = window.U;
  const { Store } = window.Xsolla;
  const Q = profile.quest;

  let ytReady = null;
  function loadYouTubeApi() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (!ytReady) {
      ytReady = new Promise(resolve => {
        const prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => { prev && prev(); resolve(window.YT); };
        const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
      });
    }
    return ytReady;
  }

  let player = null, pollTimer = null;

  window.Views = window.Views || {};
  window.Views.quest = async function (root) {
    root.innerHTML = '';
    clearInterval(pollTimer);
    const done = store.get('quest_done', false);

    root.append(el('div', { class: 'page-head' }, el('div', null,
      el('h1', null, 'Квест: посмотри видео — получи картинку'),
      el('p', null, `Досмотрите ролик до конца (или не меньше ${Q.minWatchSeconds} с) — и картинка ваша.`))));

    const catalog = await Store.virtualItems().catch(() => []);
    const reward = catalog.find(i => i.sku === Q.rewardSku);

    const videoWrap = el('div', { class: 'video-wrap' }, el('div', { id: 'yt-player' }));
    const bar = el('div', { class: 'progress' }, el('div', { id: 'quest-bar' }));
    const status = el('div', { class: 'order-status', id: 'quest-status' }, done ? 'Квест уже выполнен ✔' : 'Нажмите ▶ чтобы начать');

    const steps = el('ul', { class: 'quest-steps' },
      el('li', { id: 'st-1', class: done ? 'done' : '' }, el('span', { class: 'dot' }, '1'), 'Запустить видео'),
      el('li', { id: 'st-2', class: done ? 'done' : '' }, el('span', { class: 'dot' }, '2'), `Смотреть ≥ ${Q.minWatchSeconds} с или до конца`),
      el('li', { id: 'st-3', class: done ? 'done' : '' }, el('span', { class: 'dot' }, '3'), 'Получить награду'));

    const rewardPanel = el('div', { class: 'panel' }, el('h2', null, 'Награда'));
    if (reward) {
      rewardPanel.append(el('div', { class: 'reward-card' },
        el('img', { src: reward.image_url, alt: reward.name }),
        el('div', null, el('strong', null, reward.name), el('p', { class: 'hint' }, reward.description || ''),
          el('p', { class: 'hint' }, reward.is_free
            ? 'SKU бесплатный → выдача через Store API (POST /free/item), картинка попадёт в инвентарь.'
            : 'В этом проекте SKU платный → Store API не может выдать его бесплатно без серверного ключа; награда фиксируется локально.'))));
    } else {
      rewardPanel.append(el('div', { class: 'notice warn' }, `SKU награды «${Q.rewardSku}» не найден в каталоге проекта ${profile.projectId}.`));
    }
    const claimBtn = el('button', { class: 'btn btn-primary', disabled: !done || window.Unlock.isUnlocked(Q.rewardSku), style: 'margin-top:14px', onClick: claim }, window.Unlock.isUnlocked(Q.rewardSku) ? 'Награда получена' : 'Забрать награду');
    rewardPanel.append(claimBtn);
    if (done) rewardPanel.append(el('button', { class: 'btn btn-ghost btn-sm', style: 'margin-top:10px;margin-left:8px', onClick: () => { store.del('quest_done'); window.Views.quest(root); } }, 'Сбросить квест'));

    root.append(el('div', { class: 'two-col' },
      el('div', null, el('div', { class: 'panel' }, el('h2', null, 'Шаги'), steps), rewardPanel),
      el('div', null, videoWrap, el('div', { style: 'margin-top:12px' }, bar), el('div', { style: 'margin-top:8px' }, status),
        el('p', { class: 'hint' }, 'Прогресс считается по реальному времени воспроизведения (YouTube IFrame Player API, событие onStateChange + getCurrentTime).'))));

    async function claim() {
      claimBtn.disabled = true;
      if (!reward) return;
      if (!window.Auth.isLoggedIn() && reward.is_free) { toast('Войдите, чтобы награда попала в инвентарь', 'warn'); window.Auth.openModal(); claimBtn.disabled = false; return; }
      const mode = await window.Unlock.grant(reward, 'quest');
      claimBtn.textContent = mode === 'real' ? 'Награда в инвентаре' : 'Награда получена (локально)';
      if (mode === 'local') toast(`«${reward.name}» разблокирована и сохранена локально`, 'ok', 6000);
    }

    function complete() {
      if (store.get('quest_done')) return;
      store.set('quest_done', true);
      ['st-1', 'st-2', 'st-3'].forEach(id => document.getElementById(id)?.classList.add('done'));
      status.textContent = 'Квест выполнен ✔ Забирайте награду';
      claimBtn.disabled = window.Unlock.isUnlocked(Q.rewardSku);
      toast('Квест выполнен! 🎉', 'ok');
    }

    // Плеер
    const YT = await loadYouTubeApi();
    let watched = 0, lastT = null;
    player = new YT.Player('yt-player', {
      videoId: Q.videoId,
      playerVars: { rel: 0, modestbranding: 1, playsinline: 1, origin: location.origin },
      events: {
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.PLAYING) {
            document.getElementById('st-1')?.classList.add('done');
            status.textContent = 'Смотрим…';
            clearInterval(pollTimer);
            pollTimer = setInterval(() => {
              const t = player.getCurrentTime();
              if (lastT !== null && t > lastT && t - lastT < 2) watched += t - lastT; // накапливаем только реальный просмотр
              lastT = t;
              const dur = player.getDuration() || 1;
              const pct = Math.min(100, Math.max(watched / Q.minWatchSeconds, t / dur) * 100);
              document.getElementById('quest-bar').style.width = pct + '%';
              if (watched >= Q.minWatchSeconds) { clearInterval(pollTimer); complete(); }
            }, 500);
          } else {
            clearInterval(pollTimer); lastT = null;
            if (e.data === YT.PlayerState.ENDED) { document.getElementById('quest-bar').style.width = '100%'; complete(); }
            else if (e.data === YT.PlayerState.PAUSED && !store.get('quest_done')) status.textContent = 'Пауза';
          }
        }
      }
    });
  };
})();
