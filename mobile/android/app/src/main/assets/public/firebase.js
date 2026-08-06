// firebase.js – Firebase initialization and helper functions for ClusterGuard PWA

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore, collection, addDoc, doc, setDoc, updateDoc, getDoc, getDocs, onSnapshot, enableIndexedDbPersistence, serverTimestamp, query, where } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging.js";

// -----------------------------------------------------------------------------
// Firebase configuration – replace with your project credentials (already provided)
// -----------------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyCEZZ_qCpzWEMLhaDfj0XJWsVVwXRDRwVM",
  authDomain: "clusterg-1076f.firebaseapp.com",
  projectId: "clusterg-1076f",
  storageBucket: "clusterg-1076f.firebasestorage.app",
  messagingSenderId: "1095467329865",
  appId: "1:1095467329865:web:a5ee05ac81b38b27f69298",
  measurementId: "G-7DW587FKQ2"
};

export const VAPID_PUBLIC_KEY = "BNgVw_AWpL-lCuQZ2OLoE2xKoebQ3k5LfKpUngZUM9_Fl59TZVn0Ou2PIBLSi3kF-LuZR1yei-pito45q0mK25M";

// Initialize Firebase app
const app = initializeApp(firebaseConfig);

// Initialize Auth, Firestore, and Messaging instances
export const auth = getAuth(app);
export const db = getFirestore(app);
export const messaging = getMessaging(app);

// Enable offline persistence for Firestore (offline‑first)
enableIndexedDbPersistence(db).catch((err) => {
  console.warn("Firestore persistence could not be enabled:", err);
});

// -----------------------------------------------------------------------------
// Helper: generate synthetic email for PIC authentication (phone number based)
// -----------------------------------------------------------------------------
function syntheticEmailFromPhone(phone) {
  // Ensure phone contains only digits and optional leading +
  const cleaned = phone.replace(/[^+\d]/g, "");
  return `${cleaned}@pic.local`;
}

export async function requestFCMToken({ vapidKey = null } = {}) {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return null;
  }

  if (Notification.permission === "denied") {
    return null;
  }

  if (Notification.permission !== "granted") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return null;
    }
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const options = { serviceWorkerRegistration: registration };
    const resolvedVapidKey = vapidKey || VAPID_PUBLIC_KEY;
    if (resolvedVapidKey && resolvedVapidKey !== "PASTE_YOUR_VAPID_PUBLIC_KEY_HERE") {
      options.vapidKey = resolvedVapidKey;
    }
    return await getToken(messaging, options);
  } catch (error) {
    console.warn("FCM token tidak dapat diminta:", error);
    return null;
  }
}

export function listenForForegroundMessages(callback) {
  return onMessage(messaging, callback);
}

export async function saveFCMTokenToFirestore(token, uid) {
  if (!token || !uid) return null;
  const tokenSuffix = token.slice(-24).replace(/[^a-zA-Z0-9_-]/g, '');
  const tokenDocId = `${uid}_${tokenSuffix || 'device'}`;
  const tokenDocRef = doc(db, "fcmTokens", tokenDocId);
  const payload = {
    uid,
    token,
    tokenDocId,
    updatedAt: new Date().toISOString(),
    platform: typeof navigator !== "undefined" ? navigator.userAgent : "unknown"
  };
  await setDoc(tokenDocRef, payload, { merge: true });
  return token;
}

// -----------------------------------------------------------------------------
// Auth helpers
// -----------------------------------------------------------------------------
/**
 * Create a new user with phone (synthetic email) and password.
 * Also stores additional PIC data in the "pic" collection.
 */
export async function createPICUser({ phone, password, nama, no_rumah, jabatan, urutan }) {
  const email = syntheticEmailFromPhone(phone);
  const userCred = await createUserWithEmailAndPassword(auth, email, password);
  const uid = userCred.user.uid;
  const picDoc = {
    pic_id: uid,
    nama,
    no_hp: phone,
    jabatan,
    no_rumah: no_rumah || "-",
    urutan: Number(urutan) || 0,
    password,
    // Audit fields
    uuid: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    deletedBy: null,
    updatedBy: uid
  };
  await setDoc(doc(db, "pic", uid), picDoc);
  return userCred.user;
}

/**
 * Sign‑in a PIC using phone number and password.
 */
export async function signInPIC({ phone, password }) {
  const email = syntheticEmailFromPhone(phone);

  try {
    const userCred = await signInWithEmailAndPassword(auth, email, password);
    let picSnap = await getDoc(doc(db, "pic", userCred.user.uid));

    if (!picSnap.exists()) {
      const picQuery = query(collection(db, "pic"), where("no_hp", "==", phone));
      const querySnap = await getDocs(picQuery);
      if (!querySnap.empty) {
        picSnap = querySnap.docs[0];
      }
    }

    const profile = picSnap?.exists() ? { id: picSnap.id, ...picSnap.data() } : null;
    return { authUser: userCred.user, profile };
  } catch (error) {
    if (error?.code === 'auth/configuration-not-found') {
      const picQuery = query(collection(db, "pic"), where("no_hp", "==", phone));
      const querySnap = await getDocs(picQuery);
      if (!querySnap.empty) {
        const profileDoc = querySnap.docs[0];
        const profile = { id: profileDoc.id, ...profileDoc.data() };
        if (profile.password === password) {
          return { authUser: { uid: profileDoc.id, email }, profile };
        }
      }
      throw new Error('PIC not found');
    }
    throw error;
  }
}

export async function ensurePICAuthUser({ phone, password }) {
  const email = syntheticEmailFromPhone(phone);
  try {
    const userCred = await createUserWithEmailAndPassword(auth, email, password);
    return userCred.user;
  } catch (error) {
    if (error.code === 'auth/email-already-in-use') {
      const userCred = await signInWithEmailAndPassword(auth, email, password);
      return userCred.user;
    }
    throw error;
  }
}

// -----------------------------------------------------------------------------
// Generic Firestore CRUD helpers (with audit fields)
// -----------------------------------------------------------------------------
function addAuditFields(data, uid) {
  const now = new Date().toISOString();
  return Object.assign({
    uuid: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
    updatedBy: uid || null,
    // Use server timestamp for any explicit timestamp fields if needed
    // createdAt: serverTimestamp(), // alternative when you prefer server time
  }, data);
}

/** Add a document to a collection with audit fields */
export async function addDocument(collectionName, data, uid = null) {
  const colRef = collection(db, collectionName);
  const payload = addAuditFields(data, uid);
  const docRef = await addDoc(colRef, payload);
  return docRef.id;
}

/** Update an existing document – also updates audit fields */
export async function updateDocument(collectionName, docId, changes, uid = null) {
  const docRef = doc(db, collectionName, docId);
  const payload = Object.assign({
    updatedAt: new Date().toISOString(),
    updatedBy: uid || null,
  }, changes);
  await updateDoc(docRef, payload);
}

/** Delete (soft delete) a document */
export async function softDeleteDocument(collectionName, docId, uid = null) {
  const docRef = doc(db, collectionName, docId);
  await updateDoc(docRef, {
    deletedAt: new Date().toISOString(),
    deletedBy: uid || null
  });
}

/** Get a collection with real‑time listener */
export function listenCollection(collectionName, callback) {
  const colRef = collection(db, collectionName);
  return onSnapshot(colRef, (snapshot) => {
    const docs = [];
    snapshot.forEach((doc) => {
      docs.push({ id: doc.id, ...doc.data() });
    });
    callback(docs);
  }, (error) => {
    console.error(`Error listening to ${collectionName}:`, error);
  });
}

/** Get a single document once */
export async function getDocument(collectionName, docId) {
  const docRef = doc(db, collectionName, docId);
  const snap = await getDoc(docRef);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function fetchCollection(collectionName) {
  const colRef = collection(db, collectionName);
  const snapshot = await getDocs(colRef);
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

// -----------------------------------------------------------------------------
// Exported constants for collection names (keeps usage consistent)
// -----------------------------------------------------------------------------
export const COLLECTIONS = {
    WARGA: "warga",
    PIC: "pic",
    SOS: "sos"
};

export { doc, setDoc };

// End of firebase.js
