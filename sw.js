/* 保固維修回報 service worker：讓 App 可以安裝到桌面／主畫面。
 * 只快取 App 本身的檔案（先連網、斷線才用快取），GitHub 上的案件與照片一律直接連線，不快取。 */
const VERSION = 'warranty-app-v1';
const SHELL = ['./', 'index.html', 'app.js', 'config.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, {cache: 'reload'})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('warranty-app-') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(new URL('./', self.registration.scope).pathname)) return;
  e.respondWith(
    fetch(req, {cache: 'no-cache'})
      .then(r => { if (r.ok) { const c = r.clone(); caches.open(VERSION).then(x => x.put(req.mode === 'navigate' ? './' : req, c)); } return r; })
      .catch(() => caches.match(req.mode === 'navigate' ? './' : req, {ignoreSearch: true}))
  );
});
