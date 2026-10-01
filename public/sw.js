/* AdHello PWA — cache shell assets; network-first for app pages. */
const CACHE_VERSION = 'adhello-pwa-v1.0.387';
const SHELL = [
  '/offline.html',
  '/manifest.webmanifest',
  '/images/adhello-app-icon-192.png',
  '/images/adhello-app-icon-512.png',
  '/images/adhello-app-icon.png',
  '/css/custom.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  // iOS revokes the subscription if a push arrives without a visible notification.
  event.waitUntil(
    self.registration.showNotification(data.title || 'AdHello', {
      body: data.body || '',
      tag: data.tag || undefined,
      icon: '/images/adhello-app-icon-192.png',
      badge: '/images/adhello-app-icon-192.png',
      data: { url: data.url || '/today' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/today', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (win) {
        return win.focus().then((w) => (w && 'navigate' in w ? w.navigate(target) : null));
      }
      return self.clients.openWindow(target);
    })
  );
});

function isStaticAsset(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/css/') ||
      url.pathname.startsWith('/js/') ||
      url.pathname.startsWith('/images/') ||
      url.pathname.startsWith('/fonts/') ||
      url.pathname === '/manifest.webmanifest' ||
      url.pathname === '/offline.html')
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Never intercept API / auth / telephony
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/ceo/mcp')
  ) {
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // HTML / navigation: network first, offline fallback
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((res) => res)
        .catch(() => caches.match('/offline.html'))
    );
  }
});
