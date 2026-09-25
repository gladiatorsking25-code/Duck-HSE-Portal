// consent.js — a lightweight, additive consent gate. This does NOT replace or
// modify the sign-in gate (js/access.js); it sits on top of it. It records that
// the signed-in user has seen and accepted the Terms of Use / Privacy Notice
// before the app is used, which matters both for UAE PDPL (Federal Decree-Law
// No. 45 of 2021) lawful-basis-for-processing purposes and for ordinary
// liability protection given this tool influences real HSE decisions.
//
// Two records are kept:
//   - on the device (localStorage), so the screen shows once per device and
//     account and works offline: { version, acceptedAt, uid, onServer };
//   - with the account (users/{uid}: consentVersion, consentAcceptedAt), which
//     is the operator's evidence of who accepted which version and when. The
//     time is set by the server; the Firestore rules require consentAcceptedAt
//     to be that server time.
// People accept either when they create an account (login.html) or on the
// screen below. Sending the acceptance to the account never blocks anyone: if
// it fails, the device record stays marked as not sent and the next app page
// tries again.

const CONSENT_KEY = 'cla_tos_privacy_accepted_v1';
// Bump when the Terms or Privacy Notice change, so everyone accepts them again.
// test/e2e-lib.mjs pre-accepts this version for the browser tests.
const CONSENT_VERSION = '2026-09-25';
// Waits between tries while the account document does not exist yet (the
// onUserCreate function creates it a moment after sign-up): about 20 s in all.
const CONSENT_RETRY_MS = [1000, 2000, 3000, 5000, 8000];

function readConsentRecord() {
  try {
    const rec = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null');
    return rec && typeof rec === 'object' ? rec : null;
  } catch (e) {
    return null;
  }
}

function writeConsentRecord(rec) {
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(rec));
  } catch (e) {
    console.error('Could not record consent acceptance', e);
  }
}

function hasAcceptedConsent() {
  const rec = readConsentRecord();
  return !!rec && rec.version === CONSENT_VERSION;
}

// Resolves to the initialised firebase SDK, or null when this page has none
// (not configured, or it failed to load). Never rejects.
function consentFirebase() {
  if (typeof firebaseReadyPromise === 'undefined' || !firebaseReadyPromise) return Promise.resolve(null);
  return firebaseReadyPromise.then((fb) => fb || null, () => null);
}

// Resolves to the signed-in Firebase user, or null. Never rejects.
function consentAccountUser() {
  return consentFirebase().then((fb) => {
    if (!fb) return null;
    return new Promise((resolve) => {
      let done = false;
      let off = null;
      off = fb.auth().onAuthStateChanged((user) => {
        if (done) return;
        done = true;
        if (off) off();
        resolve(user || null);
      });
      if (done) off(); // the first call came before `off` was set
    });
  }).catch(() => null);
}

// Records that the current version was accepted. `uid` is the account that
// accepted when the caller knows it (sign-up). From the in-app screen it is
// looked up here, and the acceptance is added to that account once known.
// Resolves to true once the account has the record.
function recordConsentAcceptance(uid) {
  const rec = { version: CONSENT_VERSION, acceptedAt: new Date().toISOString(), uid: uid || null, onServer: false };
  writeConsentRecord(rec);
  if (uid) return recordConsentOnServer(uid);
  return consentAccountUser().then((user) => {
    if (!user) return false;
    const now = readConsentRecord();
    // Only claim this device record if it is still the one written above.
    if (!now || now.acceptedAt !== rec.acceptedAt || now.uid) return false;
    now.uid = user.uid;
    writeConsentRecord(now);
    return recordConsentOnServer(user.uid);
  });
}

// Adds { consentVersion, consentAcceptedAt: server time } to users/{uid}.
// update(), never set(): the account document is created by the server, and
// while it is missing the write is retried for a short while. Depending on the
// create rule, Firestore reports a missing document as not-found or as
// permission-denied, so both are retried. Resolves to true or false.
let _consentWrite = null;
function recordConsentOnServer(uid) {
  if (_consentWrite && _consentWrite.uid === uid) return _consentWrite.promise;
  const promise = (async () => {
    for (let i = 0; ; i++) {
      try {
        const fb = await consentFirebase();
        if (!fb) return false;
        await fb.firestore().collection('users').doc(uid).update({
          consentVersion: CONSENT_VERSION,
          consentAcceptedAt: fb.firestore.FieldValue.serverTimestamp()
        });
        markConsentOnServer(uid);
        return true;
      } catch (e) {
        const code = e && e.code;
        if ((code === 'not-found' || code === 'permission-denied') && i < CONSENT_RETRY_MS.length) {
          await new Promise((r) => setTimeout(r, CONSENT_RETRY_MS[i]));
          continue;
        }
        console.warn('Could not record the Terms acceptance with the account; the next page will try again', e);
        return false;
      }
    }
  })();
  _consentWrite = { uid: uid, promise: promise };
  promise.then(() => { if (_consentWrite && _consentWrite.promise === promise) _consentWrite = null; });
  return promise;
}

function markConsentOnServer(uid) {
  const rec = readConsentRecord();
  if (!rec || rec.uid !== uid || rec.version !== CONSENT_VERSION) return;
  rec.onServer = true;
  writeConsentRecord(rec);
}

// Once the signed-in account is known on an app page:
//  - the device record is this account's but the account has not got it yet
//    (sign-up moved on before the account document existed, or the device was
//    offline): send it now;
//  - the device record belongs to another account (a shared device): use this
//    account's own acceptance if it has one for this version, else ask again.
// A record with no account (accepted before sign-in could be checked) counts
// for this device only and is not attributed to anyone.
// Resolves to what it did, for the tests.
async function checkConsentForAccount() {
  try {
    const user = await consentAccountUser();
    const rec = readConsentRecord();
    if (!user || !rec || rec.version !== CONSENT_VERSION) return 'none';
    if (rec.uid === user.uid) {
      if (rec.onServer) return 'ok';
      return (await recordConsentOnServer(user.uid)) ? 'sent' : 'not-sent';
    }
    if (!rec.uid) return 'device';
    const fb = await consentFirebase();
    return await fb.firestore().collection('users').doc(user.uid).get().then((snap) => {
      const data = snap.exists ? snap.data() : null;
      if (data && data.consentVersion === CONSENT_VERSION) {
        const at = data.consentAcceptedAt && typeof data.consentAcceptedAt.toDate === 'function'
          ? data.consentAcceptedAt.toDate().toISOString() : new Date().toISOString();
        writeConsentRecord({ version: CONSENT_VERSION, acceptedAt: at, uid: user.uid, onServer: true });
        return 'account';
      }
      showConsentScreen();
      return 'asked';
    }, () => {
      showConsentScreen();
      return 'asked';
    });
  } catch (e) {
    console.warn('Consent check failed', e);
    return 'none';
  }
}

function showConsentScreen() {
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', showConsentScreen, { once: true });
    return;
  }
  if (document.getElementById('consentOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'consentOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,27,38,.72);z-index:999;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:4px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto;padding:26px 28px;font-family:'Inter',system-ui,sans-serif;">
      <h2 style="margin:0 0 10px;font-size:18px;">Before you continue</h2>
      <p style="font-size:13.5px;color:#52626d;line-height:1.55;">
        Duck HSE Portal helps you plan, record and track HSE work. It is not a substitute for
        competent-person judgement, your site's procedures, or applicable regulations such as the
        <strong>ADOSH-SF codes of practice</strong>. For lifting, it does not replace the crane's
        certified load chart or an Appointed Person's sign-off. What you enter is kept on this
        device and in your account, which Google Firebase stores outside the UAE, as described in
        the Privacy Notice. Your acceptance is recorded with your account.
      </p>
      <div style="display:flex; gap:16px; margin:14px 0;">
        <a href="terms.html" target="_blank" rel="noopener" style="font-size:13px;">Read Terms of Use</a>
        <a href="privacy.html" target="_blank" rel="noopener" style="font-size:13px;">Read Privacy Notice</a>
      </div>
      <label style="display:flex; gap:9px; align-items:flex-start; font-size:13.5px; margin-top:6px;">
        <input type="checkbox" id="consentCheckbox" style="margin-top:3px; width:16px; height:16px;">
        <span>I have read and accept the Terms of Use and Privacy Notice, and I understand this
        tool does not replace competent-person judgement or, for lifting, the manufacturer's load
        chart and a qualified Appointed Person's sign-off.</span>
      </label>
      <button id="consentAcceptBtn" disabled style="margin-top:16px;width:100%;padding:11px;border-radius:4px;border:none;background:#c8ccd0;color:#fff;font-weight:600;font-size:13.5px;cursor:not-allowed;">
        Accept & continue
      </button>
    </div>
  `;
  document.body.appendChild(overlay);

  const checkbox = document.getElementById('consentCheckbox');
  const acceptBtn = document.getElementById('consentAcceptBtn');
  checkbox.addEventListener('change', () => {
    acceptBtn.disabled = !checkbox.checked;
    acceptBtn.style.background = checkbox.checked ? '#16283a' : '#c8ccd0';
    acceptBtn.style.cursor = checkbox.checked ? 'pointer' : 'not-allowed';
  });
  acceptBtn.addEventListener('click', () => {
    if (!checkbox.checked) return;
    recordConsentAcceptance();
    overlay.remove();
  });
}

function requireConsent() {
  if (!hasAcceptedConsent()) {
    document.addEventListener('DOMContentLoaded', showConsentScreen);
    return;
  }
  // Runs after the page's own scripts have loaded the Firebase SDK.
  document.addEventListener('DOMContentLoaded', () => { checkConsentForAccount(); });
}
