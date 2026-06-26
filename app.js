// ==========================================
// 1. Database Lokal (Dexie.js)
// ==========================================
const localDb = new Dexie("DaruratClusterDB");
localDb.version(1).stores({
    warga: 'warga_id, nama, no_hp, no_rumah',
    pic: 'pic_id, nama, no_hp, jabatan, no_rumah, urutan, password'
});

function getWargaTable() {
    return localDb.warga || localDb.table('warga');
}

function getPicTable() {
    return localDb.pic || localDb.table('pic');
}

import { auth, db, signInPIC, addDocument, updateDocument, listenCollection, softDeleteDocument, setDoc, doc, COLLECTIONS } from "./firebase.js";
// ==========================================
// 2. State & Konfigurasi Global
// ==========================================
let currentUserRole = 'warga'; // warga, pic, admin
let isOnline = navigator.onLine;

// State Warga
let antreanPIC = [];
let indeksPICAktif = 0;
let currentSOSLaporanId = null;

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

// ==========================================
// 3. Integrasi Cloud (Mock & Firebase Fallback)
// ==========================================
// Kunci penyimpanan LocalStorage untuk simulasi Real-time Cloud
const STORAGE_SOS_KEY = "clusterguard_mock_laporan_sos";
const STORAGE_PIC_KEY = "clusterguard_mock_pic";
const STORAGE_WARGA_KEY = "clusterguard_mock_warga";

// Global variable to hold SOS documents
let cloudSOS = [];

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
    return JSON.parse(localStorage.getItem(STORAGE_SOS_KEY)) || [];
}

// Helper untuk menulis ke Mock Cloud & memicu event sinkronisasi tab
function setMockCloudSOS(data) {
    localStorage.setItem(STORAGE_SOS_KEY, JSON.stringify(data));
    // Trigger storage event manually for same-tab updates
    window.dispatchEvent(new Event('storage'));
}

// Helper untuk sinkronisasi Database Lokal PIC dari Cloud
async function sinkronisasiPICDariCloud() {
    const cloudPICs = JSON.parse(localStorage.getItem(STORAGE_PIC_KEY)) || [];
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
document.addEventListener("DOMContentLoaded", async () => {
    // Registrasi Service Worker untuk PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker terdaftar: ', reg.scope))
            .catch(err => console.log('Gagal registrasi Service Worker: ', err));
    }

    // Rendere Lucide Icons
    lucide.createIcons();
    
    // Status Jaringan
    monitorJaringan();
    window.addEventListener('online', () => { monitorJaringan(); syncWargaOfflineReports(); });
    window.addEventListener('offline', monitorJaringan);
    
    // Sinkronisasi PIC dari Mock Cloud ke Dexie DB
    await sinkronisasiPICDariCloud();
    
    // Listen to PIC updates
    listenCollection(COLLECTIONS.PIC, (data) => {
        localStorage.setItem(STORAGE_PIC_KEY, JSON.stringify(data));
        sinkronisasiPICDariCloud();
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

    // Form Submissions
    document.getElementById("form-register-warga").addEventListener("submit", registerWarga);
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
        if (currentUserRole === 'pic' && loggedInPIC) {
            checkActiveSOSForPIC();
        }
    }, 2000);
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
        getWargaTable().toCollection().first().then(warga => {
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
async function checkWargaRegistration() {
    const dataWarga = await getWargaTable().toCollection().first();
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
    
    const warga_id = "warga_" + Date.now();
    const dataWarga = { warga_id, nama, no_hp, no_rumah, dibuat_pada: new Date().toISOString() };
    
    await getWargaTable().put(dataWarga);
    
    // Sync to Cloud Warga List
    const cloudWarga = JSON.parse(localStorage.getItem(STORAGE_WARGA_KEY)) || [];
    cloudWarga.push(dataWarga);
    localStorage.setItem(STORAGE_WARGA_KEY, JSON.stringify(cloudWarga));
    
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
// Handler SOS Warga
async function triggerSOS(kategori) {
    const dataWarga = await getWargaTable().toCollection().first();
    antreanPIC = await getPicTable().orderBy('urutan').toArray();
    indeksPICAktif = 0;

    if (antreanPIC.length === 0) {
        alert("Peringatan: Kontak darurat kosong di memori HP. Hubungi Admin.");
        return;
    }

    const sos_id = "sos_" + Date.now();
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

    // Simpan ke offline sync queue jika offline, jika online kirim langsung ke cloud serta panggil fungsi Firebase Cloud
    if (isOnline) {
        // Add SOS report to Firestore
        const uid = loggedInUserUid || null;
        await addDocument(COLLECTIONS.SOS, laporan, uid);
    } else {
        // Offline queue remains as before
        const offlineQueue = JSON.parse(localStorage.getItem("offline_sos_queue")) || [];
        offlineQueue.push(laporan);
        localStorage.setItem("offline_sos_queue", JSON.stringify(offlineQueue));
        showToast("Mode Offline: Panggilan darurat lokal disiapkan.", "warning");
    }

    // Perbarui status tampilan
    updateWargaSOSStatus();
    // Jalankan panggilan seluler
    jalankanPanggilanSeluler();
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
    const dataWarga = await getWargaTable().toCollection().first();
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
async function loginPIC(e) {
    e.preventDefault();
    const phone = document.getElementById("pic-login-phone").value.trim();
    const password = document.getElementById("pic-login-password").value;
    try {
        const { authUser, profile } = await signInPIC({ phone, password });
        loggedInPIC = profile;
        loggedInUserUid = authUser.uid;
        document.getElementById("pic-login").style.display = "none";
        document.getElementById("pic-console").style.display = "block";
        showToast(`Selamat datang, ${profile.nama}!`, "success");
        updateIdentityTag();
        renderPICDashboard();
        checkActiveSOSForPIC();
    } catch (err) {
        console.error(err);
        alert("Nomor HP atau password PIC salah.");
    }
}

function logoutPIC() {
    loggedInPIC = null;
    stopAlarmSound();
    document.getElementById("alarm-overlay").classList.remove("active");
    document.getElementById("pic-console").style.display = "none";
    document.getElementById("pic-login").style.display = "block";
    updateIdentityTag();
}

// Cek Laporan Darurat Aktif Khusus PIC
function checkActiveSOSForPIC() {
    if (!loggedInPIC) return;
    const cloudSOS = getMockCloudSOS();
    
    // Cari apakah ada laporan berstatus "Mencari Bantuan"
    const activeAlarm = cloudSOS.find(l => l.status === "Mencari Bantuan");
    
    const alarmOverlay = document.getElementById("alarm-overlay");
    
    if (activeAlarm) {
        // Tampilkan info alert
        document.getElementById("alarm-category").innerText = activeAlarm.jenis_sos;
        document.getElementById("alarm-reporter").innerText = activeAlarm.nama_pelapor;
        document.getElementById("alarm-home").innerText = activeAlarm.no_rumah;
        document.getElementById("alarm-phone").innerText = activeAlarm.no_hp;
        document.getElementById("alarm-time").innerText = new Date(activeAlarm.waktu_kejadian).toLocaleTimeString();
        
        // Simpan id laporan aktif
        alarmOverlay.dataset.sosId = activeAlarm.sos_id;
        
        // Picu alarm visual & audio
        alarmOverlay.classList.add("active");
        startAlarmSound();
    } else {
        alarmOverlay.classList.remove("active");
        stopAlarmSound();
    }
}

// Konfirmasi Laporan SOS oleh PIC
function picAcceptSOS() {
    const alarmOverlay = document.getElementById("alarm-overlay");
    const sosId = alarmOverlay.dataset.sosId;
    if (!sosId || !loggedInPIC) return;

    let cloudSOS = getMockCloudSOS();
    const laporanIdx = cloudSOS.findIndex(l => l.sos_id === sosId);

    if (laporanIdx !== -1) {
        cloudSOS[laporanIdx].status = "Dalam Perjalanan";
        cloudSOS[laporanIdx].pic_menangani = loggedInPIC.nama;
        setMockCloudSOS(cloudSOS);
    }

    // Hentikan alarm
    stopAlarmSound();
    alarmOverlay.classList.remove("active");
    showToast("SOS Berhasil diterima! Laporan status diperbarui.", "success");
    renderPICDashboard();
}

// PIC Selesaikan Laporan Kejadian
function resolveSOS(sosId) {
    let cloudSOS = getMockCloudSOS();
    const laporanIdx = cloudSOS.findIndex(l => l.sos_id === sosId);

    if (laporanIdx !== -1) {
        cloudSOS[laporanIdx].status = "Selesai";
        cloudSOS[laporanIdx].waktu_selesai = new Date().toISOString();
        setMockCloudSOS(cloudSOS);
        showToast("Laporan dinyatakan Selesai.", "success");
        renderPICDashboard();
    }
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
            // Create document with explicit ID matching pic_id
            await setDoc(doc(db, COLLECTIONS.PIC, generatedId), picData);
        }
        resetPICForm();
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
    const cloudPICs = JSON.parse(localStorage.getItem(STORAGE_PIC_KEY)) || [];
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
                    <button onclick="editPIC('${p.pic_id}')" class="btn btn-secondary" style="width: auto; padding: 0.25rem 0.5rem; font-size: 0.8rem; border-radius: 6px;">
                        <i data-lucide="edit-3" style="width: 14px; height: 14px;"></i>
                    </button>
                    <button onclick="deletePIC('${p.pic_id}')" class="btn btn-secondary" style="width: auto; padding: 0.25rem 0.5rem; font-size: 0.8rem; border-radius: 6px; background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.2); color: var(--color-medis);">
                        <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
    lucide.createIcons();
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

// Expose functions to global scope for inline onclick handlers
window.editPIC = editPIC;
window.deletePIC = deletePIC;

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
