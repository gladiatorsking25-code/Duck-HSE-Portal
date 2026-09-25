// access.js — the single gate every protected page calls.
//
// Real accounts only: a valid Firebase session is required, AND the account
// must currently have access (trial running, paid subscription, admin grant,
// or admin role). Trial-ended / unpaid users are sent to the paywall;
// signed-out users to login. If Firebase isn't configured the gate fails
// closed and every protected page routes to login.
//
// A few pages stay open, read-only, to an account without access, so nobody
// loses sight of their records when a trial or subscription ends: Projects,
// a project, and Settings (to export). They call
// requireAccess({ allowLapsed: true }), then check Access.readOnly (or listen
// with Access.onReadOnlyChange) and hide every control that changes data.
// The Firestore rules and Cloud Functions refuse those writes anyway.
//
// Enforcement of DATA is always the Firestore rules on Google's servers — this
// gate is the UX layer that routes people to the right screen. The rules can't
// be bypassed from devtools, and the gate can't be tricked into granting data
// it isn't allowed.

(function (global) {
  'use strict';

  function firebaseOn() {
    return typeof FIREBASE_READY !== 'undefined' && FIREBASE_READY;
  }
  function cfg() {
    return (typeof SUBSCRIPTION_CONFIG !== 'undefined') ? SUBSCRIPTION_CONFIG : {
      LOGIN_PAGE: 'login.html', PAYWALL_PAGE: 'subscribe.html', ADMIN_PAGE: 'admin.html'
    };
  }
  function currentPage() { return location.pathname.split('/').pop() || 'index.html'; }
  function enc(s) { return encodeURIComponent(s); }
  function go(page) {
    if (currentPage() !== page.split('?')[0]) location.replace(page);
  }
  function cloudSignedIn() {
    try { return localStorage.getItem('cla_cloud_signed_in') === '1'; } catch (e) { return false; }
  }

  // ---- The gate for ordinary protected pages -------------------------------
  // opts.allowLapsed: sign-in is still required, but an account without access
  // stays on the page in read-only mode instead of going to the paywall.
  function requireAccess(opts) {
    const c = cfg();
    const allowLapsed = !!(opts && opts.allowLapsed);
    // No backend configured means no one can be verified: fail closed.
    if (!firebaseOn()) { go(c.LOGIN_PAGE); return; }
    const page = currentPage();
    const toLogin = function () { go(c.LOGIN_PAGE + '?next=' + enc(page + location.search)); };
    const locked = function () {
      if (allowLapsed) setReadOnly(true);
      else go(c.PAYWALL_PAGE + '?next=' + enc(page + location.search));
    };

    // Synchronous, optimistic routing from cached flags so there's no flash of
    // app content for a signed-out or locked user. The async check below is the
    // authoritative one.
    if (!cloudSignedIn()) { toLogin(); return; }
    const cached = Entitlements.cachedAccess();
    if (cached && !cached.hasAccess && page !== c.PAYWALL_PAGE) {
      locked();
      if (!allowLapsed) return;
    }

    // Live: access that ends while the page is open turns it read-only (or
    // sends it to the paywall), and access that starts makes it editable.
    armAuthWatch(function (user, access) {
      if (!user) { toLogin(); return; }
      if (access && !access.hasAccess && page !== c.PAYWALL_PAGE) locked();
      else if (access && access.hasAccess) setReadOnly(false);
    });
  }

  // ---- Read-only mode (pages that pass allowLapsed) --------------------------
  let _readOnly = false;
  let _roCbs = [];
  function setReadOnly(value) {
    const v = !!value;
    if (v === _readOnly) return;
    _readOnly = v;
    _roCbs.slice().forEach(function (f) { try { f(v); } catch (e) { console.error(e); } });
  }
  // Calls cb(readOnly) now and again every time it changes.
  function onReadOnlyChange(cb) {
    _roCbs.push(cb);
    try { cb(_readOnly); } catch (e) { console.error(e); }
    return function () { _roCbs = _roCbs.filter(function (f) { return f !== cb; }); };
  }
  // Shows the short "read-only" notice in `el` while the page is read-only.
  function readOnlyBanner(el) {
    if (!el) return;
    onReadOnlyChange(function (ro) {
      el.hidden = !ro;
      el.innerHTML = ro
        ? '<div class="banner banner-warn" role="status"><div>Your free trial or subscription has ended, so you can view, ' +
          'download and export here, but not make changes. <a href="' + cfg().PAYWALL_PAGE + '">Subscribe</a> to make changes again.</div></div>'
        : '';
    });
  }

  // Pages that call requireAccess({ allowLapsed: true }).
  const READ_ONLY_PAGES = ['projects.html', 'project.html', 'settings.html'];

  // ---- Helper for login.html: if already signed in AND has access, leave ----
  function handleLoginPage(onReady) {
    if (!firebaseOn()) { if (onReady) onReady('unconfigured'); return; }
    // Pages that stay open to an account without access (to delete data or
    // read the legal pages after the trial ends). READ_ONLY_PAGES open too,
    // read-only.
    const OPEN_PAGES = ['account-deletion.html', 'privacy.html', 'terms.html', 'about.html'];
    armAuthWatch(function (user, access) {
      const next = new URLSearchParams(location.search).get('next');
      const safeNext = next && /^[\w.-]+\.html/.test(next) ? next : '';
      if (user && access && access.hasAccess) {
        go(safeNext || 'index.html');
      } else if (user && access && !access.hasAccess) {
        const lapsedOk = OPEN_PAGES.indexOf(next) !== -1 || READ_ONLY_PAGES.indexOf(safeNext.split('?')[0]) !== -1;
        go(lapsedOk ? next : cfg().PAYWALL_PAGE);
      } else if (onReady) {
        onReady('firebase');
      }
    });
  }

  // ---- Helper for subscribe.html (paywall): require sign-in; leave if OK ----
  function handlePaywallPage(cb) {
    if (!firebaseOn()) { if (cb) cb({ configured: false }); return; }
    if (!cloudSignedIn()) { go(cfg().LOGIN_PAGE + '?next=' + enc(cfg().PAYWALL_PAGE)); return; }
    armAuthWatch(function (user, access, doc) {
      if (!user) { go(cfg().LOGIN_PAGE + '?next=' + enc(cfg().PAYWALL_PAGE)); return; }
      // Only leave the paywall when the account is genuinely, fully entitled: a
      // paid subscription, an admin comp/grant, or the admin role. Trial users
      // may open it to subscribe early, and 'pending'/'unknown' (the backend
      // hasn't finished deploying, so the entitlement doc can't be read yet)
      // must NOT bounce — otherwise the page just flickers straight back.
      const ENTITLED = ['active', 'granted', 'admin'];
      if (access && ENTITLED.indexOf(access.state) !== -1) { go('index.html'); return; }
      if (cb) cb({ configured: true, user: user, access: access, doc: doc });
    });
  }

  // ---- Helper for admin.html: require sign-in AND admin role ----------------
  function handleAdminPage(cb) {
    if (!firebaseOn()) { if (cb) cb({ configured: false }); return; }
    if (!cloudSignedIn()) { go(cfg().LOGIN_PAGE + '?next=' + enc(cfg().ADMIN_PAGE)); return; }
    armAuthWatch(function (user, access, doc) {
      if (!user) { go(cfg().LOGIN_PAGE + '?next=' + enc(cfg().ADMIN_PAGE)); return; }
      const isAdmin = doc && doc.role === 'admin';
      if (cb) cb({ configured: true, user: user, isAdmin: isAdmin, doc: doc });
    });
  }

  // ---- Shared Firebase auth + entitlement watcher --------------------------
  // Wires one onAuthStateChanged and, per signed-in user, one entitlement
  // snapshot listener. Calls cb(user, access, doc) on every meaningful change.
  let _armed = false;
  function armAuthWatch(cb) {
    firebaseReadyPromise.then(function (fb) {
      if (!fb) { cb(null, null, null); return; }
      fb.auth().onAuthStateChanged(function (user) {
        if (!user) {
          try { localStorage.removeItem('cla_cloud_signed_in'); } catch (e) {}
          Entitlements.clearCache();
          Entitlements.stop();
          cb(null, null, null);
          return;
        }
        try { localStorage.setItem('cla_cloud_signed_in', '1'); } catch (e) {}
        Entitlements.watch(user.uid, function (access, doc) {
          cb(user, access, doc);
        });
      });
      _armed = true;
    }).catch(function (err) {
      console.error('Access watch failed to start', err);
      cb(null, null, null);
    });
  }

  async function signOut() {
    try { if (typeof CloudAuth !== 'undefined') await CloudAuth.signOutCloud(); } catch (e) { /* ignore */ }
    Entitlements.clearCache();
    try { localStorage.removeItem('cla_cloud_signed_in'); } catch (e) {}
    location.href = cfg().LOGIN_PAGE;
  }

  global.requireAccess = requireAccess;
  global.Access = {
    firebaseOn: firebaseOn,
    requireAccess: requireAccess,
    onReadOnlyChange: onReadOnlyChange,
    readOnlyBanner: readOnlyBanner,
    handleLoginPage: handleLoginPage,
    handlePaywallPage: handlePaywallPage,
    handleAdminPage: handleAdminPage,
    armAuthWatch: armAuthWatch,
    signOut: signOut
  };
  // True while an allowLapsed page is open for an account without access.
  Object.defineProperty(global.Access, 'readOnly', { enumerable: true, get: function () { return _readOnly; } });
})(window);
