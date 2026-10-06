/* ------------------------------------------------------------------
   main.js — порядок запуска: скролл, шейдерные сцены, прелоадер,
   затем интерфейс. Любая упавшая часть не должна ронять страницу.
------------------------------------------------------------------ */
(function () {
  'use strict';

  const { Scroll, Observer } = window.APP;

  function safe(label, fn) {
    try { return fn(); }
    catch (e) { console.warn('Не удалось запустить: ' + label, e); return null; }
  }

  safe('скролл', () => Scroll.init());
  safe('шейдерные сцены', () => window.SCENES.init());

  function onReady() {
    safe('интерфейс', () => window.UI.init());
    Scroll.unlock();
    Scroll.measure();
    Observer.measure();
    Observer.update();

    const portrait = window.SCENES && window.SCENES.scenes.portrait;
    if (portrait) portrait.revealTarget = 1;

    // Высота меняется по мере появления шрифтов и раскрытия блоков.
    [200, 900, 2200].forEach(ms => setTimeout(() => {
      Scroll.measure();
      Observer.measure();
      Observer.update();
    }, ms));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.UI.initPreloader(onReady));
  } else {
    window.UI.initPreloader(onReady);
  }
})();
