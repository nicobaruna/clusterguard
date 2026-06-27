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
let isOnline = navigator.onLine;

// State Warga
let antreanPIC = [];
let indeksPICAktif = 0;
let currentSOSLaporanId = null;
let sosSubmissionInFlight = false;
let lastSOSSubmissionAt = 0;
const SOS_SUBMIT_COOLDOWN_MS = 4000;

// State PIC
let loggedInPIC = null;
let loggedInUserUid = null;
let activeSOSInterval = null;
let audioCtx = null;
let alarmOscillator1 = null;
let alarmOscillator2 = null;
let isAlarmPlaying = false;

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
let lastNotifiedSOSId = null;
let picSessionRestoreAttempted = false;
let wargaSessionRestoreAttempted = false;
let loggedInWarga = null;
let acknowledgedSOSIds = new Set();
let fcmListenerUnsubscribe = null;

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
    requestPICNotificationPermission();

    try {
        const token = await requestFCMToken();
        if (token) {
            localStorage.setItem("clusterguard_fcm_token", token);
            if (loggedInUserUid) {
                await saveFCMTokenToFirestore(token, loggedInUserUid);
            }
        }
    } catch (error) {
        console.warn("Pendaftaran FCM gagal:", error);
    }

    if (!fcmListenerUnsubscribe) {
        fcmListenerUnsubscribe = listenForForegroundMessages((payload) => {
            if (payload?.data?.type !== "sos_alert") return;
            if (!loggedInPIC) return;
            showToast(payload?.notification?.title || "Alarm SOS baru", "error");
            if (payload?.data?.sosId) {
                persistPendingSOSAlert({ sos_id: payload.data.sosId, jenis_sos: "SOS" });
            }
        });
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    // Registrasi Service Worker untuk PWA
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

        navigator.serviceWorker.register('./firebase-messaging-sw.js')
            .then((reg) => {
                console.log('Firebase Messaging Service Worker terdaftar: ', reg.scope);
            })
            .catch(err => console.log('Gagal registrasi Firebase Messaging Service Worker: ', err));
    }

    // Rendere Lucide Icons
    lucide.createIcons();
    await initializeNotificationSupport();
    
    // Status Jaringan
    monitorJaringan();
    window.addEventListener('online', async () => {
        monitorJaringan();
        await syncPICDataFromFirestore();
        syncWargaOfflineReports();
        await flushSOSStatusQueue();
    });
    window.addEventListener('offline', monitorJaringan);
    
    // Sinkronisasi PIC dari Mock Cloud ke Dexie DB
    loadAcknowledgedSOSIds();
    await syncPICDataFromFirestore();
    await sinkronisasiPICDariCloud();
    restorePICSession();
    await restoreWargaSession();
    
    // Listen to PIC updates
    listenCollection(COLLECTIONS.PIC, (data) => {
        const activePICs = data.filter(p => !p.deletedAt);
        localStorage.setItem(STORAGE_PIC_KEY, JSON.stringify(activePICs));
        sinkronisasiPICDariCloud();
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
    showInstallPrompt();
    const switcher = document.getElementById("view-switcher");
    switcher.addEventListener("click", (e) => {
        const btn = e.target.closest(".role-btn");
        if (!btn) return;
        
        document.querySelectorAll(".role-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        
        const targetView = btn.dataset.view;
        switchView(targetView);
    });

    showInstallPrompt();
    const picPhoneInput = document.getElementById("pic-login-phone");
    if (picPhoneInput) {
        picPhoneInput.addEventListener("input", (e) => {
            updatePICFirestoreStatus(e.target.value.trim());
        });
    }

    // Form Submissions
    document.getElementById("form-register-warga").addEventListener("submit", registerWarga);
    document.getElementById("form-login-warga").addEventListener("submit", loginWarga);
    document.getElementById("form-login-pic").addEventListener("submit", loginPIC);
    document.getElementById("form-login-admin").addEventListener("submit", loginAdmin);
    document.getElementById("form-manage-pic").addEventListener("submit", savePIC);

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

function switchView(role) {
    currentUserRole = role;
    document.querySelectorAll(".view-section").forEach(sec => sec.classList.remove("active"));
    
    // Stop alarm if shifting away from PIC
    if (role !== 'pic') {
        stopAlarmSound();
        document.getElementById("alarm-overlay").classList.remove("active");
    }

    if (role === 'warga') {
        document.getElementById("view-warga").classList.add("active");
        checkWargaRegistration();
    } else if (role === 'pic') {
        document.getElementById("view-pic").classList.add("active");
        if (loggedInPIC) {
            document.getElementById("pic-login").style.display = "none";
            document.getElementById("pic-console").style.display = "block";
            checkActiveSOSForPIC();
            renderPICDashboard();
        } else {
            document.getElementById("pic-login").style.display = "block";
            document.getElementById("pic-console").style.display = "none";
        }
    } else if (role === 'admin') {
        document.getElementById("view-admin").classList.add("active");
        const sessionAdmin = sessionStorage.getItem("admin_logged_in");
        if (sessionAdmin === "true") {
            document.getElementById("admin-login").style.display = "none";
            document.getElementById("admin-console").style.display = "block";
            renderAdminPICList();
            renderAdminHistory();
        } else {
            document.getElementById("admin-login").style.display = "block";
            document.getElementById("admin-console").style.display = "none";
        }
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
                const record = await getWargaTable().where('warga_id').equals(parsed.warga_id).first();
                if (record) {
                    loggedInWarga = record;
                    return record;
                }
            }
        } catch (error) {
            console.warn('Gagal membaca sesi warga:', error);
        }
    }

    return getWargaTable().toCollection().first();
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
}

async function restoreWargaSession() {
    if (wargaSessionRestoreAttempted) return;
    wargaSessionRestoreAttempted = true;

    const saved = localStorage.getItem(STORAGE_WARGA_SESSION_KEY);
    if (!saved) return;

    try {
        const session = JSON.parse(saved);
        if (!session?.warga_id) {
            clearWargaSession();
            return;
        }

        const record = await getWargaTable().where('warga_id').equals(session.warga_id).first();
        if (record) {
            loggedInWarga = record;
            currentUserRole = 'warga';
            switchView('warga');
            updateIdentityTag();
            await updateWargaSOSStatus();
        } else {
            clearWargaSession();
        }
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
    localStorage.removeItem(STORAGE_PIC_SESSION_KEY);
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
        const phoneInput = document.getElementById("pic-login-phone");
        if (phoneInput && session.phone) {
            phoneInput.value = session.phone;
        }

        currentUserRole = 'pic';
        switchView('pic');
        renderPICDashboard();
        checkActiveSOSForPIC();
        showToast("Sesi PIC dipulihkan otomatis.", "success");
    } catch (error) {
        console.error("Gagal memulihkan sesi PIC:", error);
        clearPICSession();
    }
}

function requestPICNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') return;
    if (Notification.permission !== 'default') return;
    Notification.requestPermission().catch(() => {});
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

function notifyPICAboutSOS(activeAlarm) {
    if (!activeAlarm || !loggedInPIC) return;
    persistPendingSOSAlert(activeAlarm);

    if (activeAlarm.sos_id === lastNotifiedSOSId) {
        return;
    }

    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
        return;
    }

    if (typeof window !== 'undefined' && window.location.protocol === 'http:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
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

    const showLocalNotification = () => {
        try {
            const browserNotification = new Notification(title, {
                body,
                icon: './icon-192.png',
                badge: './icon-192.png',
                tag: payload.tag,
                renotify: true,
                requireInteraction: true,
                data: payload.data
            });
            browserNotification.onclick = () => {
                window.focus();
                browserNotification.close();
            };
            lastNotifiedSOSId = activeAlarm.sos_id;
            return true;
        } catch (error) {
            console.warn('Browser notification failed:', error);
            return false;
        }
    };

    const notifyViaServiceWorker = () => {
        if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
            navigator.serviceWorker.ready.then((registration) => {
                const targetWorker = registration.active || registration.waiting || registration.installing;
                if (targetWorker) {
                    targetWorker.postMessage({ type: 'SHOW_SOS_NOTIFICATION', payload });
                } else {
                    registration.showNotification(title, payload);
                }
                lastNotifiedSOSId = activeAlarm.sos_id;
            }).catch(() => {
                showLocalNotification();
            });
            return;
        }

        showLocalNotification();
    };

    const shown = showLocalNotification();
    if (!shown) {
        notifyViaServiceWorker();
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

// ==========================================
// 6. Alur Warga (Resident Flow)
// ==========================================
function normalizePhoneNumber(value) {
    return String(value || "").replace(/[^+\d]/g, "");
}

async function syncWargaDataFromFirestore() {
    if (!navigator.onLine) return [];

    try {
        const firestoreWarga = await fetchCollection(COLLECTIONS.WARGA);
        const activeWarga = firestoreWarga.filter(w => !w.deletedAt);
        const normalizedWarga = activeWarga.map((warga) => ({
            ...warga,
            warga_id: warga.warga_id || warga.id || `warga_${Date.now()}`,
            no_hp: normalizePhoneNumber(warga.no_hp || "")
        }));

        localStorage.setItem(STORAGE_WARGA_KEY, JSON.stringify(normalizedWarga));

        await getWargaTable().clear();
        for (const warga of normalizedWarga) {
            await getWargaTable().put(warga);
        }

        return normalizedWarga;
    } catch (err) {
        console.error("Gagal sinkronisasi warga dari Firestore:", err);
        return [];
    }
}

async function checkWargaRegistration() {
    const dataWarga = await getActiveWargaRecord();
    if (!dataWarga) {
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

    try {
        if (navigator.onLine) {
            await setDoc(doc(db, COLLECTIONS.WARGA, warga_id), payload);
        }
    } catch (err) {
        console.error("Gagal menyimpan warga ke Firestore:", err);
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

let deferredInstallPrompt = null;

function showInstallPrompt() {
    const installBtn = document.getElementById("install-app-btn");
    if (!installBtn) return;

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isAndroid = /Android/.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

    if (isStandalone) {
        installBtn.style.display = 'none';
        return;
    }

    if (isIOS) {
        installBtn.innerHTML = '<i data-lucide="share-2"></i> Tambah ke Home Screen';
        installBtn.style.display = 'inline-flex';
        installBtn.onclick = () => {
            alert('Di iPhone/iPad, buka menu Share lalu pilih “Add to Home Screen”.');
        };
        return;
    }

    installBtn.style.display = 'inline-flex';
    installBtn.innerHTML = '<i data-lucide="download"></i> Install App';
    installBtn.onclick = async () => {
        if (deferredInstallPrompt) {
            deferredInstallPrompt.prompt();
            const { outcome } = await deferredInstallPrompt.userChoice;
            if (outcome === 'accepted') {
                showToast('Installasi dimulai.', 'success');
            }
            deferredInstallPrompt = null;
            return;
        }

        if (isAndroid && /Chrome|Edg|Chromium/.test(navigator.userAgent)) {
            showToast('Buka menu browser lalu pilih Install app / Tambahkan ke layar utama.', 'info');
            return;
        }

        showToast('Installasi belum tersedia di browser ini. Coba Chrome/Edge di Android atau Safari/iOS.', 'info');
    };
}

window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    showInstallPrompt();
});

window.addEventListener('appinstalled', () => {
    const installBtn = document.getElementById('install-app-btn');
    if (installBtn) installBtn.style.display = 'none';
});

async function loginWarga(e) {
    e.preventDefault();
    const no_hp = document.getElementById("login-no-hp").value.trim();
    const password = document.getElementById("login-password").value;

    await syncWargaDataFromFirestore();
    const wargaList = await getWargaTable().toArray();
    const normalizedInput = normalizePhoneNumber(no_hp);
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
    document.getElementById("warga-login").style.display = "none";
    document.getElementById("warga-console").style.display = "block";
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
        try {
            const storedToken = localStorage.getItem('clusterguard_fcm_token');
            if (storedToken) {
                const pushUrl = window.__CLUSTERGUARD_PUSH_URL__ ||
                    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
                        ? 'http://127.0.0.1:10001/push'
                        : 'https://clusterguard-push.onrender.com/push');
                await fetch(pushUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: `SOS ${kategori}`,
                        body: `${dataWarga.nama} di ${dataWarga.no_rumah}`,
                        token: storedToken,
                        tag: `clusterguard-sos-${sos_id}`,
                        url: '/'
                    })
                });
            }
        } catch (pushError) {
            console.warn('Gagal mengirim push SOS:', pushError);
        }
        jalankanPanggilanSeluler();
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
// 7. Alur PIC (Emergency Responder Flow)
// ==========================================
async function syncPICDataFromFirestore() {
    if (!navigator.onLine) return;

    try {
        const firestorePICs = await fetchCollection(COLLECTIONS.PIC);
        const activePICs = firestorePICs.filter(p => !p.deletedAt);
        localStorage.setItem(STORAGE_PIC_KEY, JSON.stringify(activePICs));
        await sinkronisasiPICDariCloud();
    } catch (err) {
        console.error("Gagal sinkronisasi PIC dari Firestore:", err);
    }
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
    loggedInPIC = null;
    loggedInUserUid = null;
    clearPICSession();
    stopAlarmSound();
    document.getElementById("alarm-overlay").classList.remove("active");
    document.getElementById("pic-console").style.display = "none";
    document.getElementById("pic-login").style.display = "block";
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
function loginAdmin(e) {
    e.preventDefault();
    const user = document.getElementById("admin-username").value.trim();
    const pass = document.getElementById("admin-password").value;

    if (user === "super admin" && pass === "super4dM1n*$") {
        sessionStorage.setItem("admin_logged_in", "true");
        document.getElementById("admin-login").style.display = "none";
        document.getElementById("admin-console").style.display = "block";
        showToast("Login Super Admin Berhasil!", "success");
        updateIdentityTag();
        renderAdminPICList();
        renderAdminHistory();
    } else {
        alert("Kredensial Super Admin salah.");
    }
}

function logoutAdmin() {
    sessionStorage.removeItem("admin_logged_in");
    document.getElementById("admin-console").style.display = "none";
    document.getElementById("admin-login").style.display = "block";
    updateIdentityTag();
}

function switchAdminTab(tab) {
    currentAdminTab = tab;
    document.getElementById("btn-tab-pic").classList.toggle("active", tab === 'pic');
    document.getElementById("btn-tab-history").classList.toggle("active", tab === 'history');

    document.getElementById("admin-tab-pic-content").style.display = tab === 'pic' ? 'block' : 'none';
    document.getElementById("admin-tab-history-content").style.display = tab === 'history' ? 'block' : 'none';
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

    const generatedId = editingPICId || "pic_" + Date.now();
    const picData = { pic_id: generatedId, nama, no_hp, jabatan, no_rumah, urutan, password };

    try {
        const uid = loggedInUserUid || null;
        if (editingPICId) {
            await updateDocument(COLLECTIONS.PIC, generatedId, picData, uid);
        } else {
            const authUser = await ensurePICAuthUser({ phone: no_hp, password });
            const now = new Date().toISOString();
            const firestorePicData = {
                ...picData,
                firebaseUid: authUser.uid,
                uuid: crypto.randomUUID(),
                createdAt: now,
                updatedAt: now,
                deletedAt: null,
                deletedBy: null,
                updatedBy: uid || null
            };
            // Store profile under the Firebase auth UID so PIC login can read it later
            await setDoc(doc(db, COLLECTIONS.PIC, authUser.uid), firestorePicData);
        }
        resetPICForm();

        // Update mock local storage immediately so the admin table refreshes without reload
        const currentLocalPICs = JSON.parse(localStorage.getItem(STORAGE_PIC_KEY)) || [];
        const existingIndex = currentLocalPICs.findIndex(p => p.pic_id === generatedId);
        if (existingIndex >= 0) {
            currentLocalPICs[existingIndex] = picData;
        } else {
            currentLocalPICs.push(picData);
        }
        localStorage.setItem(STORAGE_PIC_KEY, JSON.stringify(currentLocalPICs));
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
    const cloudPICs = (JSON.parse(localStorage.getItem(STORAGE_PIC_KEY)) || []).filter(p => !p.deletedAt);
    // Urutkan berdasarkan urutan prioritas panggilan
    cloudPICs.sort((a,b) => a.urutan - b.urutan);

    const container = document.getElementById("admin-pic-table-rows");
    if (cloudPICs.length === 0) {
        container.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Belum ada data PIC terdaftar.</td></tr>`;
        return;
    }

    container.innerHTML = cloudPICs.map(p => `
        <tr>
            <td><strong style="color: var(--color-medis);">#${p.urutan}</strong></td>
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
    container.querySelectorAll('button[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', () => editPIC(btn.dataset.picId));
    });
    container.querySelectorAll('button[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', () => deletePIC(btn.dataset.picId));
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
    
    // Soft delete directly using pic_id as document ID
    try {
        const uid = loggedInUserUid || null;
        await softDeleteDocument(COLLECTIONS.PIC, picId, uid);
    } catch (e) {
        console.error('Error soft deleting PIC in Firestore:', e);
        showToast('Gagal menghapus PIC di cloud.', 'error');
        return;
    }
    
    // Update local mock storage to keep UI consistent (remove from list)
    const cloudPICs = JSON.parse(localStorage.getItem(STORAGE_PIC_KEY)) || [];
    const updated = cloudPICs.filter(p => p.pic_id !== picId);
    localStorage.setItem(STORAGE_PIC_KEY, JSON.stringify(updated));
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
window.nextOnboardingStep = nextOnboardingStep;
