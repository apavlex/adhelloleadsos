/* AdHello Agency OS PWA — push + shell assets only.
 * Do NOT intercept HTML navigations (iOS blank / false offline).
 * Versioned ?v= assets are cache-first: the query string already busts on deploy,
 * so network-first was making every in-app hop wait on ~CSS+JS again. */
const CACHE_VERSION = 'adhello-pwa-v1.0.680';
const SHELL = [
  '/offline.html',
  '/manifest.webmanifest',
  '/images/adhello-app-icon-192.png',
  '/images/adhello-app-icon-512.png',
  '/images/adhello-app-icon.png',
  '/css/custom.css',
  '/css/tailwind.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) =>
        Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined)))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
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

self.addEventListener('message', (event) => {
  const data = event && event.data;
  if (!data) return;
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data.type === 'CLEAR_CACHES') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
    return;
  }
  if (data.type !== 'CLEAR_NOTIFICATIONS') return;
  event.waitUntil(
    self.registration.getNotifications().then((list) => {
      (list || []).forEach((n) => {
        try {
          n.close();
        } catch (e) {
          /* ignore */
        }
      });
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

function cachePut(req, res) {
  if (!res || !res.ok) return;
  const copy = res.clone();
  caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
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

  if (req.mode === 'navigate') return;
  const accept = req.headers.get('accept') || '';
  if (accept.includes('text/html')) return;

  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/ceo/mcp')
  ) {
    return;
  }

  if (!isStaticAsset(url)) return;

  // Cache-first for everything shell-related. ?v= on CSS/JS already changes on
  // deploy, so a new URL misses cache and fetches once — no need to block every hop.
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetching = fetch(req)
        .then((res) => {
          cachePut(req, res);
          return res;
        })
        .catch(() => cached);
      return cached || fetching;
    })
  );
});
