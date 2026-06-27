const CACHE_NAME = 'clusterguard-cache-v3';
let backgroundPollTimer = null;

async function maybeShowSOSNotification(latestSos) {
  if (!latestSos) return false;
  try {
    const cache = await caches.open('clusterguard-bg-sync');
    const previousResponse = await cache.match('/last-sos-id');
    const previousId = previousResponse ? await previousResponse.text() : '';
    if (previousId === latestSos.id) return false;
    await cache.put('/last-sos-id', new Response(latestSos.id));
    const body = `${latestSos.nama_pelapor || 'Warga'} di ${latestSos.no_rumah || '-'} (${latestSos.jenis_sos || 'SOS'})`;
    console.log('SW background alert:', latestSos.id, body);
    self.registration.showNotification('SOS ClusterGuard', {
      body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: `clusterguard-sos-${latestSos.id}`,
      renotify: true,
      requireInteraction: true,
      data: { url: './' }
    });
    return true;
  } catch (error) {
    console.warn('Background SOS polling failed:', error);
    return false;
  }
}

function startBackgroundPolling() {
  if (backgroundPollTimer) return;
  backgroundPollTimer = setInterval(async () => {
    const latestSos = await getPendingSosFromFirestore();
    await maybeShowSOSNotification(latestSos);
  }, 30000);
}

const ASSETS = [
  './',
  './index.html',
  './index.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://unpkg.com/dexie@latest/dist/dexie.js',
  'https://unpkg.com/lucide@latest'
];

// Install Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Caching App Shell Assets');
        return cache.addAll(ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Service Worker
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
    }).then(() => {
      self.clients.claim();
      startBackgroundPolling();
    })
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'SHOW_SOS_NOTIFICATION') {
    const payload = event.data.payload || {};
    self.registration.showNotification(payload.title || 'SOS ClusterGuard', {
      body: payload.body || 'Ada laporan darurat baru.',
      icon: payload.icon || './icon-192.png',
      badge: payload.badge || './icon-192.png',
      tag: payload.tag || 'clusterguard-sos',
      renotify: payload.renotify !== undefined ? payload.renotify : true,
      requireInteraction: payload.requireInteraction !== undefined ? payload.requireInteraction : true,
      data: payload.data || { url: payload.url || './' }
    });
  }

  if (event.data && event.data.type === 'START_BACKGROUND_POLLING') {
    startBackgroundPolling();
  }
});

async function getPendingSosFromFirestore() {
  try {
    const projectId = 'clusterg-1076f';
    const apiKey = 'AIzaSyCEZZ_qCpzWEMLhaDfj0XJWsVVwXRDRwVM';
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/sos?key=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();

    const docs = (data.documents || []).map((doc) => {
      const fields = doc.fields || {};
      const getString = (fieldName) => {
        const value = fields[fieldName];
        if (!value) return '';
        return value.stringValue || value.integerValue || value.timestampValue || '';
      };
      return {
        id: (doc.name || '').split('/').pop(),
        status: getString('status'),
        jenis_sos: getString('jenis_sos'),
        nama_pelapor: getString('nama_pelapor'),
        no_rumah: getString('no_rumah')
      };
    });

    return docs.filter((item) => item.status === 'Mencari Bantuan').sort((a, b) => (b.id || '').localeCompare(a.id || ''))[0] || null;
  } catch (error) {
    console.warn('Background SOS sync failed:', error);
    return null;
  }
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'sos-alert-sync') {
    event.waitUntil((async () => {
      const latestSos = await getPendingSosFromFirestore();
      if (!latestSos) return;
      await maybeShowSOSNotification(latestSos);
    })());
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('./');
      }
    })
  );
});

// Fetch Strategy: Cache first, fallback to network
self.addEventListener('fetch', event => {
  // Avoid caching non-GET requests or external analytics
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then(networkResponse => {
          // If response is valid, clone it into cache
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        }).catch(() => {
          // Offline fallback
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});
