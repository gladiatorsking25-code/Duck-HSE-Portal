// project-link.js — "Link to project" for permits, assessments and checklists.
//
// Those records stay in the user's own storage (js/storage.js); linking one to
// a project also creates or updates a tracked item on that project, so the
// team sees it on the project dashboard. Only projects where the user can
// edit are offered.

const ProjectLink = (function () {
  'use strict';

  // Fill a <select> with the user's editable projects. `current` is the
  // project already linked (kept even if the list can't load).
  function mount(select, current) {
    if (!select) return;
    select.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'Not linked to a project';
    select.appendChild(none);
    if (current) {
      const cur = document.createElement('option');
      cur.value = current;
      cur.textContent = 'Linked project';
      select.appendChild(cur);
      select.value = current;
    }
    if (typeof Projects === 'undefined') return;
    Projects.ready().then(() => {
      firebase.auth().onAuthStateChanged((user) => {
        if (!user) return;
        const unsub = Projects.watchMine(user.uid, (list) => {
          unsub();
          const keep = select.value;
          select.innerHTML = '';
          select.appendChild(none);
          list.filter((p) => p.status !== 'archived' && Projects.can.edit(p, user.uid))
            .sort((a, b) => a.name.localeCompare(b.name))
            .forEach((p) => {
              const o = document.createElement('option');
              o.value = p.id;
              o.textContent = p.number ? `${p.number} · ${p.name}` : p.name;
              o.dataset.number = p.number || '';
              select.appendChild(o);
            });
          select.value = [...select.options].some((o) => o.value === keep) ? keep : '';
        });
      });
    }).catch(() => { /* accounts not configured: leave the select as is */ });
  }

  // Create/update the project item for a record. Waits (up to 10 s) so a page
  // that navigates away right after saving doesn't cut the write off.
  async function sync(projectId, ref, input) {
    if (!projectId || typeof Projects === 'undefined') return { ok: true };
    const timeout = new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: 'timeout' }), 10000));
    const work = Projects.upsertLinkedItem(projectId, ref, input)
      .then(() => ({ ok: true }))
      .catch((err) => { console.error('Project link failed', err); return { ok: false, error: err.message || String(err) }; });
    return Promise.race([work, timeout]);
  }

  return { mount, sync };
})();
