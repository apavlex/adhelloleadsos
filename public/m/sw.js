/* Reviews / member PWA — scoped to /m/ so workspace Agency OS pushes stay separate. */
const CACHE_VERSION = 'adhello-member-sw-v3';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('adhello-member-sw-') && k !== CACHE_VERSION).map((k) => caches.delete(k)))
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
      data: { url: data.url || '/m' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || '/m';
  const target = new URL(raw, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => {
        try {
          return new URL(w.url).pathname.startsWith('/m/');
        } catch (e) {
          return false;
        }
      });
      if (win) {
        return win.focus().then((w) => (w && 'navigate' in w ? w.navigate(target) : null));
      }
      return self.clients.openWindow(target);
    })
  );
});

self.addEventListener('message', (event) => {
  const data = event && event.data;
  if (!data || data.type !== 'CLEAR_NOTIFICATIONS') return;
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
