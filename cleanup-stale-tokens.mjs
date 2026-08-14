// cleanup-stale-tokens.mjs
// Bersihkan token FCM basi dari Firestore: kirim pesan uji ke semua token,
// lalu HAPUS doc token yang gagal dengan error `registration-token-not-registered`
// (token sudah tidak terdaftar / device uninstall / token diganti).

import admin from 'firebase-admin';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const saPath = path.join(__dirname, 'service_account.json');
if (!fs.existsSync(saPath)) {
  console.error('service_account.json tidak ditemukan di', saPath);
  process.exit(1);
}

const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(sa),
    projectId: sa.project_id
  });
}
console.log('Admin SDK OK - project:', sa.project_id);

// 1) Kumpulkan semua token dari Firestore
const snap = await admin.firestore().collection('fcmTokens').get();
const entries = [];
snap.forEach((docSnap) => {
  const d = docSnap.data();
  const t = d.token || d.fcmToken || d.value;
  if (typeof t === 'string' && t.trim()) {
    entries.push({ docId: docSnap.id, token: t.trim(), source: d.source || d.platform || 'unknown' });
  }
});
console.log('Total token di Firestore:', entries.length);

if (entries.length === 0) {
  console.log('Tidak ada token untuk dicek.');
  process.exit(0);
}

// 2) Kirim pesan uji (data-only, type biasa agar tidak memicu alarm SOS di device)
const messages = entries.map((e) => ({
  token: e.token,
  data: {
    type: 'token_check',
    title: 'Token check',
    body: 'Internal check',
    silent: 'true'
  },
  android: { priority: 'high', ttl: 60000 }
}));

const UNREGISTERED = 'messaging/registration-token-not-registered';

let response;
try {
  response = await admin.messaging().sendEach(messages);
} catch (err) {
  console.error('sendEach gagal total:', err.message);
  process.exit(1);
}

console.log('Hasil cek: success', response.successCount, '| failure', response.failureCount);

// 3) Hapus doc token yang NotRegistered
const toDelete = [];
response.responses.forEach((r, i) => {
  const entry = entries[i];
  const code = r.error?.code || '';
  const isUnregistered = code === UNREGISTERED || /not-registered|NotRegistered|unregistered/i.test(r.error?.message || '');
  if (r.success) {
    console.log('  [OK]     ', entry.docId);
  } else if (isUnregistered) {
    console.log('  [HAPUS]  ', entry.docId, '->', code);
    toDelete.push(entry);
  } else {
    console.log('  [KIRIM GAGAL, DI-PERTAHANKAN]', entry.docId, '->', code, r.error?.message || '');
  }
});

if (toDelete.length === 0) {
  console.log('\nTidak ada token basi untuk dihapus.');
  process.exit(0);
}

console.log('\nMenghapus', toDelete.length, 'doc token basi…');
const batch = admin.firestore().batch();
toDelete.forEach((e) => {
  batch.delete(admin.firestore().collection('fcmTokens').doc(e.docId));
});
await batch.commit();
console.log('Selesai. Token basi terhapus:', toDelete.length);
