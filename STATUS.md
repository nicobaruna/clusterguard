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

## Belum dikerjakan (dicatat sebagai follow-up)
- Rotasi Firebase service account key yang sempat ter-paste di chat oleh user (belum dikonfirmasi sudah diganti).
- Lanjutan hardening `firestore.rules` untuk koleksi non-token (`pic`, `sos`, `warga`) tanpa memutus flow operasional saat ini.
