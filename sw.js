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

const CACHE_NAME = 'clusterguard-cache-v5';
const IGNORED_FETCH_HOSTS = ['firestore.googleapis.com', 'firebase.googleapis.com', 'googleapis.com', 'gstatic.com'];
let backgroundPollTimer = null;
let lastShownSosId = null;

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
  const data = payload.data || payload.data || {};

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: data.sosId || 'clusterguard-sos',
      renotify: true,
      requireInteraction: true,
      data: { url: './', ...data }
    })
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