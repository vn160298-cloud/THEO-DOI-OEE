/* =====================================================================
   Service Worker — cho phép chạy như app thực thụ (offline + toàn màn hình)
   Khi cập nhật app: đổi CACHE_VERSION (v1 -> v2 ...) rồi deploy lại.
   Chỉ cache phần giao diện; dữ liệu luôn lấy trực tiếp từ Google Sheets.
   ===================================================================== */
const CACHE_VERSION = 'oee-v2';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './config.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(c => Promise.all(SHELL.map(u => c.add(new Request(u, {cache:'reload'})).catch(()=>{}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;                       /* không cache API */
  const url = new URL(req.url);
  if(url.origin !== location.origin) return;             /* không cache Apps Script */

  /* network-first cho file giao diện: luôn ưu tiên bản mới, offline thì dùng cache */
  e.respondWith(
    fetch(req).then(res => {
      if(res && res.ok) caches.open(CACHE_VERSION).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
