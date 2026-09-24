// projects.js — shared projects, their tracked items and activity, in Firestore.
//
// Unlike assessments/permits (one person's records, cached in localStorage),
// projects are shared by a team, so they are read and written straight from
// Firestore with live listeners. Who may do what is enforced by
// firestore.rules; team membership is changed only through the
// projectSetMember / projectRemoveMember / projectAcceptInvites Cloud
// Functions (functions/projects.js).
//
// Everything a teammate typed is untrusted: pages must render it with
// Projects.esc() or textContent, never raw into innerHTML.

const Projects = (function () {
  'use strict';

  const STATUS = {
    planning: 'Planning', active: 'Active', on_hold: 'On hold', closed: 'Closed', archived: 'Archived'
  };
  const ROLES = { owner: 'Owner', manager: 'Manager', editor: 'Editor', viewer: 'Viewer' };
  const ITEM_TYPES = {
    action: 'Action', inspection: 'Inspection', observation: 'Observation', incident: 'Incident',
    permit: 'Permit', assessment: 'Lift assessment', checklist: 'Checklist', audit: 'Audit',
    document: 'Document', meeting: 'Meeting', other: 'Other'
  };
  const ITEM_STATUS = { open: 'Open', in_progress: 'In progress', closed: 'Closed' };
  const PRIORITY = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  async function fb() {
    if (typeof FIREBASE_READY === 'undefined' || !FIREBASE_READY) throw new Error('Accounts are not configured.');
    return firebaseReadyPromise;
  }
  function ts() { return firebase.firestore.FieldValue.serverTimestamp(); }
  function me() {
    const u = firebase.auth().currentUser;
    if (!u) throw new Error('Please sign in again.');
    return u;
  }
  function col() { return firebase.firestore().collection('projects'); }
  function millis(t) { return t && t.toMillis ? t.toMillis() : (typeof t === 'number' ? t : 0); }
  function withId(d) { return Object.assign({ id: d.id }, d.data()); }

  function roleIn(project, uid) { return (project && project.members && project.members[uid]) || ''; }
  const can = {
    edit(project, uid) { return ['owner', 'manager', 'editor'].includes(roleIn(project, uid)); },
    manage(project, uid) { return ['owner', 'manager'].includes(roleIn(project, uid)); }
  };

  // Only the fields the rules allow a client to write on a project.
  function projectFields(input) {
    const pick = (k, max) => String(input[k] == null ? '' : input[k]).trim().slice(0, max);
    return {
      name: pick('name', 120), number: pick('number', 60), client: pick('client', 120),
      location: pick('location', 160), description: pick('description', 4000),
      status: STATUS[input.status] ? input.status : 'active',
      startDate: pick('startDate', 10), endDate: pick('endDate', 10),
      driveFolderUrl: pick('driveFolderUrl', 500)
    };
  }

  function itemFields(input) {
    const pick = (k, max) => String(input[k] == null ? '' : input[k]).trim().slice(0, max);
    const out = {
      type: ITEM_TYPES[input.type] ? input.type : 'action',
      title: pick('title', 200),
      status: ITEM_STATUS[input.status] ? input.status : 'open',
      priority: PRIORITY[input.priority] ? input.priority : 'medium',
      dueDate: pick('dueDate', 10), assigneeUid: pick('assigneeUid', 128),
      location: pick('location', 160), details: pick('details', 5000)
    };
    if (input.ref && input.ref.kind && input.ref.id) {
      out.ref = { kind: String(input.ref.kind), id: String(input.ref.id).slice(0, 80), label: String(input.ref.label || '').slice(0, 200) };
    }
    return out;
  }

  async function logActivity(projectId, action, summary, itemId) {
    const u = me();
    try {
      await col().doc(projectId).collection('activity').add({
        at: ts(), uid: u.uid, email: u.email || '', action,
        itemId: itemId || '', summary: String(summary || '').slice(0, 300)
      });
    } catch (e) { console.warn('Activity log write failed', e); }
  }

  async function callable(name, data) {
    await fb();
    try {
      const res = await firebase.functions().httpsCallable(name)(data);
      return res.data;
    } catch (e) {
      throw new Error(e.message || 'The request failed.');
    }
  }

  return {
    STATUS, ROLES, ITEM_TYPES, ITEM_STATUS, PRIORITY, esc, millis, roleIn, can,

    ready: fb,
    currentUser() { return firebase.auth().currentUser; },

    // Live list of the projects you belong to. Returns an unsubscribe function.
    watchMine(uid, cb, onError) {
      return col().where('memberUids', 'array-contains', uid).onSnapshot(
        (snap) => cb(snap.docs.map(withId)),
        (err) => { console.error(err); if (onError) onError(err); }
      );
    },
    watchProject(id, cb, onError) {
      return col().doc(id).onSnapshot(
        (d) => cb(d.exists ? withId(d) : null),
        (err) => { console.error(err); if (onError) onError(err); }
      );
    },
    watchItems(id, cb, onError) {
      return col().doc(id).collection('items').onSnapshot(
        (snap) => cb(snap.docs.map(withId)),
        (err) => { console.error(err); if (onError) onError(err); }
      );
    },
    watchActivity(id, cb, limit) {
      return col().doc(id).collection('activity').orderBy('at', 'desc').limit(limit || 30).onSnapshot(
        (snap) => cb(snap.docs.map(withId)),
        (err) => console.error(err)
      );
    },

    async create(input) {
      await fb();
      const u = me();
      const data = Object.assign(projectFields(input), {
        ownerUid: u.uid, members: { [u.uid]: 'owner' }, memberUids: [u.uid],
        memberEmails: { [u.uid]: (u.email || '').toLowerCase() }, pendingInvites: [],
        createdAt: ts(), createdBy: u.uid, updatedAt: ts(), updatedBy: u.uid
      });
      if (!data.name) throw new Error('Give the project a name.');
      const ref = await col().add(data);
      await logActivity(ref.id, 'project.create', 'Created the project');
      return ref.id;
    },

    async update(id, input) {
      await fb();
      const u = me();
      const data = Object.assign(projectFields(input), { updatedAt: ts(), updatedBy: u.uid });
      if (!data.name) throw new Error('Give the project a name.');
      await col().doc(id).update(data);
      await logActivity(id, 'project.update', 'Updated the project details');
    },

    async saveItem(projectId, itemId, input) {
      await fb();
      const u = me();
      const data = Object.assign(itemFields(input), { updatedAt: ts(), updatedBy: u.uid });
      if (!data.title) throw new Error('Give the item a title.');
      const items = col().doc(projectId).collection('items');
      if (!itemId) {
        const ref = await items.add(Object.assign(data, { createdAt: ts(), createdBy: u.uid }));
        await logActivity(projectId, 'item.create', `Added ${ITEM_TYPES[data.type].toLowerCase()}: ${data.title}`, ref.id);
        return ref.id;
      }
      const before = (await items.doc(itemId).get()).data() || {};
      if (data.status === 'closed' && before.status !== 'closed') data.closedAt = ts();
      await items.doc(itemId).update(data);
      const action = data.status === 'closed' && before.status !== 'closed' ? 'item.close'
        : before.status === 'closed' && data.status !== 'closed' ? 'item.reopen' : 'item.update';
      const verb = { 'item.close': 'Closed', 'item.reopen': 'Reopened', 'item.update': 'Updated' }[action];
      await logActivity(projectId, action, `${verb}: ${data.title}`, itemId);
      return itemId;
    },

    async deleteItem(projectId, item) {
      await fb();
      await col().doc(projectId).collection('items').doc(item.id).delete();
      await logActivity(projectId, 'item.delete', `Deleted: ${item.title}`, item.id);
    },

    // Link a record from another module (permit, assessment, checklist) to a
    // project item, creating the item the first time and updating it after.
    async upsertLinkedItem(projectId, ref, input) {
      await fb();
      const items = col().doc(projectId).collection('items');
      const found = await items.where('ref.kind', '==', ref.kind).where('ref.id', '==', ref.id).limit(1).get();
      const existing = found.empty ? null : withId(found.docs[0]);
      const merged = Object.assign({}, existing || {}, input, { ref, type: ref.kind });
      return this.saveItem(projectId, existing ? existing.id : null, merged);
    },

    setMember(projectId, email, role) { return callable('projectSetMember', { projectId, email, role }); },
    removeMember(projectId, uid) { return callable('projectRemoveMember', { projectId, uid }); },
    cancelInvite(projectId, email) { return callable('projectRemoveMember', { projectId, email }); },
    acceptInvites() { return callable('projectAcceptInvites', {}); },

    // CSV export of a project's items (opens in Excel).
    itemsCsv(project, items) {
      const cell = (v) => {
        let s = String(v == null ? '' : v);
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;   // stop spreadsheet formula injection
        return '"' + s.replace(/"/g, '""') + '"';
      };
      const who = (uid) => (project.memberEmails || {})[uid] || '';
      const rows = [['Type', 'Title', 'Status', 'Priority', 'Due', 'Assignee', 'Location', 'Details', 'Linked record', 'Created by', 'Last updated']];
      items.forEach((i) => rows.push([
        ITEM_TYPES[i.type] || i.type, i.title, ITEM_STATUS[i.status] || i.status, PRIORITY[i.priority] || i.priority,
        i.dueDate || '', who(i.assigneeUid), i.location || '', i.details || '',
        i.ref ? i.ref.label : '', who(i.createdBy),
        millis(i.updatedAt) ? new Date(millis(i.updatedAt)).toISOString().slice(0, 16).replace('T', ' ') : ''
      ]));
      return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
    },

    isOverdue(item, today) {
      const t = today || new Date().toISOString().slice(0, 10);
      return item.status !== 'closed' && !!item.dueDate && item.dueDate < t;
    }
  };
})();
