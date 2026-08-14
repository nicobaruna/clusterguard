# ClusterGuard PWA

## Arsitektur Push Saat Ini

- Frontend mengirim broadcast SOS ke endpoint `/send-fcm`.
- Endpoint tersebut di-handle Vercel Serverless Function `api/send-fcm.js`.
- Function mengirim notifikasi ke Firebase Cloud Messaging (FCM).
- Deploy otomatis via Vercel setiap push ke branch `master`.

## Deploy

Project ini di-deploy di Vercel (lihat `vercel.json`). Rewrite:
- `/send-fcm` → `/api/send-fcm`
- `/health` → `/api/health`

## Environment Variables (Vercel)

- `FCM_SERVICE_ACCOUNT_JSON`
	- Wajib berisi service account JSON Firebase dalam format single-line JSON atau base64.
	- Jangan isi dengan path file lokal.
