// firebase-init.js — loads the Firebase "compat" SDKs from Google's CDN, but
// ONLY if firebase-config.js has been filled in with a real project. If it's
// still the placeholder, FIREBASE_READY is false, no network request for the
// SDK is made, and every other Firebase-aware file (firebase-auth.js,
// cloud-sync.js) quietly no-ops — the app behaves exactly as it did before
// any of these files existed.

const FIREBASE_READY = typeof FIREBASE_CONFIG !== 'undefined' &&
  !!FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY';

// Resolves to the initialized `firebase` global once the SDK + your project
// config are both loaded. Anything that needs Firebase should `await` this
// rather than assuming `firebase` already exists.
let firebaseReadyPromise = null;

if (FIREBASE_READY) {
  firebaseReadyPromise = new Promise((resolve, reject) => {
    const SDK_VERSION = '10.13.0';   // keep in step with FIREBASE_SDK_VERSION in sw.js
    const scripts = [
      `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app-compat.js`,
      `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth-compat.js`,
      `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore-compat.js`,
      // functions-compat is needed for the subscription callables
      // (verifyPlayPurchase, adminSetSubscription, adminListUsers).
      `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-functions-compat.js`
    ];
    function loadNext(i) {
      if (i >= scripts.length) {
        try {
          firebase.initializeApp(FIREBASE_CONFIG);
          // Keep the account's records and any unsent writes in IndexedDB, so
          // a save made offline survives leaving the page and is sent when the
          // device is back online. Best effort: some browsers (private
          // windows) refuse it, and Firestore then keeps them in memory only.
          try {
            firebase.firestore().enablePersistence({ synchronizeTabs: true })
              .catch((err) => console.warn('Offline copy of the account is not available here', err && err.code));
          } catch (e) { /* not available */ }
          resolve(firebase);
        } catch (e) { reject(e); }
        return;
      }
      const s = document.createElement('script');
      s.src = scripts[i];
      s.onload = () => loadNext(i + 1);
      s.onerror = () => reject(new Error('Could not load Firebase SDK: ' + scripts[i]));
      document.head.appendChild(s);
    }
    loadNext(0);
  });
} else {
  // Resolve to null rather than leaving callers hanging when Firebase isn't
  // configured yet.
  firebaseReadyPromise = Promise.resolve(null);
}
