// js/firebase-config.js
// Configuración de Firebase del proyecto "femjoc".
// OJO: esta config SÍ puede ser pública (va siempre en el cliente).
// La seguridad real la dan las reglas de Firestore/Storage, no esta clave.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  signInWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyB86EI00VpSCPUGaa5qSLboyszS4o7Iskc",
  authDomain: "femjoc.firebaseapp.com",
  databaseURL: "https://femjoc-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "femjoc",
  storageBucket: "femjoc.firebasestorage.app",
  messagingSenderId: "40095419694",
  appId: "1:40095419694:web:ef9fc75c7df91bc4583ebf",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export {
  // auth
  signInAnonymously,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  // firestore
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
  // storage
  ref,
  uploadBytes,
  getDownloadURL,
};
