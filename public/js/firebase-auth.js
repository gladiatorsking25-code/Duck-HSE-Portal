// firebase-auth.js — real email/password accounts via Firebase Authentication.
//
// Sign-up, sign-in, password reset and sign-out, plus watchAndSync(), which
// starts/stops Firestore sync (js/cloud-sync.js) as the user signs in/out.
// Access decisions live in js/access.js; data protection lives in
// firestore.rules. If Firebase isn't configured, every method here throws a
// clear error.

const CloudAuth = {
  CLOUD_SESSION_FLAG: 'cla_cloud_signed_in',   // localStorage: "was the last sign-in a real cloud account?"

  async _auth() {
    if (!FIREBASE_READY) throw new Error('Cloud sign-in is not set up yet — see README "Cloud sync & accounts".');
    await firebaseReadyPromise;
    return firebase.auth();
  },

  async signUp(email, password) {
    const auth = await this._auth();
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    // A verified address is required before project invites can land on this
    // account (functions/projects.js), so ask for it straight away.
    try { await cred.user.sendEmailVerification(); } catch (e) { console.warn('Verification email not sent', e); }
    // NOTE: do NOT write the user's Firestore doc here. The onUserCreate Cloud
    // Function (functions/index.js) creates it with the email, role, and the
    // server-set trial window — and the Firestore rules now forbid a client from
    // writing any entitlement field (subscriptionStatus, trialEndsAt, …), so a
    // client-side write of those would be rejected. Trying to set them here is
    // both unnecessary and would make signup fail.
    return cred.user;
  },

  async signIn(email, password) {
    const auth = await this._auth();
    const cred = await auth.signInWithEmailAndPassword(email, password);
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

  // Call once per protected page load. Starts/stops Firestore sync as the
  // user signs in/out, and sends a signed-out user back to login.
  watchAndSync() {
    if (!FIREBASE_READY) return;
    this._auth().then(auth => {
      auth.onAuthStateChanged(user => {
        if (user) {
          localStorage.setItem(this.CLOUD_SESSION_FLAG, '1');
          if (typeof CloudSync !== 'undefined') CloudSync.start(user.uid);
        } else {
          localStorage.removeItem(this.CLOUD_SESSION_FLAG);
          if (typeof CloudSync !== 'undefined') CloudSync.stop();
          if (!location.pathname.endsWith('login.html')) location.href = 'login.html';
        }
      });
    }).catch(err => console.error('Firebase auth watch failed to start', err));
  }
};
