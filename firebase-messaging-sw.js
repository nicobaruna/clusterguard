importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: self.location.search.includes('apiKey=') ? new URL(self.location.href).searchParams.get('apiKey') : '',
  authDomain: 'clusterg-1076f.firebaseapp.com',
  projectId: 'clusterg-1076f',
  storageBucket: 'clusterg-1076f.appspot.com',
  messagingSenderId: '1095467329865',
  appId: '1:1095467329865:web:a5ee05ac81b38b27f69298',
  measurementId: 'G-7DW587FKQ2'
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || 'SOS ClusterGuard';
  const body = payload?.notification?.body || 'Ada laporan darurat baru.';
  const options = {
    body,
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: payload?.data?.tag || 'clusterguard-sos',
    renotify: true,
    data: { url: payload?.data?.url || './' }
  };
  return self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
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
