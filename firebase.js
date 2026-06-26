// firebase.js – Firebase initialization and helper functions for ClusterGuard PWA

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore, collection, addDoc, doc, setDoc, updateDoc, getDoc, getDocs, onSnapshot, enableIndexedDbPersistence, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

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

// Initialize Firebase app
const app = initializeApp(firebaseConfig);

// Initialize Auth and Firestore instances
export const auth = getAuth(app);
export const db = getFirestore(app);

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
  const userCred = await signInWithEmailAndPassword(auth, email, password);
  // Retrieve PIC profile
  const picSnap = await getDoc(doc(db, "pic", userCred.user.uid));
  return { authUser: userCred.user, profile: picSnap.exists() ? picSnap.data() : null };
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

// -----------------------------------------------------------------------------
// Exported constants for collection names (keeps usage consistent)
// -----------------------------------------------------------------------------
export const COLLECTIONS = {
  WARGA: "warga",
  PIC: "pic",
  SOS: "sos"
};

// End of firebase.js
