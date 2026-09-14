const CACHE = 'minha-area-shell-v5';
const SHELL = ['/aluno', '/manifest.webmanifest', '/assets/marca/app-icon-192.png', '/assets/marca/app-icon-512.png', '/assets/marca/apple-touch-icon.png'];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/painel') || url.pathname.startsWith('/login')) return;
  event.respondWith(fetch(request).then((response) => { if (response.ok && (url.pathname === '/aluno' || url.pathname.startsWith('/assets/'))) { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(request, copy)); } return response; }).catch(() => caches.match(request).then((cached) => cached || caches.match('/aluno'))));
});
