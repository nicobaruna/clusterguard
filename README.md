# ClusterGuard PWA

## Deploy ke Vercel

1. Push project ke GitHub.
2. Buka Vercel dan pilih New Project.
3. Import repository ini.
4. Gunakan pengaturan:
   - Framework Preset: Other
   - Build Command: `npm run build`
   - Output Directory: `.`
5. Tambahkan environment variable berikut di Vercel Project Settings > Environment Variables:
   - `FCM_SERVICE_ACCOUNT_JSON` (wajib)
   - `GOOGLE_APPLICATION_CREDENTIALS` (opsional, jika Anda ingin memakai kredensial default dari Google)
6. Deploy.

### Endpoint yang tersedia
- `GET /api/health`
- `POST /send-fcm` atau `POST /api/send-fcm`

### Contoh uji
```bash
curl -X POST https://<nama-project>.vercel.app/send-fcm \
  -H "Content-Type: application/json" \
  -d '{"tokens":["TOKEN_FCM_ANDA"],"title":"SOS Test","body":"Coba push dari Vercel"}'
```

### Catatan penting
- Nilai `FCM_SERVICE_ACCOUNT_JSON` harus berisi JSON service account Firebase dalam format single-line JSON atau base64.
- Jangan isi dengan path file lokal.
