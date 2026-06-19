// ============================================================
// MoneyIn — Authentication
// ============================================================

import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as fbSignOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  fetchSignInMethodsForEmail,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, setDoc, serverTimestamp, query, collection, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * Creates the Firestore user profile document if it doesn't already exist.
 * Mirrors DivAid's AuthService: profile defaults + wallet stub (no real wallet here).
 */
async function ensureUserProfile(user, displayNameOverride) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      displayName: displayNameOverride || user.displayName || user.email.split("@")[0],
      email: user.email,
      photoUrl: user.photoURL || null,
      friends: [],
      starredFriends: [],
      starredGroups: [],
      createdAt: serverTimestamp()
    });
  }
  return ref;
}

/** Sign up with email + password. */
export async function signUp(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName });
  await ensureUserProfile(cred.user, displayName);
  return cred.user;
}

/** Sign in with email + password. */
export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

/**
 * Sign in with Google. Blocks if the email is already registered
 * with a password account (mirrors DivAid's policy).
 */
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();

  // Pre-check: is this email already a password account?
  // (Best-effort; Firebase will also enforce this server-side via linking errors.)
  const cred = await signInWithPopup(auth, provider);
  const methods = await fetchSignInMethodsForEmail(auth, cred.user.email).catch(() => []);
  if (methods.includes("password") && !methods.includes("google.com")) {
    await fbSignOut(auth);
    throw new Error("This email is already registered with a password. Sign in with your password instead.");
  }

  await ensureUserProfile(cred.user);
  return cred.user;
}

export async function resetPassword(email) {
  if (!email) throw new Error("Enter your email first, then tap 'Forgot password?'");
  await sendPasswordResetEmail(auth, email);
}

export async function signOut() {
  await fbSignOut(auth);
}

export function watchAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

export function currentUid() {
  return auth.currentUser ? auth.currentUser.uid : null;
}

/** Find a user document by exact email (for contact requests). */
export async function findUserByEmail(email) {
  const q = query(collection(db, "users"), where("email", "==", email.trim().toLowerCase()));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}
