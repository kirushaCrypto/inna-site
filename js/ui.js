/* ------------------------------------------------------------------
   ui.js — поведение интерфейса: разбивка заголовков, появления,
   счётчики, курсор, магнитные кнопки, лента, карусели, аккордеон,
   меню и прелоадер.
------------------------------------------------------------------ */
(function () {
  'use strict';

  const { Scroll, Observer, Pointer, Ticker, clamp, lerp, damp, reduceMotion, isTouch } = window.APP;
  const $ = (s, c) => (c || document).querySelector(s);
  const $$ = (s, c) => Array.from((c || document).querySelectorAll(s));

  /* --------------------- Разбивка на слова ------------------------ */
  function wrapWords(node, out) {
    const frag = document.createDocumentFragment();
    Array.from(node.childNodes).forEach(child => {
      if (child.nodeType === 3) {
        // Делим только по обычным пробелам: неразрывный должен остаться
        // внутри слова, иначе связки вроде «к десяти» распадаются переносом.
        const parts = child.textContent.split(/([ \t\n\r]+)/);
        parts.forEach(part => {
          if (!part) return;
          if (/^[ \t\n\r]+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
          const word = document.createElement('span');
          word.className = 'w';
          const inner = document.createElement('i');
          inner.textContent = part;
          word.appendChild(inner);
          out.push(inner);
          frag.appendChild(word);
        });
      } else if (child.nodeType === 1) {
        if (child.tagName === 'BR') { frag.appendChild(child.cloneNode()); return; }
        const clone = child.cloneNode(false);
        clone.appendChild(wrapWords(child, out));
        frag.appendChild(clone);
      }
    });
    return frag;
  }

  function splitAll() {
    $$('[data-split]').forEach(el => {
      if (el.dataset.splitDone) return;
      const words = [];
      const frag = wrapWords(el, words);
      el.textContent = '';
      el.appendChild(frag);
      el.classList.add('split');
      words.forEach((w, i) => { w.style.transitionDelay = (i * 0.038).toFixed(3) + 's'; });
      el.dataset.splitDone = '1';
    });
  }

  /* ------------------------- Появления ---------------------------- */
  function initReveal() {
    $$('[data-reveal], [data-split]').forEach(el => {
      if (!el.hasAttribute('data-split')) el.classList.add('fade-up');
      Observer.add(el, {
        once: true,
        offset: 90,
        onEnter(item) { item.el.classList.add('is-revealed'); }
      });
    });
  }

  /* -------------------------- Счётчики ---------------------------- */
  function initCounters() {
    $$('[data-count]').forEach(el => {
      const target = parseFloat(el.dataset.count);
      Observer.add(el, {
        once: true,
        offset: 60,
        onEnter() {
          const dur = 1500;
          const start = performance.now();
          const tick = now => {
            const p = clamp((now - start) / dur, 0, 1);
            const eased = 1 - Math.pow(1 - p, 3);
            el.textContent = Math.round(target * eased).toLocaleString('ru-RU');
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      });
    });
  }

  /* --------------------------- Курсор ----------------------------- */
  function initCursor() {
    if (isTouch || reduceMotion) return;
    const cursor = $('#cursor');
    const ring = $('#cursor-ring');
    if (!cursor) return;
    document.documentElement.classList.add('has-cursor');

    let rx = Pointer.x, ry = Pointer.y;
    Ticker.add((t, dt) => {
      rx = damp(rx, Pointer.x, 14, dt);
      ry = damp(ry, Pointer.y, 14, dt);
      cursor.style.transform = `translate3d(${Pointer.x}px, ${Pointer.y}px, 0)`;
      ring.style.transform = `translate3d(${rx - Pointer.x}px, ${ry - Pointer.y}px, 0) translate(-50%, -50%)`;
    });

    document.addEventListener('pointerover', e => {
      const el = e.target.closest('[data-cursor], a, button');
      if (!el) { cursor.classList.remove('is-hover', 'is-drag'); ring.textContent = ''; return; }
      const mode = el.dataset ? el.dataset.cursor : null;
      if (mode === 'drag') {
        cursor.classList.add('is-drag');
        cursor.classList.remove('is-hover');
        ring.textContent = 'тяни';
      } else {
        cursor.classList.add('is-hover');
        cursor.classList.remove('is-drag');
        ring.textContent = '';
      }
    });
    document.addEventListener('mouseleave', () => cursor.classList.add('is-hidden'));
    document.addEventListener('mouseenter', () => cursor.classList.remove('is-hidden'));
  }

  /* --------------------- Магнитные элементы ----------------------- */
  function initMagnetic() {
    if (isTouch || reduceMotion) return;
    $$('[data-magnetic]').forEach(el => {
      let tx = 0, ty = 0, cx = 0, cy = 0, active = false;
      el.addEventListener('pointerenter', () => (active = true));
      el.addEventListener('pointerleave', () => { active = false; tx = ty = 0; });
      el.addEventListener('pointermove', e => {
        const r = el.getBoundingClientRect();
        tx = (e.clientX - (r.left + r.width / 2)) * 0.32;
        ty = (e.clientY - (r.top + r.height / 2)) * 0.42;
      });
      Ticker.add((t, dt) => {
        if (!active && Math.abs(cx) < 0.05 && Math.abs(cy) < 0.05) return;
        cx = damp(cx, tx, 10, dt);
        cy = damp(cy, ty, 10, dt);
        el.style.transform = `translate3d(${cx.toFixed(2)}px, ${cy.toFixed(2)}px, 0)`;
      });
    });
  }

  /* ---------------------- Бегущая строка -------------------------- */
  function initMarquee() {
    $$('[data-marquee]').forEach(wrap => {
      const row = $('.marquee__row', wrap);
      const item = $('.marquee__item', row);
      if (!row || !item) return;

      // Лента сдвигается на ширину одной копии, поэтому за первой копией
      // всегда должно оставаться контента минимум на ширину экрана.
      const fill = () => {
        const need = item.offsetWidth + window.innerWidth + 80;
        while (row.scrollWidth < need && row.children.length < 12) {
          row.appendChild(item.cloneNode(true));
        }
      };
      fill();
      window.addEventListener('resize', fill);

      const speed = parseFloat(wrap.dataset.speed || '1');
      let offset = 0;
      Ticker.add((t, dt) => {
        const r = wrap.getBoundingClientRect();
        if (r.bottom < -100 || r.top > window.innerHeight + 100) return;
        const width = item.offsetWidth;
        if (!width) return;
        // Направление и скорость подхватывают движение страницы.
        offset -= (speed * 46 + Scroll.state.velocity * 0.13) * dt;
        if (offset <= -width) offset += width;
        if (offset > 0) offset -= width;
        row.style.transform = `translate3d(${offset.toFixed(2)}px,0,0)`;
      });
    });
  }

  /* ------------------- Горизонтальные карусели -------------------- */
  function initDragScroll() {
    $$('[data-drag]').forEach(track => {
      let down = false, startX = 0, startLeft = 0, moved = 0, vx = 0, lastX = 0;

      track.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        down = true; moved = 0; vx = 0;
        startX = lastX = e.clientX;
        startLeft = track.scrollLeft;
      });
      track.addEventListener('pointermove', e => {
        if (!down) return;
        const dx = e.clientX - startX;
        moved = Math.abs(dx);
        // Захват только после сдвига, иначе клики по ссылкам и кнопкам в ленте теряются.
        if (moved > 6 && !track.hasPointerCapture(e.pointerId)) {
          track.setPointerCapture(e.pointerId);
          track.classList.add('is-dragging');
        }
        if (!track.hasPointerCapture(e.pointerId)) return;
        vx = e.clientX - lastX;
        lastX = e.clientX;
        track.scrollLeft = startLeft - dx;
      });
      const release = e => {
        if (!down) return;
        down = false;
        track.classList.remove('is-dragging');
        if (e && e.pointerId != null && track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
        // Небольшой выбег после отпускания.
        let v = clamp(vx, -60, 60);
        const glide = () => {
          if (Math.abs(v) < 0.4) return;
          track.scrollLeft -= v;
          v *= 0.92;
          requestAnimationFrame(glide);
        };
        glide();
      };
      track.addEventListener('pointerup', release);
      track.addEventListener('pointercancel', release);
      track.addEventListener('click', e => { if (moved > 6) { e.preventDefault(); e.stopPropagation(); } }, true);

      // Колесо: вертикальный жест листает ленту, пока она не упёрлась в край.
      track.addEventListener('wheel', e => {
        if (e.ctrlKey) return;
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        const atStart = track.scrollLeft <= 0 && d < 0;
        const atEnd = track.scrollLeft >= track.scrollWidth - track.clientWidth - 1 && d > 0;
        if (atStart || atEnd) return;
        e.preventDefault();
        e.stopPropagation();
        track.scrollLeft += d;
      }, { passive: false });
    });

    // Индикатор для карточек форматов.
    const track = $('#formats-track');
    const bar = $('#formats-progress');
    const counter = $('#formats-counter');
    if (track && bar) {
      const sync = () => {
        const max = Math.max(track.scrollWidth - track.clientWidth, 1);
        const p = clamp(track.scrollLeft / max, 0, 1);
        const visible = track.clientWidth / track.scrollWidth;
        bar.style.width = (visible * 100).toFixed(1) + '%';
        bar.style.transform = `translateX(${(p * (100 / visible - 100)).toFixed(2)}%)`;
        if (counter) {
          const cards = track.children.length;
          const idx = Math.min(cards, Math.round(p * (cards - 1)) + 1);
          counter.textContent = String(idx).padStart(2, '0');
        }
      };
      track.addEventListener('scroll', sync, { passive: true });
      window.addEventListener('resize', sync);
      sync();
    }
  }

  /* -------------------------- Параллакс --------------------------- */
  function initParallax() {
    if (reduceMotion) return;
    $$('[data-parallax]').forEach(el => {
      const amount = parseFloat(el.dataset.parallax || '0.1');
      const img = el.tagName === 'IMG' ? el : $('img', el);
      const target = img || el;
      Observer.add(el, {
        onUpdate(p) {
          const shift = (p - 0.5) * 2 * amount * 100;
          target.style.transform = `translate3d(0, ${shift.toFixed(2)}px, 0)`;
        }
      });
    });
  }

  /* --------------------------- Аккордеон -------------------------- */
  function initFaq() {
    $$('.faq__item').forEach(item => {
      const head = $('.faq__head', item);
      const body = $('.faq__body', item);
      const inner = $('.faq__inner', item);
      if (!head || !body) return;
      head.setAttribute('aria-expanded', 'false');

      head.addEventListener('click', () => {
        const open = item.classList.contains('is-open');
        $$('.faq__item.is-open').forEach(other => {
          if (other === item) return;
          other.classList.remove('is-open');
          $('.faq__body', other).style.height = '0px';
          $('.faq__head', other).setAttribute('aria-expanded', 'false');
        });
        item.classList.toggle('is-open', !open);
        head.setAttribute('aria-expanded', String(!open));
        body.style.height = open ? '0px' : inner.offsetHeight + 'px';
        setTimeout(() => Observer.measure(), 650);
      });

      window.addEventListener('resize', () => {
        if (item.classList.contains('is-open')) body.style.height = inner.offsetHeight + 'px';
      });
    });
  }

  /* --------------------- Навигация и меню ------------------------- */
  function initNav() {
    const nav = $('#nav');
    const burger = $('#burger');
    const menu = $('#menu');
    const toTop = $('#to-top');
    let lastY = 0;

    Scroll.onUpdate(state => {
      const y = state.current;
      if (nav) {
        nav.classList.toggle('is-stuck', y > 40);
        const goingDown = y > lastY + 2;
        const menuOpen = menu && menu.classList.contains('is-open');
        nav.classList.toggle('is-hidden', goingDown && y > window.innerHeight * 0.9 && !menuOpen);
      }
      if (toTop) toTop.classList.toggle('is-on', y > window.innerHeight * 1.4);
      lastY = y;
    });

    if (burger && menu) {
      const items = $$('.menu__item', menu);
      items.forEach((el, i) => (el.style.transitionDelay = 0.08 + i * 0.05 + 's'));
      const toggle = force => {
        const open = force != null ? force : !menu.classList.contains('is-open');
        menu.classList.toggle('is-open', open);
        burger.classList.toggle('is-open', open);
        burger.setAttribute('aria-expanded', String(open));
        document.documentElement.classList.toggle('is-loading', open);
      };
      burger.addEventListener('click', () => toggle());
      $$('a', menu).forEach(a => a.addEventListener('click', () => toggle(false)));
      document.addEventListener('keydown', e => { if (e.key === 'Escape') toggle(false); });
    }

    if (toTop) toTop.addEventListener('click', () => Scroll.scrollTo(0));

    // Якоря — через инерционный скролл.
    $$('a[href^="#"]').forEach(a => {
      a.addEventListener('click', e => {
        const id = a.getAttribute('href');
        if (!id || id === '#') return;
        const el = document.querySelector(id);
        if (!el) return;
        e.preventDefault();
        Scroll.toElement(el, id === '#top' ? 0 : 20);
      });
    });
  }

  /* ---------------------------- Отзывы ---------------------------- */
  function initReviews() {
    const track = $('#reviews-track');
    if (!track) return;

    // Длинные отзывы сворачиваем до нескольких строк.
    $$('.review', track).forEach(card => {
      const text = $('.review__text', card);
      const more = $('.review__more', card);
      if (!text || !more) return;
      text.classList.add('is-clamped');
      const check = () => {
        if (card.classList.contains('is-open')) return;
        more.hidden = text.scrollHeight <= text.clientHeight + 2;
      };
      check();
      window.addEventListener('resize', check);
      if (document.fonts) document.fonts.ready.then(check);
      more.addEventListener('click', () => {
        const open = card.classList.toggle('is-open');
        text.classList.toggle('is-clamped', !open);
        more.textContent = open ? 'Свернуть' : 'Читать целиком';
      });
    });

    const bar = $('#reviews-progress');
    const sync = () => {
      const max = track.scrollWidth - track.clientWidth;
      const p = max > 0 ? track.scrollLeft / max : 1;
      const visible = Math.min(1, track.clientWidth / track.scrollWidth);
      if (bar) {
        bar.style.width = (visible * 100).toFixed(2) + '%';
        bar.style.transform = `translateX(${(p * (100 / visible - 100)).toFixed(2)}%)`;
      }
    };
    track.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    sync();

    $$('.reviews__arrows .arrow-btn').forEach(b => {
      b.addEventListener('click', () => {
        const card = $('.review', track);
        const step = card ? card.getBoundingClientRect().width + 20 : track.clientWidth * 0.8;
        track.scrollBy({ left: step * Number(b.dataset.dir), behavior: 'smooth' });
      });
    });
  }

  /* ----------------------- Плавающая заявка ----------------------- */
  function initFab() {
    const fab = $('#fab');
    const contact = $('#contact');
    if (!fab) return;
    let inContact = false;
    if (contact && 'IntersectionObserver' in window) {
      new IntersectionObserver(([e]) => { inContact = e.isIntersecting; }, { threshold: 0.15 }).observe(contact);
    }
    Scroll.onUpdate(state => {
      fab.classList.toggle('is-on', state.current > window.innerHeight * 0.8 && !inContact);
    });
  }

  /* -------------------------- Подвал ------------------------------ */
  function initFooterMark() {
    const mark = $('.footer__mark');
    if (!mark || reduceMotion) return;
    Observer.add(mark, {
      onUpdate(p) {
        mark.style.transform = `translate3d(${(-p * 22).toFixed(2)}%, 0, 0)`;
      }
    });
  }

  /* ------------------------- Прелоадер ---------------------------- */
  function initPreloader(onDone) {
    const pre = $('#preloader');
    const count = $('#pre-count');
    const bar = $('#pre-bar');
    const word = $('#pre-word');
    const words = ['Собираем зал', 'Проверяем звук', 'Ставим свет', 'Гости заходят'];

    if (!pre) { onDone(); return; }

    let value = 0;
    let done = false;
    let loaded = false;
    // Ждём только первый экран: шрифты и портрет. Остальная страница догрузится под заставкой.
    const hero = document.querySelector('.hero__portrait img');
    const heroReady = !hero || hero.complete ? null : new Promise(r => {
      hero.addEventListener('load', r, { once: true });
      hero.addEventListener('error', r, { once: true });
    });
    Promise.all([document.fonts && document.fonts.ready, heroReady]).then(() => (loaded = true));
    window.addEventListener('load', () => (loaded = true));
    setTimeout(() => (loaded = true), 3000);

    const start = performance.now();
    const step = now => {
      const t = (now - start) / 1000;
      // До загрузки подбираемся к 92, дальше добегаем до сотни.
      const ceiling = loaded ? 100 : 92;
      value = Math.min(ceiling, value + (ceiling - value) * 0.045 + 0.35);
      count.textContent = Math.floor(value);
      bar.style.transform = `translateX(${value}%)`;
      word.textContent = words[Math.min(words.length - 1, Math.floor(t / 0.55))];

      if (value >= 99.4 && !done) {
        done = true;
        count.textContent = '100';
        setTimeout(() => {
          pre.classList.add('is-done');
          document.documentElement.classList.remove('is-loading');
          onDone();
          setTimeout(() => pre.remove(), 700);
        }, 260);
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  window.UI = {
    init() {
      splitAll();
      initReveal();
      initCounters();
      initCursor();
      initMagnetic();
      initMarquee();
      initDragScroll();
      initParallax();
      initFaq();
      initNav();
      initReviews();
      initFab();
      initFooterMark();
      const y = $('#year');
      if (y) y.textContent = new Date().getFullYear();
    },
    initPreloader
  };
})();
