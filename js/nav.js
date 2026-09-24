function renderSidebar(active) {
  const el = document.getElementById('sidebar');
  if (!el) return;
  const items = [
    { key: 'index', href: 'index.html', label: 'Dashboard', icon: 'grid' },
    { key: 'assessment', href: 'assessment.html', label: 'New assessment', icon: 'gauge' },
    { key: 'selector', href: 'crane-selector.html', label: 'Crane selector', icon: 'search' },
    { key: 'history', href: 'history.html', label: 'Assessment history', icon: 'clock' },
    { key: 'permit', href: 'permit.html', label: 'New permit', icon: 'doc' },
    { key: 'permits', href: 'permits.html', label: 'All permits', icon: 'stack' },
    { key: 'settings', href: 'settings.html', label: 'Fleet & backup', icon: 'gear' },
    { key: 'about', href: 'about.html', label: 'About & legal', icon: 'info' },
    { key: 'checklist', href: 'checklist.html', label: 'Equipment checklist', icon: 'clipboard' },
    { key: 'checklists', href: 'checklists.html', label: 'Checklist records', icon: 'stack' },
    { key: 'audits', href: 'audits.html', label: 'HSE audit preparation', icon: 'shield' },
  ];
  // Grouped by key, not by position, so adding an item can never shift
  // another into the wrong section.
  const group = (keys) => keys.map((k) => items.find((i) => i.key === k)).filter(Boolean).map(navLink).join('');
  const icons = {
    grid: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" stroke="currentColor" stroke-width="1.6" fill="none"/>',
    gauge: '<path d="M12 21a9 9 0 100-18 9 9 0 000 18z" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M12 12l4-4M12 12v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M20 20l-5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    clock: '<path d="M12 21a9 9 0 100-18 9 9 0 000 18z" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M12 7v5l3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    doc: '<path d="M6 2h9l4 4v16H6z" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M9 12h7M9 16h7M9 8h3" stroke="currentColor" stroke-width="1.4"/>',
    stack: '<path d="M12 3l9 5-9 5-9-5z" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M3 13l9 5 9-5M3 8l9 5 9-5" stroke="currentColor" stroke-width="1.6" fill="none"/>',
    gear: '<path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M19.4 13a7.4 7.4 0 000-2l2-1.5-2-3.4-2.4.6a7.6 7.6 0 00-1.7-1L14.7 3h-4l-.6 2.7a7.6 7.6 0 00-1.7 1l-2.4-.6-2 3.4L6 11a7.4 7.4 0 000 2l-2 1.6 2 3.4 2.4-.6a7.6 7.6 0 001.7 1l.6 2.6h4l.6-2.6a7.6 7.6 0 001.7-1l2.4.6 2-3.4z" stroke="currentColor" stroke-width="1.3" fill="none"/>',
    info: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M12 11v6M12 7.5h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    clipboard: '<path d="M9 3h6v3H9z" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M9 4.5H6v17h12v-17h-3" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M9 11l1.6 1.6L14 9M9 16.5h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/>',
    shield: '<path d="M12 3l7 3v5.5c0 4.6-3 8.4-7 9.5-4-1.1-7-4.9-7-9.5V6z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M8.8 12.2l2.2 2.2 4.3-4.6" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
  };
  el.innerHTML = `
    <div class="brand">
      <div class="brand-row">
        <span class="mark" style="font-size:20px; background:var(--amber);">🦆</span>
        <div>
          <h1>Duck HSE Portal</h1>
          <div class="sub">HSE PORTAL</div>
        </div>
      </div>
    </div>
    <nav class="nav">
      <div class="section-label">Operations</div>
      ${group(['index', 'assessment', 'selector', 'history'])}
      <div class="section-label">Permits</div>
      ${group(['permit', 'permits'])}
      <div class="section-label">Equipment</div>
      ${group(['checklist', 'checklists'])}
      <div class="section-label">HSE audit</div>
      ${group(['audits'])}
      <div class="section-label">Configuration</div>
      ${group(['settings', 'about'])}
    </nav>
    <div class="sidebar-foot">
      <div id="navSubStatus" class="nav-sub-status"></div>
      Data stored locally in this browser.<br>Export a backup regularly.<br>
      <a href="terms.html">Terms</a> · <a href="privacy.html">Privacy</a> · <a href="account-deletion.html">Delete data</a><br>
      ${typeof APP_BUILD_LABEL !== 'undefined' ? `<span class="sidebar-build">${APP_BUILD_LABEL}</span><br>` : ''}
      <a href="#" class="logout-link" id="navLogoutLink">Sign out</a></div>
  `;
  const logoutLink = document.getElementById('navLogoutLink');
  if (logoutLink) {
    logoutLink.addEventListener('click', (e) => {
      e.preventDefault();
      // Real-accounts mode: sign out of Firebase (and local) via Access.
      if (typeof Access !== 'undefined' && Access.firebaseOn && Access.firebaseOn()) {
        Access.signOut();
        return;
      }
      if (typeof AUTH !== 'undefined') AUTH.logout();
      location.href = 'login.html';
    });
  }
  renderSubscriptionStatus();
  mountMobileNavToggle();
  // Additive: if Firebase has been configured (see js/firebase-config.js),
  // start watching real cloud auth state / Firestore sync. No-ops entirely
  // when Firebase isn't set up, so this is safe on every page that calls
  // renderSidebar() whether or not cloud sync exists yet.
  if (typeof CloudAuth !== 'undefined') CloudAuth.watchAndSync();
  function navLink(item) {
    return `<a href="${item.href}" class="${item.key === active ? 'active' : ''}">
      <svg viewBox="0 0 24 24" width="16" height="16">${icons[item.icon]}</svg>
      ${item.label}
    </a>`;
  }
}

// Shows the account's trial / subscription state in the sidebar, plus a
// Subscribe link and (for admins) an Admin link. No-ops entirely when Firebase
// isn't configured, so the local-only build is unchanged.
function renderSubscriptionStatus() {
  const el = document.getElementById('navSubStatus');
  if (!el) return;
  if (typeof Access === 'undefined' || !Access.firebaseOn || !Access.firebaseOn()) return;

  Access.armAuthWatch(function (user, access, doc) {
    if (!user || !access) { el.innerHTML = ''; return; }
    let line = '';
    if (access.state === 'admin') {
      line = 'Administrator account.';
    } else if (access.state === 'trial') {
      const left = (typeof Entitlements !== 'undefined') ? Entitlements.daysLeft(access.until) : null;
      line = `Free trial — ${left} day${left === 1 ? '' : 's'} left. <a href="subscribe.html">Subscribe</a>`;
    } else if (access.state === 'active' || access.state === 'granted') {
      line = 'Subscription active.';
    } else if (access.state === 'locked') {
      line = 'Trial ended. <a href="subscribe.html">Subscribe</a>';
    }
    const adminLink = (doc && doc.role === 'admin') ? ' · <a href="admin.html">Admin</a>' : '';
    const emailLine = user.email ? `<span class="nav-sub-email">${user.email}</span><br>` : '';
    el.innerHTML = line ? `${emailLine}<span class="nav-sub-line">${line}${adminLink}</span>` : (emailLine + (adminLink ? `<span class="nav-sub-line">${adminLink.replace(/^ · /, '')}</span>` : ''));
  });
}

// On phones the sidebar becomes an off-canvas drawer (see the "Phone / tablet
// layout" block in css/styles.css). This adds the hamburger button that opens
// it, plus the backdrop that closes it. On desktop the button is hidden by CSS
// and none of this is visible, so every page gets it unconditionally.
function mountMobileNavToggle() {
  const topbar = document.querySelector('.topbar');
  if (!topbar || document.getElementById('navToggleBtn')) return;

  const btn = document.createElement('button');
  btn.id = 'navToggleBtn';
  btn.className = 'nav-toggle no-print';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Open navigation menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  topbar.insertBefore(btn, topbar.firstChild);

  const backdrop = document.createElement('div');
  backdrop.className = 'nav-backdrop no-print';
  document.body.appendChild(backdrop);

  const setOpen = (open) => {
    document.body.classList.toggle('nav-open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
  };

  btn.addEventListener('click', () => setOpen(!document.body.classList.contains('nav-open')));
  backdrop.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
  // Following a link should leave the drawer closed behind it.
  document.querySelectorAll('.sidebar a').forEach(a => a.addEventListener('click', () => setOpen(false)));
  // Rotating to landscape / resizing past the breakpoint shouldn't strand it open.
  window.addEventListener('resize', () => { if (window.innerWidth > 900) setOpen(false); });
}

function renderDisclaimer(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = `
    <div class="banner banner-warn">
      <svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 2L1 21h22L12 2z" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M12 9v5M12 17h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      <div><strong>Verify before you rely on this.</strong> An appointed person must check every lift against the crane's official, current load chart before work begins — this tool supports planning, it does not replace it. Lifting operations should be planned and controlled in line with <strong>${typeof ADOSH_COP_REFERENCE !== 'undefined' ? ADOSH_COP_REFERENCE : 'ADOSH-SF CoP 34.0 – Safe Use of Lifting Equipment and Lifting Accessories'}</strong> and any other applicable local regulations, which take precedence over anything shown here.</div>
    </div>
  `;
}

function renderFooter(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = `
    <div class="app-footer no-print">
      <span class="trial-tag">Trial · Educational use only</span>
      <span>Not for operational lift decisions.</span>
      <span class="sep">|</span>
      <span>Developed by <strong>Sabir Amin</strong></span>
      <span class="sep">|</span>
      <span>Email: <a href="mailto:sabiriis143@gmail.com">sabiriis143@gmail.com</a></span>
      <span class="sep">|</span>
      <span><a href="terms.html">Terms of Use</a></span>
      <span class="sep">|</span>
      <span><a href="privacy.html">Privacy Notice</a></span>
      <span class="sep">|</span>
      <span><a href="account-deletion.html">Delete my data</a></span>
      <span class="sep">|</span>
      <span><a href="about.html">About${typeof APP_VERSION !== 'undefined' ? ' · v' + APP_VERSION : ''}</a></span>
    </div>
  `;
}
