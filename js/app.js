/* ============================================================
   app.js — top-level navigation between the three views.
   Views are plain sections shown/hidden by hash, so the
   browser back button and deep links (e.g. #birthday) work.
   ============================================================ */

(function () {
  const VIEWS = ['home', 'talking', 'birthday', 'memories'];

  function show(view) {
    if (!VIEWS.includes(view)) view = 'home';

    document.querySelectorAll('.view').forEach((section) => {
      section.hidden = section.dataset.view !== view;
    });

    document.querySelectorAll('.nav-btn').forEach((btn) => {
      const active = btn.dataset.nav === view;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-current', active ? 'page' : 'false');
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function route() {
    show(location.hash.replace('#', '') || 'home');
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-nav]').forEach((el) => {
      el.addEventListener('click', () => {
        location.hash = el.dataset.nav;
      });
    });

    document.getElementById('brand-home').addEventListener('click', () => {
      location.hash = 'home';
    });

    window.addEventListener('hashchange', () => {
      if (location.hash === '#memories') MyMemories.refresh();
      route();
    });
    route();
    if ((location.hash.replace('#', '') || 'home') === 'memories') MyMemories.refresh();

    // Initialize feature modules once the DOM is ready.
    TalkingPhotos.init();
    BirthdayMaker.init();
    MyMemories.init();
  });
})();
