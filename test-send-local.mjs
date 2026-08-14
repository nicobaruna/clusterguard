// test-send-local.mjs
// Test kirim FCM dari lokal: kirim push test ke SEMUA token di koleksi `fcmTokens`
// dan tampilkan hasil per-token (success / error code) untuk diagnosa kenapa
// notif tidak masuk di mobile apps.
//
// Cara pakai:  node test-send-local.mjs
// Opsional:     node test-send-local.mjs <token-fcm>   (kirim ke 1 token tertentu)

import admin from 'firebase-admin';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TITLE = 'TEST ClusterGuard (lokal)';
const BODY = 'Ini notif uji coba dari mesin lokal. Jika ini muncul, FCM OK.';

// 1) Init Admin SDK dari service_account.json
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

// 2) Kumpulkan token
const explicitToken = process.argv[2];
let tokens = [];

if (explicitToken) {
  tokens = [explicitToken.trim()];
  console.log('Mengirim ke 1 token eksplisit (…' + tokens[0].slice(-20) + ')');
} else {
  const snap = await admin.firestore().collection('fcmTokens').get();
  snap.forEach((docSnap) => {
    const d = docSnap.data();
    const t = d.token || d.fcmToken || d.value;
    if (typeof t === 'string' && t.trim()) {
      tokens.push({ token: t.trim(), docId: docSnap.id, source: d.source || d.platform || 'unknown' });
    }
  });
  console.log('Token di Firestore:', tokens.length);
  for (const e of tokens) {
    console.log('  -', e.docId, '| source:', e.source, '| …' + e.token.slice(-20));
  }
}

if (tokens.length === 0) {
  console.error('Tidak ada token. Pastikan app sudah registrasi & tersimpan ke Firestore.');
  process.exit(1);
}

// 3) Kirim pesan data-only (sama seperti produksi: tanpa blok notification)
const messages = tokens.map((entry) => {
  const token = typeof entry === 'string' ? entry : entry.token;
  return {
    token,
    data: {
      type: 'sos_alert',
      sosId: 'test-local-' + Date.now(),
      title: TITLE,
      body: BODY
    },
    android: {
      priority: 'high',
      ttl: 3600000
    }
  };
});

console.log('\nMengirim ' + messages.length + ' pesan FCM…');
try {
  const response = await admin.messaging().sendEach(messages);
  console.log('\n=== HASIL ===');
  console.log('Success :', response.successCount);
  console.log('Failure :', response.failureCount);

  response.responses.forEach((r, i) => {
    const label = typeof tokens[i] === 'string' ? tokens[i] : tokens[i].docId;
    if (r.success) {
      console.log('  [OK]     ', label);
    } else {
      const code = r.error?.code || 'unknown';
      const msg = r.error?.message || '';
      console.log('  [GAGAL]  ', label, '->', code, msg);
    }
  });
} catch (err) {
  console.error('sendEach gagal total:', err.message);
  process.exit(1);
}
