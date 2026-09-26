// project-page.js — the project dashboard (project.html).
// Live view of one project: details, headline numbers, tracked items, team and
// activity. Everything a teammate typed is rendered escaped (Projects.esc).

(function () {
  'use strict';

  renderSidebar('projects');
  renderFooter('app-footer');

  const $ = (id) => document.getElementById(id);
  const esc = Projects.esc;
  const projectId = new URLSearchParams(location.search).get('id') || '';

  let uid = null;
  let project = null;
  let items = [];
  let editingItem = null;

  function banner(host, kind, text) {
    host.innerHTML = '';
    if (!text) return;
    const d = document.createElement('div');
    d.className = 'banner banner-' + kind;
    d.style.margin = '10px 0';
    d.textContent = text;
    host.appendChild(d);
  }
  function friendly(err) {
    if (err && err.code === 'permission-denied') {
      return 'You do not have permission to do that. Your role may not allow it, or your subscription is not active.';
    }
    return (err && err.message) || 'Something went wrong.';
  }
  function who(u) { return (project && project.memberEmails && project.memberEmails[u]) || (u ? 'Former member' : ''); }
  function fmtWhen(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function canEdit() { return Projects.can.edit(project, uid); }
  function canManage() { return Projects.can.manage(project, uid); }
  function isOwner() { return Projects.roleIn(project, uid) === 'owner'; }

  // ---- Options that don't depend on data --------------------------------------
  const typeOptions = Object.entries(Projects.ITEM_TYPES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  $('iType').innerHTML = typeOptions;
  $('itemType').innerHTML = '<option value="">All types</option>' + typeOptions;

  // ---- Header ------------------------------------------------------------------
  function renderHead() {
    $('pageTitle').textContent = project.name;
    $('crumbName').textContent = project.number || project.name;
    document.title = project.name + ' · Duck HSE Portal';
    const facts = [
      ['Number', project.number], ['Client', project.client], ['Location', project.location],
      ['Start', project.startDate], ['End', project.endDate],
      ['Your role', Projects.ROLES[Projects.roleIn(project, uid)]]
    ].filter(([, v]) => v).map(([k, v]) => `<span>${esc(k)}: <b>${esc(v)}</b></span>`).join('');
    const drive = /^https:\/\/drive\.google\.com\//.test(project.driveFolderUrl || '')
      ? `<a class="btn btn-sm" href="${esc(project.driveFolderUrl)}" target="_blank" rel="noopener noreferrer">Open Drive folder</a>` : '';
    $('projectHead').innerHTML = `
      <div style="min-width:0; flex:1;">
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <span class="pill pill-${esc(project.status)}">${esc(Projects.STATUS[project.status] || project.status)}</span>
        </div>
        <div class="ph-facts">${facts}</div>
        ${project.description ? `<p class="project-desc">${esc(project.description)}</p>` : ''}
      </div>
      <div class="ph-actions">
        ${drive}
        ${canManage() ? '<button class="btn btn-sm" type="button" id="editProjectBtn">Edit details</button>' : ''}
      </div>`;
    const eb = $('editProjectBtn');
    if (eb) eb.addEventListener('click', openProjectModal);
    $('addItemBtn').hidden = !canEdit() || project.status === 'archived';
    $('inviteForm').hidden = !canManage() || project.status === 'archived';
    $('leaveBtn').hidden = isOwner();
  }

  // ---- Numbers -------------------------------------------------------------------
  function renderStats() {
    const t = today();
    const monthAgo = Date.now() - 30 * 86400000;
    const open = items.filter((i) => i.status === 'open').length;
    const prog = items.filter((i) => i.status === 'in_progress').length;
    const overdue = items.filter((i) => Projects.isOverdue(i, t)).length;
    const closed30 = items.filter((i) => i.status === 'closed' && Projects.millis(i.closedAt || i.updatedAt) >= monthAgo).length;
    const card = (label, value, cls, foot) => `<div class="card stat-card"><div class="label">${label}</div><div class="value ${cls}">${value}</div><div class="foot">${foot}</div></div>`;
    $('statCards').innerHTML =
      card('Open', open, '', 'Not started yet') +
      card('In progress', prog, '', 'Being worked on') +
      card('Overdue', overdue, overdue ? 'danger' : 'ok', 'Past their due date') +
      card('Closed', closed30, 'ok', 'In the last 30 days');
  }

  // ---- Items table --------------------------------------------------------------
  function filteredItems() {
    const q = $('itemSearch').value.trim().toLowerCase();
    const st = $('itemStatus').value;
    const ty = $('itemType').value;
    const mine = $('onlyMine').checked;
    const t = today();
    const rank = { critical: 0, high: 1, medium: 2, low: 3 };
    return items.filter((i) => {
      if (st === 'notclosed' && i.status === 'closed') return false;
      if (st === 'overdue' && !Projects.isOverdue(i, t)) return false;
      if (st && !['notclosed', 'overdue'].includes(st) && i.status !== st) return false;
      if (ty && i.type !== ty) return false;
      if (mine && i.assigneeUid !== uid) return false;
      if (q && !`${i.title} ${i.details || ''} ${i.location || ''} ${i.ref ? i.ref.label : ''}`.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) =>
      (a.status === 'closed') - (b.status === 'closed') ||
      Projects.isOverdue(b, t) - Projects.isOverdue(a, t) ||
      (rank[a.priority] - rank[b.priority]) ||
      String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));
  }

  function renderItems() {
    const list = filteredItems();
    const host = $('itemsTable');
    if (!items.length) {
      host.innerHTML = `<div class="card empty-state"><div class="icon">🗂️</div>Nothing tracked yet.${canEdit() ? ' Add actions, inspections, observations and more, or link permits and assessments from their own pages.' : ''}</div>`;
      return;
    }
    if (!list.length) { host.innerHTML = '<div class="card empty-state">No items match these filters.</div>'; return; }
    const t = today();
    host.innerHTML = `<div class="table-scroll"><table class="data-table">
      <thead><tr><th>Item</th><th>Type</th><th>Priority</th><th>Due</th><th>Assigned</th><th>Status</th></tr></thead>
      <tbody>${list.map((i) => {
        const overdue = Projects.isOverdue(i, t);
        return `<tr class="${overdue ? 'is-overdue' : ''} ${i.status === 'closed' ? 'is-closed' : ''}" data-id="${esc(i.id)}" tabindex="0" style="cursor:pointer;">
          <td><div class="item-title">${esc(i.title)}</div>${i.location || i.ref ? `<div class="item-sub">${esc([i.location, i.ref && i.ref.label].filter(Boolean).join(' · '))}</div>` : ''}</td>
          <td>${esc(Projects.ITEM_TYPES[i.type] || i.type)}</td>
          <td>${['critical', 'high'].includes(i.priority) ? `<span class="pill pill-${esc(i.priority)}">${esc(Projects.PRIORITY[i.priority])}</span>` : esc(Projects.PRIORITY[i.priority] || '')}</td>
          <td class="num">${i.dueDate ? esc(i.dueDate) : '—'}${overdue ? ' <span class="pill pill-overdue">Overdue</span>' : ''}</td>
          <td>${esc(who(i.assigneeUid)) || '—'}</td>
          <td><span class="pill pill-${esc(i.status)}">${esc(Projects.ITEM_STATUS[i.status] || i.status)}</span></td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  }

  $('itemsTable').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) openItemModal(items.find((i) => i.id === tr.dataset.id));
  });
  $('itemsTable').addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openItemModal(items.find((i) => i.id === tr.dataset.id)); }
  });
  ['itemSearch', 'itemStatus', 'itemType', 'onlyMine'].forEach((id) =>
    $(id).addEventListener(id === 'itemSearch' ? 'input' : 'change', renderItems));

  // ---- Team -----------------------------------------------------------------------
  function renderTeam() {
    const roleRank = { owner: 0, manager: 1, editor: 2, viewer: 3 };
    const mine = Projects.roleIn(project, uid);
    const members = Object.entries(project.members || {}).sort((a, b) => roleRank[a[1]] - roleRank[b[1]]);
    $('memberList').innerHTML = members.map(([mUid, role]) => {
      // Owners manage everyone; managers manage editors and viewers.
      const manageable = mUid !== uid && role !== 'owner' &&
        (mine === 'owner' || (mine === 'manager' && ['editor', 'viewer'].includes(role)));
      const roleOpts = (mine === 'owner' ? ['manager', 'editor', 'viewer'] : ['editor', 'viewer'])
        .map((r) => `<option value="${r}"${r === role ? ' selected' : ''}>${esc(Projects.ROLES[r])}</option>`).join('');
      return `<li>
        <span class="m-email">${esc(who(mUid))}${mUid === uid ? ' (you)' : ''}</span>
        <span class="m-actions">${manageable
          ? `<select data-role-for="${esc(mUid)}" aria-label="Role">${roleOpts}</select>
             ${mine === 'owner' ? `<button class="btn btn-sm" type="button" data-transfer="${esc(mUid)}" title="Make this person the owner">Make owner</button>` : ''}
             <button class="btn btn-sm btn-danger" type="button" data-remove="${esc(mUid)}">Remove</button>`
          : `<span class="pill">${esc(Projects.ROLES[role] || role)}</span>`}</span>
      </li>`;
    }).join('');

    const pending = project.pendingInvites || [];
    $('pendingList').innerHTML = pending.length ? `<div class="item-sub" style="margin-top:12px; font-weight:600;">Invited, not joined yet</div>
      <ul class="member-list">${pending.map((p) => `<li><span class="m-email">${esc(p.email)}</span>
        <span class="m-actions"><span class="pill">${esc(Projects.ROLES[p.role] || p.role)}</span>
        ${canManage() && (mine === 'owner' || ['editor', 'viewer'].includes(p.role)) ? `<button class="btn btn-sm" type="button" data-cancel="${esc(p.email)}">Cancel</button>` : ''}</span></li>`).join('')}</ul>` : '';

    // Assignee options for the item form.
    $('iAssignee').innerHTML = '<option value="">Unassigned</option>' + members
      .map(([mUid]) => `<option value="${esc(mUid)}">${esc(who(mUid))}</option>`).join('');
  }

  async function teamAction(fn, okText) {
    banner($('teamMsg'), 'info', 'Working…');
    try { await fn(); banner($('teamMsg'), 'ok', okText); }
    catch (err) { banner($('teamMsg'), 'danger', friendly(err)); }
  }

  $('memberList').addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-role-for]');
    if (!sel) return;
    const email = who(sel.dataset.roleFor);
    teamAction(() => Projects.setMember(projectId, email, sel.value), `${email} is now ${Projects.ROLES[sel.value].toLowerCase()}.`);
  });
  $('memberList').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    const tr = e.target.closest('[data-transfer]');
    if (rm) {
      const email = who(rm.dataset.remove);
      if (!confirm(`Remove ${email} from this project?`)) return;
      teamAction(() => Projects.removeMember(projectId, rm.dataset.remove), `${email} was removed.`);
    } else if (tr) {
      const email = who(tr.dataset.transfer);
      if (!confirm(`Make ${email} the owner of this project? You will become a manager.`)) return;
      teamAction(() => Projects.setMember(projectId, email, 'owner'), `${email} is now the owner.`);
    }
  });
  $('pendingList').addEventListener('click', (e) => {
    const c = e.target.closest('[data-cancel]');
    if (c) teamAction(() => Projects.cancelInvite(projectId, c.dataset.cancel), 'Invite cancelled.');
  });
  $('inviteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('inviteEmail').value.trim();
    const role = $('inviteRole').value;
    $('inviteBtn').disabled = true;
    try {
      const res = await Projects.setMember(projectId, email, role);
      banner($('teamMsg'), 'ok', res && res.status === 'added'
        ? `${email} was added as ${Projects.ROLES[role].toLowerCase()}.`
        : `Invite saved. ${email} joins as soon as they sign in with a verified email address.`);
      $('inviteEmail').value = '';
    } catch (err) { banner($('teamMsg'), 'danger', friendly(err)); }
    $('inviteBtn').disabled = false;
  });
  $('leaveBtn').addEventListener('click', () => {
    if (!confirm('Leave this project? You will lose access to it.')) return;
    Projects.removeMember(projectId, uid).then(() => { location.href = 'projects.html'; })
      .catch((err) => banner($('teamMsg'), 'danger', friendly(err)));
  });

  // ---- Activity --------------------------------------------------------------------
  function renderActivity(events) {
    $('activityFeed').innerHTML = events.length ? events.map((ev) =>
      `<li><time>${esc(fmtWhen(Projects.millis(ev.at)))}</time>${esc(ev.email || who(ev.uid))}: ${esc(ev.summary)}</li>`).join('')
      : '<li>No activity yet.</li>';
  }

  // ---- Item modal --------------------------------------------------------------------
  function openItemModal(item) {
    editingItem = item || null;
    const readOnly = !canEdit() || project.status === 'archived';
    $('itemModalTitle').textContent = item ? (readOnly ? 'Item' : 'Edit item') : 'Add item';
    $('iTitle').value = item ? item.title : '';
    $('iType').value = item ? item.type : 'action';
    $('iStatus').value = item ? item.status : 'open';
    $('iPriority').value = item ? item.priority : 'medium';
    $('iDue').value = item ? (item.dueDate || '') : '';
    $('iAssignee').value = item ? (item.assigneeUid || '') : '';
    $('iLocation').value = item ? (item.location || '') : '';
    $('iDetails').value = item ? (item.details || '') : '';
    $('itemFields').disabled = readOnly;
    $('itemSaveBtn').hidden = readOnly;
    $('itemDeleteBtn').hidden = !item || !canManage() || project.status === 'archived';
    const refPage = { permit: 'permit.html?mode=view&id=', assessment: 'history.html?id=', checklist: 'checklist.html?id=' };
    $('itemRef').innerHTML = item && item.ref
      ? `Linked ${esc(item.ref.kind)}: ${item.createdBy === uid ? `<a href="${refPage[item.ref.kind] || '#'}${encodeURIComponent(item.ref.id)}">${esc(item.ref.label)}</a>` : esc(item.ref.label)}` : '';
    $('itemMeta').textContent = item
      ? `Added by ${who(item.createdBy)} on ${fmtWhen(Projects.millis(item.createdAt))}. Last updated by ${who(item.updatedBy)} on ${fmtWhen(Projects.millis(item.updatedAt))}.`
      : '';
    $('itemFormError').innerHTML = '';
    ProjectFiles.renderItemFiles(item ? item.id : '');
    $('itemModal').hidden = false;
    if (!readOnly) $('iTitle').focus();
  }
  $('addItemBtn').addEventListener('click', () => openItemModal(null));
  $('itemForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('itemSaveBtn').disabled = true;
    try {
      await Projects.saveItem(projectId, editingItem && editingItem.id, Object.assign({}, editingItem || {}, {
        title: $('iTitle').value, type: $('iType').value, status: $('iStatus').value,
        priority: $('iPriority').value, dueDate: $('iDue').value, assigneeUid: $('iAssignee').value,
        location: $('iLocation').value, details: $('iDetails').value
      }));
      $('itemModal').hidden = true;
    } catch (err) { banner($('itemFormError'), 'danger', friendly(err)); }
    $('itemSaveBtn').disabled = false;
  });
  $('itemDeleteBtn').addEventListener('click', async () => {
    if (!editingItem || !confirm(`Delete "${editingItem.title}"? This cannot be undone.`)) return;
    try { await Projects.deleteItem(projectId, editingItem); $('itemModal').hidden = true; }
    catch (err) { banner($('itemFormError'), 'danger', friendly(err)); }
  });

  // ---- Project modal ------------------------------------------------------------------
  function openProjectModal() {
    $('pName').value = project.name || '';
    $('pNumber').value = project.number || '';
    $('pStatus').value = project.status || 'active';
    $('pClient').value = project.client || '';
    $('pLocation').value = project.location || '';
    $('pStart').value = project.startDate || '';
    $('pEnd').value = project.endDate || '';
    $('pDrive').value = project.driveFolderUrl || '';
    $('pDesc').value = project.description || '';
    $('projectFormError').innerHTML = '';
    $('projectModal').hidden = false;
    $('pName').focus();
  }
  $('projectForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const drive = $('pDrive').value.trim();
    if (drive && !/^https:\/\/drive\.google\.com\//.test(drive)) {
      banner($('projectFormError'), 'danger', 'The Drive link must start with https://drive.google.com/');
      return;
    }
    $('projectSaveBtn').disabled = true;
    try {
      await Projects.update(projectId, {
        name: $('pName').value, number: $('pNumber').value, status: $('pStatus').value,
        client: $('pClient').value, location: $('pLocation').value, startDate: $('pStart').value,
        endDate: $('pEnd').value, driveFolderUrl: drive, description: $('pDesc').value
      });
      $('projectModal').hidden = true;
    } catch (err) { banner($('projectFormError'), 'danger', friendly(err)); }
    $('projectSaveBtn').disabled = false;
  });

  // Shared modal closing.
  ['itemModal', 'projectModal'].forEach((id) => {
    $(id).addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === $(id)) $(id).hidden = true; });
  });
  document.addEventListener('keydown', (e) => {
    // A files window or photo viewer on top closes first (project-files.js).
    if (e.key !== 'Escape' || (typeof ProjectFiles !== 'undefined' && ProjectFiles.modalOpen())) return;
    ['itemModal', 'projectModal'].forEach((id) => { $(id).hidden = true; });
  });

  // ---- Export ----------------------------------------------------------------------
  $('exportBtn').addEventListener('click', () => {
    const csv = Projects.itemsCsv(project, filteredItems());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = (project.number || project.name).replace(/[^\w.-]+/g, '_').slice(0, 60) + '_items.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // ---- Load --------------------------------------------------------------------------
  if (!projectId) { banner($('notice'), 'danger', 'No project selected.'); return; }
  Projects.ready().then(() => {
    firebase.auth().onAuthStateChanged((user) => {
      if (!user || uid) return;
      uid = user.uid;
      Projects.watchProject(projectId, (p) => {
        if (!p || !Projects.roleIn(p, uid)) {
          $('projectBody').hidden = true;
          banner($('notice'), 'danger', 'This project does not exist or you are no longer a member.');
          return;
        }
        const first = !project;
        project = p;
        $('projectBody').hidden = false;
        $('exportBtn').disabled = false;
        banner($('notice'), '', '');
        renderHead(); renderTeam(); renderStats(); renderItems();
        if (first) {
          ProjectFiles.init({
            projectId, friendly, project: () => project, uid: () => uid, items: () => items,
            openItemId: () => (!$('itemModal').hidden && editingItem ? editingItem.id : '')
          });
        }
        ProjectFiles.onProject();
      }, () => banner($('notice'), 'danger', 'This project does not exist or you do not have access to it.'));
      Projects.watchItems(projectId, (list) => { items = list; if (project) { renderStats(); renderItems(); ProjectFiles.renderFiles(); } });
      Projects.watchActivity(projectId, renderActivity, 30);
    });
  }).catch((err) => banner($('notice'), 'danger', err.message));
})();
