// access.js — the single gate every protected page calls.
//
// Real accounts only: a valid Firebase session is required, AND the account
// must currently have access (trial running, paid subscription, admin grant,
// or admin role). Trial-ended / unpaid users are sent to the paywall;
// signed-out users to login. If Firebase isn't configured the gate fails
// closed and every protected page routes to login.
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
  function requireAccess() {
    const c = cfg();
    // No backend configured means no one can be verified: fail closed.
    if (!firebaseOn()) { go(c.LOGIN_PAGE); return; }
    const page = currentPage();

    // Synchronous, optimistic routing from cached flags so there's no flash of
    // app content for a signed-out or locked user. The async check below is the
    // authoritative one.
    if (!cloudSignedIn()) { go(c.LOGIN_PAGE + '?next=' + enc(page + location.search)); return; }
    const cached = Entitlements.cachedAccess();
    if (cached && !cached.hasAccess && page !== c.PAYWALL_PAGE) {
      go(c.PAYWALL_PAGE + '?next=' + enc(page + location.search)); return;
    }

    armAuthWatch(function (user, access) {
      if (!user) { go(c.LOGIN_PAGE + '?next=' + enc(page + location.search)); return; }
      if (access && !access.hasAccess && page !== c.PAYWALL_PAGE) {
        go(c.PAYWALL_PAGE + '?next=' + enc(page + location.search));
      }
    });
  }

  // ---- Helper for login.html: if already signed in AND has access, leave ----
  function handleLoginPage(onReady) {
    if (!firebaseOn()) { if (onReady) onReady('unconfigured'); return; }
    armAuthWatch(function (user, access) {
      if (user && access && access.hasAccess) {
        const next = new URLSearchParams(location.search).get('next');
        go(next && /^[\w.-]+\.html/.test(next) ? next : 'index.html');
      } else if (user && access && !access.hasAccess) {
        go(cfg().PAYWALL_PAGE);
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
    handleLoginPage: handleLoginPage,
    handlePaywallPage: handlePaywallPage,
    handleAdminPage: handleAdminPage,
    armAuthWatch: armAuthWatch,
    signOut: signOut
  };
})(window);
