/* Роутер (hash-based, чтобы работать со статического хостинга и подпути GitHub Pages). */
(function () {
  const { profile, profileKey, C } = window.U;
  const app = document.getElementById('app');

  document.getElementById('env-badge').textContent = (C.sandbox ? 'sandbox' : 'live') + ' · ' + profile.projectId;
  document.getElementById('footer-project').textContent = `Профиль: ${profileKey} · ${profile.title}`;
  document.title = `Картинки · ${profile.title}`;

  const routes = { '': 'store', '/': 'store', '/profile': 'profile', '/quest': 'quest' };

  async function render() {
    // Сохраняем ?profile= при переходах по хэшу — он и так в location.search, менять не надо.
    const path = location.hash.replace(/^#/, '').split('?')[0];
    const name = routes[path] || 'store';
    document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.route === name));
    try { await window.Views[name](app); }
    catch (e) {
      console.error(e);
      app.innerHTML = '';
      app.append(window.U.el('div', { class: 'notice warn' }, 'Ошибка: ' + (e.message || e)));
    }
    window.scrollTo({ top: 0 });
  }

  window.addEventListener('hashchange', render);
  window.Auth.onChange(() => { if (routes[location.hash.replace(/^#/, '')] === 'profile') render(); });
  render();
})();
