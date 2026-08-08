# ClusterGuard PWA

## Arsitektur Push Saat Ini

- Frontend mengirim broadcast SOS ke endpoint `/send-fcm`.
- Endpoint tersebut di-handle Netlify Function `netlify/functions/send-fcm.js`.
- Netlify Function mengirim notifikasi ke Firebase Cloud Messaging (FCM).

## Deploy

Project ini dikonfigurasi untuk deploy di Netlify (lihat `netlify.toml`).

## Environment Variables (Netlify)

- `FCM_SERVICE_ACCOUNT_JSON`
	- Wajib berisi service account JSON Firebase dalam format single-line JSON atau base64.
	- Jangan isi dengan path file lokal.
