const STORAGE_PIC_KEY = "clusterguard_mock_pic";
const STORAGE_WARGA_KEY = "clusterguard_mock_warga";
const STORAGE_SOS_KEY = "clusterguard_mock_laporan_sos";

export const COLLECTIONS = {
  WARGA: "warga",
  PIC: "pic",
  SOS: "sos"
};

export const auth = null;
export const db = null;

function getStorageValue(key) {
  if (typeof localStorage === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch (error) {
    return null;
  }
}

function setStorageValue(key, value) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

function getCollectionData(collectionName) {
  switch (collectionName) {
    case COLLECTIONS.PIC:
      return Array.isArray(getStorageValue(STORAGE_PIC_KEY)) ? getStorageValue(STORAGE_PIC_KEY) : [];
    case COLLECTIONS.WARGA:
      return Array.isArray(getStorageValue(STORAGE_WARGA_KEY)) ? getStorageValue(STORAGE_WARGA_KEY) : [];
    case COLLECTIONS.SOS:
      return Array.isArray(getStorageValue(STORAGE_SOS_KEY)) ? getStorageValue(STORAGE_SOS_KEY) : [];
    default:
      return [];
  }
}

function saveCollectionData(collectionName, data) {
  switch (collectionName) {
    case COLLECTIONS.PIC:
      setStorageValue(STORAGE_PIC_KEY, data);
      break;
    case COLLECTIONS.WARGA:
      setStorageValue(STORAGE_WARGA_KEY, data);
      break;
    case COLLECTIONS.SOS:
      setStorageValue(STORAGE_SOS_KEY, data);
      break;
  }
}

export function normalizePhoneNumber(phone) {
  if (!phone) return "";
  return String(phone).replace(/[^+\d]/g, "");
}

async function getFirebaseAdapter() {
  const env = (typeof window !== "undefined" && window.env && typeof window.env === "object") ? window.env : {};
  const hasRealConfig = Object.values({
    apiKey: env.VITE_FIREBASE_API_KEY || "",
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "",
    projectId: env.VITE_FIREBASE_PROJECT_ID || "",
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
    appId: env.VITE_FIREBASE_APP_ID || "",
    measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || ""
  }).every((value) => typeof value === "string" && value && !value.startsWith("YOUR_"));

  if (!hasRealConfig) return null;
  try {
    return await import('./firebase.js');
  } catch (error) {
    console.warn('Firebase adapter unavailable, using local-only mode:', error);
    return null;
  }
}

function toDocRecord(collectionName, item, fallbackId = null) {
  if (!item) return null;
  const normalized = { ...item };
  const id = normalized.id || normalized.pic_id || normalized.warga_id || normalized.sos_id || fallbackId || null;
  if (!normalized.pic_id && collectionName === COLLECTIONS.PIC && id) {
    normalized.pic_id = id;
  }
  if (!normalized.warga_id && collectionName === COLLECTIONS.WARGA && id) {
    normalized.warga_id = id;
  }
  if (!normalized.sos_id && collectionName === COLLECTIONS.SOS && id) {
    normalized.sos_id = id;
  }
  return { id, ...normalized };
}

function getRecordKey(collectionName, item) {
  if (!item) return "";
  if (collectionName === COLLECTIONS.PIC) {
    return normalizePhoneNumber(item?.no_hp || "") || item?.pic_id || item?.id || "";
  }
  if (collectionName === COLLECTIONS.WARGA) {
    return normalizePhoneNumber(item?.no_hp || "") || item?.warga_id || item?.id || "";
  }
  return item?.sos_id || item?.id || "";
}

function chooseLatestRecord(a, b) {
  if (!a) return b;
  if (!b) return a;
  const aUpdated = Date.parse(a.updatedAt || a.createdAt || a.dibuat_pada || 0);
  const bUpdated = Date.parse(b.updatedAt || b.createdAt || b.dibuat_pada || 0);
  if (Number.isNaN(aUpdated) && Number.isNaN(bUpdated)) return a;
  if (Number.isNaN(aUpdated)) return b;
  if (Number.isNaN(bUpdated)) return a;
  return aUpdated >= bUpdated ? a : b;
}

function mergeCollectionItems(collectionName, localItems, remoteItems) {
  const merged = new Map();
  const allItems = [...(Array.isArray(localItems) ? localItems : []), ...(Array.isArray(remoteItems) ? remoteItems : [])];
  allItems.forEach((item, index) => {
    const key = getRecordKey(collectionName, item);
    if (!key) {
      merged.set(`fallback_${index}`, item);
      return;
    }
    const existing = merged.get(key);
    merged.set(key, chooseLatestRecord(existing, item));
  });
  return Array.from(merged.values()).map((item) => toDocRecord(collectionName, item));
}

export async function signInPIC({ phone, password }) {
  const normalizedPhone = normalizePhoneNumber(phone);
  const localPics = getCollectionData(COLLECTIONS.PIC);
  const localMatch = localPics.find((item) => {
    const itemPhone = normalizePhoneNumber(item?.no_hp || "");
    return !item?.deletedAt && itemPhone === normalizedPhone && String(item?.password || "") === String(password);
  });

  if (localMatch) {
    const profile = { id: localMatch.pic_id || localMatch.id || normalizedPhone, ...localMatch };
    return {
      authUser: { uid: profile.id, email: `${normalizedPhone}@pic.local` },
      profile
    };
  }

  const firebaseAdapter = await getFirebaseAdapter();
  if (firebaseAdapter?.signInPIC) {
    return firebaseAdapter.signInPIC({ phone, password });
  }

  throw new Error('PIC not found');
}

export async function ensurePICAuthUser({ phone, password }) {
  const firebaseAdapter = await getFirebaseAdapter();
  if (firebaseAdapter?.ensurePICAuthUser) {
    return firebaseAdapter.ensurePICAuthUser({ phone, password });
  }
  return { uid: `local_${normalizePhoneNumber(phone)}_${Date.now()}` };
}

export async function addDocument(collectionName, data, uid = null) {
  const items = getCollectionData(collectionName);
  const next = { ...(data || {}), id: data?.id || `${collectionName}_${Date.now()}` };
  items.push(next);
  saveCollectionData(collectionName, items);
  const firebaseAdapter = await getFirebaseAdapter();
  if (firebaseAdapter?.addDocument) {
    try {
      await firebaseAdapter.addDocument(collectionName, next, uid);
    } catch (error) {
      console.warn("Gagal menulis dokumen ke Firestore:", error);
    }
  }
  return next.id;
}

export async function updateDocument(collectionName, docId, changes, uid = null) {
  const items = getCollectionData(collectionName);
  const index = items.findIndex((item) => item.id === docId || item.pic_id === docId || item.warga_id === docId || item.sos_id === docId);
  if (index >= 0) {
    items[index] = { ...items[index], ...changes, id: items[index].id || docId };
    saveCollectionData(collectionName, items);
  }
  const firebaseAdapter = await getFirebaseAdapter();
  if (firebaseAdapter?.updateDocument) {
    try {
      await firebaseAdapter.updateDocument(collectionName, docId, changes, uid);
    } catch (error) {
      console.warn("Gagal memperbarui dokumen di Firestore:", error);
    }
  }
}

export async function softDeleteDocument(collectionName, docId, uid = null) {
  const items = getCollectionData(collectionName);
  const index = items.findIndex((item) => item.id === docId || item.pic_id === docId || item.warga_id === docId || item.sos_id === docId);
  if (index >= 0) {
    items[index] = { ...items[index], deletedAt: new Date().toISOString(), deletedBy: uid || null };
    saveCollectionData(collectionName, items);
  }
  const firebaseAdapter = await getFirebaseAdapter();
  if (firebaseAdapter?.softDeleteDocument) {
    try {
      await firebaseAdapter.softDeleteDocument(collectionName, docId, uid);
    } catch (error) {
      console.warn("Gagal soft delete dokumen di Firestore:", error);
    }
  }
}

export async function queryDocumentsByField(collectionName, field, value) {
  const localItems = getCollectionData(collectionName);
  const firebaseAdapter = await getFirebaseAdapter();
  if (firebaseAdapter?.queryDocumentsByField) {
    try {
      const remoteItems = await firebaseAdapter.queryDocumentsByField(collectionName, field, value);
      const merged = mergeCollectionItems(collectionName, localItems, remoteItems);
      saveCollectionData(collectionName, merged);
      return merged.filter((item) => item?.[field] === value);
    } catch (error) {
      console.warn("Gagal query Firestore, memakai data lokal:", error);
    }
  }
  return localItems.filter((item) => item?.[field] === value).map((item) => toDocRecord(collectionName, item));
}

export async function upsertWargaToFirestore(wargaData) {
  const items = getCollectionData(COLLECTIONS.WARGA);
  const normalizedPhone = normalizePhoneNumber(wargaData?.no_hp || "");
  const existingIndex = items.findIndex((item) => normalizePhoneNumber(item?.no_hp || "") === normalizedPhone);
  const payload = { ...wargaData, no_hp: normalizedPhone, id: wargaData?.warga_id || wargaData?.id || `warga_${Date.now()}` };
  if (existingIndex >= 0) {
    items[existingIndex] = { ...items[existingIndex], ...payload };
  } else {
    items.push(payload);
  }
  saveCollectionData(COLLECTIONS.WARGA, items);
  const firebaseAdapter = await getFirebaseAdapter();
  if (firebaseAdapter?.upsertWargaToFirestore) {
    try {
      return await firebaseAdapter.upsertWargaToFirestore(payload);
    } catch (error) {
      console.warn("Gagal menulis warga ke Firestore:", error);
    }
  }
  return payload;
}

export async function syncAllWargaFromFirestore(localTable) {
  if (!localTable) return [];
  const localRows = await localTable.toArray();
  const items = getCollectionData(COLLECTIONS.WARGA);
  for (const row of localRows) {
    const merged = await upsertWargaToFirestore(row);
    if (localTable?.put) {
      await localTable.put(merged);
    }
  }
  return items;
}

export function listenCollection(collectionName, callback) {
  const emitLocal = () => {
    const docs = getCollectionData(collectionName).map((item) => toDocRecord(collectionName, item));
    callback(docs);
  };

  emitLocal();

  void (async () => {
    try {
      const firebaseAdapter = await getFirebaseAdapter();
      if (firebaseAdapter?.listenCollection) {
        return firebaseAdapter.listenCollection(collectionName, (docs) => {
          const normalizedDocs = (Array.isArray(docs) ? docs : []).map((item) => toDocRecord(collectionName, item));
          saveCollectionData(collectionName, normalizedDocs);
          callback(normalizedDocs);
        });
      }

      const remoteDocs = await fetchCollection(collectionName);
      const docs = (Array.isArray(remoteDocs) ? remoteDocs : []).filter(Boolean);
      saveCollectionData(collectionName, docs);
      callback(docs);
    } catch (error) {
      console.warn("Gagal memuat data real-time dari Firestore:", error);
      emitLocal();
    }
  })();

  return () => {};
}

export async function getDocument(collectionName, docId) {
  const items = getCollectionData(collectionName);
  const item = items.find((entry) => entry.id === docId || entry.pic_id === docId || entry.warga_id === docId || entry.sos_id === docId);
  return item ? toDocRecord(collectionName, item) : null;
}

export async function fetchCollection(collectionName) {
  const localItems = getCollectionData(collectionName);
  const firebaseAdapter = await getFirebaseAdapter();
  if (firebaseAdapter?.fetchCollection) {
    try {
      const remoteItems = await firebaseAdapter.fetchCollection(collectionName);
      const merged = mergeCollectionItems(collectionName, localItems, remoteItems);
      const cleaned = merged.filter((item) => !item?.deletedAt);
      saveCollectionData(collectionName, cleaned);
      return cleaned;
    } catch (error) {
      console.warn("Gagal mengambil data dari Firestore, memakai data lokal:", error);
    }
  }
  const items = localItems.filter((item) => !item?.deletedAt);
  return items.map((item) => toDocRecord(collectionName, item));
}

export function doc(_db, collectionName, id) {
  return { collectionName, id };
}

function toFirestoreDocRef(docRef, collectionName, id) {
  if (!docRef) return null;
  if (typeof docRef.path === "string" && typeof docRef.id === "string") {
    return docRef;
  }
  if (typeof docRef.collectionName === "string" && docRef.id) {
    return { collectionName: docRef.collectionName, id: docRef.id };
  }
  if (typeof collectionName === "string" && id) {
    return { collectionName, id };
  }
  return docRef;
}

export async function setDoc(docRef, payload, options = {}) {
  const collectionName = docRef?.collectionName || docRef?.name;
  const id = docRef?.id;
  const items = getCollectionData(collectionName);
  const index = items.findIndex((entry) => entry.id === id || entry.pic_id === id || entry.warga_id === id || entry.sos_id === id);
  const nextItem = { ...(items[index] || {}), ...payload, id: id || payload?.id || `${collectionName}_${Date.now()}` };
  if (index >= 0) {
    items[index] = nextItem;
  } else {
    items.push(nextItem);
  }
  saveCollectionData(collectionName, items);
  const firebaseAdapter = await getFirebaseAdapter();
  if (firebaseAdapter?.setDoc && typeof firebaseAdapter.doc === "function" && firebaseAdapter.db && collectionName && id) {
    try {
      const firestoreDocRef = firebaseAdapter.doc(firebaseAdapter.db, collectionName, id);
      return await firebaseAdapter.setDoc(firestoreDocRef, payload, options);
    } catch (error) {
      console.warn("Gagal menulis dokumen ke Firestore:", error);
    }
  }
  if (firebaseAdapter?.setDoc && typeof firebaseAdapter.doc === "function" && firebaseAdapter.db && typeof docRef?.collectionName === "string") {
    try {
      const firestoreDocRef = firebaseAdapter.doc(firebaseAdapter.db, docRef.collectionName, docRef.id);
      return await firebaseAdapter.setDoc(firestoreDocRef, payload, options);
    } catch (error) {
      console.warn("Gagal menulis dokumen ke Firestore:", error);
    }
  }
  return nextItem;
}

