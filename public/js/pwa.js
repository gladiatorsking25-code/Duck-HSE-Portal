// pwa.js — registers the service worker, surfaces updates, and gives the app
// the small amount of "installed app" behaviour Play Store users expect.
//
// Everything here degrades silently: on a browser with no service-worker
// support, or when the page is opened from file://, none of it runs and the app
// behaves exactly as it did before.

(function () {
  'use strict';

  // file:// has no service worker scope, and registering from there throws.
  const canRegister = 'serviceWorker' in navigator &&
    (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');

  // ---- Remember that the Android app opened this launch ----
  // The app opens pages with ?src=twa (twa-manifest.json startUrl and
  // shortcuts), which the sign-in redirect keeps in ?next=, and Android gives
  // the first page an android-app://<package> referrer. The paywall reads this
  // mark so it never offers web payments inside the app. Same check as
  // Billing.inTwa() in js/billing.js; sessionStorage keeps it for this launch.
  function isAppLaunch() {
    const q = new URLSearchParams(location.search);
    if (q.get('src') === 'twa' || /[?&]src=twa(&|$)/.test(q.get('next') || '')) return true;
    const pkg = String((typeof SUBSCRIPTION_CONFIG !== 'undefined' && SUBSCRIPTION_CONFIG.PLAY_PACKAGE_NAME) || 'Duck.HSE.Portal');
    return String(document.referrer || '').toLowerCase().indexOf('android-app://' + pkg.toLowerCase()) === 0;
  }
  try { if (isAppLaunch()) sessionStorage.setItem('duck_twa', '1'); } catch (e) { /* storage blocked */ }

  // ---- small toast, styled from the app's own tokens ----
  function toast(html, actions) {
    const el = document.createElement('div');
    el.className = 'pwa-toast no-print';
    el.innerHTML = `<div class="pwa-toast-msg">${html}</div><div class="pwa-toast-actions"></div>`;
    const holder = el.querySelector('.pwa-toast-actions');
    (actions || []).forEach(a => {
      const b = document.createElement('button');
      b.className = 'btn btn-sm' + (a.primary ? ' btn-primary' : '');
      b.textContent = a.label;
      b.addEventListener('click', () => { el.remove(); a.onClick && a.onClick(); });
      holder.appendChild(b);
    });
    document.body.appendChild(el);
    return el;
  }

  // ---- offline / online indicator ----
  let offlineBar = null;
  function renderConnectivity() {
    const offline = !navigator.onLine;
    if (offline && !offlineBar) {
      offlineBar = document.createElement('div');
      offlineBar.className = 'pwa-offline-bar no-print';
      offlineBar.textContent = 'Offline — the app is running from its on-device copy. Assessments and permits are saved locally and will be here when you reconnect.';
      document.body.appendChild(offlineBar);
      document.body.classList.add('has-offline-bar');
    } else if (!offline && offlineBar) {
      offlineBar.remove();
      offlineBar = null;
      document.body.classList.remove('has-offline-bar');
    }
  }
  window.addEventListener('online', renderConnectivity);
  window.addEventListener('offline', renderConnectivity);

  // ---- service worker registration + update prompt ----
  function register() {
    navigator.serviceWorker.register('sw.js').then(reg => {

      // A worker already waiting means an update was downloaded on a previous
      // visit but never applied.
      if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg);

      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          // controller check: on a first-ever install there is nothing to
          // update *from*, so no prompt.
          if (sw.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(reg);
        });
      });

      // Check for a new deployment when the app is brought back to the front —
      // the usual pattern for a site-ops tool left open all day.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(err => console.warn('[pwa] service worker registration failed', err));

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  }

  function promptUpdate(reg) {
    toast('<strong>Update available.</strong> A newer version of the app has been downloaded.', [
      { label: 'Later' },
      {
        label: 'Reload now', primary: true, onClick: () => {
          if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING');
        }
      }
    ]);
  }

  // ---- "Add to home screen" for people using it from a browser ----
  let installEvent = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    if (sessionStorage.getItem('cla_install_dismissed') === '1') return;
    toast('<strong>Install this app?</strong> It will work offline on site and open like a normal app.', [
      { label: 'Not now', onClick: () => sessionStorage.setItem('cla_install_dismissed', '1') },
      {
        label: 'Install', primary: true, onClick: () => {
          if (!installEvent) return;
          installEvent.prompt();
          installEvent = null;
        }
      }
    ]);
  });

  // Exposed so a Settings/About page can offer an explicit install button.
  window.PWA = {
    canInstall() { return !!installEvent; },
    install() { if (installEvent) { installEvent.prompt(); installEvent = null; } },
    isStandalone() {
      return window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true ||
        document.referrer.startsWith('android-app://');
    },
    version() { return (typeof APP_VERSION !== 'undefined') ? APP_VERSION : 'unknown'; },
    async clearCaches() {
      if (!('caches' in window)) return false;
      const names = await caches.keys();
      await Promise.all(names.map(n => caches.delete(n)));
      return true;
    }
  };

  function boot() {
    renderConnectivity();
    if (canRegister) register();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
