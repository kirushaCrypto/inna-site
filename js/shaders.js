/* ------------------------------------------------------------------
   shaders.js — GLSL для сцен: фоновая дымка, портрет первого экрана,
   морфинг-слайдер. NOISE подключается в начало каждой программы.
------------------------------------------------------------------ */
(function () {
  'use strict';

  const NOISE = `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += amp * vnoise(p);
    p = rot * p * 2.02;
    amp *= 0.5;
  }
  return v;
}

float grain(vec2 uv, float t) {
  return hash21(uv * 913.0 + fract(t) * 137.0);
}

vec2 cover(vec2 uv, float screenAspect, float imageAspect) {
  vec2 scale = screenAspect > imageAspect
    ? vec2(1.0, imageAspect / screenAspect)
    : vec2(screenAspect / imageAspect, 1.0);
  return (uv - 0.5) * scale + 0.5;
}
`;

  /* ---------------- Фоновая дымка, фиксирована на весь сайт -------- */
  const BG = `
precision highp float;
varying vec2 v_uv;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_scroll;
uniform float u_velocity;
uniform vec2 u_mouse;
${NOISE}

void main() {
  vec2 uv = v_uv;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = u_time * 0.032;

  // Двойное доменное искажение: облако не читается как повтор.
  vec2 q = vec2(fbm(p * 1.5 + vec2(0.0, t)),
                fbm(p * 1.5 + vec2(5.2, 1.3 - t)));
  vec2 r = vec2(fbm(p * 1.8 + q * 1.3 + vec2(1.7, 9.2) + t * 1.3),
                fbm(p * 1.8 + q * 1.3 + vec2(8.3, 2.8) - t * 1.0));
  float f = fbm(p * 1.6 + r * 1.2 + u_scroll * 0.55);

  vec3 base = vec3(0.030, 0.030, 0.035);
  vec3 warm = vec3(0.085, 0.086, 0.070);
  vec3 lime = vec3(0.482, 0.549, 0.176);

  vec3 col = mix(base, warm, smoothstep(0.35, 0.95, f));
  // Лаймовые прожилки в гребнях шума — акцент костюма на фото.
  float veins = smoothstep(0.62, 0.86, f + length(r) * 0.16);
  col += lime * veins * (0.055 + u_scroll * 0.075);

  // Пятно света, тянущееся за курсором.
  vec2 m = vec2(u_mouse.x * aspect, u_mouse.y);
  float md = distance(p, m);
  col += lime * smoothstep(0.85, 0.0, md) * 0.05;
  col += vec3(0.09) * smoothstep(0.55, 0.0, md) * 0.16;

  // Скорость скролла подсвечивает картинку.
  col += lime * clamp(abs(u_velocity), 0.0, 1.0) * 0.045;

  // Виньетка и зерно.
  float vig = smoothstep(1.25, 0.25, distance(uv, vec2(0.5)));
  col *= 0.42 + vig * 0.58;
  col += (grain(uv, u_time) - 0.5) * 0.030;

  gl_FragColor = vec4(col, 1.0);
}`;

  /* ------------------ Портрет первого экрана ----------------------- */
  const PORTRAIT = `
precision highp float;
varying vec2 v_uv;
uniform vec2 u_resolution;
uniform vec2 u_tex0_size;
uniform sampler2D u_tex0;
uniform float u_time;
uniform float u_reveal;     // 0..1 появление при загрузке
uniform float u_velocity;   // скорость скролла
uniform float u_progress;   // прогресс ухода первого экрана
uniform vec2 u_mouse;       // -1..1 относительно канваса
${NOISE}

void main() {
  vec2 uv = v_uv;
  float screenAspect = u_resolution.x / u_resolution.y;
  float imageAspect = u_tex0_size.x / u_tex0_size.y;

  // Медленное «дыхание» поверхности плюс реакция на курсор.
  float n = fbm(uv * 2.6 + vec2(u_time * 0.07, -u_time * 0.05));
  vec2 flow = vec2(n - 0.5, fbm(uv * 2.2 - u_time * 0.06) - 0.5);

  vec2 warped = uv;
  warped += flow * 0.026 * (0.35 + u_reveal);
  warped += u_mouse * 0.022 * (0.4 + n * 0.6);
  warped.y -= u_progress * 0.06;

  vec2 iuv = cover(warped, screenAspect, imageAspect);
  iuv = (iuv - 0.5) * (1.0 - u_progress * 0.07 + (1.0 - u_reveal) * 0.14) + 0.5;

  // Хроматическая аберрация растёт со скоростью скролла.
  float split = 0.0022 + abs(u_velocity) * 0.020;
  vec2 dir = normalize(vec2(0.35, 1.0));
  float rC = texture2D(u_tex0, iuv + dir * split).r;
  float gC = texture2D(u_tex0, iuv).g;
  float bC = texture2D(u_tex0, iuv - dir * split).b;
  vec3 col = vec3(rC, gC, bC);

  float lum = dot(col, vec3(0.299, 0.587, 0.114));

  // Мягкий дуотон: тени уходят в холодный графит, света остаются тёплыми.
  vec3 shadow = vec3(0.043, 0.047, 0.054);
  vec3 light  = vec3(0.960, 0.956, 0.925);
  vec3 duo = mix(shadow, light, smoothstep(0.03, 0.94, lum));
  col = mix(col, duo, 0.46);

  // Лаймовый отсвет по контуру освещённых зон.
  float rim = smoothstep(0.52, 0.88, lum) - smoothstep(0.88, 1.0, lum);
  col += vec3(0.482, 0.549, 0.176) * rim * 0.16;

  // Контраст.
  col = (col - 0.5) * 1.10 + 0.5;

  // Появление: шумовая волна снизу вверх, поверх — тонкая светящаяся кромка.
  float wave = fbm(uv * 3.4 + 11.0) * 0.28;
  float edge = u_reveal * 1.4 - 0.2;
  float mask = smoothstep(edge - 0.16, edge + 0.02, uv.y * 0.72 + wave + 0.14);
  mask = 1.0 - mask;
  float glow = smoothstep(0.06, 0.0, abs(uv.y * 0.72 + wave + 0.14 - edge));
  col += vec3(0.482, 0.549, 0.176) * glow * u_reveal * (1.0 - u_reveal) * 3.2;

  // Растворение краёв, чтобы портрет садился в фон без рамки.
  vec2 d = abs(uv - 0.5) * 2.0;
  float fade = (1.0 - smoothstep(0.62, 1.0, d.x)) * (1.0 - smoothstep(0.70, 1.0, d.y));
  float alpha = mask * fade;
  alpha *= 1.0 - smoothstep(0.55, 1.0, u_progress);

  col += (grain(uv, u_time) - 0.5) * 0.045;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`;

  /* --------------- Морфинг-слайдер: перелив между кадрами ---------- */
  const MORPH = `
precision highp float;
varying vec2 v_uv;
uniform vec2 u_resolution;
uniform sampler2D u_tex0;
uniform sampler2D u_tex1;
uniform vec2 u_tex0_size;
uniform vec2 u_tex1_size;
uniform float u_time;
uniform float u_mix;        // 0..1 переход между кадрами
uniform float u_velocity;
uniform vec2 u_mouse;
uniform float u_hover;
${NOISE}

vec3 sample_frame(sampler2D tex, vec2 size, vec2 uv, float push) {
  float screenAspect = u_resolution.x / u_resolution.y;
  float imageAspect = size.x / size.y;
  vec2 scale = screenAspect > imageAspect
    ? vec2(1.0, imageAspect / screenAspect)
    : vec2(screenAspect / imageAspect, 1.0);
  // Центр кадрирования смещён вверх: в вертикальном портрете там лицо.
  vec2 iuv = (uv - 0.5) * scale + vec2(0.5, mix(0.5, 0.70, 1.0 - scale.y));
  iuv = (iuv - 0.5) * (1.0 + push * 0.10) + 0.5;
  return texture2D(tex, clamp(iuv, 0.001, 0.999)).rgb;
}

void main() {
  vec2 uv = v_uv;
  float t = u_time * 0.05;

  // Жидкая маска перехода: не линейная шторка, а растекающееся пятно.
  float n = fbm(uv * 2.9 + vec2(t, -t));
  float m = smoothstep(0.0, 1.0, u_mix);
  float threshold = m * 1.5 - 0.25;
  float edge = smoothstep(threshold - 0.30, threshold + 0.16, uv.x * 0.42 + uv.y * 0.16 + n * 0.62);
  float blend = 1.0 - edge;

  // На кромке перехода изображение растягивается по потоку шума.
  float ridge = smoothstep(0.42, 0.0, abs(blend - 0.5));
  vec2 flow = vec2(fbm(uv * 3.1 + 4.0) - 0.5, fbm(uv * 3.1 - 2.0) - 0.5);
  vec2 dist = flow * ridge * 0.16;
  vec2 mouseWarp = u_mouse * 0.018 * u_hover;

  float split = 0.0016 + abs(u_velocity) * 0.014 + ridge * 0.010;
  vec2 uvA = uv + dist + mouseWarp;
  vec2 uvB = uv - dist + mouseWarp;

  vec3 a = vec3(
    sample_frame(u_tex0, u_tex0_size, uvA + vec2(split, 0.0), m).r,
    sample_frame(u_tex0, u_tex0_size, uvA, m).g,
    sample_frame(u_tex0, u_tex0_size, uvA - vec2(split, 0.0), m).b
  );
  vec3 b = vec3(
    sample_frame(u_tex1, u_tex1_size, uvB + vec2(split, 0.0), m - 1.0).r,
    sample_frame(u_tex1, u_tex1_size, uvB, m - 1.0).g,
    sample_frame(u_tex1, u_tex1_size, uvB - vec2(split, 0.0), m - 1.0).b
  );

  vec3 col = mix(b, a, blend);

  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  vec3 duo = mix(vec3(0.047, 0.050, 0.056), vec3(0.957, 0.953, 0.925), smoothstep(0.02, 0.95, lum));
  col = mix(col, duo, 0.52 - u_hover * 0.24);
  col += vec3(0.482, 0.549, 0.176) * ridge * 0.14;
  col = (col - 0.5) * 1.07 + 0.5;

  float vig = smoothstep(1.30, 0.30, distance(uv, vec2(0.5)));
  col *= (0.40 + vig * 0.38);
  col += (grain(uv, u_time) - 0.5) * 0.040;

  gl_FragColor = vec4(col, 1.0);
}`;

  window.SHADERS = { NOISE, BG, PORTRAIT, MORPH };
})();
