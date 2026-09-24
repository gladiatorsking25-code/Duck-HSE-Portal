// firebase-auth.js — real email/password accounts via Firebase Authentication,
// layered ON TOP OF the existing js/auth.js gate rather than replacing it.
//
// js/auth.js still works exactly as before (username "Sabir" / password
// "admin", session in sessionStorage). This file adds a second, real path:
// when Firebase is configured (see firebase-config.js) and someone signs up
// or signs in with an email/password, it (a) creates/checks a real Firebase
// account, (b) flips the SAME sessionStorage flag js/auth.js's requireAuth()
// already checks, so every existing protected page keeps working unchanged,
// and (c) starts Firestore sync via js/cloud-sync.js so assessments/permits
// saved on one device show up on another.
//
// If Firebase isn't configured, every method here throws a clear error and
// nothing else in the app is affected.

const CloudAuth = {
  CLOUD_SESSION_FLAG: 'cla_cloud_signed_in',   // localStorage: "was the last sign-in a real cloud account?"
  USED_CLOUD_FLAG: 'cla_used_cloud_login',      // localStorage: "has this browser ever used cloud login?"

  async _auth() {
    if (!FIREBASE_READY) throw new Error('Cloud sign-in is not set up yet — see README "Cloud sync & accounts".');
    await firebaseReadyPromise;
    return firebase.auth();
  },

  async signUp(email, password) {
    const auth = await this._auth();
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    // NOTE: do NOT write the user's Firestore doc here. The onUserCreate Cloud
    // Function (functions/index.js) creates it with the email, role, and the
    // server-set trial window — and the Firestore rules now forbid a client from
    // writing any entitlement field (subscriptionStatus, trialEndsAt, …), so a
    // client-side write of those would be rejected. Trying to set them here is
    // both unnecessary and would make signup fail.
    localStorage.setItem(this.USED_CLOUD_FLAG, '1');
    return cred.user;
  },

  async signIn(email, password) {
    const auth = await this._auth();
    const cred = await auth.signInWithEmailAndPassword(email, password);
    localStorage.setItem(this.USED_CLOUD_FLAG, '1');
    return cred.user;
  },

  async resetPassword(email) {
    const auth = await this._auth();
    await auth.sendPasswordResetEmail(email);
  },

  async signOutCloud() {
    if (!FIREBASE_READY) return;
    const auth = await this._auth();
    await auth.signOut();
    localStorage.removeItem(this.CLOUD_SESSION_FLAG);
  },

  // Call once per protected page load (in addition to, not instead of,
  // requireAuth()) when Firebase is configured. Keeps the existing session
  // gate synced with real Firebase auth state and starts/stops Firestore
  // sync as the user signs in/out.
  watchAndSync() {
    if (!FIREBASE_READY) return;

    // Prime the existing gate immediately from the last known state, so a
    // page reload doesn't flash-redirect to login.html while Firebase
    // rehydrates its own (asynchronous) session in the background.
    if (localStorage.getItem(this.CLOUD_SESSION_FLAG) === '1' && typeof AUTH !== 'undefined') {
      sessionStorage.setItem(AUTH.SESSION_KEY, '1');
    }

    this._auth().then(auth => {
      auth.onAuthStateChanged(user => {
        if (user) {
          localStorage.setItem(this.CLOUD_SESSION_FLAG, '1');
          if (typeof AUTH !== 'undefined') sessionStorage.setItem(AUTH.SESSION_KEY, '1');
          if (typeof CloudSync !== 'undefined') CloudSync.start(user.uid);
        } else {
          localStorage.removeItem(this.CLOUD_SESSION_FLAG);
          if (typeof CloudSync !== 'undefined') CloudSync.stop();
          // Only force a logout redirect for browsers that have actually
          // used cloud login before — otherwise this would boot people still
          // using the original local-only login gate, which never creates a
          // Firebase session at all.
          if (localStorage.getItem(this.USED_CLOUD_FLAG) === '1') {
            if (typeof AUTH !== 'undefined') AUTH.logout();
            if (!location.pathname.endsWith('login.html')) location.href = 'login.html';
          }
        }
      });
    }).catch(err => console.error('Firebase auth watch failed to start', err));
  }
};
