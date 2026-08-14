# ClusterGuard - Status Notifikasi SOS (28 Jul 2026)

## Arsitektur aktif (final, gratis/free-tier)
- Client (`app.js` -> `sendSOSFcmBroadcast()`) POST ke Netlify Function `/send-fcm`.
- `netlify/functions/send-fcm.js` menyusun payload FCM (`buildMessage()`) dan mengirim via `admin.messaging().sendEach()`.
- Kredensial: env var Netlify `FCM_SERVICE_ACCOUNT_JSON` (JSON single-line atau base64, BUKAN path file).
- Token disimpan per-device di Firestore `fcmTokens` dengan doc ID `{uid}_{24 char terakhir token}`.
- Firebase Cloud Functions lama sudah dihapus dari alur aktif. Push sekarang full via Netlify Functions.

## Masalah yang sudah diperbaiki
- [DONE] Kredensial FCM di Netlify (format single-line/base64).
- [DONE] Token per-device (bukan overwrite per-user).
- [DONE] Push debug panel (`?debugPush=1`) idle status - fix via persist localStorage + cache-busting service worker (v6 -> v7, network-first app shell).
- [DONE] Notifikasi web tidak bersuara - sudah di-set `silent:false`, vibrate pattern, `requireInteraction:true` di `send-fcm.js` dan `sw.js` (`buildAudibleNotificationOptions`). **Batasnya: ini cuma bisa memicu suara notifikasi default sistem Android, bukan nada custom, karena Web Push API/Service Worker tidak bisa memutar audio custom.**
- [DONE] Refresh token FCM periodik (6 jam) + saat online/focus/visible/controllerchange.
- [DONE] Cleanup legacy Firebase Functions (`functions/index.js`, `functions/package.json`) dan hapus blok `functions` di `firebase.json`.
- [DONE] Hardening awal `firestore.rules` untuk koleksi `fcmTokens` (akses dibatasi per UID terautentikasi).

## Sedang dikerjakan: native Android wrapper (biar alarm custom bisa maksa bunyi walau HP terkunci)
Lokasi: folder `mobile/` (project Capacitor terpisah, tidak dideploy oleh Netlify).

Yang sudah dibuat:
- `mobile/package.json`, `mobile/capacitor.config.json` (appId `com.clusterguard.app`).
- `mobile/scripts/copy-web-assets.js` - copy index.html/app.js/dll dari root ke `mobile/www` (jalankan `npm run sync-web` di dalam `mobile/`).
- `mobile/scripts/generate-siren.js` - generate WAV sirine sintetis (tanpa aset berhak cipta) ke `mobile/android/app/src/main/res/raw/alarm_sos.wav`.
- `mobile/android/` - project native Android (via `npx cap add android`), sudah **berhasil di-build** jadi debug APK di `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.
- `app.js`: fungsi baru `isNativeApp()`, `ensureNativePushChannel()`, `registerNativePushAndSyncToken()`, `setupNativePushListeners()` - dipanggil otomatis kalau app jalan di dalam wrapper native (Capacitor), pakai channel notifikasi `sos_alerts_v1` (IMPORTANCE_MAX + custom sound).
- `netlify/functions/send-fcm.js`: `buildMessage()` sekarang juga kirim blok `android` (channelId `sos_alerts_v1`, sound `alarm_sos`, priority high) selain `webpush`, jadi satu broadcast melayani web & native.

## Progress terbaru (28 Jul 2026)
- `google-services.json` sudah dipasang di `mobile/android/app/google-services.json`.
- Rebuild native berhasil: `npm run android:build` (sync-web + cap sync + Gradle assembleDebug).
- APK terbaru tersedia di `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.
- APK berhasil terpasang ke device nyata via Wireless ADB (tanpa USB file transfer).
- Fix tambahan untuk kasus sirine tidak bunyi: notification channel di-upgrade ke `sos_alerts_v2` (Android channel immutable, perubahan sound pada channel lama bisa diabaikan OS).

## Info lingkungan mesin dev
- Android SDK: `C:\Users\nico_putra\AppData\Local\Android\Sdk` (sudah ada, JDK 20 tersedia).
- `mobile/android/local.properties` berisi `sdk.dir=...` (gitignored, harus dibuat ulang tiap mesin baru).
- Build command: `cd mobile/android; ./gradlew.bat assembleDebug --console=plain` (build pertama ~6 menit, download Gradle distro + SDK platform/build-tools otomatis).

## Belum dikonfirmasi user (perlu ditest ulang di HP asli)
- Status push debug panel tidak lagi "idle" setelah fix cache-busting SW.
- Suara default sistem sudah keluar di HP terkunci (web push, sebelum native wrapper).
- Native APK (versi rebuild 28 Jul 2026) benar-benar membunyikan sirine custom saat HP terkunci.
- Payload FCM produksi sudah memakai `channelId: sos_alerts_v2` (butuh deploy Netlify Function terbaru jika belum terdeploy).

## E2E Test di HP Asli (14 Agu 2026) - Root cause & fix APK tidak terima notif

### Hasil E2E (SM-A528B, Android 14, wireless ADB)
- [DONE] Token FCM native terdaftar & tersimpan ke Firestore (`fcmTokens`).
- [DONE] APK menerima pesan FCM dan menjalankan alarm lengkap: `onMessageReceived` -> `SosAlarmActivity` (full-screen) -> `SosAlarmService` (sirine `alarm_sos` via MediaPlayer USAGE_ALARM + notifikasi foreground).
- [DONE] Tombol matikan alarm berhenti bersih tanpa crash.

### Root cause yang ditemukan & diperbaiki
1. **Pengiriman FCM selalu gagal di SDK**: `android.notification.priority: 'PRIORITY_MAX'` ditolak firebase-admin v13 (harus huruf kecil `'max'`). Terjadi di `fcm.js` dan `netlify/functions/send-fcm.js`.
2. **Daftar token penerima kosong**: device warga (tidak terautentikasi) diblokir `firestore.rules` saat baca `fcmTokens`; error ditelan `.catch(() => [])`. Fix: token dikumpulkan **server-side** di Netlify Function & dev server via Admin SDK (bypass rules). `triggerSOS` kini cukup POST `{title, body, data}`.
3. **Pesan `notification`/`android.notification` tidak memanggil `onMessageReceived` saat app di background** (FCM SDK menampilkan sendiri, tag `FCM-Notification`). Fix: pesan jadi **data-only murni** (tanpa blok notification & tanpa `android.notification`).
4. **Dua service FCM terdaftar** (custom + bawaan library `com.google.firebase.messaging.FirebaseMessagingService`) sehingga pesan ditangani service default. Fix: hapus service library via `tools:node="remove"`; custom service di-set `exported="false"` + `directBootAware="true"` (syarat FCM).
5. **Crash ANR `ForegroundServiceDidNotStartInTimeException`**: jalur STOP memakai `startForegroundService` tanpa `startForeground`, dan `startForeground` dilewati jika izin notifikasi ditolak. Fix: `stopNow` pakai `stopService()` + guard `isRunning`; `startForeground` selalu dipanggil; cleanup dipindah ke `onDestroy`.
6. **Endpoint FCM di APK salah**: `resolveFcmEndpoint()` di WebView Capacitor mengembalikan `https://localhost/send-fcm`. Fix: native selalu arahkan ke `https://clusterguard.netlify.app/send-fcm`.

### Catatan penting
- **Latency background**: di HP Samsung ini pesan data-only bisa tertunda 1-3 menit saat app di background (power management); saat foreground ~4 detik. Sarankan user mengecualikan app dari optimasi baterai (set "Unrestricted"/tidak dibatasi) di pengaturan Samsung.
- **Full-screen alarm hanya otomatis muncul saat layar terkunci** (perilaku Android `Background activity launch blocked`). Saat layar terbuka dengan app lain, sirine + heads-up tetap jalan.
- **Belum di-deploy**: perubahan `netlify/functions/send-fcm.js` harus di-deploy ulang ke Netlify (function lama masih versi rusak). APK terbaru sudah terpasang di HP (build 14 Agu 2026).

## Belum dikerjakan (dicatat sebagai follow-up)
- Rotasi Firebase service account key yang sempat ter-paste di chat oleh user (belum dikonfirmasi sudah diganti).
- Lanjutan hardening `firestore.rules` untuk koleksi non-token (`pic`, `sos`, `warga`) tanpa memutus flow operasional saat ini.
- `fcm.js`/dev server belum bisa parse `FCM_SERVICE_ACCOUNT_JSON` yang berisi path file (`./service_account.json`) di `.env` - perlu dukungan baca file agar testing lokal jalan.
