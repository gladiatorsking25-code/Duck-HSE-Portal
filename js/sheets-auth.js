const CloudAuth = {
  signUp(email, password) { return SheetsBackend.auth().createUserWithEmailAndPassword(email, password); },
  signIn(email, password) { return SheetsBackend.auth().signInWithEmailAndPassword(email, password); },
  resetPassword(email) { return SheetsBackend.auth().sendPasswordResetEmail(email); },
  signOutCloud() { return SheetsBackend.auth().signOut(); },
  watchAndSync() {
    if (this.watching) return;
    this.watching = true;
    SheetsBackend.auth().onAuthStateChanged(user => {
      if (user) {
        sessionStorage.setItem(AUTH.SESSION_KEY, '1');
        if (typeof CloudSync !== 'undefined') CloudSync.start(user.uid);
      } else {
        sessionStorage.removeItem(AUTH.SESSION_KEY);
        if (typeof CloudSync !== 'undefined') CloudSync.stop();
      }
    });
  }
};
