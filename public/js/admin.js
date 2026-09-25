// admin.js — the owner's subscription control panel (admin.html).
//
// Every action here calls an admin-only Cloud Function (functions/index.js); the
// server re-checks that the caller's own users/{uid}.role === 'admin' before
// doing anything, so this page is a convenience, not the security boundary — a
// non-admin who loads it can't do anything the functions won't allow.

(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const DAY = 86400000;
  let allUsers = [];

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmt(ms) { return ms ? new Date(Number(ms)).toLocaleDateString() : '—'; }
  function fns() { return firebase.functions(); }

  function stateOf(u) {
    // Reuse the same entitlement logic the app uses, for a consistent label.
    const a = Entitlements.computeAccess({
      role: u.role, adminGrantUntil: u.adminGrantUntil, compForever: u.compForever,
      subscriptionStatus: u.subscriptionStatus, subscriptionExpiryMillis: u.subscriptionExpiryMillis,
      trialEndsAt: u.trialEndsAt
    });
    return a;
  }

  function badge(a) {
    const cls = a.hasAccess ? (a.state === 'locked' ? 'badge-fail' : 'badge-ok') : 'badge-fail';
    return `<span class="badge ${a.hasAccess ? 'badge-ok' : 'badge-fail'}"><span class="badge-dot"></span>${esc(a.state)}</span>`;
  }

  async function call(name, data) {
    $('adminResult').innerHTML = '<div class="hint">Working…</div>';
    try {
      const res = await fns().httpsCallable(name)(data);
      $('adminResult').innerHTML = '';
      return res.data;
    } catch (e) {
      $('adminResult').innerHTML = `<div class="banner banner-danger"><div>${esc(e.message || 'Action failed')}</div></div>`;
      throw e;
    }
  }

  async function load() {
    $('adminTable').innerHTML = '<div class="hint">Loading users…</div>';
    try {
      const data = await call('adminListUsers', { limit: 500 });
      allUsers = data.users || [];
      render();
    } catch (e) {
      $('adminTable').innerHTML = '';
    }
  }

  async function act(uid, action, untilMillis) {
    try {
      await call('adminSetSubscription', { targetUid: uid, action, untilMillis });
      await load();
    } catch (e) { /* message already shown */ }
  }
  async function setRole(uid, role) {
    if (!confirm(role === 'admin' ? 'Grant admin rights to this account?' : 'Remove admin rights from this account?')) return;
    try { await call('adminSetRole', { targetUid: uid, role }); await load(); } catch (e) {}
  }

  function note(kind, text) {
    $('adminResult').innerHTML = `<div class="banner banner-${kind}"><div>${esc(text)}</div></div>`;
  }

  // Deleting an account (when its owner asks, see docs/DEPLOY.md): the server
  // first says what would happen, then the admin types the address to confirm.
  async function deleteAccount(uid) {
    let plan;
    try { plan = await call('adminDeleteAccount', { targetUid: uid, dryRun: true }); } catch (e) { return; }
    const byId = plan.email === plan.uid;
    const lines = [
      `Delete the account ${plan.email}? This cannot be undone.`,
      '',
      'Their sign-in, profile and saved records are deleted and they leave every project. Project history keeps what they did, shown as "deleted user".'
    ];
    if (plan.leave.length) lines.push('', `They leave: ${plan.leave.join(', ')}.`);
    if (plan.archive.length) lines.push('', `Archived, because nobody else belongs to them: ${plan.archive.join(', ')}.`);
    const sub = plan.subscription;
    if (sub && sub.provider === 'stripe') {
      lines.push('', sub.renews
        ? `WARNING: their card subscription still renews. Cancel it in Stripe first (customer ${sub.stripeCustomerId || 'unknown'}), or they will keep being charged.`
        : 'Their card subscription is already cancelled and will not renew.');
    } else if (sub) {
      lines.push('', 'WARNING: their Google Play subscription is still running. Ask them to cancel it in Google Play, or cancel it in Play Console (Order management), or they will keep being charged.');
    }
    lines.push('', byId ? 'To confirm, type the account id:' : 'To confirm, type their email address:');
    const typed = prompt(lines.join('\n'));
    if (typed == null) return;
    if (typed.trim().toLowerCase() !== plan.email.toLowerCase()) {
      note('warn', 'Nothing was deleted: what you typed did not match.');
      return;
    }
    try {
      const res = await call('adminDeleteAccount', { targetUid: uid, confirm: typed.trim() });
      await load();
      const parts = [`The account ${res.email} was deleted.`];
      if (res.archived) parts.push(`${res.archived} project${res.archived === 1 ? ' was' : 's were'} archived.`);
      if (res.subscription && res.subscription.renews) parts.push('Remember to cancel their subscription.');
      note('ok', parts.join(' '));
    } catch (e) { /* message already shown */ }
  }

  function render() {
    const q = ($('adminSearch').value || '').toLowerCase();
    const list = allUsers.filter(u => {
      if (!q) return true;
      return `${u.email || ''} ${u.uid} ${u.subscriptionStatus || ''} ${u.role || ''}`.toLowerCase().includes(q);
    });
    if (!list.length) { $('adminTable').innerHTML = '<div class="card empty-state">No users match.</div>'; return; }

    $('adminTable').innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>Email</th><th>State</th><th>Status</th><th>Trial ends</th><th>Sub expires</th><th>Grant until</th><th>Role</th><th>Manage</th>
        </tr></thead>
        <tbody>
          ${list.map(u => {
            const a = stateOf(u);
            const grant = u.compForever ? 'forever' : fmt(u.adminGrantUntil);
            return `<tr>
              <td>${esc(u.email || '—')}${u.email && !u.emailVerified ? ' <span class="hint">(not verified)</span>' : ''}
                ${u.signInDeleted ? '<div class="hint">Sign-in deleted</div>' : ''}<div class="hint num">${esc(u.uid.slice(0, 10))}…</div></td>
              <td>${badge(a)}</td>
              <td>${esc(u.subscriptionStatus || '—')}${u.subscriptionProvider ? `<div class="hint">${esc(u.subscriptionProvider)}${u.cancelAtPeriodEnd ? ' · cancelling' : ''}</div>` : ''}</td>
              <td class="num">${fmt(u.trialEndsAt)}</td>
              <td class="num">${fmt(u.subscriptionExpiryMillis)}</td>
              <td class="num">${esc(grant)}</td>
              <td>${u.role === 'admin' ? '<span class="badge badge-warn"><span class="badge-dot"></span>admin</span>' : 'user'}</td>
              <td>
                <div class="admin-actions">
                  <button class="btn btn-sm" data-a="grant" data-d="30" data-u="${esc(u.uid)}">+30d</button>
                  <button class="btn btn-sm" data-a="grant" data-d="365" data-u="${esc(u.uid)}">+1y</button>
                  <button class="btn btn-sm" data-a="grantForever" data-u="${esc(u.uid)}">Forever</button>
                  <button class="btn btn-sm" data-a="extendTrial" data-d="14" data-u="${esc(u.uid)}">+14d trial</button>
                  <button class="btn btn-sm btn-danger" data-a="revoke" data-u="${esc(u.uid)}">Revoke</button>
                  <button class="btn btn-sm" data-a="role" data-r="${u.role === 'admin' ? 'user' : 'admin'}" data-u="${esc(u.uid)}">${u.role === 'admin' ? 'Remove admin' : 'Make admin'}</button>
                  ${u.role === 'admin' ? '' : `<button class="btn btn-sm btn-danger" data-a="delete" data-u="${esc(u.uid)}">Delete account</button>`}
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    $('adminTable').querySelectorAll('button[data-a]').forEach(b => {
      b.addEventListener('click', () => {
        const uid = b.getAttribute('data-u');
        const a = b.getAttribute('data-a');
        if (a === 'grant') act(uid, 'grant', Date.now() + Number(b.getAttribute('data-d')) * DAY);
        else if (a === 'grantForever') act(uid, 'grant', 'forever');
        else if (a === 'extendTrial') act(uid, 'extendTrial', Date.now() + Number(b.getAttribute('data-d')) * DAY);
        else if (a === 'revoke') { if (confirm('Revoke access for this account?')) act(uid, 'revoke'); }
        else if (a === 'role') setRole(uid, b.getAttribute('data-r'));
        else if (a === 'delete') deleteAccount(uid);
      });
    });
  }

  // ---- boot ----
  if (!Access.firebaseOn()) {
    $('adminGate').innerHTML = '<div class="banner banner-warn"><div><strong>Backend not configured.</strong> The admin dashboard manages real subscriptions once Firebase is set up (see SECURITY.md). Nothing to manage yet.</div></div>';
    return;
  }
  Access.handleAdminPage((ctx) => {
    if (!ctx.configured) return;
    if (!ctx.isAdmin) {
      const email = ctx.user ? (ctx.user.email || '') : '';
      const uid = ctx.user ? ctx.user.uid : '';
      $('adminGate').innerHTML = `<div class="banner banner-warn"><div>
        <strong>This account isn’t an administrator yet.</strong>
        Signed in as ${esc(email)} <span class="hint num">(${esc(uid)})</span>.
        <br><br>To make it the owner/admin, do this once in the Firebase Console:
        <ol style="margin:8px 0 0; padding-left:20px;">
          <li>Firestore Database → the <span class="num">users</span> collection → open the document with ID <strong class="num">${esc(uid)}</strong>
            (create it if it isn’t there yet — that means the Cloud Functions haven’t been deployed).</li>
          <li>Add/set a field <strong>role</strong> (string) = <strong>admin</strong>.</li>
          <li>Reload this page.</li>
        </ol>
        After the first admin, you can promote others from this dashboard.
      </div></div>`;
      $('adminBody').hidden = true;
      return;
    }
    $('adminGate').innerHTML = '';
    $('adminBody').hidden = false;
    $('adminRefresh').addEventListener('click', load);
    $('adminSearch').addEventListener('input', render);
    load();
  });
})();
