// firebase-config.js — LIVE config for the "duck-hse-portal" Firebase project.
//
// This is the Firebase *web* app config. These values are public by design (the
// apiKey is an identifier, not a secret — see SECURITY.md §2); shipping them in
// the app is expected. Security comes from Firebase Auth + the Firestore rules,
// not from hiding this.
//
// Because apiKey is now a real value (not the YOUR_API_KEY placeholder), the app
// runs in REAL-ACCOUNTS mode: the local Sabir/admin gate is retired and everyone
// signs in with an email/password account. For sign-in to actually work you must
// have completed the backend setup in SECURITY.md §6:
//   1. Authentication → Sign-in method → enable Email/Password.
//   2. firebase deploy --only firestore:rules
//   3. firebase deploy --only functions   (creates the trial on signup, verifies
//      Play purchases, powers the admin dashboard)
//   4. Firestore → users/<your uid> → set role: "admin"  (makes admin.html yours)
// Until those are done the app shows the login screen but sign-in will fail.

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAy28UK_MMSjnldl2-FP5Qe9zksVnGc_RM",
  authDomain: "duck-hse-portal.firebaseapp.com",
  projectId: "duck-hse-portal",
  storageBucket: "duck-hse-portal.firebasestorage.app",
  messagingSenderId: "93471036351",
  appId: "1:93471036351:web:bc7f453c712df3aab9470a",
  measurementId: "G-KNS5C5GR9J"
};
