// entitlements.js — decides whether the signed-in user currently has access.
//
// The rule the whole app follows: ACCESS IS SERVER-TRUTH. The only source of an
// entitlement is the `users/{uid}` document in Firestore, and the client can
// only READ it — Firestore rules forbid the client from writing any of the
// entitlement fields (subscriptionStatus, trialEndsAt, adminGrantUntil, role).
// Those are written exclusively by Cloud Functions using the Admin SDK (on
// account creation, on a verified Play purchase, or on an admin action). So a
// user cannot unlock the app by editing localStorage or devtools — the gate
// re-checks against the server document.
//
// This module is pure-logic + a thin Firestore reader:
//   Entitlements.computeAccess(userDoc, nowMs)  -> { state, hasAccess, until }
//   Entitlements.watch(uid, cb)                 -> live updates from Firestore
//   Entitlements.current()                      -> last computed access (cached)
//
// computeAccess() has no dependencies and is unit-tested in the browser.

const Entitlements = (function () {
  'use strict';

  const CACHE_KEY = 'cla_access_cache'; // {state, hasAccess, until, uid, ts}
  let _current = null;
  let _unsub = null;

  // The heart of it — a pure function so it can be tested without Firebase.
  // Order matters: admin role wins, then a manual admin grant, then a paid
  // subscription, then the free trial, else locked.
  function computeAccess(userDoc, nowMs) {
    const now = nowMs || Date.now();
    const u = userDoc || {};
    const paidStatuses = (typeof SUBSCRIPTION_CONFIG !== 'undefined' && SUBSCRIPTION_CONFIG.PAID_STATUSES) || ['active', 'in_grace'];

    // 0. Brand-new account whose trial hasn't been stamped by the server yet.
    //    The onUserCreate Cloud Function writes role + trial within a second or
    //    so of signup, but the client can read the doc before that lands. A doc
    //    with none of the entitlement fields = "just created" → let it through;
    //    the live snapshot corrects to 'trial' the moment the trigger writes. A
    //    genuinely locked account always has entitlement fields, so it is never
    //    mistaken for pending.
    const hasEntitlementField = !!(u.role || u.subscriptionStatus || u.trialEndsAt || u.adminGrantUntil || u.compForever);
    if (!hasEntitlementField) return mk('pending', true, null);

    // 1. Owner / admin — always full access, never gated.
    if (u.role === 'admin') return mk('admin', true, null);

    // 2. Manual admin grant / comp (an owner gave this account access until a date).
    const grant = num(u.adminGrantUntil);
    if (grant && grant > now) return mk('granted', true, grant);
    // A permanent comp (grant with no end date).
    if (u.adminGrantUntil === 'forever' || u.compForever === true) return mk('granted', true, null);

    // 3. Active paid subscription (verified by the Cloud Function).
    const exp = num(u.subscriptionExpiryMillis);
    const status = u.subscriptionStatus || '';
    if (paidStatuses.indexOf(status) !== -1) {
      if (!exp) return mk('active', true, null);       // active, expiry not yet known
      if (exp > now) return mk('active', true, exp);   // active and not expired
    }

    // 4. Free trial still running.
    const trialEnd = num(u.trialEndsAt);
    if (trialEnd && trialEnd > now) return mk('trial', true, trialEnd);

    // 5. Otherwise locked — trial ended and no active subscription.
    return mk('locked', false, null);
  }

  function mk(state, hasAccess, until) {
    return { state: state, hasAccess: !!hasAccess, until: until || null };
  }
  function num(v) {
    if (v == null) return 0;
    const n = Number(v);
    return isFinite(n) ? n : 0;
  }

  // Whole days remaining until `untilMs` (>=0), or null.
  function daysLeft(untilMs, nowMs) {
    if (!untilMs) return null;
    const ms = untilMs - (nowMs || Date.now());
    return ms <= 0 ? 0 : Math.ceil(ms / 86400000);
  }

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) { return null; }
  }
  function writeCache(access, uid) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(Object.assign({}, access, { uid: uid, ts: Date.now() })));
    } catch (e) { /* ignore */ }
  }
  function clearCache() {
    try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* ignore */ }
  }

  // Optimistic access from the cache, so a page can render without waiting for
  // the network. This is a UX convenience only — the live watch() below
  // corrects it, and the server rules are the real enforcement.
  function cachedAccess(uid) {
    const c = readCache();
    if (!c || (uid && c.uid && c.uid !== uid)) return null;
    // Re-evaluate the cached `until` against the clock so an expired trial in a
    // stale cache doesn't read as still-valid.
    if (c.hasAccess && c.until && Number(c.until) <= Date.now()) {
      return mk(c.state === 'trial' ? 'locked' : c.state, false, null);
    }
    return mk(c.state, c.hasAccess, c.until);
  }

  // Live subscription to the user's entitlement document, MULTIPLEXED: several
  // parts of the app (the page gate, the sidebar status chip, the paywall) all
  // want to react to entitlement changes, so watch() keeps ONE Firestore
  // listener per uid and fans every update out to all registered callbacks.
  // Returns an unsubscribe that removes just that callback.
  let _cbs = [];
  let _watchUid = null;

  function _emit(access, doc) {
    _current = access;
    _cbs.slice().forEach(function (f) { try { f(access, doc); } catch (e) { console.error(e); } });
  }

  // Client-side free-trial bootstrap. Runs when an account has no entitlement at
  // all (a 'pending' doc). It writes the trial fields the Firestore rules allow a
  // user to set once (status 'trial' + a bounded end date), so trials work
  // without the Cloud Functions / Blaze plan. The rules forbid delete and a
  // second trial, so it can't be reset or extended. If Cloud Functions ARE
  // deployed they stamp the trial first, and this becomes a no-op.
  const _trialTried = {};
  function ensureTrial(uid, doc) {
    if (_trialTried[uid]) return;
    const d = doc || {};
    if (d.role || d.subscriptionStatus || d.trialEndsAt || d.adminGrantUntil || d.compForever) return;
    _trialTried[uid] = true;
    const days = (typeof SUBSCRIPTION_CONFIG !== 'undefined' && SUBSCRIPTION_CONFIG.TRIAL_DAYS) || 14;
    const now = Date.now();
    firebase.firestore().collection('users').doc(uid).set({
      subscriptionStatus: 'trial',
      trialStartedAt: now,
      trialEndsAt: now + days * 86400000
    }, { merge: true }).catch(function (e) { console.warn('Trial bootstrap could not write', e); });
  }

  function watch(uid, cb) {
    if (typeof FIREBASE_READY === 'undefined' || !FIREBASE_READY) {
      const a = mk('unconfigured', true, null); // no backend yet → don't gate
      _current = a; if (cb) cb(a, null);
      return function () {};
    }
    if (cb) _cbs.push(cb);

    if (_watchUid !== uid) {
      _watchUid = uid;
      if (_unsub) { try { _unsub(); } catch (e) {} _unsub = null; }
      firebaseReadyPromise.then(function () {
        if (_watchUid !== uid) return; // switched again before the SDK was ready
        _unsub = firebase.firestore().collection('users').doc(uid).onSnapshot(function (snap) {
          const doc = snap.exists ? snap.data() : {};
          const access = computeAccess(doc, Date.now());
          writeCache(access, uid);
          _emit(access, doc);
          // Brand-new account with nothing stamped yet → start its free trial.
          if (access.state === 'pending') ensureTrial(uid, doc);
        }, function (err) {
          console.error('Entitlement watch failed', err);
          // Fall back to the cached value rather than locking someone out over a
          // transient network problem.
          _emit(cachedAccess(uid) || mk('unknown', true, null), null);
        });
      });
    } else if (cb && _current) {
      try { cb(_current, null); } catch (e) {} // deliver the current value at once
    }
    return function () { _cbs = _cbs.filter(function (f) { return f !== cb; }); };
  }

  function stop() {
    if (_unsub) { try { _unsub(); } catch (e) { /* ignore */ } _unsub = null; }
    _cbs = [];
    _watchUid = null;
  }

  function current() { return _current; }

  return {
    computeAccess: computeAccess,
    daysLeft: daysLeft,
    watch: watch,
    stop: stop,
    current: current,
    cachedAccess: cachedAccess,
    writeCache: writeCache,
    clearCache: clearCache
  };
})();
