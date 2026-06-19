// ============================================================
// MoneyIn — Firebase configuration
// ------------------------------------------------------------
// Fill in YOUR Firebase project's config below.
// Get it from: Firebase Console → Project Settings → General
//              → Your apps → SDK setup and configuration
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCs79P44dqG4x7R918_bYlsj8ZbXkUZDDc",
  authDomain: "moneyin-690e0.firebaseapp.com",
  projectId: "moneyin-690e0",
  storageBucket: "moneyin-690e0.firebasestorage.app",
  messagingSenderId: "370414594293",
  appId: "1:370414594293:web:d04b7cf706dd766f057dbc"
};
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
