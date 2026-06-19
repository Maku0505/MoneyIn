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
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// ------------------------------------------------------------
// Gemini API key for receipt scanning.
// WARNING: This key will be visible to anyone who views your
// site's source on GitHub Pages (static hosting = no server
// to hide secrets behind). For a public/production app, put
// this behind a small server-side proxy instead. For personal/
// low-traffic use, restrict the key in Google AI Studio to
// only the Generative Language API and (if possible) your
// GitHub Pages domain via HTTP referrer restrictions.
// ------------------------------------------------------------
export const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
