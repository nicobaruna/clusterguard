// ==========================================
// 1. Database Lokal (Dexie.js)
// ==========================================
const localDb = new Dexie("DaruratClusterDB");
localDb.version(1).stores({
    warga: 'warga_id, nama, no_hp, no_rumah, password',
    pic: 'pic_id, nama, no_hp, jabatan, no_rumah, urutan, password'
});
function getWargaTable() {
    return localDb.warga || localDb.table('warga');
}

function getPicTable() {
    return localDb.pic || localDb.table('pic');
}

import { auth, db, signInPIC, ensurePICAuthUser, addDocument, updateDocument, listenCollection, softDeleteDocument, setDoc, doc, COLLECTIONS, fetchCollection, requestFCMToken, listenForForegroundMessages, saveFCMTokenToFirestore } from "./firebase.js";
// ==========================================
// 2. State & Konfigurasi Global
// ==========================================
let currentUserRole = 'warga'; // warga, pic, admin
let loggedInRole = null; // 'pic' atau 'admin' - role yang sedang login
let isOnline = navigator.onLine;

// State Warga
let antreanPIC = [];
let indeksPICAktif = 0;
let currentSOSLaporanId = null;
let sosSubmissionInFlight = false;
let lastSOSSubmissionAt = 0;
const SOS_SUBMIT_COOLDOWN_MS = 200;

// State PIC
let loggedInPIC = null;
let loggedInUserUid = null;
let activeSOSInterval = null;
let audioCtx = null;
let alarmOscillator1 = null;
let alarmOscillator2 = null;
let isAlarmPlaying = false;
let keepAliveTimer = null;
let wakeLockSentinel = null;
let keepAliveActive = false;

// State Admin
let currentAdminTab = 'pic';
let editingPICId = null;

// Onboarding State
let onboardingStep = 1;
const STORAGE_PIC_SESSION_KEY = "clusterguard_pic_session";
const STORAGE_WARGA_SESSION_KEY = "clusterguard_warga_session";
const STORAGE_ACKNOWLEDGED_SOS_KEY = "clusterguard_acknowledged_sos";
const STORAGE_SOS_STATUS_QUEUE_KEY = "clusterguard_sos_status_queue";
const STORAGE_PENDING_SOS_ALERT_KEY = "clusterguard_pending_sos_alert";
const STORAGE_FCM_LAST_SYNC_AT = 'clusterguard_fcm_last_sync_at';
const STORAGE_PENDING_WARGA_SYNC_KEY = 'clusterguard_pending_warga_sync';
const FCM_TOKEN_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FCM_TOKEN_REFRESH_CHECK_INTERVAL_MS = 5 * 60 * 1000;
let lastNotifiedSOSId = null;
let picSessionRestoreAttempted = false;
let wargaSessionRestoreAttempted = false;
let loggedInWarga = null;
let acknowledgedSOSIds = new Set();
let fcmListenerUnsubscribe = null;
let wargaListenerUnsubscribe = null;
const STORAGE_PUSH_DEBUG_KEY = 'clusterguard_push_debug';
const STORAGE_PUSH_DEBUG_STATE_KEY = 'clusterguard_push_debug_state';
const pushDebugState = {
    enabled: false,
    permission: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
    tokenMasked: '-',
    tokenSyncStatus: 'idle',
    tokenSyncAt: null,
    tokenSyncError: '',
    pushStatus: 'idle',
    pushAt: null,
    pushEndpoint: '-',
    pushSuccess: '-',
    pushFailure: '-',
    pushRecipientCount: '-',
    pushIncludesCurrentToken: '-',
    pushError: ''
};

function loadSavedPushDebugState() {
    try {
        const raw = localStorage.getItem(STORAGE_PUSH_DEBUG_STATE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
        return null;
    }
}

function maskToken(token) {
    if (!token || typeof token !== 'string') return '-';
    if (token.length <= 16) return token;
    return `${token.slice(0, 8)}...${token.slice(-8)}`;
}

function formatDebugTime(timestamp) {
    if (!timestamp) return '-';
    try {
        return new Date(timestamp).toLocaleString();
    } catch (error) {
        return '-';
    }
}

function resolvePushDebugEnabled() {
    const params = new URLSearchParams(window.location.search || '');
    if (params.has('debugPush')) {
        const value = (params.get('debugPush') || '').toLowerCase();
        const enabled = value === '' || value === '1' || value === 'true' || value === 'on';
        localStorage.setItem(STORAGE_PUSH_DEBUG_KEY, enabled ? '1' : '0');
        return enabled;
    }
    return localStorage.getItem(STORAGE_PUSH_DEBUG_KEY) === '1';
}

function refreshPushDebugPanel() {
    const panel = document.getElementById('push-debug-panel');
    if (!panel) return;

    if (!pushDebugState.enabled) {
        panel.style.display = 'none';
        return;
    }

    panel.style.display = 'block';
    const setText = (id, value) => {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    };

    setText('push-debug-permission', pushDebugState.permission || 'unknown');
    setText('push-debug-token', pushDebugState.tokenMasked || '-');
    setText('push-debug-token-status', pushDebugState.tokenSyncStatus || 'idle');
    setText('push-debug-token-at', formatDebugTime(pushDebugState.tokenSyncAt));
    setText('push-debug-token-error', pushDebugState.tokenSyncError || '-');
    setText('push-debug-push-status', pushDebugState.pushStatus || 'idle');
    setText('push-debug-push-at', formatDebugTime(pushDebugState.pushAt));
    setText('push-debug-push-endpoint', pushDebugState.pushEndpoint || '-');
    setText('push-debug-push-success', String(pushDebugState.pushSuccess ?? '-'));
    setText('push-debug-push-failure', String(pushDebugState.pushFailure ?? '-'));
    setText('push-debug-push-recipients', String(pushDebugState.pushRecipientCount ?? '-'));
    setText('push-debug-push-includes-current', String(pushDebugState.pushIncludesCurrentToken ?? '-'));
    setText('push-debug-push-error', pushDebugState.pushError || '-');
}

function setPushDebugState(patch = {}) {
    Object.assign(pushDebugState, patch);
    try {
        const snapshot = {
            permission: pushDebugState.permission,
            tokenMasked: pushDebugState.tokenMasked,
            tokenSyncStatus: pushDebugState.tokenSyncStatus,
            tokenSyncAt: pushDebugState.tokenSyncAt,
            tokenSyncError: pushDebugState.tokenSyncError,
            pushStatus: pushDebugState.pushStatus,
            pushAt: pushDebugState.pushAt,
            pushEndpoint: pushDebugState.pushEndpoint,
            pushSuccess: pushDebugState.pushSuccess,
            pushFailure: pushDebugState.pushFailure,
            pushRecipientCount: pushDebugState.pushRecipientCount,
            pushIncludesCurrentToken: pushDebugState.pushIncludesCurrentToken,
            pushError: pushDebugState.pushError
        };
        localStorage.setItem(STORAGE_PUSH_DEBUG_STATE_KEY, JSON.stringify(snapshot));
    } catch (error) {
        // Ignore localStorage persistence errors.
    }
    refreshPushDebugPanel();
}

function initializePushDebugPanel() {
    const enabled = resolvePushDebugEnabled();
    const savedState = loadSavedPushDebugState();
    setPushDebugState({
        ...(savedState || {}),
        enabled,
        permission: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
    });

    if (enabled) {
        showToast('Mode debug push aktif.', 'info');
    }
}

async function requestPersistentWakeLock() {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
        return;
    }

    if (keepAliveActive || !loggedInPIC) {
        return;
    }

    try {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        keepAliveActive = true;
        console.log('Wake lock aktif untuk monitoring background');
    } catch (error) {
        console.warn('Wake lock tidak tersedia:', error);
    }
}

function releasePersistentWakeLock() {
    if (wakeLockSentinel && typeof wakeLockSentinel.release === 'function') {
        wakeLockSentinel.release().catch(() => {});
    }
    wakeLockSentinel = null;
    keepAliveActive = false;
}

function startBackgroundKeepAlive() {
    if (keepAliveTimer) return;

    keepAliveTimer = setInterval(() => {
        if (document.visibilityState === 'hidden' || !navigator.onLine) {
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({ type: 'KEEP_ALIVE' });
            }
            return;
        }

        if (loggedInPIC) {
            void requestPersistentWakeLock();
        }
    }, 30000);
}

function registerNativeAndroidTokenListener() {
    if (typeof window === 'undefined') return;
    window.addEventListener('native-fcm-token', (event) => {
        const token = String(event?.detail?.token || '').trim();
        if (!token) return;
        window.__CLUSTERGUARD_NATIVE_FCM_TOKEN__ = token;
        localStorage.setItem('clusterguard_fcm_token', token);
        localStorage.setItem('clusterguard_last_native_token', token);
        localStorage.setItem('clusterguard_pending_fcm_token', token);
        setPushDebugState({
            tokenMasked: maskToken(token),
            tokenSyncStatus: 'received-from-native',
            tokenSyncAt: Date.now(),
            tokenSyncError: ''
        });
        logPushDebug('native-token-received', { token });
    });
}

function logPushDebug(step, detail = {}) {
    const enabled = resolvePushDebugEnabled();
    if (!enabled) return;
    const entry = {
        at: new Date().toISOString(),
        step,
        detail,
        userAgent: navigator.userAgent,
        online: navigator.onLine,
        visibility: document.visibilityState
    };
    console.log('[push-debug]', entry);
    try {
        const history = JSON.parse(localStorage.getItem(STORAGE_PUSH_DEBUG_KEY) || '[]');
        history.push(entry);
        localStorage.setItem(STORAGE_PUSH_DEBUG_KEY, JSON.stringify(history.slice(-50)));
    } catch (error) {
        console.warn('Gagal menulis log push debug:', error);
    }
}

function isNativeApp() {
    return typeof window !== 'undefined' && !!window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform();
}

async function ensureNativePushChannel() {
    const PushNotifications = window.Capacitor?.Plugins?.PushNotifications;
    if (!PushNotifications) return;
    try {
        await PushNotifications.createChannel({
            id: 'sos_alerts_v2',
            name: 'SOS ClusterGuard',
            description: 'Alarm darurat SOS ClusterGuard',
            importance: 5,
            visibility: 1,
            sound: 'default',
            vibration: true,
            lights: true
        });
    } catch (error) {
        console.warn('Gagal membuat notification channel native:', error);
    }
}

async function ensureNativeLocalNotificationChannel() {
    const LocalNotifications = window.Capacitor?.Plugins?.LocalNotifications;
    if (!LocalNotifications || !isNativeApp()) return false;

    try {
        await LocalNotifications.createChannel({
            id: 'sos_alerts_local',
            name: 'SOS Local Alerts',
            description: 'Notifikasi lokal SOS ClusterGuard',
            importance: 5,
            visibility: 1,
            sound: 'default',
            vibration: true,
            lights: true
        });
        return true;
    } catch (error) {
        console.warn('Gagal membuat channel lokal notifikasi Android:', error);
        return false;
    }
}

async function requestNativeLocalNotificationPermission() {
    const LocalNotifications = window.Capacitor?.Plugins?.LocalNotifications;
    if (!LocalNotifications || !isNativeApp()) return false;

    try {
        const permissionStatus = await LocalNotifications.checkPermissions();
        if (permissionStatus.display === 'granted') {
            return true;
        }

        const requested = await LocalNotifications.requestPermissions();
        return requested.display === 'granted';
    } catch (error) {
        console.warn('Gagal meminta izin notifikasi local Android:', error);
        return false;
    }
}

async function showNativeSOSNotification(title, body, data = {}) {
    const LocalNotifications = window.Capacitor?.Plugins?.LocalNotifications;
    if (!LocalNotifications || !isNativeApp()) return false;

    try {
        await ensureNativeLocalNotificationChannel();
        const permissionGranted = await requestNativeLocalNotificationPermission();
        if (!permissionGranted) {
            return false;
        }

        const notificationId = Math.floor(Math.random() * 900000) + 100000;
        await LocalNotifications.schedule({
            notifications: [{
                id: notificationId,
                title: title || 'SOS ClusterGuard',
                body: body || 'Ada laporan darurat baru.',
                channelId: 'sos_alerts_local',
                extra: data,
                ongoing: false,
                autoCancel: true
            }]
        });
        return true;
    } catch (error) {
        console.warn('Gagal menampilkan notifikasi lokal Android:', error);
        return false;
    }
}

async function registerNativePushAndSyncToken() {
    const PushNotifications = window.Capacitor?.Plugins?.PushNotifications;
    const uid = loggedInUserUid || loggedInWarga?.warga_id || null;
    if (!PushNotifications || !uid) return null;

    logPushDebug('native-register-start', { uid });
    await ensureNativePushChannel();

    return new Promise((resolve) => {
        let resolved = false;
        const finish = (token) => {
            if (resolved) return;
            resolved = true;
            resolve(token);
        };

        PushNotifications.addListener('registration', async (token) => {
            logPushDebug('native-registration', { token: token?.value });
            try {
                const nativeToken = String(token?.value || '').trim();
                if (nativeToken) {
                    window.__CLUSTERGUARD_NATIVE_FCM_TOKEN__ = nativeToken;
                    localStorage.setItem('clusterguard_last_native_token', nativeToken);
                    localStorage.setItem('clusterguard_pending_fcm_token', nativeToken);
                }
                await saveFCMTokenToFirestore(nativeToken, uid);
                localStorage.setItem(STORAGE_FCM_LAST_SYNC_AT, String(Date.now()));
                setPushDebugState({
                    tokenMasked: maskToken(token.value),
                    tokenSyncStatus: 'saved-to-firestore',
                    tokenSyncAt: Date.now(),
                    tokenSyncError: ''
                });
            } catch (error) {
                logPushDebug('native-save-token-failed', { error: error?.message || String(error) });
                console.warn('Gagal menyimpan token push native:', error);
            }
            finish(token.value);
        });

        PushNotifications.addListener('registrationError', (error) => {
            logPushDebug('native-registration-error', { error: error?.error || String(error) });
            setPushDebugState({
                tokenSyncStatus: 'failed',
                tokenSyncAt: Date.now(),
                tokenSyncError: error?.error || 'Registrasi push native gagal.'
            });
            finish(null);
        });

        PushNotifications.checkPermissions().then(async (status) => {
            let permission = status.receive;
            logPushDebug('native-permission-check', { permission });
            if (permission !== 'granted') {
                const req = await PushNotifications.requestPermissions();
                permission = req.receive;
                logPushDebug('native-permission-request', { permission });
            }
            if (permission !== 'granted') {
                setPushDebugState({ tokenSyncStatus: 'no-token', tokenSyncAt: Date.now(), tokenSyncError: 'Izin notifikasi native ditolak.' });
                logPushDebug('native-permission-denied');
                finish(null);
                return;
            }
            window.triggerTestNativeNotification = showNativeSOSNotification;
            await PushNotifications.register();
            setTimeout(() => {
                showNativeSOSNotification("ALARM SOS CLUSTERGUARD", "Peringatan darurat native aktif!");
            }, 1500);
        });
    });
}

function setupNativePushListeners() {
    const PushNotifications = window.Capacitor?.Plugins?.PushNotifications;
    if (!PushNotifications) return;

    PushNotifications.addListener('pushNotificationReceived', (notification) => {
        const data = notification?.data || {};
        if (data.type && data.type !== 'sos_alert') return;
        if (!loggedInPIC) return;
        showToast(notification?.title || 'Alarm SOS baru', 'error');
        showNativeSOSNotification(notification?.title || 'Alarm SOS Baru', notification?.body || 'Ada laporan darurat baru.', data);
        if (data.sosId) {
            persistPendingSOSAlert({ sos_id: data.sosId, jenis_sos: data.jenis_sos || 'SOS' });
        }
        checkActiveSOSForPIC();
    });

    PushNotifications.addListener('pushNotificationActionPerformed', () => {
        checkActiveSOSForPIC();
    });
}

async function syncCurrentDeviceFCMToken() {
    // Gunakan loggedInUserUid (PIC) atau warga_id (warga) sebagai identifier
    const uid = loggedInUserUid || (loggedInWarga?.warga_id) || null;
    if (!uid) {
        setPushDebugState({
            tokenSyncStatus: 'skipped-no-uid',
            tokenSyncAt: Date.now(),
            tokenSyncError: 'UID belum tersedia.'
        });
        return null;
    }

    if (isNativeApp()) {
        setPushDebugState({
            tokenSyncStatus: 'requesting-token',
            tokenSyncAt: Date.now(),
            tokenSyncError: '',
            permission: 'granted'
        });
        const token = await registerNativePushAndSyncToken();
        if (!token) {
            setPushDebugState({
                tokenSyncStatus: 'no-token',
                tokenSyncAt: Date.now(),
                tokenSyncError: 'Token push native tidak tersedia.'
            });
        }
        return token;
    }

    try {
        logPushDebug('web-token-request', { uid, permission: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported' });
        setPushDebugState({
            tokenSyncStatus: 'requesting-token',
            tokenSyncAt: Date.now(),
            tokenSyncError: '',
            permission: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
        });
        const token = await requestFCMToken();
        logPushDebug('web-token-result', { token });
        if (!token) {
            setPushDebugState({
                tokenSyncStatus: 'no-token',
                tokenSyncAt: Date.now(),
                tokenSyncError: 'Token tidak tersedia (izin notifikasi atau browser).'
            });
            return null;
        }

        localStorage.setItem('clusterguard_fcm_token', token);
        localStorage.setItem('clusterguard_last_native_token', token);
        localStorage.setItem('clusterguard_pending_fcm_token', token);
        localStorage.setItem(STORAGE_FCM_LAST_SYNC_AT, String(Date.now()));
        await saveFCMTokenToFirestore(token, uid);
        logPushDebug('web-token-saved', { uid, token });
        setPushDebugState({
            tokenMasked: maskToken(token),
            tokenSyncStatus: 'saved-to-firestore',
            tokenSyncAt: Date.now(),
            tokenSyncError: ''
        });
        return token;
    } catch (error) {
        console.warn('Sinkronisasi token FCM gagal:', error);
        setPushDebugState({
            tokenSyncStatus: 'failed',
            tokenSyncAt: Date.now(),
            tokenSyncError: error?.message || String(error)
        });
        return null;
    }
}

function getLastFCMTokenSyncAt() {
    const raw = localStorage.getItem(STORAGE_FCM_LAST_SYNC_AT);
    const parsed = Number(raw || 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

async function refreshFCMTokenIfStale(reason = 'periodic', force = false) {
    // Cek ada user PIC atau warga yang sedang login
    const hasUser = loggedInUserUid || loggedInWarga?.warga_id;
    if (!hasUser || !navigator.onLine) {
        return null;
    }

    const permission = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
    if (!force && permission !== 'granted') {
        return null;
    }

    const lastSyncAt = getLastFCMTokenSyncAt();
    const isStale = force || !lastSyncAt || (Date.now() - lastSyncAt) >= FCM_TOKEN_REFRESH_INTERVAL_MS;
    if (!isStale) {
        return null;
    }

    setPushDebugState({
        tokenSyncStatus: `refreshing-${reason}`,
        tokenSyncAt: Date.now(),
        tokenSyncError: ''
    });

    return syncCurrentDeviceFCMToken();
}

function resolveFcmEndpoint() {
    if (window.__CLUSTERGUARD_FCM_ENDPOINT__) {
        return window.__CLUSTERGUARD_FCM_ENDPOINT__;
    }

    // Override via query param ?fcmEndpoint=... (berlaku juga di wrapper native,
    // mis. untuk tes ke server lokal seperti http://192.168.1.10:3000/send-fcm).
    const searchParams = new URLSearchParams(window.location.search || '');
    const endpointFromQuery = searchParams.get('fcmEndpoint');
    if (endpointFromQuery) {
        return endpointFromQuery;
    }

    // Di dalam wrapper native (Capacitor), origin WebView adalah https://localhost
    // dan tidak bisa menjangkau server hosting. Selalu arahkan ke endpoint produksi
    // (Vercel). ganti di sini kalau pindah hosting.
    if (isNativeApp()) {
        return 'https://clusterguard.vercel.app/send-fcm';
    }

    const hostname = window.location.hostname || '';
    const isLocalHost = ['localhost', '127.0.0.1', '0.0.0.0'].includes(hostname);
    if (isLocalHost) {
        const currentPort = String(window.location.port || '');
        if (currentPort && currentPort !== '8888') {
            return 'http://localhost:8888/send-fcm';
        }
    }

    return `${window.location.origin}/send-fcm`;
}

async function sendSOSFcmBroadcast(payload) {
    const endpoint = resolveFcmEndpoint();
    setPushDebugState({
        pushStatus: 'sending',
        pushAt: Date.now(),
        pushEndpoint: endpoint,
        pushError: ''
    });

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
    });

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        throw new Error(`Endpoint ${endpoint} tidak mengembalikan JSON (${response.status})`);
    }

    const result = await response.json();
    if (!response.ok || !result?.success || result?.error) {
        throw new Error(result?.error || result?.message || `Push endpoint gagal (${response.status})`);
    }

    setPushDebugState({
        pushStatus: 'sent',
        pushAt: Date.now(),
        pushEndpoint: endpoint,
        pushSuccess: result?.success ?? '-',
        pushFailure: result?.failure ?? '-',
        pushRecipientCount: result?.tokenCount ?? '-',
        pushError: ''
    });

    return result;
}

// ==========================================
// 3. Integrasi Cloud (Mock & Firebase Fallback)
// ==========================================
// Kunci penyimpanan LocalStorage untuk simulasi Real-time Cloud
const STORAGE_SOS_KEY = "clusterguard_mock_laporan_sos";
const STORAGE_PIC_KEY = "clusterguard_mock_pic";
const STORAGE_WARGA_KEY = "clusterguard_mock_warga";

// Global variable to hold SOS documents
let cloudSOS = [];
let sosListenerUnsubscribe = null;

const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Inisialisasi data simulasi awal jika kosong
function inisialisasiDataMock() {
    if (!localStorage.getItem(STORAGE_PIC_KEY)) {
        const defaultPICs = [
            { pic_id: "pic_1", nama: "Budi Satpam", no_hp: "081234567890", jabatan: "Satpam", no_rumah: "-", urutan: 1, password: "pic123" },
            { pic_id: "pic_2", nama: "Bapak RT Joko", no_hp: "081987654321", jabatan: "Ketua RT", no_rumah: "UB 1 12", urutan: 2, password: "rt123" }
        ];
        localStorage.setItem(STORAGE_PIC_KEY, JSON.stringify(defaultPICs));
    }
    if (!localStorage.getItem(STORAGE_SOS_KEY)) {
        localStorage.setItem(STORAGE_SOS_KEY, JSON.stringify([]));
    }
}
inisialisasiDataMock();

// Helper untuk membaca dari Mock Cloud
function getMockCloudSOS() {
    if (Array.isArray(cloudSOS)) {
        return cloudSOS;
    }
    cloudSOS = JSON.parse(localStorage.getItem(STORAGE_SOS_KEY)) || [];
    return cloudSOS;
}

// Helper untuk menulis ke Mock Cloud & memicu event sinkronisasi tab
function setMockCloudSOS(data) {
    const normalized = Array.isArray(data) ? data : [];
    const unique = normalized.filter((item, index, arr) => arr.findIndex(existing => existing.sos_id === item.sos_id) === index);
    cloudSOS = unique;
    localStorage.setItem(STORAGE_SOS_KEY, JSON.stringify(cloudSOS));
    // Trigger storage event manually for same-tab updates
    window.dispatchEvent(new Event('storage'));
}

// Helper untuk sinkronisasi Database Lokal PIC dari Cloud
async function sinkronisasiPICDariCloud() {
    const cloudPICs = (JSON.parse(localStorage.getItem(STORAGE_PIC_KEY)) || []).filter(p => !p.deletedAt);
    await getPicTable().clear();
    for (const pic of cloudPICs) {
        await getPicTable().put(pic);
    }
    // Update Warga list
    antreanPIC = await getPicTable().orderBy('urutan').toArray();
}

// ==========================================
// 4. Manajemen Suara Alarm (Web Audio API)
// ==========================================
function startAlarmSound() {
    if (isAlarmPlaying) return;
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Buat dua oscillator untuk suara sirine polisi / ambulans bergantian
        alarmOscillator1 = audioCtx.createOscillator();
        alarmOscillator2 = audioCtx.createOscillator();
        
        const gainNode = audioCtx.createGain();
        gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime); // Volume sedang
        
        alarmOscillator1.type = 'sawtooth';
        alarmOscillator1.frequency.setValueAtTime(600, audioCtx.currentTime);
        
        // Modulasi frekuensi untuk efek sirine
        const modulator = audioCtx.createOscillator();
        const modulatorGain = audioCtx.createGain();
        modulator.frequency.value = 2; // Kecepatan kedipan bunyi
        modulatorGain.gain.value = 150; // Jangkauan naik-turun frekuensi
        
        modulator.connect(modulatorGain);
        modulatorGain.connect(alarmOscillator1.frequency);
        
        alarmOscillator1.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        modulator.start();
        alarmOscillator1.start();
        
        isAlarmPlaying = true;
    } catch (e) {
        console.error("Gagal menyalakan Audio Context: ", e);
    }
}

function stopAlarmSound() {
    if (!isAlarmPlaying) return;
    try {
        if (alarmOscillator1) {
            alarmOscillator1.stop();
            alarmOscillator1.disconnect();
        }
        if (audioCtx) {
            audioCtx.close();
        }
        isAlarmPlaying = false;
    } catch (e) {
        console.error("Gagal mematikan Audio: ", e);
    }
}

// ==========================================
// 5. Inisialisasi & Pengendali Navigasi
// ==========================================
async function initializeNotificationSupport() {
    setPushDebugState({
        permission: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
    });

    startBackgroundKeepAlive();

    try {
        if ('serviceWorker' in navigator && 'PushManager' in window) {
            const permission = Notification.permission;
            if (permission === 'granted') {
                await navigator.serviceWorker.ready;
                await syncCurrentDeviceFCMToken();
            }
        }
        await syncCurrentDeviceFCMToken();
        if (loggedInPIC) {
            await requestPersistentWakeLock();
        }
    } catch (error) {
        console.warn("Pendaftaran FCM gagal:", error);
    }

    if (!fcmListenerUnsubscribe) {
        try {
            fcmListenerUnsubscribe = listenForForegroundMessages((payload) => {
                if (payload?.data?.type !== "sos_alert") return;
                if (!loggedInPIC) return;
                showToast(payload?.notification?.title || "Alarm SOS baru", "error");
                if (payload?.data?.sosId) {
                    persistPendingSOSAlert({ sos_id: payload.data.sosId, jenis_sos: "SOS" });
                }
            });
        } catch (error) {
            console.warn("Listener FCM foreground tidak aktif:", error);
            setPushDebugState({
                tokenSyncStatus: 'listener-unavailable',
                tokenSyncAt: Date.now(),
                tokenSyncError: error?.message || String(error)
            });
        }
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    if (isNativeApp()) {
        registerNativeAndroidTokenListener();
        await ensureNativePushChannel();
        setupNativePushListeners();
    }

    // Registrasi Service Worker untuk PWA dan FCM
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(async (reg) => {
                console.log('Service Worker terdaftar: ', reg.scope);
                if (reg.waiting) {
                    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
                }
                const swReady = await navigator.serviceWorker.ready;
                if (swReady.active) {
                    swReady.active.postMessage({ type: 'START_BACKGROUND_POLLING' });
                }
                try {
                    if ('periodicSync' in reg) {
                        await reg.periodicSync.register('sos-alert-sync', { minInterval: 60 * 1000 });
                        console.log('Background sync PWA aktif');
                    }
                } catch (error) {
                    console.warn('Background sync PWA tidak tersedia di browser ini:', error);
                }
            })
            .catch(err => console.log('Gagal registrasi Service Worker: ', err));
    }

    // Rendere Lucide Icons
    lucide.createIcons();
    initializePushDebugPanel();
    await initializeNotificationSupport();
    if (isNativeApp() && !sessionStorage.getItem('cg_native_notif_smoke_done')) {
        sessionStorage.setItem('cg_native_notif_smoke_done', '1');
        try {
            const smokeShown = await showNativeSOSNotification('Tes Notifikasi Native', 'Smoke test notifikasi Android berjalan.');
            console.info('Native notification smoke result:', smokeShown);
        } catch (error) {
            console.warn('Smoke test notifikasi native gagal:', error);
        }
    }
    setInterval(() => {
        if (document.visibilityState === 'visible') {
            void refreshFCMTokenIfStale('interval', false);
        }
    }, FCM_TOKEN_REFRESH_CHECK_INTERVAL_MS);
    
    // Status Jaringan
    monitorJaringan();
    window.addEventListener('online', async () => {
        monitorJaringan();
        await refreshFCMTokenIfStale('online', true);
        await syncPICDataFromFirestore();
        await syncWargaDataFromFirestore();
        await syncLocalWargasToFirestore();
        syncWargaOfflineReports();
        await flushSOSStatusQueue();
    });
    window.addEventListener('offline', monitorJaringan);
    document.addEventListener('visibilitychange', async () => {
        setPushDebugState({
            permission: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
        });
        if (document.visibilityState === 'visible') {
            if (navigator.onLine) {
                await refreshFCMTokenIfStale('visible', false);
                await syncWargaDataFromFirestore();
                await syncLocalWargasToFirestore();
            }
            if (loggedInPIC) {
                await requestPersistentWakeLock();
            }
        } else if (!document.visibilityState || document.visibilityState === 'hidden') {
            releasePersistentWakeLock();
        }
    });
    window.addEventListener('focus', async () => {
        if (navigator.onLine) {
            await refreshFCMTokenIfStale('focus', false);
            await syncWargaDataFromFirestore();
            await syncLocalWargasToFirestore();
        }
        if (loggedInPIC) {
            await requestPersistentWakeLock();
        }
    });
    window.addEventListener('pagehide', () => {
        releasePersistentWakeLock();
    });
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (navigator.onLine) {
                void refreshFCMTokenIfStale('sw-controller-change', true);
            }
        });
    }
    
    // Sinkronisasi PIC dari Mock Cloud ke Dexie DB
    loadAcknowledgedSOSIds();
    await syncPICDataFromFirestore();
    await sinkronisasiPICDariCloud();
    await syncWargaDataFromFirestore();
    await syncLocalWargasToFirestore();
    restorePICSession();
    await restoreWargaSession();
    
    // Listen to PIC updates
    listenCollection(COLLECTIONS.PIC, (data) => {
        const activePICs = data.filter(p => !p.deletedAt);
        localStorage.setItem(STORAGE_PIC_KEY, JSON.stringify(activePICs));
        sinkronisasiPICDariCloud();
    });

    if (wargaListenerUnsubscribe) {
        wargaListenerUnsubscribe();
    }
    wargaListenerUnsubscribe = listenCollection(COLLECTIONS.WARGA, async (data) => {
        const activeWarga = data.filter((warga) => !warga.deletedAt);
        const normalizedWarga = activeWarga.map((warga) => ({
            ...warga,
            warga_id: warga.warga_id || warga.id || `warga_${Date.now()}`,
            no_hp: normalizePhoneNumber(warga.no_hp || "")
        }));

        // Gabungkan dengan data lokal yang mungkin belum ter-sync ke Firestore
        const mergedWarga = [...normalizedWarga];
        const mergedIds = new Set(normalizedWarga.map(w => w.warga_id));
        try {
            const savedSession = localStorage.getItem(STORAGE_WARGA_SESSION_KEY);
            if (savedSession) {
                const session = JSON.parse(savedSession);
                if (session?.warga_id && !mergedIds.has(session.warga_id)) {
                    mergedWarga.push({
                        warga_id: session.warga_id,
                        nama: session.nama || '',
                        no_hp: normalizePhoneNumber(session.no_hp || ''),
                        no_rumah: session.no_rumah || '',
                        password: ''
                    });
                    mergedIds.add(session.warga_id);
                }
            }
        } catch (_e) { /* ignore */ }

        localStorage.setItem(STORAGE_WARGA_KEY, JSON.stringify(mergedWarga));
        await getWargaTable().clear();
        for (const warga of mergedWarga) {
            await getWargaTable().put(warga);
        }

        if (currentUserRole === 'admin') {
            renderAdminWargaList();
        }

        if (currentUserRole === 'warga' && loggedInWarga) {
            const updatedWarga = normalizedWarga.find((warga) =>
                warga.warga_id === loggedInWarga.warga_id ||
                normalizePhoneNumber(warga.no_hp || "") === normalizePhoneNumber(loggedInWarga.no_hp || "")
            );
            if (updatedWarga) {
                loggedInWarga = updatedWarga;
                persistWargaSession(updatedWarga);
                await checkWargaRegistration();
            }
        }
    });

    // Listen to SOS updates from Firestore so all logged-in PIC devices receive the alert
    sosListenerUnsubscribe = listenCollection(COLLECTIONS.SOS, (data) => {
        const activeSOS = data.filter(doc => !doc.deletedAt);
        setMockCloudSOS(activeSOS);
        if (currentUserRole === 'pic' && loggedInPIC) {
            checkActiveSOSForPIC();
            renderPICDashboard();
        } else if (currentUserRole === 'warga') {
            updateWargaSOSStatus();
        } else if (currentUserRole === 'admin') {
            renderAdminHistory();
        }
    });
    
    // Setup Warga View
    await checkWargaRegistration();

    // Event Switcher Panel (Demo mode)
    const switcher = document.getElementById("view-switcher");
    switcher.addEventListener("click", (e) => {
        const btn = e.target.closest(".role-btn");
        if (!btn) return;
        
        document.querySelectorAll(".role-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        
        const targetView = btn.dataset.view;
        switchView(targetView);
    });

    const picPhoneInput = document.getElementById("pic-login-phone");
    if (picPhoneInput) {
        picPhoneInput.addEventListener("input", (e) => {
            updatePICFirestoreStatus(e.target.value.trim());
        });
    }

    // Warga auth tabs
    document.querySelectorAll('.auth-tab[data-auth-mode]').forEach((tab) => {
        tab.addEventListener('click', () => {
            setWargaAuthMode(tab.dataset.authMode);
        });
    });

    // Form Submissions
    document.getElementById("form-register-warga").addEventListener("submit", registerWarga);
    document.getElementById("form-login-warga").addEventListener("submit", loginWarga);
    document.getElementById("form-login-pic").addEventListener("submit", loginPIC);
    document.getElementById("form-login-admin").addEventListener("submit", loginAdmin);
    document.getElementById("form-manage-pic").addEventListener("submit", savePIC);
    document.getElementById("form-manage-warga").addEventListener("submit", saveWarga);

    // Unified Login Form Submission
    document.getElementById('form-unified-login').addEventListener('submit', handleUnifiedLogin);

    // Auto Listen to Cloud updates (Storage Event)
    window.addEventListener('storage', () => {
        if (currentUserRole === 'pic' && loggedInPIC) {
            checkActiveSOSForPIC();
            renderPICDashboard();
        } else if (currentUserRole === 'warga') {
            updateWargaSOSStatus();
        } else if (currentUserRole === 'admin') {
            renderAdminHistory();
            renderAdminPICList();
        }
    });

    // Jalankan pengecekan PIC active alarm berkala
    setInterval(() => {
        if (loggedInPIC) {
            checkActiveSOSForPIC();
        }
    }, 2000);

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            persistPICSession();
            const pendingAlert = getPendingSOSAlertFromStorage();
            if (pendingAlert) {
                showToast(`Alarm SOS aktif: ${pendingAlert.jenis_sos || 'SOS'}`, 'error');
            }
            checkActiveSOSForPIC();
            flushSOSStatusQueue();
        }
    });

    window.addEventListener('pageshow', () => {
        persistPICSession();
        if (loggedInPIC) {
            const pendingAlert = getPendingSOSAlertFromStorage();
            if (pendingAlert) {
                showToast(`Alarm SOS aktif: ${pendingAlert.jenis_sos || 'SOS'}`, 'error');
            }
            checkActiveSOSForPIC();
        }
    });

    window.addEventListener('focus', () => {
        persistPICSession();
        if (loggedInPIC) {
            const pendingAlert = getPendingSOSAlertFromStorage();
            if (pendingAlert) {
                showToast(`Alarm SOS aktif: ${pendingAlert.jenis_sos || 'SOS'}`, 'error');
            }
            checkActiveSOSForPIC();
        }
    });
});

function monitorJaringan() {
    isOnline = navigator.onLine;
    setPushDebugState({
        permission: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
    });
    const indikator = document.getElementById("status-indikator");
    if (isOnline) {
        indikator.innerHTML = '<i data-lucide="wifi"></i> Sistem: Online (Cloud Terhubung)';
        indikator.className = "status-badge badge-online";
    } else {
        indikator.innerHTML = '<i data-lucide="wifi-off"></i> Sistem: Offline (Mode Panggilan Lokal)';
        indikator.className = "status-badge badge-offline";
    }
    lucide.createIcons();
}

function setRoleSwitcherState() {
    const wargaButton = document.querySelector('.role-btn[data-view="warga"]');
    const picButton = document.querySelector('.role-btn[data-view="pic"]');

    if (wargaButton) {
        wargaButton.disabled = false;
        wargaButton.style.opacity = '1';
        wargaButton.style.pointerEvents = 'auto';
        wargaButton.title = '';
    }

    if (picButton) {
        picButton.style.opacity = '1';
        picButton.style.pointerEvents = 'auto';
    }
}

function switchView(role) {
    currentUserRole = role;
    document.querySelectorAll(".view-section").forEach(sec => sec.classList.remove("active"));
    setRoleSwitcherState();
    
    // Stop alarm if shifting away from PIC
    if (role !== 'pic') {
        stopAlarmSound();
        document.getElementById("alarm-overlay").classList.remove("active");
    }

    if (role === 'warga') {
        document.getElementById("view-warga").classList.add("active");
        // Warga view always shows console (login sudah dilakukan)
        document.getElementById('warga-registration').style.display = 'none';
        document.getElementById('warga-console').style.display = 'block';
        antreanPIC = [];
        getPicTable().orderBy('urutan').toArray().then(picList => { antreanPIC = picList; });
        updateWargaSOSStatus();
    } else if (role === 'pic') {
        document.getElementById("view-pic").classList.add("active");
        // PIC view always shows console (login sudah dilakukan)
        document.getElementById('pic-login').style.display = 'none';
        document.getElementById('pic-console').style.display = 'block';
        checkActiveSOSForPIC();
        renderPICDashboard();
    } else if (role === 'admin') {
        document.getElementById("view-admin").classList.add("active");
        // Admin view always shows console (login sudah dilakukan)
        document.getElementById('admin-login').style.display = 'none';
        document.getElementById('admin-console').style.display = 'block';
        renderAdminPICList();
        renderAdminHistory();
    }
    updateIdentityTag();
}

function updateIdentityTag() {
    const tag = document.getElementById("identity-tag");
    if (currentUserRole === 'warga') {
        getActiveWargaRecord().then(warga => {
            tag.innerText = warga ? `Warga: ${warga.nama} (${warga.no_rumah})` : "";
        });
    } else if (currentUserRole === 'pic' && loggedInPIC) {
        tag.innerText = `PIC: ${loggedInPIC.nama}`;
    } else if (currentUserRole === 'admin' && sessionStorage.getItem("admin_logged_in") === "true") {
        tag.innerText = "Super Admin";
    } else {
        tag.innerText = "";
    }
}

async function getActiveWargaRecord() {
    if (loggedInWarga?.warga_id) {
        return loggedInWarga;
    }

    const savedSession = localStorage.getItem(STORAGE_WARGA_SESSION_KEY);
    if (savedSession) {
        try {
            const parsed = JSON.parse(savedSession);
            if (parsed?.warga_id) {
                // Coba cari di Dexie DB dulu
                const record = await getWargaTable().where('warga_id').equals(parsed.warga_id).first();
                if (record) {
                    loggedInWarga = record;
                    return record;
                }
                // Fallback: gunakan data dari sesi localStorage jika tidak ditemukan di Dexie
                // (misalnya data belum ter-sync dari Firestore)
                const fallbackWarga = {
                    warga_id: parsed.warga_id,
                    nama: parsed.nama || '',
                    no_hp: parsed.no_hp || '',
                    no_rumah: parsed.no_rumah || '',
                    password: ''
                };
                loggedInWarga = fallbackWarga;
                return fallbackWarga;
            }
        } catch (error) {
            console.warn('Gagal membaca sesi warga:', error);
        }
    }

    return null;
}

function persistWargaSession(wargaRecord) {
    if (!wargaRecord?.warga_id) {
        localStorage.removeItem(STORAGE_WARGA_SESSION_KEY);
        return;
    }

    loggedInWarga = wargaRecord;
    const sessionPayload = {
        warga_id: wargaRecord.warga_id,
        nama: wargaRecord.nama || '',
        no_hp: wargaRecord.no_hp || '',
        no_rumah: wargaRecord.no_rumah || '',
        updatedAt: Date.now()
    };
    localStorage.setItem(STORAGE_WARGA_SESSION_KEY, JSON.stringify(sessionPayload));
}

function clearWargaSession() {
    loggedInWarga = null;
    localStorage.removeItem(STORAGE_WARGA_SESSION_KEY);
    sessionStorage.removeItem(STORAGE_WARGA_SESSION_KEY);
}

async function restoreWargaSession() {
    if (wargaSessionRestoreAttempted) return;
    wargaSessionRestoreAttempted = true;

    if (loggedInPIC || localStorage.getItem(STORAGE_PIC_SESSION_KEY)) {
        return;
    }

    const saved = localStorage.getItem(STORAGE_WARGA_SESSION_KEY);
    if (!saved) return;

    try {
        const session = JSON.parse(saved);
        if (!session?.warga_id) {
            clearWargaSession();
            return;
        }

        const picMatch = getPICStorageList().find((pic) => normalizePhoneNumber(pic?.no_hp || "") === normalizePhoneNumber(session.no_hp || ""));
        if (picMatch) {
            loggedInPIC = picMatch;
            loggedInUserUid = picMatch.firestoreDocId || picMatch.firebaseUid || picMatch.id || picMatch.pic_id || null;
            currentUserRole = 'pic';
            clearWargaSession();
            switchView('pic');
            renderPICDashboard();
            checkActiveSOSForPIC();
            updateIdentityTag();
            await syncCurrentDeviceFCMToken();
            return;
        }

        const record = await getWargaTable().where('warga_id').equals(session.warga_id).first();
        if (record) {
            loggedInWarga = record;
        } else {
            // Fallback: gunakan data dari sesi localStorage jika record tidak ditemukan di Dexie
            // (misalnya data belum ter-sync dari Firestore setelah refresh)
            loggedInWarga = {
                warga_id: session.warga_id,
                nama: session.nama || '',
                no_hp: session.no_hp || '',
                no_rumah: session.no_rumah || '',
                password: ''
            };
        }
        currentUserRole = 'warga';
        switchView('warga');
        updateIdentityTag();
        await updateWargaSOSStatus();
    } catch (error) {
        console.warn('Gagal memulihkan sesi warga:', error);
        clearWargaSession();
    }
}

function persistPICSession() {
    if (!loggedInPIC || !loggedInUserUid) {
        localStorage.removeItem(STORAGE_PIC_SESSION_KEY);
        return;
    }

    const phoneInput = document.getElementById("pic-login-phone");
    const minimalProfile = {
        pic_id: loggedInPIC.pic_id || loggedInPIC.id || null,
        nama: loggedInPIC.nama || "",
        no_hp: loggedInPIC.no_hp || "",
        jabatan: loggedInPIC.jabatan || "",
        no_rumah: loggedInPIC.no_rumah || "",
        urutan: loggedInPIC.urutan || 0
    };

    const sessionPayload = {
        uid: loggedInUserUid,
        profile: minimalProfile,
        phone: phoneInput ? phoneInput.value.trim() : "",
        updatedAt: Date.now()
    };
    localStorage.setItem(STORAGE_PIC_SESSION_KEY, JSON.stringify(sessionPayload));
}

function clearPICSession() {
    loggedInPIC = null;
    loggedInUserUid = null;
    localStorage.removeItem(STORAGE_PIC_SESSION_KEY);
    sessionStorage.removeItem(STORAGE_PIC_SESSION_KEY);
}

function loadAcknowledgedSOSIds() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_ACKNOWLEDGED_SOS_KEY) || "[]");
        acknowledgedSOSIds = new Set(Array.isArray(saved) ? saved : []);
    } catch (error) {
        acknowledgedSOSIds = new Set();
    }
}

function persistAcknowledgedSOSIds() {
    localStorage.setItem(STORAGE_ACKNOWLEDGED_SOS_KEY, JSON.stringify([...acknowledgedSOSIds]));
}

function getSOSStatusQueue() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_SOS_STATUS_QUEUE_KEY) || "[]") || [];
    } catch (error) {
        return [];
    }
}

function saveSOSStatusQueue(queue) {
    localStorage.setItem(STORAGE_SOS_STATUS_QUEUE_KEY, JSON.stringify(queue));
}

function queueSOSStatusUpdate(sosId, changes, uid = null) {
    if (!sosId) return;
    const queue = getSOSStatusQueue();
    queue.push({ sosId, changes, uid });
    saveSOSStatusQueue(queue);
}

async function flushSOSStatusQueue() {
    if (!navigator.onLine) return;

    const queue = getSOSStatusQueue();
    if (queue.length === 0) return;

    const remaining = [];
    for (const item of queue) {
        try {
            await updateDocument(COLLECTIONS.SOS, item.sosId, {
                ...item.changes,
                updatedAt: new Date().toISOString(),
                updatedBy: item.uid || loggedInUserUid || null
            }, item.uid || loggedInUserUid || null);
        } catch (error) {
            console.error("Gagal mengirim status SOS yang tertunda ke Firestore:", error);
            remaining.push(item);
        }
    }

    if (remaining.length === 0) {
        localStorage.removeItem(STORAGE_SOS_STATUS_QUEUE_KEY);
    } else {
        saveSOSStatusQueue(remaining);
    }
}

function markSOSHandled(sosId) {
    if (!sosId) return;
    acknowledgedSOSIds.add(sosId);
    persistAcknowledgedSOSIds();
}

function keepPICSessionAlive() {
    if (!loggedInPIC || !loggedInUserUid) {
        showToast("Tidak ada sesi PIC yang aktif.", "warning");
        return;
    }
    persistPICSession();
    showToast("Sesi PIC diperpanjang.", "success");
}
window.keepPICSessionAlive = keepPICSessionAlive;

function restorePICSession() {
    if (picSessionRestoreAttempted) return;
    picSessionRestoreAttempted = true;

    const saved = localStorage.getItem(STORAGE_PIC_SESSION_KEY);
    if (!saved) return;

    try {
        const session = JSON.parse(saved);
        if (!session?.profile || !session?.uid) {
            clearPICSession();
            return;
        }

        loggedInPIC = session.profile;
        loggedInUserUid = session.uid;
        clearWargaSession();
        const phoneInput = document.getElementById("unified-pic-phone");
        if (phoneInput && session.phone) {
            phoneInput.value = session.phone;
        }

        // Gunakan unified flow untuk restore sesi
        showViewsForRole('pic');
        void syncCurrentDeviceFCMToken();
        showToast("Sesi PIC dipulihkan otomatis.", "success");
    } catch (error) {
        console.error("Gagal memulihkan sesi PIC:", error);
        clearPICSession();
    }
}

async function requestPICNotificationPermission() {
    if (isNativeApp()) {
        const nativePermissionGranted = await requestNativeLocalNotificationPermission();
        setPushDebugState({ permission: nativePermissionGranted ? 'granted' : 'denied' });

        if (!nativePermissionGranted) {
            showToast('Izin notifikasi Android ditolak. Buka pengaturan aplikasi untuk mengizinkan notifikasi.', 'warning');
        }

        return nativePermissionGranted;
    }

    if (!('Notification' in window)) {
        console.warn('Browser tidak mendukung Notification API.');
        setPushDebugState({ permission: 'unsupported' });
        return false;
    }

    if (Notification.permission === 'granted') {
        setPushDebugState({ permission: Notification.permission });
        return true;
    }

    if (Notification.permission === 'denied') {
        setPushDebugState({ permission: Notification.permission });
        showToast('Izin notifikasi diblokir. Buka pengaturan browser untuk mengizinkan.', 'warning');
        return false;
    }

    try {
        const permission = await Notification.requestPermission();
        setPushDebugState({ permission });
        if (permission === 'granted') {
            showToast('Notifikasi diizinkan.', 'success');
            return true;
        }

        if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
            showToast('Notifikasi hanya bisa muncul di HTTPS/localhost. Pindah ke domain aman.', 'warning');
        } else {
            showToast('Notifikasi belum diizinkan, banner tidak akan muncul.', 'warning');
        }
        return false;
    } catch (error) {
        console.warn('Gagal meminta izin notifikasi:', error);
        showToast('Browser memblokir prompt notifikasi. Gunakan tab normal, bukan Incognito.', 'warning');
        return false;
    }
}

async function showSOSNotificationInUI(title, options) {
    try {
        if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.ready;
            if (registration && typeof registration.showNotification === 'function') {
                await registration.showNotification(title, options);
                return true;
            }
        }
    } catch (error) {
        console.warn('Gagal menampilkan notifikasi via service worker:', error);
    }

    try {
        const browserNotification = new Notification(title, options);
        browserNotification.onclick = () => {
            window.focus();
            browserNotification.close();
        };
        return true;
    } catch (error) {
        console.warn('Browser notification failed:', error);
        return false;
    }
}

async function showImmediateSOSAnnouncement(laporan, kategori, dataWarga) {
    const title = `SOS ${kategori}`;
    const body = `${dataWarga.nama} di ${dataWarga.no_rumah} sedang membutuhkan bantuan`;
    const payload = {
        title,
        body,
        icon: './icon-192.png',
        badge: './icon-192.png',
        tag: `clusterguard-sos-${laporan.sos_id}`,
        renotify: true,
        requireInteraction: true,
        data: {
            url: './',
            sosId: laporan.sos_id,
            jenis_sos: kategori,
            nama_pelapor: dataWarga.nama,
            no_rumah: dataWarga.no_rumah
        }
    };

    try {
        persistPendingSOSAlert({
            sos_id: laporan.sos_id,
            jenis_sos: kategori,
            nama_pelapor: dataWarga.nama,
            no_rumah: dataWarga.no_rumah
        });

        if (isNativeApp()) {
            const nativeShown = await showNativeSOSNotification(title, body, payload.data);
            if (nativeShown) {
                return true;
            }
        }

        if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.ready;
            if (registration?.active) {
                registration.active.postMessage({
                    type: 'SHOW_SOS_NOTIFICATION',
                    payload
                });
                return true;
            }
        }

        return showSOSNotificationInUI(title, payload);
    } catch (error) {
        console.warn('Gagal memicu notifikasi SOS instan:', error);
        return false;
    }
}

function persistPendingSOSAlert(activeAlarm) {
    if (!activeAlarm?.sos_id) {
        localStorage.removeItem(STORAGE_PENDING_SOS_ALERT_KEY);
        return;
    }
    localStorage.setItem(STORAGE_PENDING_SOS_ALERT_KEY, JSON.stringify(activeAlarm));
}

function getPendingSOSAlertFromStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_PENDING_SOS_ALERT_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        console.warn('Gagal membaca alarm SOS tertunda:', error);
        return null;
    }
}

function clearPendingSOSAlert() {
    localStorage.removeItem(STORAGE_PENDING_SOS_ALERT_KEY);
}

async function notifyPICAboutSOS(activeAlarm) {
    if (!activeAlarm || !loggedInPIC) return;
    persistPendingSOSAlert(activeAlarm);

    if (activeAlarm.sos_id === lastNotifiedSOSId) {
        return;
    }

    const permissionGranted = await requestPICNotificationPermission();
    if (!permissionGranted) {
        return;
    }

    const title = `SOS ${activeAlarm.jenis_sos || 'Darurat'}`;
    const body = `${activeAlarm.nama_pelapor || 'Warga'} di ${activeAlarm.no_rumah || '-'}`;
    const payload = {
        title,
        body,
        icon: './icon-192.png',
        badge: './icon-192.png',
        tag: `clusterguard-sos-${activeAlarm.sos_id}`,
        renotify: true,
        requireInteraction: true,
        data: { url: './', sosId: activeAlarm.sos_id }
    };

    let shown = false;
    if (isNativeApp()) {
        shown = await showNativeSOSNotification(title, body, payload.data);
    }

    if (!shown) {
        shown = await showSOSNotificationInUI(title, payload);
    }

    if (shown) {
        lastNotifiedSOSId = activeAlarm.sos_id;
        showSystemBanner(`Alarm SOS: ${body}`, 'error');
    } else {
        showSystemBanner(`Alarm SOS aktif: ${body}`, 'error');
        console.warn('Banner notifikasi tidak tampil. Periksa izin browser dan mode tab.');
    }
}

// Toast System
function showToast(message, type = "info") {
    const toast = document.getElementById("global-toast");
    const msg = document.getElementById("toast-message");
    const icon = document.getElementById("toast-icon");
    
    msg.innerText = message;
    toast.className = `toast active`;
    
    setTimeout(() => {
        toast.classList.remove("active");
    }, 3000);
}

function showSystemBanner(message, type = 'error') {
    const banner = document.getElementById('system-banner');
    const text = document.getElementById('system-banner-message');
    const icon = document.getElementById('system-banner-icon');
    if (!banner || !text || !icon) return;

    text.innerText = message;
    banner.style.display = 'flex';
    banner.className = 'toast active';
    banner.style.background = type === 'success' ? 'rgba(16, 185, 129, 0.95)' : 'rgba(239, 68, 68, 0.95)';
    icon.setAttribute('data-lucide', type === 'success' ? 'check-circle' : 'bell-ring');
    lucide.createIcons();

    clearTimeout(showSystemBanner.timer);
    showSystemBanner.timer = setTimeout(() => {
        banner.style.display = 'none';
        banner.classList.remove('active');
    }, 6000);
}
window.showSystemBanner = showSystemBanner;

// ==========================================
// 6. Alur Warga (Resident Flow)
// ==========================================
function normalizePhoneNumber(value) {
    return String(value || "").replace(/[^+\d]/g, "");
}

async function getMatchingPICForCredentials(phone, password) {
    const normalizedPhone = normalizePhoneNumber(phone);
    const normalizedPassword = String(password || "");

    const picList = getPICStorageList();
    const localMatch = picList.find((pic) => {
        return normalizePhoneNumber(pic?.no_hp || "") === normalizedPhone && String(pic?.password || "") === normalizedPassword;
    });
    if (localMatch) {
        return localMatch;
    }

    if (!navigator.onLine) {
        return null;
    }

    try {
        const firestorePICs = await fetchCollection(COLLECTIONS.PIC);
        return firestorePICs
            .filter((pic) => !pic.deletedAt)
            .find((pic) => {
                return normalizePhoneNumber(pic?.no_hp || "") === normalizedPhone && String(pic?.password || "") === normalizedPassword;
            }) || null;
    } catch (error) {
        console.warn('Tidak bisa memeriksa PIC dari Firestore untuk login:', error);
        return null;
    }
}

async function syncWargaDataFromFirestore() {
    if (!navigator.onLine) return [];

    try {
        // Baca data lokal dulu sebelum sync agar tidak hilang
        const existingLocalWarga = JSON.parse(localStorage.getItem(STORAGE_WARGA_KEY)) || [];
        const localSessionWarga = [];
        try {
            const savedSession = localStorage.getItem(STORAGE_WARGA_SESSION_KEY);
            if (savedSession) {
                const session = JSON.parse(savedSession);
                if (session?.warga_id) {
                    const localRecord = await getWargaTable().where('warga_id').equals(session.warga_id).first();
                    if (localRecord) localSessionWarga.push(localRecord);
                    else if (session.nama) localSessionWarga.push({
                        warga_id: session.warga_id,
                        nama: session.nama || '',
                        no_hp: session.no_hp || '',
                        no_rumah: session.no_rumah || '',
                        password: ''
                    });
                }
            }
        } catch (_e) { /* ignore */ }

        const firestoreWarga = await fetchCollection(COLLECTIONS.WARGA);
        const activeWarga = firestoreWarga.filter(w => !w.deletedAt);
        const normalizedWarga = activeWarga.map((warga) => ({
            ...warga,
            warga_id: warga.warga_id || warga.id || `warga_${Date.now()}`,
            no_hp: normalizePhoneNumber(warga.no_hp || "")
        }));

        // Gabungkan data Firestore dengan data lokal yang mungkin belum ter-sync
        const mergedWarga = [...normalizedWarga];
        const mergedIds = new Set(normalizedWarga.map(w => w.warga_id));
        for (const localW of [...existingLocalWarga, ...localSessionWarga]) {
            if (!mergedIds.has(localW.warga_id)) {
                mergedWarga.push(localW);
                mergedIds.add(localW.warga_id);
            }
        }

        localStorage.setItem(STORAGE_WARGA_KEY, JSON.stringify(mergedWarga));

        await getWargaTable().clear();
        for (const warga of mergedWarga) {
            await getWargaTable().put(warga);
        }

        if (currentUserRole === 'admin') {
            renderAdminWargaList();
        }

        if (currentUserRole === 'warga' && loggedInWarga) {
            const updatedWarga = mergedWarga.find((warga) =>
                warga.warga_id === loggedInWarga.warga_id ||
                normalizePhoneNumber(warga.no_hp || "") === normalizePhoneNumber(loggedInWarga.no_hp || "")
            );
            if (updatedWarga) {
                loggedInWarga = updatedWarga;
                persistWargaSession(updatedWarga);
                await checkWargaRegistration();
            }
        }

        return mergedWarga;
    } catch (err) {
        console.error("Gagal sinkronisasi warga dari Firestore:", err);
        return [];
    }
}

function setWargaAuthMode(mode) {
    const activeMode = mode === 'login' ? 'login' : 'register';
    document.querySelectorAll('.auth-tab[data-auth-mode]').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.authMode === activeMode);
    });

    const registerPanel = document.getElementById('warga-register-panel');
    const loginPanel = document.getElementById('warga-login-panel');
    const title = document.getElementById('warga-auth-title');
    const description = document.getElementById('warga-auth-description');

    if (registerPanel && loginPanel) {
        registerPanel.style.display = activeMode === 'register' ? 'block' : 'none';
        loginPanel.style.display = activeMode === 'login' ? 'block' : 'none';
    }

    if (title && description) {
        if (activeMode === 'login') {
            title.textContent = 'Masuk ke Akun Warga';
            description.textContent = 'Masukkan nomor HP dan password untuk membuka tombol darurat kluster.';
        } else {
            title.textContent = 'Pendaftaran Warga';
            description.textContent = 'Daftarkan akun warga dengan password untuk login ulang dan penggunaan tombol darurat kluster.';
        }
    }
}

async function checkWargaRegistration() {
    const dataWarga = await getActiveWargaRecord();
    if (!dataWarga) {
        setWargaAuthMode('register');
        document.getElementById("warga-registration").style.display = "block";
        document.getElementById("warga-console").style.display = "none";
    } else {
        document.getElementById("warga-registration").style.display = "none";
        document.getElementById("warga-console").style.display = "block";
        antreanPIC = await getPicTable().orderBy('urutan').toArray();
        updateWargaSOSStatus();
    }
    updateIdentityTag();
}

async function registerWarga(e) {
    e.preventDefault();
    const nama = document.getElementById("reg-nama").value.trim();
    const no_hp = document.getElementById("reg-no-hp").value.trim();
    const no_rumah = document.getElementById("reg-no-rumah").value.trim();
    const password = document.getElementById("reg-password").value;
    
    const warga_id = "warga_" + Date.now();
    const dataWarga = { warga_id, nama, no_hp, no_rumah, password, dibuat_pada: new Date().toISOString() };
    const payload = {
        ...dataWarga,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
        deletedBy: null,
        updatedBy: null
    };
    
    await getWargaTable().put(payload);
    persistWargaSession(payload);
    
    // Sync to Cloud Warga List
    const cloudWarga = JSON.parse(localStorage.getItem(STORAGE_WARGA_KEY)) || [];
    const existingIndex = cloudWarga.findIndex(item => normalizePhoneNumber(item.no_hp || "") === normalizePhoneNumber(no_hp));
    if (existingIndex >= 0) {
        cloudWarga[existingIndex] = payload;
    } else {
        cloudWarga.push(payload);
    }
    localStorage.setItem(STORAGE_WARGA_KEY, JSON.stringify(cloudWarga));

    let firestoreSynced = false;
    try {
        if (navigator.onLine) {
            await setDoc(doc(db, COLLECTIONS.WARGA, warga_id), payload);
            firestoreSynced = true;
        }
    } catch (err) {
        console.error("Gagal menyimpan warga ke Firestore:", err);
    }

    // Jika gagal sync ke Firestore, tambahkan ke antrean sync offline
    if (!firestoreSynced) {
        enqueuePendingWargaSync(payload);
    }
    
    showToast("Pendaftaran berhasil!", "success");
    await checkWargaRegistration();
    
    // Tampilkan Onboarding Lansia setelah pendaftaran
    showOnboarding();
}

function showOnboarding() {
    onboardingStep = 1;
    document.getElementById("onboarding-overlay").classList.add("active");
    renderOnboardingStep();
}

function renderOnboardingStep() {
    const content = document.getElementById("onboarding-step-content");
    const nextBtn = document.getElementById("onboarding-next-btn");
    
    document.querySelectorAll(".step-dot").forEach(d => d.classList.remove("active"));
    document.getElementById(`dot-${onboardingStep}`).classList.add("active");

    if (onboardingStep === 1) {
        content.innerHTML = `
            <i data-lucide="help-circle" style="width: 64px; height: 64px; color: var(--color-medis); margin-bottom: 1rem;"></i>
            <h2 style="font-weight: 700; margin-bottom: 0.5rem;">Langkah 1: Pilih Bantuan</h2>
            <p style="color: var(--text-secondary); font-size: 1.1rem; line-height: 1.6;">
                Tekan tombol darurat berwarna <strong>Merah (Medis)</strong>, <strong>Oranye (Keamanan)</strong>, atau <strong>Cokelat (Bencana)</strong> sesuai kebutuhan mendesak Anda.
            </p>
        `;
    } else if (onboardingStep === 2) {
        content.innerHTML = `
            <i data-lucide="phone-call" style="width: 64px; height: 64px; color: var(--color-keamanan); margin-bottom: 1rem;"></i>
            <h2 style="font-weight: 700; margin-bottom: 0.5rem;">Langkah 2: Menu Telepon</h2>
            <p style="color: var(--text-secondary); font-size: 1.1rem; line-height: 1.6;">
                Layar HP Anda akan otomatis berpindah ke aplikasi telepon bawaan dan langsung mengarah ke nomor PIC Kluster.
            </p>
        `;
    } else if (onboardingStep === 3) {
        content.innerHTML = `
            <i data-lucide="check-circle" style="width: 64px; height: 64px; color: var(--color-success); margin-bottom: 1rem;"></i>
            <h2 style="font-weight: 700; margin-bottom: 0.5rem;">Langkah 3: Hubungi PIC</h2>
            <p style="color: var(--text-secondary); font-size: 1.1rem; line-height: 1.6;">
                Tekan tombol <strong>Panggil/Hijau</strong> sekali lagi pada HP Anda untuk melakukan panggilan darurat sesungguhnya.
            </p>
        `;
        nextBtn.innerHTML = `Mulai Menggunakan <i data-lucide="check"></i>`;
    }
    lucide.createIcons();
}

function nextOnboardingStep() {
    if (onboardingStep < 3) {
        onboardingStep++;
        renderOnboardingStep();
    } else {
        document.getElementById("onboarding-overlay").classList.remove("active");
    }
}
window.nextOnboardingStep = nextOnboardingStep;


function logoutWarga() {
    clearWargaSession();
    currentUserRole = 'warga';
    document.getElementById("warga-console").style.display = "none";
    document.getElementById("warga-registration").style.display = "block";
    document.getElementById("warga-login-panel").style.display = "none";
    document.getElementById("warga-register-panel").style.display = "block";
    document.getElementById("warga-auth-title").textContent = "Pendaftaran Warga";
    document.getElementById("warga-auth-description").textContent = "Daftarkan akun warga dengan password untuk login ulang dan penggunaan tombol darurat kluster.";
    document.querySelectorAll('.auth-tab[data-auth-mode]').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.authMode === 'register');
    });
    const identityTag = document.getElementById('identity-tag');
    if (identityTag) {
        identityTag.textContent = '';
    }
    updateIdentityTag();
    showToast('Anda telah keluar dari akun warga.', 'info');
}
window.logoutWarga = logoutWarga;

async function loginWarga(e) {
    e.preventDefault();
    const no_hp = document.getElementById("login-no-hp").value.trim();
    const password = document.getElementById("login-password").value;

    await syncWargaDataFromFirestore();
    await syncPICDataFromFirestore();

    const normalizedInput = normalizePhoneNumber(no_hp);

    const wargaList = await getWargaTable().toArray();
    let matchedWarga = wargaList.find(warga => {
        const normalizedStored = normalizePhoneNumber(warga.no_hp || "");
        return normalizedStored === normalizedInput && String(warga.password || "") === String(password);
    });

    if (!matchedWarga) {
        const fallbackWarga = (JSON.parse(localStorage.getItem(STORAGE_WARGA_KEY)) || []).find(warga => {
            const normalizedStored = normalizePhoneNumber(warga.no_hp || "");
            return normalizedStored === normalizedInput && String(warga.password || "") === String(password);
        });
        if (fallbackWarga) {
            await getWargaTable().put(fallbackWarga);
            matchedWarga = fallbackWarga;
        }
    }

    if (!matchedWarga) {
        alert("Nomor HP atau password warga salah.");
        return;
    }

    loggedInWarga = matchedWarga;
    persistWargaSession(matchedWarga);
    currentUserRole = 'warga';
    const wargaRegistrationPanel = document.getElementById("warga-registration");
    const wargaConsolePanel = document.getElementById("warga-console");
    if (wargaRegistrationPanel) {
        wargaRegistrationPanel.style.display = "none";
    }
    if (wargaConsolePanel) {
        wargaConsolePanel.style.display = "block";
    }
    showToast(`Selamat datang, ${matchedWarga.nama}!`, "success");
    updateIdentityTag();
    await checkWargaRegistration();
}

// Handler SOS Warga
async function triggerSOS(kategori) {
    const now = Date.now();
    if (sosSubmissionInFlight || (now - lastSOSSubmissionAt) < SOS_SUBMIT_COOLDOWN_MS) {
        showToast("Permintaan SOS sedang diproses. Tunggu sebentar.", "warning");
        return;
    }

    setPushDebugState({
        pushStatus: 'sos-triggered',
        pushAt: now,
        pushError: ''
    });

    const dataWarga = await getActiveWargaRecord();
    if (!dataWarga) {
        alert("Silakan login ulang sebagai warga sebelum mengirim SOS.");
        return;
    }

    antreanPIC = await getPicTable().orderBy('urutan').toArray();
    indeksPICAktif = 0;

    if (antreanPIC.length === 0) {
        alert("Peringatan: Kontak darurat kosong di memori HP. Hubungi Admin.");
        return;
    }

    const sos_id = `sos_${dataWarga?.warga_id || 'warga'}_${now}`;
    currentSOSLaporanId = sos_id;

    const laporan = {
        sos_id: sos_id,
        warga_id: dataWarga.warga_id,
        nama_pelapor: dataWarga.nama,
        no_rumah: dataWarga.no_rumah,
        no_hp: dataWarga.no_hp,
        jenis_sos: kategori,
        waktu_kejadian: new Date().toISOString(),
        status: "Mencari Bantuan",
        pic_menangani: "",
        waktu_selesai: ""
    };

    const sosButtons = document.querySelectorAll('.sos-button');
    sosButtons.forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = '0.7';
        btn.style.pointerEvents = 'none';
    });

    sosSubmissionInFlight = true;
    lastSOSSubmissionAt = now;

    try {
        const notificationPermissionGranted = await requestPICNotificationPermission();
        if (!notificationPermissionGranted) {
            showToast('Izin notifikasi belum aktif, pemberitahuan lokal akan dibatasi.', 'warning');
        }
        if (isOnline) {
            const uid = loggedInUserUid || null;
            const payload = {
                ...laporan,
                uuid: crypto.randomUUID(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                deletedAt: null,
                deletedBy: null,
                updatedBy: uid || null
            };
            await setDoc(doc(db, COLLECTIONS.SOS, sos_id), payload);
            if (!getMockCloudSOS().some(item => item.sos_id === sos_id)) {
                setMockCloudSOS([...getMockCloudSOS(), payload]);
            }
        } else {
            const offlineQueue = JSON.parse(localStorage.getItem("offline_sos_queue")) || [];
            offlineQueue.push(laporan);
            localStorage.setItem("offline_sos_queue", JSON.stringify(offlineQueue));
            if (!getMockCloudSOS().some(item => item.sos_id === sos_id)) {
                setMockCloudSOS([...getMockCloudSOS(), laporan]);
            }
            showToast("Mode Offline: Panggilan darurat lokal disiapkan.", "warning");
        }

        updateWargaSOSStatus();
        const localNotificationShown = await showImmediateSOSAnnouncement(laporan, kategori, dataWarga);
        if (!localNotificationShown) {
            showSystemBanner(`SOS ${kategori} sudah diterima. Pastikan izin notifikasi aktif agar pemberitahuan muncul di perangkat.`, 'warning');
        }

        void (async () => {
            try {
                setPushDebugState({
                    pushRecipientCount: 'mengumpulkan-di-server',
                    pushIncludesCurrentToken: '-'
                });

                // Token penerima dikumpulkan server-side di /send-fcm (baca fcmTokens
                // via Admin SDK), jadi device pengirim tidak perlu akses ke koleksi itu.
                await sendSOSFcmBroadcast({
                    title: `SOS ${kategori}`,
                    body: `${dataWarga.nama} di ${dataWarga.no_rumah} sedang membutuhkan bantuan`,
                    data: {
                        type: 'sos_alert',
                        sosId: sos_id,
                        jenisSos: kategori,
                        namaPelapor: dataWarga.nama,
                        noRumah: dataWarga.no_rumah,
                        timestamp: new Date().toISOString()
                    }
                });
            } catch (pushError) {
                console.warn('Gagal mengirim push SOS ke warga:', pushError);
                setPushDebugState({
                    pushStatus: 'failed',
                    pushAt: Date.now(),
                    pushError: pushError?.message || String(pushError)
                });
                showToast('Push alert gagal terkirim. Cek konfigurasi Vercel Function & FCM.', 'warning');
            }
        })();

        try {
            if (document.visibilityState === 'visible') {
                showSystemBanner(`Pemberitahuan sudah dikirim ke warga sekitar tentang ${dataWarga.nama} di ${dataWarga.no_rumah}`, 'info');
            }
        } catch (bannerError) {
            console.warn('Gagal menampilkan banner broadcast warga:', bannerError);
        }

        showToast('Pemberitahuan SOS telah dikirim ke warga sekitar.', 'info');
    } catch (error) {
        console.error('Gagal mengirim SOS:', error);
        showToast('Gagal mengirim SOS. Coba lagi.', 'error');
    } finally {
        sosSubmissionInFlight = false;
        sosButtons.forEach(btn => {
            btn.disabled = false;
            btn.style.opacity = '';
            btn.style.pointerEvents = '';
        });
    }
}

function jalankanPanggilanSeluler() {
    if (indeksPICAktif < antreanPIC.length) {
        const target = antreanPIC[indeksPICAktif];
        
        document.getElementById("asisten-panggilan").style.display = "block";
        document.getElementById("nama-pic-aktif").innerText = target.nama;
        document.getElementById("jabatan-pic-aktif").innerText = `${target.jabatan} (Prioritas ${target.urutan})`;
        
        showToast(`Membuka telepon untuk menghubungi: ${target.nama}...`);
        
        // Picu dialer HP
        window.location.href = `tel:${target.no_hp}`;
    } else {
        alert("Semua PIC prioritas sudah dihubungi. Mengulang kembali dari prioritas pertama.");
        indeksPICAktif = 0;
        jalankanPanggilanSeluler();
    }
}

// Deteksi saat Warga kembali fokus ke browser
window.addEventListener('focus', () => {
    if (currentUserRole === 'warga' && antreanPIC.length > 0 && indeksPICAktif < antreanPIC.length) {
        document.getElementById("tombol-lanjut").style.display = "block";
    }
});

function panggilBerikutnya() {
    indeksPICAktif++;
    document.getElementById("tombol-lanjut").style.display = "none";
    jalankanPanggilanSeluler();
}

function redialCurrentPIC() {
    jalankanPanggilanSeluler();
}

// Update UI Status Laporan Warga
async function updateWargaSOSStatus() {
    const dataWarga = await getActiveWargaRecord();
    if (!dataWarga) return;

    const cloudSOS = getMockCloudSOS();
    // Cari laporan milik warga ini yang paling baru dan belum selesai
    const activeLaporan = cloudSOS
        .filter(l => l.warga_id === dataWarga.warga_id)
        .sort((a, b) => new Date(b.waktu_kejadian) - new Date(a.waktu_kejadian))[0];

    const container = document.getElementById("status-laporan-konten");

    if (!activeLaporan) {
        container.innerHTML = `<p style="color: var(--text-muted); font-style: italic;">Belum ada laporan SOS aktif saat ini.</p>`;
        document.getElementById("asisten-panggilan").style.display = "none";
        return;
    }

    currentSOSLaporanId = activeLaporan.sos_id;
    let badgeClass = "badge-offline";
    let iconName = "alert-circle";

    if (activeLaporan.status === "Dalam Perjalanan") {
        badgeClass = "badge-online";
        iconName = "truck";
    } else if (activeLaporan.status === "Selesai") {
        badgeClass = "badge-online";
        iconName = "check-circle";
    }

    container.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-weight: 600; color: #fff;">SOS ${activeLaporan.jenis_sos}</span>
                <span class="status-badge ${badgeClass}" style="padding: 0.25rem 0.5rem; border-radius: 6px; font-size: 0.8rem; background: rgba(255,255,255,0.05);">
                    <i data-lucide="${iconName}"></i> ${activeLaporan.status}
                </span>
            </div>
            <p style="font-size: 0.9rem; color: var(--text-secondary);">
                Waktu Laporan: ${new Date(activeLaporan.waktu_kejadian).toLocaleTimeString()}
            </p>
            ${activeLaporan.pic_menangani ? `
                <div style="padding: 0.75rem; border-radius: 8px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); margin-top: 0.25rem;">
                    <p style="font-weight: 500; font-size: 0.95rem; color: var(--color-success);">
                        🚨 Ditangani Oleh: ${activeLaporan.pic_menangani}
                    </p>
                    <p style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem;">
                        Petugas sedang bergerak ke lokasi Anda di ${activeLaporan.no_rumah}. Tetap tenang.
                    </p>
                </div>
            ` : `
                <p style="font-size: 0.9rem; color: var(--color-warning);">
                    Menunggu PIC merespon & mengonfirmasi bantuan...
                </p>
            `}
        </div>
    `;
    lucide.createIcons();
}

// Sinkronisasi data offline warga saat koneksi kembali online
function syncWargaOfflineReports() {
    const offlineQueue = JSON.parse(localStorage.getItem("offline_sos_queue")) || [];
    if (offlineQueue.length === 0) return;
    // Push each offline report to Firestore
    offlineQueue.forEach(async (item) => {
        const uid = loggedInUserUid || null;
        await addDocument(COLLECTIONS.SOS, item, uid);
    });
    localStorage.removeItem("offline_sos_queue");
    showToast("Semua laporan darurat offline disinkronkan ke Cloud!", "success");
    // UI will update via listener
}

// ==========================================
// 6b. Re-sync Data Warga Lokal ke Firestore
// ==========================================
// Antrean warga yang dibuat/diupdate lokal tapi belum sampai ke Firestore
// (misalnya saat user offline atau Firestore write gagal).

function getPendingWargaSyncQueue() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_PENDING_WARGA_SYNC_KEY) || '[]') || [];
    } catch (_e) {
        return [];
    }
}

function enqueuePendingWargaSync(wargaPayload) {
    if (!wargaPayload?.warga_id) return;
    const queue = getPendingWargaSyncQueue();
    // Hindari duplikat: ganti entry lama dengan id yang sama
    const filtered = queue.filter(item => item.warga_id !== wargaPayload.warga_id);
    filtered.push(wargaPayload);
    localStorage.setItem(STORAGE_PENDING_WARGA_SYNC_KEY, JSON.stringify(filtered));
}

function removePendingWargaSync(wargaId) {
    const queue = getPendingWargaSyncQueue().filter(item => item.warga_id !== wargaId);
    if (queue.length === 0) {
        localStorage.removeItem(STORAGE_PENDING_WARGA_SYNC_KEY);
    } else {
        localStorage.setItem(STORAGE_PENDING_WARGA_SYNC_KEY, JSON.stringify(queue));
    }
}

async function syncLocalWargasToFirestore() {
    if (!navigator.onLine) return;

    const queue = getPendingWargaSyncQueue();
    if (queue.length === 0) return;

    let synced = 0;
    let failed = 0;

    for (const wargaPayload of queue) {
        try {
            await setDoc(doc(db, COLLECTIONS.WARGA, wargaPayload.warga_id), wargaPayload);
            removePendingWargaSync(wargaPayload.warga_id);
            synced++;
        } catch (error) {
            console.error(`Gagal sync warga ${wargaPayload.warga_id} ke Firestore:`, error);
            failed++;
        }
    }

    if (synced > 0) {
        console.log(`${synced} data warga berhasil disync ke Firestore.`);
    }
    if (failed > 0) {
        console.warn(`${failed} data warga gagal disync, akan dicoba lagi nanti.`);
    }
    if (synced > 0 && failed === 0) {
        showToast(`${synced} data warga berhasil disinkronkan ke Cloud.`, "success");
    } else if (failed > 0) {
        showToast(`${synced} berhasil, ${failed} gagal disync. Akan dicoba lagi.`, "warning");
    }
}

// ==========================================
// 7. Alur PIC (Emergency Responder Flow)
// ==========================================
function normalizePICRecord(pic, fallbackId = null) {
    const resolvedId = pic?.pic_id || pic?.id || fallbackId || `pic_${Date.now()}`;
    return {
        ...pic,
        pic_id: resolvedId,
        firestoreDocId: pic?.firestoreDocId || pic?.firebaseUid || pic?.id || fallbackId || resolvedId,
        no_hp: normalizePhoneNumber(pic?.no_hp || ""),
        urutan: Number(pic?.urutan || 1),
        no_rumah: pic?.no_rumah || "-"
    };
}

function getPICStorageList() {
    return (JSON.parse(localStorage.getItem(STORAGE_PIC_KEY)) || [])
        .filter((p) => !p.deletedAt)
        .map((pic) => normalizePICRecord(pic, pic?.pic_id));
}

function persistPICStorageList(picList) {
    const normalized = picList.map((pic) => normalizePICRecord(pic, pic?.pic_id));
    localStorage.setItem(STORAGE_PIC_KEY, JSON.stringify(normalized));
    return normalized;
}

function applyPICOrderShift(picList, targetRecord, targetUrutan, currentPicId = null) {
    const safeTargetUrutan = Math.max(1, Number(targetUrutan) || 1);
    const filtered = picList.filter((pic) => pic.pic_id !== currentPicId && !pic.deletedAt);
    const insertAt = Math.min(filtered.length, safeTargetUrutan - 1);
    filtered.splice(insertAt, 0, { ...targetRecord, urutan: safeTargetUrutan });
    return filtered.map((pic, index) => ({ ...pic, urutan: index + 1 }));
}

async function syncPICDataFromFirestore() {
    if (!navigator.onLine) return [];

    try {
        const firestorePICs = await fetchCollection(COLLECTIONS.PIC);
        const activePICs = firestorePICs
            .filter((p) => !p.deletedAt)
            .map((pic) => normalizePICRecord(pic, pic?.id));
        persistPICStorageList(activePICs);
        await sinkronisasiPICDariCloud();
        return activePICs;
    } catch (err) {
        console.error("Gagal sinkronisasi PIC dari Firestore:", err);
        return [];
    }
}

async function persistPICOrderToFirestore(picList) {
    const uid = loggedInUserUid || null;
    const now = new Date().toISOString();
    await Promise.all(picList.map((pic) => {
        const docId = pic.firestoreDocId || pic.firebaseUid || pic.id || pic.pic_id;
        const payload = {
            ...pic,
            no_hp: normalizePhoneNumber(pic.no_hp || ""),
            urutan: Number(pic.urutan || 1),
            updatedAt: now,
            updatedBy: uid
        };
        return setDoc(doc(db, COLLECTIONS.PIC, docId), payload, { merge: true });
    }));
}

async function reorderPICRows(draggedPicId, targetPicId) {
    const currentList = getPICStorageList();
    const draggedIndex = currentList.findIndex((pic) => pic.pic_id === draggedPicId);
    const targetIndex = currentList.findIndex((pic) => pic.pic_id === targetPicId);

    if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) {
        return;
    }

    const reordered = [...currentList];
    const [movedItem] = reordered.splice(draggedIndex, 1);
    reordered.splice(targetIndex, 0, movedItem);
    const reindexed = reordered.map((pic, index) => ({ ...pic, urutan: index + 1 }));

    persistPICStorageList(reindexed);
    await persistPICOrderToFirestore(reindexed);
    await sinkronisasiPICDariCloud();
    renderAdminPICList();
    showToast("Urutan PIC berhasil diperbarui.", "success");
}

async function updatePICFirestoreStatus(phone = "") {
    const statusEl = document.getElementById("pic-firestore-status-text");
    if (!statusEl) return;

    if (!phone) {
        statusEl.innerText = "Masukkan nomor HP untuk memeriksa data PIC di Firestore.";
        return;
    }

    try {
        const firestorePICs = await fetchCollection(COLLECTIONS.PIC);
        const matching = firestorePICs.filter(p => !p.deletedAt && (p.no_hp === phone || p.pic_id === phone || p.firebaseUid === phone));
        if (matching.length === 0) {
            statusEl.innerText = "Tidak ada data PIC yang cocok di Firestore untuk nomor HP ini.";
            return;
        }

        const first = matching[0];
        statusEl.innerHTML = `Ditemukan ${matching.length} data PIC di Firestore. Nama: <strong>${first.nama || '-'}</strong>, password tersimpan: <strong>${first.password ? 'ya' : 'tidak'}</strong>.`;
    } catch (err) {
        console.error(err);
        statusEl.innerText = "Gagal membaca data PIC dari Firestore.";
    }
}

// ==========================================
// 6c. Unified Login & Role-Based Access
// ==========================================

// Sembunyikan semua view section
function hideAllViews() {
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
}

// Tampilkan halaman login
function showLoginPage() {
    loggedInRole = null;
    currentUserRole = 'warga';
    hideAllViews();
    document.getElementById('view-login').classList.add('active');
    document.getElementById('view-switcher').style.display = 'none';
    const logoutBtn = document.getElementById('global-logout-btn');
    if (logoutBtn) logoutBtn.style.display = 'none';
    updateIdentityTag();
    // Reset form login
    const form = document.getElementById('form-unified-login');
    if (form) form.reset();
    const errEl = document.getElementById('unified-login-error');
    if (errEl) errEl.style.display = 'none';
}

// Update role switcher visibility berdasarkan role yang login
function updateRoleSwitcher() {
    const switcher = document.getElementById('view-switcher');
    const wargaBtn = switcher.querySelector('[data-view="warga"]');
    const picBtn = switcher.querySelector('[data-view="pic"]');
    const adminBtn = switcher.querySelector('[data-view="admin"]');

    if (!loggedInRole) {
        switcher.style.display = 'none';
        return;
    }

    if (loggedInRole === 'warga') {
        // Warga: tidak perlu switcher, hanya lihat halaman warga
        switcher.style.display = 'none';
    } else if (loggedInRole === 'pic') {
        // PIC: bisa lihat Warga + PIC
        switcher.style.display = 'flex';
        wargaBtn.style.display = '';
        picBtn.style.display = '';
        adminBtn.style.display = 'none';
    } else if (loggedInRole === 'admin') {
        // Admin: bisa lihat semua tab
        switcher.style.display = 'flex';
        wargaBtn.style.display = '';
        picBtn.style.display = '';
        adminBtn.style.display = '';
    }
}

// Setelah login berhasil, tampilkan view berdasarkan role
function showViewsForRole(role) {
    loggedInRole = role;
    updateRoleSwitcher();
    lucide.createIcons();

    // Tampilkan tombol logout
    const logoutBtn = document.getElementById('global-logout-btn');
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';

    hideAllViews();

    if (role === 'warga') {
        // Warga: hanya bisa lihat halaman warga
        currentUserRole = 'warga';
        document.getElementById('view-warga').classList.add('active');
        document.getElementById('warga-registration').style.display = 'none';
        document.getElementById('warga-console').style.display = 'block';
        antreanPIC = [];
        getPicTable().orderBy('urutan').toArray().then(picList => { antreanPIC = picList; });
        updateWargaSOSStatus();
        // Setup notifikasi untuk warga agar push SOS bisa diterima
        void initializeNotificationSupport();
    } else if (role === 'pic') {
        // PIC: default ke view Warga, bisa switch ke PIC
        currentUserRole = 'warga';
        document.getElementById('view-warga').classList.add('active');
        document.querySelectorAll('#view-switcher .role-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('#view-switcher [data-view="warga"]').classList.add('active');
        // Render warga + PIC console
        document.getElementById('warga-registration').style.display = 'none';
        document.getElementById('warga-console').style.display = 'block';
        document.getElementById('pic-login').style.display = 'none';
        document.getElementById('pic-console').style.display = 'block';
        antreanPIC = [];
        getPicTable().orderBy('urutan').toArray().then(picList => { antreanPIC = picList; });
        updateWargaSOSStatus();
        renderPICDashboard();
        checkActiveSOSForPIC();
    } else if (role === 'admin') {
        // Admin: default ke view Warga, bisa switch ke PIC dan Admin
        currentUserRole = 'warga';
        document.getElementById('view-warga').classList.add('active');
        document.querySelectorAll('#view-switcher .role-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('#view-switcher [data-view="warga"]').classList.add('active');
        // Render all consoles
        document.getElementById('warga-registration').style.display = 'none';
        document.getElementById('warga-console').style.display = 'block';
        document.getElementById('pic-login').style.display = 'none';
        document.getElementById('pic-console').style.display = 'block';
        document.getElementById('admin-login').style.display = 'none';
        document.getElementById('admin-console').style.display = 'block';
        antreanPIC = [];
        getPicTable().orderBy('urutan').toArray().then(picList => { antreanPIC = picList; });
        updateWargaSOSStatus();
        renderPICDashboard();
        checkActiveSOSForPIC();
        renderAdminPICList();
        renderAdminHistory();
        renderAdminWargaList();
        void initializeNotificationSupport();
    }

    updateIdentityTag();
}

// Logout unified: kembali ke halaman login
function logoutAll() {
    if (loggedInRole === 'pic') {
        clearPICSession();
        stopAlarmSound();
        document.getElementById('alarm-overlay').classList.remove('active');
    } else if (loggedInRole === 'admin') {
        sessionStorage.removeItem('admin_logged_in');
    }
    clearWargaSession();
    showLoginPage();
    showToast('Anda telah keluar.', 'info');
}
window.logoutAll = logoutAll;

// ---- Clear Cache ----
function clearAppCache() {
    if (isNativeApp() && window.NativeBridge) {
        window.NativeBridge.clearCache();
        showToast('Cache dibersihkan.', 'success');
        setTimeout(() => window.NativeBridge.reloadApp(), 500);
    } else if ('caches' in window) {
        caches.keys().then(names => {
            names.forEach(name => caches.delete(name));
        });
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(regs => {
                regs.forEach(reg => reg.unregister());
            });
        }
        showToast('Cache dibersihkan, reload halaman.', 'success');
        setTimeout(() => location.reload(), 500);
    } else {
        showToast('Clear cache tidak tersedia di browser ini.', 'info');
    }
}
window.clearAppCache = clearAppCache;

// Single unified login handler: cek admin → PIC → warga
async function handleUnifiedLogin(e) {
    e.preventDefault();
    const credential = document.getElementById('unified-login-credential').value.trim();
    const password = document.getElementById('unified-login-password').value;
    const errorEl = document.getElementById('unified-login-error');

    if (!credential || !password) {
        if (errorEl) { errorEl.textContent = 'Isi semua field.'; errorEl.style.display = 'block'; }
        return;
    }
    if (errorEl) errorEl.style.display = 'none';

    // 1) Coba login sebagai Admin
    if (credential === 'super admin' && password === 'super4dM1n*$') {
        sessionStorage.setItem('admin_logged_in', 'true');
        showViewsForRole('admin');
        showToast('Login Super Admin Berhasil!', 'success');
        return;
    }

    // 2) Coba login sebagai PIC
    try {
        await syncPICDataFromFirestore();
        const { authUser, profile } = await signInPIC({ phone: credential, password });
        loggedInPIC = profile;
        loggedInUserUid = authUser.uid;
        persistPICSession();
        await initializeNotificationSupport();
        showViewsForRole('pic');
        showToast(`Selamat datang, ${profile.nama}! (PIC)`, 'success');
        return;
    } catch (_picErr) {
        // Bukan PIC, lanjut cek warga
    }

    // 3) Coba login sebagai Warga
    await syncWargaDataFromFirestore();
    await syncPICDataFromFirestore();
    const normalizedInput = normalizePhoneNumber(credential);
    const wargaList = await getWargaTable().toArray();
    let matchedWarga = wargaList.find(w => {
        const normalizedStored = normalizePhoneNumber(w.no_hp || '');
        return normalizedStored === normalizedInput && String(w.password || '') === String(password);
    });

    if (!matchedWarga) {
        const fallbackWarga = (JSON.parse(localStorage.getItem(STORAGE_WARGA_KEY)) || []).find(w => {
            const normalizedStored = normalizePhoneNumber(w.no_hp || '');
            return normalizedStored === normalizedInput && String(w.password || '') === String(password);
        });
        if (fallbackWarga) {
            await getWargaTable().put(fallbackWarga);
            matchedWarga = fallbackWarga;
        }
    }

    if (matchedWarga) {
        loggedInWarga = matchedWarga;
        persistWargaSession(matchedWarga);
        showViewsForRole('warga');
        showToast(`Selamat datang, ${matchedWarga.nama}!`, 'success');
        return;
    }

    // 4) Tidak cocok dengan semua role
    if (errorEl) {
        errorEl.textContent = 'Nomor HP / username atau password salah.';
        errorEl.style.display = 'block';
    }
}

// Tampilkan form registrasi warga dari halaman login
function showWargaRegisterFromLogin() {
    hideAllViews();
    document.getElementById('view-warga').classList.add('active');
    currentUserRole = 'warga';
    document.getElementById('warga-registration').style.display = 'block';
    document.getElementById('warga-console').style.display = 'none';
    setWargaAuthMode('register');
    updateIdentityTag();
}
window.showWargaRegisterFromLogin = showWargaRegisterFromLogin;

async function loginPIC(e) {
    e.preventDefault();
    const phone = document.getElementById("pic-login-phone").value.trim();
    const password = document.getElementById("pic-login-password").value;
    try {
        await updatePICFirestoreStatus(phone);
        await syncPICDataFromFirestore();
        const { authUser, profile } = await signInPIC({ phone, password });
        loggedInPIC = profile;
        loggedInUserUid = authUser.uid;
        persistPICSession();
        await initializeNotificationSupport();
        document.getElementById("pic-login").style.display = "none";
        document.getElementById("pic-console").style.display = "block";
        showToast(`Selamat datang, ${profile.nama}!`, "success");
        updateIdentityTag();
        renderPICDashboard();
        checkActiveSOSForPIC();
    } catch (err) {
        console.error(err);
        const message = err?.message === 'PIC not found'
            ? 'Data PIC tidak ditemukan di Firestore. Pastikan PIC sudah tersimpan dan Firebase Authentication diaktifkan.'
            : 'Nomor HP atau password PIC salah.';
        alert(message);
    }
}

function logoutPIC() {
    clearPICSession();
    stopAlarmSound();
    document.getElementById("alarm-overlay").classList.remove("active");
    document.getElementById("pic-console").style.display = "none";
    document.getElementById("pic-login").style.display = "block";
    const identityTag = document.getElementById('identity-tag');
    if (identityTag) {
        identityTag.textContent = '';
    }
    updateIdentityTag();
    showToast("Anda telah keluar dari sesi PIC.", "info");
}

// Cek Laporan Darurat Aktif Khusus PIC
function checkActiveSOSForPIC() {
    if (!loggedInPIC) return;
    const cloudSOS = getMockCloudSOS();
    const alarmOverlay = document.getElementById("alarm-overlay");

    const pendingAlarm = cloudSOS
        .filter(l => l.status === "Mencari Bantuan" && !acknowledgedSOSIds.has(l.sos_id))
        .sort((a, b) => new Date(b.waktu_kejadian) - new Date(a.waktu_kejadian))[0];

    if (pendingAlarm) {
        document.getElementById("alarm-category").innerText = pendingAlarm.jenis_sos;
        document.getElementById("alarm-reporter").innerText = pendingAlarm.nama_pelapor;
        document.getElementById("alarm-home").innerText = pendingAlarm.no_rumah;
        document.getElementById("alarm-phone").innerText = pendingAlarm.no_hp;
        document.getElementById("alarm-time").innerText = new Date(pendingAlarm.waktu_kejadian).toLocaleTimeString();

        alarmOverlay.dataset.sosId = pendingAlarm.sos_id;

        if (!alarmOverlay.classList.contains("active") || alarmOverlay.dataset.sosId !== pendingAlarm.sos_id) {
            alarmOverlay.classList.add("active");
        }
        startAlarmSound();
        try {
            if (navigator.vibrate) {
                const pattern = document.visibilityState === 'hidden' ? [1000, 500, 1000, 500, 1000] : [500, 200, 500];
                navigator.vibrate(pattern);
            }
        } catch (error) {
            console.warn('Vibration tidak tersedia:', error);
        }
        notifyPICAboutSOS(pendingAlarm);
    } else {
        alarmOverlay.classList.remove("active");
        alarmOverlay.dataset.sosId = "";
        stopAlarmSound();
        clearPendingSOSAlert();
    }
}

// Konfirmasi Laporan SOS oleh PIC
async function updateSOSStatusInCloud(sosId, changes) {
    const cloudSOS = getMockCloudSOS();
    const laporanIdx = cloudSOS.findIndex(l => l.sos_id === sosId);

    if (laporanIdx === -1) return null;

    const existing = cloudSOS[laporanIdx];
    const updated = {
        ...existing,
        ...changes,
        updatedAt: new Date().toISOString(),
        updatedBy: loggedInUserUid || null
    };

    const nextCloudSOS = [...cloudSOS];
    nextCloudSOS[laporanIdx] = updated;
    setMockCloudSOS(nextCloudSOS);

    try {
        if (navigator.onLine) {
            await updateDocument(COLLECTIONS.SOS, sosId, {
                ...changes,
                updatedAt: updated.updatedAt,
                updatedBy: updated.updatedBy
            }, loggedInUserUid || null);
            await flushSOSStatusQueue();
        } else {
            queueSOSStatusUpdate(sosId, changes, loggedInUserUid || null);
        }
    } catch (error) {
        console.error("Gagal memperbarui status SOS di cloud:", error);
        queueSOSStatusUpdate(sosId, changes, loggedInUserUid || null);
    }

    return updated;
}

async function picAcceptSOS() {
    const alarmOverlay = document.getElementById("alarm-overlay");
    const sosId = alarmOverlay.dataset.sosId;
    if (!sosId || !loggedInPIC) return;

    const currentRecord = getMockCloudSOS().find(l => l.sos_id === sosId);
    if (!currentRecord) return;

    if (currentRecord.status === "Selesai") {
        stopAlarmSound();
        alarmOverlay.classList.remove("active");
        renderPICDashboard();
        return;
    }

    if (currentRecord.status !== "Mencari Bantuan") {
        stopAlarmSound();
        alarmOverlay.classList.remove("active");
        showToast("Laporan ini sudah diproses.", "info");
        renderPICDashboard();
        return;
    }

    markSOSHandled(sosId);
    await updateSOSStatusInCloud(sosId, {
        status: "Dalam Perjalanan",
        pic_menangani: loggedInPIC.nama
    });

    stopAlarmSound();
    alarmOverlay.classList.remove("active");
    showToast("SOS Berhasil diterima! Laporan status diperbarui.", "success");
    renderPICDashboard();
}

// PIC Selesaikan Laporan Kejadian
async function resolveSOS(sosId) {
    const currentRecord = getMockCloudSOS().find(l => l.sos_id === sosId);
    if (!currentRecord) return;

    if (currentRecord.status === "Selesai") {
        showToast("Laporan ini sudah selesai.", "info");
        renderPICDashboard();
        return;
    }

    markSOSHandled(sosId);
    await updateSOSStatusInCloud(sosId, {
        status: "Selesai",
        waktu_selesai: new Date().toISOString()
    });

    showToast("Laporan dinyatakan Selesai.", "success");
    renderPICDashboard();
}

function renderPICDashboard() {
    if (!loggedInPIC) return;
    const cloudSOS = getMockCloudSOS();

    // List SOS Aktif (Mencari Bantuan atau Dalam Perjalanan)
    const activeList = cloudSOS.filter(l => l.status !== "Selesai");
    const activeContainer = document.getElementById("pic-active-sos-list");
    document.getElementById("pic-active-count").textContent = activeList.length;

    if (activeList.length === 0) {
        activeContainer.innerHTML = `
            <p style="color: var(--text-muted); font-style: italic; text-align: center; padding: 1rem;">
                Tidak ada laporan darurat yang aktif. Kondisi kluster kondusif.
            </p>
        `;
    } else {
        activeContainer.innerHTML = activeList.map(l => `
            <div style="padding: 1rem; border-radius: 12px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-color); margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
                <div>
                    <h4 style="font-weight: 700; color: #fff;">${l.jenis_sos.toUpperCase()} - ${l.nama_pelapor}</h4>
                    <p style="font-size: 0.9rem; color: var(--text-secondary);">Rumah: ${l.no_rumah} | Telp: ${l.no_hp}</p>
                    <p style="font-size: 0.85rem; color: var(--text-muted);">Dilaporkan: ${new Date(l.waktu_kejadian).toLocaleTimeString()}</p>
                    ${l.pic_menangani ? `<p style="font-size: 0.85rem; color: var(--color-success); font-weight: 500;">Ditangani: ${l.pic_menangani}</p>` : ""}
                </div>
                <div>
                    ${l.status === 'Mencari Bantuan' ? `
                        <button onclick="picAcceptSOSDirect('${l.sos_id}')" class="btn btn-primary" style="padding: 0.5rem 1rem; width: auto; font-size: 0.85rem;">Terima</button>
                    ` : `
                        <button onclick="resolveSOS('${l.sos_id}')" class="btn btn-secondary" style="padding: 0.5rem 1rem; width: auto; font-size: 0.85rem; background: var(--color-success); color: #fff; border: none;">Selesai</button>
                    `}
                </div>
            </div>
        `).join('');
    }

    // Riwayat Penanganan Pribadi PIC
    const personalHistory = cloudSOS.filter(l => l.pic_menangani === loggedInPIC.nama && l.status === "Selesai");
    const historyRows = document.getElementById("pic-personal-history-rows");
    document.getElementById("pic-history-count").textContent = personalHistory.length;

    if (personalHistory.length === 0) {
        historyRows.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; color: var(--text-muted); font-style: italic;">Belum menangani kejadian hari ini.</td>
            </tr>
        `;
    } else {
        historyRows.innerHTML = personalHistory.map(l => `
            <tr>
                <td>${l.nama_pelapor}</td>
                <td>${l.no_rumah}</td>
                <td><span style="padding: 0.25rem 0.5rem; font-size: 0.8rem; border-radius: 4px; background: rgba(255,255,255,0.05); font-weight: 600;">${l.jenis_sos}</span></td>
                <td>${new Date(l.waktu_kejadian).toLocaleTimeString()}</td>
                <td style="color: var(--color-success); font-weight: 600;">Selesai</td>
            </tr>
        `).join('');
    }
    lucide.createIcons();
}

function picAcceptSOSDirect(sosId) {
    const alarmOverlay = document.getElementById("alarm-overlay");
    alarmOverlay.dataset.sosId = sosId;
    picAcceptSOS();
}

// ==========================================
// 8. Dasbor Super Admin (Super Admin Flow)
// ==========================================
async function loginAdmin(e) {
    e.preventDefault();
    const user = document.getElementById("admin-username").value.trim();
    const pass = document.getElementById("admin-password").value;

    if (user === "super admin" && pass === "super4dM1n*$") {
        sessionStorage.setItem("admin_logged_in", "true");
        document.getElementById("admin-login").style.display = "none";
        document.getElementById("admin-console").style.display = "block";
        showToast("Login Super Admin Berhasil!", "success");
        updateIdentityTag();
        if (navigator.onLine) {
            await syncPICDataFromFirestore();
            await syncWargaDataFromFirestore();
        }
        renderAdminPICList();
        renderAdminHistory();
        await renderAdminWargaList();
    } else {
        alert("Kredensial Super Admin salah.");
    }
}

function logoutAdmin() {
    sessionStorage.removeItem("admin_logged_in");
    document.getElementById("admin-console").style.display = "none";
    document.getElementById("admin-login").style.display = "block";
    const identityTag = document.getElementById('identity-tag');
    if (identityTag) {
        identityTag.textContent = '';
    }
    updateIdentityTag();
}

async function switchAdminTab(tab) {
    currentAdminTab = tab;
    document.getElementById("btn-tab-pic").classList.toggle("active", tab === 'pic');
    document.getElementById("btn-tab-warga").classList.toggle("active", tab === 'warga');
    document.getElementById("btn-tab-history").classList.toggle("active", tab === 'history');

    document.getElementById("admin-tab-pic-content").style.display = tab === 'pic' ? 'block' : 'none';
    document.getElementById("admin-tab-warga-content").style.display = tab === 'warga' ? 'block' : 'none';
    document.getElementById("admin-tab-history-content").style.display = tab === 'history' ? 'block' : 'none';

    if (tab === 'pic' && navigator.onLine) {
        await syncPICDataFromFirestore();
    }
    if (tab === 'warga' && navigator.onLine) {
        await syncWargaDataFromFirestore();
    }
    if (tab === 'pic') {
        renderAdminPICList();
    }
    if (tab === 'warga') {
        await renderAdminWargaList();
    }
}

async function assignWargaAsPIC(wargaId) {
    const wargaList = JSON.parse(localStorage.getItem(STORAGE_WARGA_KEY)) || [];
    const warga = wargaList.find((item) => item.warga_id === wargaId);

    if (!warga) {
        showToast('Data warga tidak ditemukan.', 'error');
        return;
    }

    const currentPICs = getPICStorageList();
    const existingPIC = currentPICs.find((pic) =>
        normalizePhoneNumber(pic.no_hp || '') === normalizePhoneNumber(warga.no_hp || '') ||
        pic.pic_id === `pic_${warga.warga_id}`
    );

    const now = new Date().toISOString();
    const nextRecord = {
        pic_id: existingPIC?.pic_id || `pic_${warga.warga_id}`,
        nama: warga.nama,
        no_hp: normalizePhoneNumber(warga.no_hp || ''),
        jabatan: existingPIC?.jabatan || 'PIC Warga',
        no_rumah: warga.no_rumah || '-',
        urutan: existingPIC?.urutan || currentPICs.length + 1,
        password: warga.password || 'pic123',
        firestoreDocId: existingPIC?.firestoreDocId || existingPIC?.firebaseUid || existingPIC?.id || null,
        firebaseUid: existingPIC?.firebaseUid || existingPIC?.firestoreDocId || existingPIC?.id || null,
        createdAt: existingPIC?.createdAt || now,
        updatedAt: now,
        deletedAt: null,
        deletedBy: null,
        updatedBy: loggedInUserUid || null
    };

    const nextPICs = existingPIC
        ? currentPICs.map((pic) => pic.pic_id === existingPIC.pic_id ? nextRecord : pic)
        : [...currentPICs, nextRecord];

    persistPICStorageList(nextPICs);

    try {
        let firestoreDocId = nextRecord.firestoreDocId;
        if (!firestoreDocId) {
            const authUser = await ensurePICAuthUser({ phone: nextRecord.no_hp, password: nextRecord.password });
            firestoreDocId = authUser.uid;
        }

        const firestorePayload = {
            ...nextRecord,
            firestoreDocId,
            firebaseUid: firestoreDocId,
            uuid: existingPIC?.uuid || crypto.randomUUID(),
            createdAt: nextRecord.createdAt,
            updatedAt: now,
            deletedAt: null,
            deletedBy: null,
            updatedBy: loggedInUserUid || null
        };

        await setDoc(doc(db, COLLECTIONS.PIC, firestoreDocId), firestorePayload, { merge: true });
        await sinkronisasiPICDariCloud();

        if (currentAdminTab !== 'pic') {
            await switchAdminTab('pic');
        } else {
            renderAdminPICList();
        }

        showToast(`Warga ${warga.nama} berhasil ditetapkan sebagai PIC.`, 'success');
    } catch (error) {
        console.error('Gagal menetapkan warga sebagai PIC:', error);
        showToast('Gagal menetapkan warga sebagai PIC.', 'error');
    }
}

async function saveWarga(e) {
    e.preventDefault();
    const nama = document.getElementById("warga-nama").value.trim();
    const no_hp = document.getElementById("warga-no-hp").value.trim();
    const no_rumah = document.getElementById("warga-no-rumah").value.trim();
    const password = document.getElementById("warga-password").value;
    const existingWargaId = document.getElementById("manage-warga-id").value;

    const wargaId = existingWargaId || `warga_${Date.now()}`;
    const payload = {
        warga_id: wargaId,
        nama,
        no_hp: normalizePhoneNumber(no_hp),
        no_rumah,
        password,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
        deletedBy: null,
        updatedBy: loggedInUserUid || null
    };

    let firestoreSynced = false;
    try {
        if (navigator.onLine) {
            await setDoc(doc(db, COLLECTIONS.WARGA, wargaId), payload);
            firestoreSynced = true;
        }
        await getWargaTable().put(payload);

        const cloudWarga = JSON.parse(localStorage.getItem(STORAGE_WARGA_KEY)) || [];
        const existingIndex = cloudWarga.findIndex((item) => item.warga_id === wargaId || normalizePhoneNumber(item.no_hp || "") === normalizePhoneNumber(no_hp));
        if (existingIndex >= 0) {
            cloudWarga[existingIndex] = payload;
        } else {
            cloudWarga.push(payload);
        }
        localStorage.setItem(STORAGE_WARGA_KEY, JSON.stringify(cloudWarga));

        if (!firestoreSynced) {
            enqueuePendingWargaSync(payload);
        }

        resetWargaForm();
        renderAdminWargaList();
        showToast("Data warga berhasil disimpan." + (firestoreSynced ? "" : " (akan disync saat online)"), "success");
    } catch (error) {
        console.error("Gagal menyimpan data warga:", error);
        enqueuePendingWargaSync(payload);
        showToast("Data warga tersimpan lokal. Akan disync saat online.", "warning");
    }
}

function resetWargaForm() {
    document.getElementById("form-manage-warga").reset();
    document.getElementById("manage-warga-id").value = "";
    document.getElementById("btn-cancel-edit-warga").style.display = "none";
}

async function renderAdminWargaList() {
    let wargaList = [];
    const storedWarga = JSON.parse(localStorage.getItem(STORAGE_WARGA_KEY) || "null");
    if (Array.isArray(storedWarga) && storedWarga.length > 0) {
        wargaList = storedWarga;
    } else {
        try {
            wargaList = await getWargaTable().orderBy('nama').toArray();
        } catch (error) {
            console.warn("Tidak bisa membaca daftar warga dari Dexie, pakai fallback kosong.", error);
        }
    }

    if (!wargaList.length && navigator.onLine) {
        wargaList = await syncWargaDataFromFirestore();
    }

    const cloudWarga = wargaList.filter((item) => !item.deletedAt);
    const picList = getPICStorageList();
    const container = document.getElementById("admin-warga-table-rows");

    if (cloudWarga.length === 0) {
        container.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Belum ada data warga terdaftar.</td></tr>`;
        return;
    }

    container.innerHTML = cloudWarga.map((warga) => {
        const isPIC = picList.some((pic) =>
            normalizePhoneNumber(pic.no_hp || '') === normalizePhoneNumber(warga.no_hp || '') ||
            pic.pic_id === `pic_${warga.warga_id}`
        );

        return `
            <tr>
                <td>${warga.nama}</td>
                <td>${warga.no_hp}</td>
                <td>${warga.no_rumah}</td>
                <td>${isPIC ? `<span style="display:inline-flex;align-items:center;gap:0.35rem;padding:0.25rem 0.55rem;border-radius:999px;background:rgba(16,185,129,0.12);color:var(--color-success);font-weight:700;"> <i data-lucide="shield-check" style="width:14px;height:14px;"></i> PIC</span>` : warga.password}</td>
                <td>
                    <div style="display: flex; gap: 0.5rem;">
                        <button data-action="edit" data-warga-id="${warga.warga_id}" class="btn btn-secondary" style="width: auto; padding: 0.25rem 0.5rem; font-size: 0.8rem; border-radius: 6px;">
                            <i data-lucide="edit-3" style="width: 14px; height: 14px;"></i>
                        </button>
                        <button data-action="delete" data-warga-id="${warga.warga_id}" class="btn btn-secondary" style="width: auto; padding: 0.25rem 0.5rem; font-size: 0.8rem; border-radius: 6px; background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.2); color: var(--color-medis);">
                            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    lucide.createIcons();
    container.querySelectorAll('button[data-action="edit"]').forEach((btn) => {
        btn.addEventListener('click', () => editWarga(btn.dataset.wargaId));
    });
    container.querySelectorAll('button[data-action="delete"]').forEach((btn) => {
        btn.addEventListener('click', () => deleteWarga(btn.dataset.wargaId));
    });
}

function editWarga(wargaId) {
    const cloudWarga = JSON.parse(localStorage.getItem(STORAGE_WARGA_KEY)) || [];
    const warga = cloudWarga.find((item) => item.warga_id === wargaId);
    if (!warga) return;

    document.getElementById("manage-warga-id").value = warga.warga_id;
    document.getElementById("warga-nama").value = warga.nama || "";
    document.getElementById("warga-no-hp").value = warga.no_hp || "";
    document.getElementById("warga-no-rumah").value = warga.no_rumah || "";
    document.getElementById("warga-password").value = warga.password || "";
    document.getElementById("btn-cancel-edit-warga").style.display = "inline-flex";
    document.getElementById("form-manage-warga").scrollIntoView({ behavior: 'smooth' });
}

async function deleteWarga(wargaId) {
    if (!confirm("Apakah Anda yakin ingin menghapus data warga ini?")) return;

    try {
        const cloudWarga = JSON.parse(localStorage.getItem(STORAGE_WARGA_KEY)) || [];
        const updated = cloudWarga.filter((item) => item.warga_id !== wargaId);
        localStorage.setItem(STORAGE_WARGA_KEY, JSON.stringify(updated));
        await getWargaTable().where('warga_id').equals(wargaId).delete();
        await updateDocument(COLLECTIONS.WARGA, wargaId, { deletedAt: new Date().toISOString(), deletedBy: loggedInUserUid || null }, loggedInUserUid || null);
        renderAdminWargaList();
        showToast("Data warga berhasil dihapus.", "success");
    } catch (error) {
        console.error("Gagal menghapus data warga:", error);
        showToast("Gagal menghapus data warga.", "error");
    }
}

// Simpan/Update PIC
async function savePIC(e) {
    e.preventDefault();
    const nama = document.getElementById("pic-nama").value.trim();
    const no_hp = document.getElementById("pic-no-hp").value.trim();
    const jabatan = document.getElementById("pic-jabatan").value;
    const no_rumah = document.getElementById("pic-no-rumah").value.trim() || "-";
    const urutan = parseInt(document.getElementById("pic-urutan").value);
    const password = document.getElementById("pic-password").value;

    const currentPICs = getPICStorageList();
    const existingRecord = editingPICId ? currentPICs.find((pic) => pic.pic_id === editingPICId) : null;
    const generatedId = editingPICId || `pic_${Date.now()}`;
    const normalizedPhone = normalizePhoneNumber(no_hp);
    const now = new Date().toISOString();
    const docId = existingRecord?.firestoreDocId || existingRecord?.firebaseUid || existingRecord?.id || existingRecord?.pic_id || null;

    const nextRecord = {
        pic_id: generatedId,
        nama,
        no_hp: normalizedPhone,
        jabatan,
        no_rumah,
        urutan: Number(urutan) || 1,
        password,
        firestoreDocId: docId,
        firebaseUid: docId || null,
        createdAt: existingRecord?.createdAt || now,
        updatedAt: now,
        deletedAt: null,
        deletedBy: null,
        updatedBy: loggedInUserUid || null
    };

    const orderedPICs = applyPICOrderShift(currentPICs, nextRecord, nextRecord.urutan, editingPICId || null);
    persistPICStorageList(orderedPICs);

    try {
        const uid = loggedInUserUid || null;
        let firestoreDocId = docId;
        if (!firestoreDocId) {
            const authUser = await ensurePICAuthUser({ phone: normalizedPhone, password });
            firestoreDocId = authUser.uid;
        }

        const firestorePayload = {
            ...nextRecord,
            firestoreDocId,
            firebaseUid: firestoreDocId,
            uuid: existingRecord?.uuid || crypto.randomUUID(),
            createdAt: nextRecord.createdAt,
            updatedAt: now,
            deletedAt: null,
            deletedBy: null,
            updatedBy: uid || null
        };

        await setDoc(doc(db, COLLECTIONS.PIC, firestoreDocId), firestorePayload, { merge: true });
        await persistPICOrderToFirestore(orderedPICs);
        resetPICForm();
        await sinkronisasiPICDariCloud();
        renderAdminPICList();
        showToast("PIC berhasil disimpan ke Cloud!", "success");
    } catch (e) {
        console.error('Error saving PIC:', e);
        showToast('Gagal menyimpan PIC ke cloud.', 'error');
    }
}

function resetPICForm() {
    editingPICId = null;
    document.getElementById("form-manage-pic").reset();
    document.getElementById("manage-pic-id").value = "";
    document.getElementById("btn-cancel-edit-pic").style.display = "none";
}

function renderAdminPICList() {
    const cloudPICs = getPICStorageList().sort((a, b) => a.urutan - b.urutan);
    const container = document.getElementById("admin-pic-table-rows");
    if (cloudPICs.length === 0) {
        container.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Belum ada data PIC terdaftar.</td></tr>`;
        return;
    }

    container.innerHTML = cloudPICs.map((p) => `
        <tr data-pic-id="${p.pic_id}" draggable="true" style="cursor: move;">
            <td><strong style="color: var(--color-medis);">☰ #${p.urutan}</strong></td>
            <td>${p.nama}</td>
            <td>${p.jabatan}</td>
            <td>${p.no_hp}</td>
            <td>${p.no_rumah}</td>
            <td>
                <div style="display: flex; gap: 0.5rem;">
                    <button data-action="edit" data-pic-id="${p.pic_id}" class="btn btn-secondary" style="width: auto; padding: 0.25rem 0.5rem; font-size: 0.8rem; border-radius: 6px;">
                        <i data-lucide="edit-3" style="width: 14px; height: 14px;"></i>
                    </button>
                    <button data-action="delete" data-pic-id="${p.pic_id}" class="btn btn-secondary" style="width: auto; padding: 0.25rem 0.5rem; font-size: 0.8rem; border-radius: 6px; background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.2); color: var(--color-medis);">
                        <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
    lucide.createIcons();
    container.querySelectorAll('button[data-action="edit"]').forEach((btn) => {
        btn.addEventListener('click', () => editPIC(btn.dataset.picId));
    });
    container.querySelectorAll('button[data-action="delete"]').forEach((btn) => {
        btn.addEventListener('click', () => deletePIC(btn.dataset.picId));
    });
    container.querySelectorAll('tr[data-pic-id]').forEach((row) => {
        row.addEventListener('dragstart', (event) => {
            event.dataTransfer.setData('text/plain', row.dataset.picId);
            row.style.opacity = '0.6';
        });
        row.addEventListener('dragend', () => {
            row.style.opacity = '1';
        });
        row.addEventListener('dragover', (event) => {
            event.preventDefault();
            row.style.background = 'rgba(255,255,255,0.08)';
        });
        row.addEventListener('dragleave', () => {
            row.style.background = '';
        });
        row.addEventListener('drop', async (event) => {
            event.preventDefault();
            row.style.background = '';
            const draggedPicId = event.dataTransfer.getData('text/plain');
            if (draggedPicId && draggedPicId !== row.dataset.picId) {
                await reorderPICRows(draggedPicId, row.dataset.picId);
            }
        });
    });
}

function editPIC(picId) {
    const cloudPICs = JSON.parse(localStorage.getItem(STORAGE_PIC_KEY)) || [];
    const pic = cloudPICs.find(p => p.pic_id === picId);
    if (!pic) return;

    editingPICId = picId;
    document.getElementById("pic-nama").value = pic.nama;
    document.getElementById("pic-no-hp").value = pic.no_hp;
    document.getElementById("pic-jabatan").value = pic.jabatan;
    document.getElementById("pic-no-rumah").value = pic.no_rumah;
    document.getElementById("pic-urutan").value = pic.urutan;
    document.getElementById("pic-password").value = pic.password;

    document.getElementById("btn-cancel-edit-pic").style.display = "inline-flex";
    document.getElementById("form-manage-pic").scrollIntoView({ behavior: 'smooth' });
}

async function deletePIC(picId) {
    if (!confirm("Apakah Anda yakin ingin menghapus PIC ini?")) return;
    
    try {
        const uid = loggedInUserUid || null;
        const currentPIC = getPICStorageList().find((pic) => pic.pic_id === picId);
        const docId = currentPIC?.firestoreDocId || currentPIC?.firebaseUid || currentPIC?.id || picId;
        await softDeleteDocument(COLLECTIONS.PIC, docId, uid);
    } catch (e) {
        console.error('Error soft deleting PIC in Firestore:', e);
        showToast('Gagal menghapus PIC di cloud.', 'error');
        return;
    }
    
    const cloudPICs = getPICStorageList();
    const updated = cloudPICs.filter((pic) => pic.pic_id !== picId);
    persistPICStorageList(updated);
    await sinkronisasiPICDariCloud();
    renderAdminPICList();
    showToast("PIC berhasil dihapus (soft delete).", "success");
}

// Render Riwayat Kejadian Digital di Admin
function renderAdminHistory() {
    const cloudSOS = getMockCloudSOS();
    // Sort from newest
    cloudSOS.sort((a,b) => new Date(b.waktu_kejadian) - new Date(a.waktu_kejadian));

    const container = document.getElementById("admin-history-table-rows");
    if (cloudSOS.length === 0) {
        container.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Belum ada riwayat laporan darurat.</td></tr>`;
        return;
    }

    container.innerHTML = cloudSOS.map(l => {
        let badgeColor = "var(--text-muted)";
        if (l.status === 'Mencari Bantuan') badgeColor = "var(--color-medis)";
        else if (l.status === 'Dalam Perjalanan') badgeColor = "var(--color-keamanan)";
        else if (l.status === 'Selesai') badgeColor = "var(--color-success)";

        // Hitung durasi respon (waktu selesai - waktu kejadian)
        let durasiStr = "-";
        if (l.waktu_selesai) {
            const ms = new Date(l.waktu_selesai) - new Date(l.waktu_kejadian);
            const mins = Math.round(ms / 60000);
            durasiStr = mins <= 0 ? "Kurang dari 1 menit" : `${mins} menit`;
        }

        return `
            <tr>
                <td>${new Date(l.waktu_kejadian).toLocaleString()}</td>
                <td><strong>${l.nama_pelapor}</strong> (${l.no_rumah})</td>
                <td><span style="padding: 0.25rem 0.5rem; font-size: 0.8rem; border-radius: 4px; background: rgba(255,255,255,0.05); font-weight: 600;">${l.jenis_sos}</span></td>
                <td><strong style="color: ${badgeColor};">${l.status}</strong></td>
                <td>${l.pic_menangani || "-"}</td>
                <td>${durasiStr}</td>
            </tr>
        `;
    }).join('');
}

// Expose handlers used by inline onclick attributes in index.html.
window.triggerSOS = triggerSOS;
window.panggilBerikutnya = panggilBerikutnya;
window.redialCurrentPIC = redialCurrentPIC;
window.logoutPIC = logoutPIC;
window.picAcceptSOS = picAcceptSOS;
window.resolveSOS = resolveSOS;
window.picAcceptSOSDirect = picAcceptSOSDirect;
window.logoutAdmin = logoutAdmin;
window.switchAdminTab = switchAdminTab;
window.resetPICForm = resetPICForm;
window.resetWargaForm = resetWargaForm;
window.nextOnboardingStep = nextOnboardingStep;
