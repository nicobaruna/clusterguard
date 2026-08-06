// Import Firebase SDK for service workers
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js');

// Initialize Firebase in service worker
const firebaseConfig = {
  apiKey: "AIzaSyCEZZ_qCpzWEMLhaDfj0XJWsVVwXRDRwVM",
  authDomain: "clusterg-1076f.firebaseapp.com",
  projectId: "clusterg-1076f",
  storageBucket: "clusterg-1076f.firebasestorage.app",
  messagingSenderId: "1095467329865",
  appId: "1:1095467329865:web:a5ee05ac81b38b27f69298"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

const CACHE_NAME = 'clusterguard-cache-v7';
const IGNORED_FETCH_HOSTS = ['firestore.googleapis.com', 'firebase.googleapis.com', 'googleapis.com', 'gstatic.com'];
let backgroundPollTimer = null;
let lastShownSosId = null;

function parseVibratePattern(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch (_error) {
      // ignore parse failures
    }
  }
  return null;
}

function buildAudibleNotificationOptions({ title = 'SOS ClusterGuard', body = 'Ada laporan darurat baru.', data = {}, tag = 'clusterguard-sos' } = {}) {
  const vibrate = parseVibratePattern(data.vibrate) || [900, 300, 900, 300, 1200];
  const normalizedTag = data.tag || data.sosId || tag || `clusterguard-sos-${Date.now()}`;

  return {
    title,
    body,
    icon: data.icon || './icon-192.png',
    badge: data.badge || './icon-192.png',
    tag: normalizedTag,
    silent: false,
    vibrate,
    timestamp: Date.now(),
    renotify: true,
    requireInteraction: true,
    data: { url: data.url || './', ...data }
  };
}

async function maybeShowSOSNotification(latestSos) {
  if (!latestSos) return false;
  try {
    const cache = await caches.open('clusterguard-bg-sync');
    const previousResponse = await cache.match('/last-sos-id');
    const previousId = previousResponse ? await previousResponse.text() : '';
    if (previousId === latestSos.id) return false;
    await cache.put('/last-sos-id', new Response(latestSos.id));
    lastShownSosId = latestSos.id;
    const body = `${latestSos.nama_pelapor || 'Warga'} di ${latestSos.no_rumah || '-'} (${latestSos.jenis_sos || 'SOS'})`;
    console.log('SW background alert:', latestSos.id, body);
    const options = buildAudibleNotificationOptions({
      body,
      tag: `clusterguard-sos-${latestSos.id}`,
      data: {
        sosId: latestSos.id,
        jenis_sos: latestSos.jenis_sos,
        nama_pelapor: latestSos.nama_pelapor,
        no_rumah: latestSos.no_rumah
      }
    });
    self.registration.showNotification(options.title, options);
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
  }, 20000);
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
        keys.filter(key => key.startsWith('clusterguard-cache-') && key !== CACHE_NAME)
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
    const options = buildAudibleNotificationOptions({
      title: payload.title,
      body: payload.body,
      data: {
        ...(payload.data || {}),
        icon: payload.icon,
        badge: payload.badge,
        tag: payload.tag,
        url: payload.url || payload?.data?.url || './'
      },
      tag: payload.tag || 'clusterguard-sos'
    });
    self.registration.showNotification(options.title, options);
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

// Handle FCM push messages when app is in background
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data && event.data.json ? event.data.json() : {};
  } catch (error) {
    payload = {};
  }

  const title = payload.title || payload.notification?.title || 'SOS ClusterGuard';
  const body = payload.body || payload.notification?.body || 'Ada laporan darurat baru.';
  const data = payload.data || {};
  const options = buildAudibleNotificationOptions({
    title,
    body,
    data,
    tag: data.sosId || payload?.notification?.tag || 'clusterguard-sos'
  });

  event.waitUntil(
    self.registration.showNotification(options.title, options)
  );
});

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
  const targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Fetch Strategy: Cache first, fallback to network
self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);

  // Avoid caching non-GET requests or external API traffic that should flow directly.
  if (event.request.method !== 'GET') return;

  const shouldIgnore = IGNORED_FETCH_HOSTS.some((host) => requestUrl.hostname.includes(host));
  if (shouldIgnore) {
    return;
  }

  // Only cache same-origin app assets and navigations.
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  const isAppShellCritical =
    event.request.mode === 'navigate' ||
    requestUrl.pathname.endsWith('/app.js') ||
    requestUrl.pathname.endsWith('/index.html');

  // Keep app shell fresh to avoid running stale JS from an old service worker cache.
  if (isAppShellCritical) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            if (cached) {
              return cached;
            }
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html');
            }
            return undefined;
          });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        }).catch(() => {
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});