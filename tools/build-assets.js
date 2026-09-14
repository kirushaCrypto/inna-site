// Собирает js/assets.js: фото в виде data-URI, чтобы WebGL-текстуры
// грузились без CORS даже при открытии index.html напрямую (file://).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const imgDir = path.join(root, 'img');
const out = path.join(root, 'js', 'assets.js');

const files = fs.readdirSync(imgDir).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort();

const mime = f => (/\.png$/i.test(f) ? 'image/png' : /\.webp$/i.test(f) ? 'image/webp' : 'image/jpeg');

let body = '';
for (const f of files) {
  const key = path.basename(f).replace(/\.[^.]+$/, '');
  const b64 = fs.readFileSync(path.join(imgDir, f)).toString('base64');
  body += `  ${JSON.stringify(key)}: "data:${mime(f)};base64,${b64}",\n`;
}

const src = `/* Сгенерировано tools/build-assets.js — не редактировать вручную. */\nwindow.ASSETS = {\n${body}};\n`;
fs.writeFileSync(out, src);
console.log(`assets.js: ${files.length} файлов, ${(src.length / 1024).toFixed(0)} KB`);
