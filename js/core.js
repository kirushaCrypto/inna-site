/* ------------------------------------------------------------------
   core.js — ядро: математика, единый тикер, инерционный скролл,
   наблюдатель за прогрессом секций. Без внешних зависимостей.
------------------------------------------------------------------ */
(function () {
  'use strict';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const map = (v, a, b, c, d) => c + ((v - a) / (b - a)) * (d - c);
  const smoothstep = (a, b, v) => {
    const t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  // Кадронезависимое сглаживание: одинаковая инерция на 60 и 144 Гц.
  const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouch = window.matchMedia('(hover: none)').matches;

  /* ---------------------------- Ticker ---------------------------- */
  const Ticker = (function () {
    const subs = [];
    let last = performance.now();
    let elapsed = 0;
    let running = false;

    function frame(now) {
      const dt = Math.min((now - last) / 1000, 1 / 20);
      last = now;
      elapsed += dt;
      for (let i = 0; i < subs.length; i++) subs[i](elapsed, dt);
      requestAnimationFrame(frame);
    }
    return {
      add(fn) {
        subs.push(fn);
        if (!running) {
          running = true;
          last = performance.now();
          requestAnimationFrame(frame);
        }
        return () => this.remove(fn);
      },
      remove(fn) {
        const i = subs.indexOf(fn);
        if (i > -1) subs.splice(i, 1);
      },
      get time() {
        return elapsed;
      }
    };
  })();

  /* ------------------------- Smooth scroll -------------------------
     Виртуальный скролл: колесо перехватывается, позиция сглаживается
     и раз в кадр отдаётся нативному window.scrollTo. Страница при этом
     скроллится по-настоящему, поэтому position: sticky, якоря и
     нативная прокрутка с клавиатуры продолжают работать.
     На тач-устройствах не вмешиваемся вовсе.
  ------------------------------------------------------------------ */
  const Scroll = (function () {
    const state = {
      target: 0,
      current: 0,
      velocity: 0,
      max: 0,
      progress: 0,
      native: isTouch || reduceMotion,
      locked: true
    };

    let listeners = [];
    let syncing = false;

    function measure() {
      state.max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      state.target = clamp(state.target, 0, state.max);
    }

    function onWheel(e) {
      if (state.locked || state.native) return;
      e.preventDefault();
      let d = e.deltaY;
      if (e.deltaMode === 1) d *= 16;
      else if (e.deltaMode === 2) d *= window.innerHeight;
      state.target = clamp(state.target + d, 0, state.max);
    }

    function onKey(e) {
      if (state.locked || state.native) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      const step = window.innerHeight;
      const moves = {
        ArrowDown: 120, ArrowUp: -120,
        PageDown: step * 0.9, PageUp: -step * 0.9,
        Home: -1e9, End: 1e9, ' ': step * 0.9
      };
      if (!(e.key in moves)) return;
      e.preventDefault();
      state.target = clamp(state.target + moves[e.key], 0, state.max);
    }

    function onScroll() {
      if (state.native) {
        state.target = window.scrollY;
        return;
      }
      // Скролл пришёл со стороны (якорь, поиск по странице, тачпад ОС) —
      // подхватываем позицию, чтобы страницу не дёрнуло обратно.
      if (syncing) return;
      if (Math.abs(window.scrollY - state.current) > 6) {
        state.current = state.target = window.scrollY;
      }
    }

    function update(time, dt) {
      const prev = state.current;
      if (state.native) {
        state.current = state.target;
      } else {
        state.current = damp(state.current, state.target, 8.5, dt);
        if (Math.abs(state.target - state.current) < 0.08) state.current = state.target;
        if (Math.round(state.current) !== Math.round(window.scrollY)) {
          syncing = true;
          window.scrollTo(0, state.current);
          syncing = false;
        }
      }
      state.velocity = (state.current - prev) / Math.max(dt, 0.001);
      state.progress = state.max ? state.current / state.max : 0;
      for (let i = 0; i < listeners.length; i++) listeners[i](state, dt);
    }

    return {
      state,
      init() {
        state.current = state.target = window.scrollY;
        if (state.native) {
          document.documentElement.classList.add('is-native-scroll');
        } else {
          document.documentElement.classList.add('is-smooth-scroll');
          window.addEventListener('wheel', onWheel, { passive: false });
          window.addEventListener('keydown', onKey);
        }
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', measure);
        measure();
        // Пересчёт после подгрузки шрифтов и картинок.
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
        window.addEventListener('load', measure);
        setTimeout(measure, 400);
        setTimeout(measure, 1600);
        Ticker.add(update);
      },
      measure,
      unlock() { state.locked = false; },
      lock() { state.locked = true; },
      onUpdate(fn) { listeners.push(fn); },
      scrollTo(y, instant) {
        measure();
        const v = clamp(y, 0, state.max);
        state.target = v;
        if (instant) {
          state.current = v;
          window.scrollTo(0, v);
        } else if (state.native) {
          window.scrollTo({ top: v, behavior: 'smooth' });
        }
      },
      toElement(el, offset) {
        if (!el) return;
        const y = el.getBoundingClientRect().top + window.scrollY - (offset || 0);
        this.scrollTo(y);
      }
    };
  })();

  /* ------------------------ ScrollObserver ------------------------
     Считает для элемента progress 0..1 от «низ вьюпорта коснулся
     верха» до «верх вьюпорта миновал низ», плюс inView-флаг.
  ------------------------------------------------------------------ */
  const Observer = (function () {
    const items = [];

    function add(el, opts) {
      const item = Object.assign(
        { el, rect: null, progress: 0, inView: false, onUpdate: null, onEnter: null, onLeave: null, once: false, done: false },
        opts || {}
      );
      items.push(item);
      cache(item);
      return item;
    }

    function cache(item) {
      const r = item.el.getBoundingClientRect();
      item.rect = { top: r.top + window.scrollY, height: r.height };
    }

    function measure() {
      for (const it of items) cache(it);
    }

    function update() {
      const y = Scroll.state.current;
      const vh = window.innerHeight;
      for (const it of items) {
        if (it.done) continue;
        const { top, height } = it.rect;
        const start = top - vh;
        const end = top + height;
        const p = clamp((y - start) / Math.max(end - start, 1), 0, 1);
        it.progress = p;
        const visible = y + vh > top + (it.offset || 0) && y < top + height;
        if (visible !== it.inView) {
          it.inView = visible;
          if (visible && it.onEnter) it.onEnter(it);
          if (!visible && it.onLeave) it.onLeave(it);
          if (visible && it.once) it.done = true;
        }
        if (it.onUpdate && !it.done) it.onUpdate(p, it);
      }
    }

    Scroll.onUpdate(update);
    window.addEventListener('resize', () => { measure(); update(); });
    window.addEventListener('load', () => { measure(); update(); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measure(); update(); });

    return { add, measure, update };
  })();

  /* --------------------------- Pointer ---------------------------- */
  const Pointer = (function () {
    const p = { x: innerWidth / 2, y: innerHeight / 2, nx: 0.5, ny: 0.5, sx: innerWidth / 2, sy: innerHeight / 2, snx: 0.5, sny: 0.5, down: false };
    window.addEventListener('pointermove', e => {
      p.x = e.clientX; p.y = e.clientY;
      p.nx = e.clientX / innerWidth; p.ny = e.clientY / innerHeight;
    }, { passive: true });
    window.addEventListener('pointerdown', () => (p.down = true));
    window.addEventListener('pointerup', () => (p.down = false));
    Ticker.add((t, dt) => {
      p.sx = damp(p.sx, p.x, 6, dt);
      p.sy = damp(p.sy, p.y, 6, dt);
      p.snx = damp(p.snx, p.nx, 6, dt);
      p.sny = damp(p.sny, p.ny, 6, dt);
    });
    return p;
  })();

  window.APP = { clamp, lerp, map, smoothstep, damp, Ticker, Scroll, Observer, Pointer, reduceMotion, isTouch };
})();
