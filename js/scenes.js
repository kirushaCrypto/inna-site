/* ------------------------------------------------------------------
   scenes.js — четыре WebGL-сцены и их связь со скроллом:
   фоновая дымка, портрет героя, морфинг-слайдер, портрет из точек.
------------------------------------------------------------------ */
(function () {
  'use strict';

  const { Scroll, Pointer, Ticker, clamp, damp, lerp, reduceMotion } = window.APP;
  const A = window.ASSETS || {};
  const scenes = {};

  // Прогресс закреплённой секции: 0 — верх дошёл до верха экрана,
  // 1 — низ секции поравнялся с низом экрана.
  function pinProgress(el) {
    const r = el.getBoundingClientRect();
    const dur = Math.max(el.offsetHeight - window.innerHeight, 1);
    return clamp(-r.top / dur, 0, 1);
  }

  let vel = 0;
  Ticker.add((t, dt) => {
    const raw = clamp(Scroll.state.velocity / 2600, -1.2, 1.2);
    vel = damp(vel, raw, 9, dt);
  });

  /* ------------------------- Фоновая дымка ------------------------ */
  function initBackground() {
    const canvas = document.getElementById('gl-bg');
    if (!canvas) return;
    const s = new GL.Sketch(canvas, {
      frag: SHADERS.BG,
      alwaysRender: true,
      dprCap: 1.1,
      onFrame(sk) {
        sk.uniforms.u_scroll = Scroll.state.progress;
        sk.uniforms.u_velocity = vel;
        sk.uniforms.u_mouse = [Pointer.snx, 1 - Pointer.sny];
      }
    });
    if (s.ok) scenes.bg = s;
    return s.ok;
  }

  /* ------------------------ Портрет героя ------------------------- */
  function initPortrait() {
    const canvas = document.getElementById('gl-portrait');
    const hero = document.getElementById('hero');
    if (!canvas || !hero) return;

    const s = new GL.Sketch(canvas, {
      frag: SHADERS.PORTRAIT,
      textures: { u_tex0: A['inna-03'] || 'img/inna-03.jpg' },
      dprCap: 1.5,
      uniforms: { u_reveal: 0 },
      onFrame(sk, t, dt) {
        const p = clamp(window.scrollY / Math.max(window.innerHeight, 1), 0, 1);
        sk.uniforms.u_progress = p;
        sk.uniforms.u_velocity = vel;
        const r = canvas.getBoundingClientRect();
        const mx = ((Pointer.sx - r.left) / Math.max(r.width, 1) - 0.5) * 2;
        const my = ((Pointer.sy - r.top) / Math.max(r.height, 1) - 0.5) * 2;
        sk.uniforms.u_mouse = [clamp(mx, -1.6, 1.6), clamp(-my, -1.6, 1.6)];
        sk.uniforms.u_reveal = damp(sk.uniforms.u_reveal, sk.revealTarget || 0, 1.6, dt);
      }
    });
    if (s.ok) {
      s.revealTarget = 0;
      scenes.portrait = s;
    }
    return s.ok;
  }

  /* ---------------------- Морфинг-слайдер ------------------------- */
  function initReel() {
    const canvas = document.getElementById('gl-reel');
    const section = document.getElementById('reel');
    if (!canvas || !section) return;

    const keys = ['inna-02', 'inna-04', 'inna-01', 'inna-03'];
    const srcs = keys.map((k, i) => A[k] || `img/inna-0${[2, 4, 1, 3][i]}.jpg`);
    const titles = document.querySelectorAll('#reel-title span');
    const dots = document.querySelectorAll('#reel-dots .reel__dot i');

    let frames = [];
    let index = -1;
    let hover = 0;

    const s = new GL.Sketch(canvas, {
      frag: SHADERS.MORPH,
      dprCap: 1.4,
      uniforms: { u_mix: 0, u_hover: 0 },
      onFrame(sk, t, dt) {
        if (frames.length < keys.length) return;

        const p = pinProgress(section);
        const total = keys.length - 1;
        const raw = p * total;
        const i = clamp(Math.floor(raw), 0, total - 1);
        const frac = clamp(raw - i, 0, 1);
        // Плато в начале и конце сегмента: кадр успевает «подышать».
        const mix = clamp((frac - 0.16) / 0.68, 0, 1);

        if (i !== index) {
          index = i;
          sk.textures.u_tex0 = frames[i];
          sk.textures.u_tex1 = frames[i + 1];
          sk.uniforms.u_tex0_size = [frames[i].width, frames[i].height];
          sk.uniforms.u_tex1_size = [frames[i + 1].width, frames[i + 1].height];
        }

        sk.uniforms.u_mix = 1 - mix;
        sk.uniforms.u_velocity = vel;
        hover = damp(hover, section.matches(':hover') ? 1 : 0, 5, dt);
        sk.uniforms.u_hover = hover;

        const r = canvas.getBoundingClientRect();
        sk.uniforms.u_mouse = [
          clamp(((Pointer.sx - r.left) / Math.max(r.width, 1) - 0.5) * 2, -1.2, 1.2),
          clamp(-((Pointer.sy - r.top) / Math.max(r.height, 1) - 0.5) * 2, -1.2, 1.2)
        ];

        // Подписи и индикатор идут за прогрессом.
        const active = Math.round(clamp(raw, 0, total));
        titles.forEach((el, k) => el.classList.toggle('is-active', k === active));
        dots.forEach((el, k) => {
          const local = clamp(raw - k, 0, 1);
          el.style.transform = `scaleX(${k <= raw ? (k === Math.floor(raw) ? local : 1) : 0})`;
        });
      }
    });

    if (!s.ok) return false;
    s.textureOrder = ['u_tex0', 'u_tex1'];

    Promise.all(srcs.map(GL.loadImage)).then(imgs => {
      const gl = s.gl;
      frames = imgs.map(img => {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        return { tex, width: img.width, height: img.height };
      });
      s.textures.u_tex0 = frames[0];
      s.textures.u_tex1 = frames[1];
      s.uniforms.u_tex0_size = [frames[0].width, frames[0].height];
      s.uniforms.u_tex1_size = [frames[1].width, frames[1].height];
      document.documentElement.classList.add('reel-ready');
    });

    scenes.reel = s;
    return true;
  }

  /* --------------------- Портрет из точек ------------------------- */
  function initParticles() {
    const canvas = document.getElementById('gl-particles');
    const section = document.getElementById('dust');
    if (!canvas || !section) return;

    let progress = 0;

    const p = new GL.ParticlePortrait(canvas, {
      image: A['inna-04'] || 'img/inna-04.jpg',
      density: window.innerWidth < 760 ? 110 : 165,
      scale: 1.02,
      size: 1.35,
      keyOut: true,
      keySat: 0.045,
      keyLum: 0.52,
      mono: true,
      tint: [1, 1, 1],
      onFrame(sc, t, dt) {
        const r = section.getBoundingClientRect();
        const vh = window.innerHeight;
        // Сборка, пока секция входит в кадр; распад, когда уходит вверх.
        const enter = clamp((vh - r.top) / (vh * 0.85), 0, 1);
        // Разлёт включается только когда секция уходит за верх экрана.
        const leave = clamp(1 - r.bottom / (vh * 0.75), 0, 1);
        progress = damp(progress, enter, 4, dt);
        sc.uniforms.u_progress = progress;
        sc.uniforms.u_dispersion = leave;

        const rect = canvas.getBoundingClientRect();
        const aspect = sc.uniforms.u_imageAspect;
        const inside = Pointer.sx > rect.left && Pointer.sx < rect.right &&
                       Pointer.sy > rect.top && Pointer.sy < rect.bottom;
        // Пока курсор вне облака, уводим точку влияния за пределы кадра.
        sc.uniforms.u_mouse = inside
          ? [((Pointer.sx - rect.left) / rect.width - 0.5) * 2 * aspect[0],
             -((Pointer.sy - rect.top) / rect.height - 0.5) * 2 * aspect[1]]
          : [-99, -99];
      }
    });

    if (p.ok) scenes.particles = p;
    return p.ok;
  }

  function init() {
    if (!GL.supported() || reduceMotion) return false;
    const ok = initBackground();
    if (!ok) return false;
    document.documentElement.classList.add('gl-on');
    initPortrait();
    initReel();
    initParticles();
    return true;
  }

  window.SCENES = { init, scenes, pinProgress };
})();
