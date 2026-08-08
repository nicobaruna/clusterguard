// Menyalin file statis dari root PWA ke mobile/www agar Capacitor bisa membungkusnya jadi APK.
// Jalankan lewat: npm run sync-web (di dalam folder mobile/)
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const WWW = path.resolve(__dirname, '..', 'www');

const FILES_TO_COPY = [
  'index.html',
  'index.css',
  'app.js',
  'firebase.js',
  'sw.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png'
];

if (!fs.existsSync(WWW)) {
  fs.mkdirSync(WWW, { recursive: true });
}

for (const file of FILES_TO_COPY) {
  const src = path.join(ROOT, file);
  const dest = path.join(WWW, file);
  if (!fs.existsSync(src)) {
    console.warn(`[sync-web] Lewati (tidak ditemukan): ${file}`);
    continue;
  }
  fs.copyFileSync(src, dest);
  console.log(`[sync-web] Disalin: ${file}`);
}

console.log('[sync-web] Selesai menyalin aset web ke mobile/www');
