// sw.js — service worker for the Duck HSE Portal app.
//
// Why this exists:
//   1. **Offline.** The app itself needs no network (everything is localStorage),
//      but without a service worker the *pages* still have to be fetched. On a
//      site with no signal — which is most of them — the app would show a browser
//      error page. Wrapped as a Play Store TWA that looks like a crash.
//   2. **Updates actually landing.** HTML is served network-first, so a new
//      deployment is picked up as soon as the device has a connection, instead of
//      users sitting on a stale cached build. js/pwa.js turns the waiting worker
//      into a visible "Update available" prompt.
//
// Bump CACHE_VERSION on every deployment (it must match APP_VERSION in
// js/app-version.js — see the note there).

const CACHE_VERSION = 'v1.10.0';
const CACHE_NAME = `cla-${CACHE_VERSION}`;
const OFFLINE_URL = 'offline.html';

// How long a same-origin asset request waits for the network before falling
// back to its cached copy. Short enough not to be felt on a bad site link,
// long enough that a working connection nearly always wins the race.
const ASSET_NETWORK_TIMEOUT_MS = 2000;

// Paths the worker must never cache or serve: credentials and environment
// files. None of them belongs in this folder at all (START-HERE.txt step 3),
// and this list must never be added to PRECACHE_URLS below.
const NEVER_CACHE = /(^|\/)(service-account[^/]*\.json|\.env(\.[^/]*)?|[^/]*\.(pem|p12|key|keystore|jks))$/i;

// Everything the app needs to run with no network at all.
const PRECACHE_URLS = [
  './',
  'index.html',
  'login.html',
  'assessment.html',
  'crane-selector.html',
  'history.html',
  'permit.html',
  'permits.html',
  'projects.html',
  'project.html',
  'settings.html',
  'terms.html',
  'privacy.html',
  'account-deletion.html',
  'about.html',
  'checklist.html',
  'checklists.html',
  'subscribe.html',
  'admin.html',
  'audits.html',
  'audit.html',
  'offline.html',
  'manifest.webmanifest',
  'css/styles.css',
  'css/hse-dashboard.css',
  'css/audit.css',
  'css/projects.css',
  'js/app-version.js',
  'js/consent.js',
  'js/crane-data.js',
  'js/storage.js',
  'js/nav.js',
  'js/lift-planning.js',
  'js/assessment-detail.js',
  'js/assessment.js',
  'js/crane-selector.js',
  'js/crane-visual.js',
  'js/permit.js',
  'js/projects.js',
  'js/project-page.js',
  'js/project-link.js',
  'js/signature-pad.js',
  'js/pwa.js',
  'js/i18n.js',
  'js/checklist-data.js',
  'js/checklist.js',
  'js/mailer.js',
  'js/subscription-config.js',
  'js/entitlements.js',
  'js/access.js',
  'js/billing.js',
  'js/admin.js',
  // Admin control centre: the HSE analytics stack. All of it has to be cached —
  // the whole point is that a monthly return can be analysed on a site with no
  // signal, and none of it calls out to a network at any stage.
  'js/xlsx-reader.js',
  'js/hse-parser.js',
  'js/hse-kpi.js',
  'js/hse-analysis.js',
  'js/hse-charts.js',
  'js/hse-ai.js',
  'js/admin-dashboard.js',
  // HSE audit preparation. Everything except the Google Drive upload works
  // offline — evidence is gathered and packs are compiled on the device, and
  // the Google sign-in / Drive scripts are loaded only when uploading.
  'js/audit-checklists.js',
  'js/audit-store.js',
  'js/audit-pack.js',
  'js/audit-viewer.js',
  'js/zip-writer.js',
  'js/gdrive.js',
  'js/audits.js',
  'js/audit.js',
  'js/photo.js',
  'js/certificate-storage.js',
  'js/certificate-report.js',
  'js/firebase-config.js',
  'js/firebase-init.js',
  'js/firebase-auth.js',
  'js/cloud-sync.js',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-192.png',
  'assets/icons/icon-maskable-512.png',
  'assets/icons/apple-touch-icon-180.png',
  'assets/icons/favicon-32.png',
  'assets/icons/favicon.ico'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // addAll() is all-or-nothing; a single 404 would abort the whole install and
    // leave the app with no offline copy, so each URL is added independently.
    await Promise.all(PRECACHE_URLS.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (e) {
        console.warn('[sw] precache skipped:', url, e && e.message);
      }
    }));
  })());
  // Don't skipWaiting automatically — js/pwa.js asks the user first, so a lift
  // assessment being typed in isn't reloaded out from under someone.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(n => (n.startsWith('cla-') && n !== CACHE_NAME) ? caches.delete(n) : null));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) { /* not supported */ }
    }
    await self.clients.claim();
  })());
});

// js/pwa.js posts this when the user accepts an update.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' || (event.data && event.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});

function isHtmlRequest(request) {
  return request.mode === 'navigate' ||
    (request.headers.get('accept') || '').includes('text/html');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never touch Firebase / Firestore traffic — those must always hit the
  // network and have their own offline persistence.
  if (/firebase|firestore|googleapis\.com\/(identitytoolkit|securetoken)/.test(url.href)) return;

  // Never cache a credential, even one deployed by mistake: the same-origin
  // branch below stores every response it fetches, which would copy a leaked
  // key into the Cache Storage of everyone who requested it.
  if (url.origin === self.location.origin && NEVER_CACHE.test(url.pathname)) return;

  // ---- HTML: network-first, so deployments land; cache is the fallback ----
  if (isHtmlRequest(request)) {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        const fresh = preload || await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        const offline = await caches.match(OFFLINE_URL);
        return offline || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  // ---- Google Fonts: stale-while-revalidate, and never fail the page ----
  if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      const network = fetch(request).then(res => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await network) ||
        new Response('', { status: 200, headers: { 'Content-Type': 'text/css' } });
    })());
    return;
  }

  // ---- Same-origin static assets: network-first with a short timeout ----
  //
  // Cache-first would be faster, but it lets a page load new HTML alongside a
  // stale cached script — the version-skew bug that makes a shipped fix look
  // like it never deployed. Racing the network against a short timer keeps the
  // CSS and JS honest whenever there is any connection at all, and still falls
  // back to the cached copy instantly when the request fails (offline) or the
  // link is too slow to wait for.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);

      const fromNetwork = fetch(request).then(res => {
        if (res && res.ok) cache.put(request, res.clone());
        return res;
      });

      const cached = await cache.match(request, { ignoreSearch: true });

      if (!cached) {
        // Nothing cached — we have to wait for the network, however long it takes.
        try { return await fromNetwork; }
        catch (e) { return new Response('', { status: 504, statusText: 'Offline and not cached' }); }
      }

      // Cached copy exists: give the network a brief head start, then serve the
      // cache rather than leave someone on site staring at a blank screen. The
      // network response still lands in the cache for the next load.
      const timeout = new Promise(resolve => setTimeout(() => resolve(null), ASSET_NETWORK_TIMEOUT_MS));
      const winner = await Promise.race([fromNetwork.catch(() => null), timeout]);
      return winner || cached;
    })());
  }
});
