# ClusterGuard PWA - Project Notes

## Ringkasan Singkat
ClusterGuard adalah Progressive Web App (PWA) untuk sistem kontak darurat kluster perumahan. Aplikasi mendukung tiga role utama:
- Warga: mengirim laporan SOS darurat.
- PIC: menerima dan menangani laporan SOS.
- Admin: mengelola data PIC dan melihat riwayat laporan.

## Status Saat Ini
- Aplikasi berjalan sebagai PWA dan sudah terdeploy ke Firebase Hosting.
- PIC bisa login, sesi disimpan lokal, dan laporan SOS bisa diterima.
- Status SOS sekarang diusahakan sinkron ke Firestore.
- Alarm SOS sudah dibatasi agar tidak muncul terus setelah laporan diterima/ditutup.

## Arsitektur Utama
- Frontend: HTML/CSS/JavaScript murni, tanpa framework.
- Storage lokal: IndexedDB via Dexie.js.
- Cloud sync: Firebase Firestore + Firebase Auth.
- PWA: Service Worker + Web App Manifest.

## File Penting
- app.js: logika utama aplikasi, alur warga/PIC/admin, session handling, alarm SOS, sync UI.
- firebase.js: inisialisasi Firebase, auth PIC, helper Firestore, listener koleksi.
- sw.js: service worker untuk PWA dan notifikasi.
- index.html: struktur UI utama dan elemen halaman.
- manifest.json: metadata PWA.
- firestore.rules: aturan akses Firestore.

## Masalah yang Sudah Diperbaiki
1. Sesi PIC tidak mudah hilang saat refresh atau buka ulang.
2. Alarm SOS tidak terus muncul setelah PIC menerima laporan.
3. Status SOS sekarang diperbarui ke Firestore melalui updateDocument.
4. Jika offline, update status SOS ditunda ke queue lokal dan dikirim saat online kembali.

## Catatan Kunci untuk Agent Berikutnya
- Jangan menghapus logika session PIC yang disimpan di localStorage.
- Jangan mengubah alur status SOS tanpa mempertimbangkan transisi:
  - Mencari Bantuan -> Dalam Perjalanan -> Selesai
- Saat bekerja di area SOS, cek dulu:
  - app.js
  - firebase.js
  - sw.js
- Jika ingin menguji sinkronisasi Firestore, gunakan akun PIC yang sudah login dan jalankan aksi menerima/menyelesaikan SOS.

## URL Aplikasi
- Firebase Hosting: https://clusterguard.web.app

## Perintah Umum
- Jalankan lokal: npm run dev
- Deploy hosting: firebase deploy --only hosting
