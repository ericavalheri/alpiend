import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { pendente } from './scripts/_pendente.mjs';

const icones = ['public/assets/marca/app-icon-192.png', 'public/assets/marca/app-icon-512.png', 'public/assets/marca/apple-touch-icon.png'];
const faltando = icones.filter((caminho) => !existsSync(caminho));
if (faltando.length) pendente(`faltam os ícones do app desta escola: ${faltando.join(', ')} (ver public/assets/LEIA-ME.md)`);

const manifest = JSON.parse(await readFile(new URL('./public/manifest.webmanifest', import.meta.url), 'utf8'));
const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const serviceWorker = await readFile(new URL('./public/sw.js', import.meta.url), 'utf8');

assert.equal(manifest.start_url, '/aluno');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.scope, '/');

const expectedIcons = [
  ['/assets/marca/app-icon-192.png', 192, 192],
  ['/assets/marca/app-icon-512.png', 512, 512],
];
for (const [src, width, height] of expectedIcons) {
  const icon = manifest.icons.find((item) => item.src === src);
  assert.ok(icon, `Manifest precisa declarar ${src}.`);
  assert.equal(icon.type, 'image/png');
  assert.match(icon.purpose || '', /maskable/);
  const png = await readFile(new URL(`./public${src}`, import.meta.url));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), width);
  assert.equal(png.readUInt32BE(20), height);
  assert.ok(serviceWorker.includes(src), `${src} precisa entrar no shell do service worker.`);
}

const appleIcon = await readFile(new URL('./public/assets/marca/apple-touch-icon.png', import.meta.url));
assert.equal(appleIcon.readUInt32BE(16), 180);
assert.equal(appleIcon.readUInt32BE(20), 180);
assert.match(html, /rel="apple-touch-icon"[^>]+apple-touch-icon\.png/);
assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
assert.match(serviceWorker, /url\.pathname\.startsWith\('\/api\/'\)/, 'Service worker não pode cachear respostas privadas da API.');

console.log('Minha Área PWA: manifest, ícones Android/iPhone e cache seguro verificados.');
