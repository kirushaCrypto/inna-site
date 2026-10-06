/* ------------------------------------------------------------------
   gl.js — лёгкий слой над WebGL1: полноэкранные шейдерные плоскости
   и облако точек, собранное из пикселей фотографии.
------------------------------------------------------------------ */
(function () {
  'use strict';

  const { Ticker, clamp } = window.APP;

  const DEFAULT_VERT = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('shader:', gl.getShaderInfoLog(sh), src);
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function link(gl, vsSrc, fsSrc) {
    const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.warn('program:', gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }

  function context(canvas) {
    const attrs = { alpha: true, antialias: false, premultipliedAlpha: false, powerPreference: 'high-performance' };
    return canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
  }

  const imageCache = new Map();
  function loadImage(src) {
    if (imageCache.has(src)) return imageCache.get(src);
    const p = new Promise((res, rej) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
    imageCache.set(src, p);
    return p;
  }

  function makeTexture(gl, img) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return { tex, width: img.width, height: img.height };
  }

  /* --------------------------- Sketch ----------------------------- */
  class Sketch {
    constructor(canvas, opts) {
      opts = opts || {};
      this.canvas = canvas;
      this.gl = context(canvas);
      this.ok = !!this.gl;
      if (!this.ok) return;

      const gl = this.gl;
      this.program = link(gl, opts.vert || DEFAULT_VERT, opts.frag);
      if (!this.program) { this.ok = false; return; }

      this.buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      this.aPosition = gl.getAttribLocation(this.program, 'a_position');

      this.uniforms = Object.assign({ u_time: 0, u_resolution: [1, 1], u_mouse: [0.5, 0.5], u_scroll: 0, u_velocity: 0, u_progress: 0, u_reveal: 0 }, opts.uniforms || {});
      this.locations = {};
      this.textures = {};
      this.textureOrder = [];
      this.dprCap = opts.dprCap || 1.75;
      this.visible = true;
      this.alwaysRender = !!opts.alwaysRender;

      this.resize();
      this._onResize = () => this.resize();
      window.addEventListener('resize', this._onResize);

      if (opts.textures) {
        Promise.all(Object.entries(opts.textures).map(([name, src]) =>
          loadImage(src).then(img => { this.setTexture(name, img); })
        )).then(() => { if (opts.onReady) opts.onReady(this); });
      } else if (opts.onReady) {
        opts.onReady(this);
      }

      if (!this.alwaysRender && 'IntersectionObserver' in window) {
        this.io = new IntersectionObserver(es => { this.visible = es[0].isIntersecting; }, { rootMargin: '120px' });
        this.io.observe(canvas);
      }

      this.stop = Ticker.add((t, dt) => {
        if (!this.visible) return;
        this.uniforms.u_time = t;
        if (opts.onFrame) opts.onFrame(this, t, dt);
        this.render();
      });
    }

    setTexture(name, img) {
      const gl = this.gl;
      const t = makeTexture(gl, img);
      this.textures[name] = t;
      if (this.textureOrder.indexOf(name) === -1) this.textureOrder.push(name);
      this.uniforms[name + '_size'] = [t.width, t.height];
      return t;
    }

    resize() {
      const c = this.canvas;
      const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
      const w = Math.max(1, Math.round(c.clientWidth * dpr));
      const h = Math.max(1, Math.round(c.clientHeight * dpr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      this.uniforms.u_resolution = [w, h];
    }

    loc(name) {
      if (!(name in this.locations)) this.locations[name] = this.gl.getUniformLocation(this.program, name);
      return this.locations[name];
    }

    render() {
      const gl = this.gl;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.useProgram(this.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.enableVertexAttribArray(this.aPosition);
      gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 0, 0);

      this.textureOrder.forEach((name, i) => {
        const t = this.textures[name];
        const l = this.loc(name);
        if (!t || l === null) return;
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, t.tex);
        gl.uniform1i(l, i);
      });

      for (const key in this.uniforms) {
        const l = this.loc(key);
        if (l === null) continue;
        const v = this.uniforms[key];
        if (typeof v === 'number') gl.uniform1f(l, v);
        else if (Array.isArray(v)) {
          if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
          else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
          else if (v.length === 4) gl.uniform4f(l, v[0], v[1], v[2], v[3]);
        }
      }

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    destroy() {
      if (this.stop) this.stop();
      if (this.io) this.io.disconnect();
      window.removeEventListener('resize', this._onResize);
    }
  }

  /* ------------------------ ParticlePortrait -----------------------
     Пиксели фотографии превращаются в облако точек. Цвет каждой точки
     считается один раз на CPU, поэтому vertex-texture-fetch не нужен
     и сцена работает даже на слабых встроенных видеокартах.
  ------------------------------------------------------------------ */
  const PARTICLE_VERT = `
attribute vec2 a_uv;
attribute vec3 a_color;
attribute vec3 a_rand;
uniform vec2 u_resolution;
uniform vec2 u_imageAspect;
uniform float u_time;
uniform float u_progress;   // 0 — облако, 1 — собранный портрет
uniform float u_dispersion;
uniform vec2 u_mouse;
uniform float u_size;
varying vec3 v_color;
varying float v_alpha;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 uv = a_uv;
  vec2 centered = (uv - 0.5) * 2.0;

  // Целевая позиция — точка на фотографии, вписанной по высоте.
  vec2 target = centered * u_imageAspect;

  // Хаотичная стартовая позиция.
  float a = a_rand.x * 6.2831853;
  float r = 0.55 + a_rand.y * 1.9;
  vec2 chaos = vec2(cos(a), sin(a)) * r;
  chaos.y += sin(u_time * 0.55 + a_rand.z * 9.0) * 0.16;
  chaos.x += cos(u_time * 0.42 + a_rand.x * 7.0) * 0.16;

  float ease = u_progress * u_progress * (3.0 - 2.0 * u_progress);
  float stagger = clamp(ease * 1.55 - a_rand.z * 0.55, 0.0, 1.0);
  vec2 pos = mix(chaos, target, stagger);

  // Живое дыхание собранного портрета.
  pos += vec2(sin(u_time * 0.8 + a_rand.x * 20.0), cos(u_time * 0.7 + a_rand.y * 20.0)) * 0.006 * stagger;

  // Отталкивание от курсора.
  vec2 m = u_mouse * u_imageAspect;
  vec2 d = pos - m;
  float dist = length(d);
  float push = smoothstep(0.30, 0.0, dist) * 0.11 * stagger;
  pos += normalize(d + 0.0001) * push;

  // Дополнительный разлёт после того, как секция уходит вверх.
  pos += normalize(chaos) * u_dispersion * (0.4 + a_rand.y);

  float scaleY = 1.0;
  float scaleX = u_resolution.y / u_resolution.x;
  gl_Position = vec4(pos.x * scaleX, pos.y * scaleY, 0.0, 1.0);

  float px = min(u_resolution.x, u_resolution.y);
  gl_PointSize = u_size * px * (0.0016 + a_rand.y * 0.0011) * (0.55 + stagger * 0.75);

  v_color = a_color;
  v_alpha = (0.12 + stagger * 0.88) * (1.0 - u_dispersion * 0.85);
}`;

  const PARTICLE_FRAG = `
precision mediump float;
varying vec3 v_color;
varying float v_alpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float mask = smoothstep(0.5, 0.12, d);
  if (mask <= 0.01) discard;
  gl_FragColor = vec4(v_color, mask * v_alpha);
}`;

  class ParticlePortrait {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.gl = context(canvas);
      this.ok = !!this.gl;
      if (!this.ok) return;
      this.opts = opts;
      this.uniforms = { u_progress: 0, u_dispersion: 0, u_mouse: [-9, -9], u_size: opts.size || 1, u_imageAspect: [0.6, 1] };
      this.visible = true;
      this.ready = false;

      const gl = this.gl;
      this.program = link(gl, PARTICLE_VERT, PARTICLE_FRAG);
      if (!this.program) { this.ok = false; return; }

      this.resize();
      this._onResize = () => this.resize();
      window.addEventListener('resize', this._onResize);

      loadImage(opts.image).then(img => this.build(img));

      if ('IntersectionObserver' in window) {
        this.io = new IntersectionObserver(es => { this.visible = es[0].isIntersecting; }, { rootMargin: '160px' });
        this.io.observe(canvas);
      }

      this.stop = Ticker.add((t, dt) => {
        if (!this.visible || !this.ready) return;
        this.uniforms.u_time = t;
        if (opts.onFrame) opts.onFrame(this, t, dt);
        this.render();
      });
    }

    build(img) {
      const gl = this.gl;
      const density = this.opts.density || 150;
      const aspect = img.width / img.height;
      const cols = Math.round(density * Math.min(aspect, 1) * 1.35);
      const rows = Math.round(density);

      const cv = document.createElement('canvas');
      cv.width = cols; cv.height = rows;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, cols, rows);
      let data;
      try {
        data = ctx.getImageData(0, 0, cols, rows).data;
      } catch (e) {
        console.warn('Портрет из точек недоступен (canvas заблокирован политикой источника).');
        return;
      }

      const uv = [], color = [], rand = [];
      const tint = this.opts.tint || [1, 1, 1];
      const cut = this.opts.cutoff != null ? this.opts.cutoff : 0.055;
      // Студийный фон светлый и полностью обесцвеченный, а фигура — нет.
      // Поэтому отсекаем по насыщенности, а не по одной яркости.
      const keySat = this.opts.keySat != null ? this.opts.keySat : 0.055;
      const keyLum = this.opts.keyLum != null ? this.opts.keyLum : 0.44;

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = (y * cols + x) * 4;
          const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          if (lum < cut) continue;
          if (this.opts.keyOut) {
            const sat = Math.max(r, g, b) - Math.min(r, g, b);
            if (sat < keySat && lum > keyLum) continue;
          }
          // Мягкое прореживание тёмных зон — портрет читается как свет.
          if (lum < 0.22 && Math.random() > lum * 3.2) continue;
          uv.push(x / (cols - 1), 1 - y / (rows - 1));

          if (this.opts.mono) {
            // Светопись: тени лаймовые, света уходят в тёплый белый,
            // яркость точки повторяет яркость пикселя.
            const t = clamp((lum - 0.22) / 0.6, 0, 1);
            // Резкая кривая: света вспыхивают, полутона гаснут — так силуэт читается.
            const k = 0.10 + Math.pow(lum, 1.9) * 2.1;
            color.push(
              (0.76 + 0.21 * t) * k * tint[0],
              (0.85 + 0.11 * t) * k * tint[1],
              (0.28 + 0.62 * t) * k * tint[2]
            );
          } else {
            color.push(r * tint[0], g * tint[1], b * tint[2]);
          }
          rand.push(Math.random(), Math.random(), Math.random());
        }
      }

      this.count = uv.length / 2;
      this.uniforms.u_imageAspect = [aspect * (this.opts.scale || 0.86), (this.opts.scale || 0.86)];

      const mk = (arr, size, name) => {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
        return { buf, size, loc: gl.getAttribLocation(this.program, name) };
      };
      this.attribs = [mk(uv, 2, 'a_uv'), mk(color, 3, 'a_color'), mk(rand, 3, 'a_rand')];
      this.locations = {};
      this.ready = true;
      if (this.opts.onReady) this.opts.onReady(this);
    }

    resize() {
      const c = this.canvas;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      const w = Math.max(1, Math.round(c.clientWidth * dpr));
      const h = Math.max(1, Math.round(c.clientHeight * dpr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      this.uniforms.u_resolution = [w, h];
    }

    loc(name) {
      if (!(name in this.locations)) this.locations[name] = this.gl.getUniformLocation(this.program, name);
      return this.locations[name];
    }

    render() {
      const gl = this.gl;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.useProgram(this.program);
      for (const a of this.attribs) {
        if (a.loc < 0) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, a.buf);
        gl.enableVertexAttribArray(a.loc);
        gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, 0, 0);
      }
      for (const key in this.uniforms) {
        const l = this.loc(key);
        if (l === null) continue;
        const v = this.uniforms[key];
        if (typeof v === 'number') gl.uniform1f(l, v);
        else if (Array.isArray(v) && v.length === 2) gl.uniform2f(l, v[0], v[1]);
        else if (Array.isArray(v) && v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
      }
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.drawArrays(gl.POINTS, 0, this.count);
    }

    destroy() {
      if (this.stop) this.stop();
      if (this.io) this.io.disconnect();
      window.removeEventListener('resize', this._onResize);
    }
  }

  function supported() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) { return false; }
  }

  window.GL = { Sketch, ParticlePortrait, loadImage, supported, DEFAULT_VERT };
})();
