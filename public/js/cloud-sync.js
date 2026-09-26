// cloud-sync.js — keeps localStorage (which every page already reads
// synchronously) in sync with Firestore, so no other file needs to become
// async. Two directions:
//   - Firestore -> localStorage: real-time onSnapshot listeners merge cloud
//     documents into the same localStorage keys js/storage.js already uses
//     (last-write-wins by an `updatedAt` timestamp), so the next call to
//     DB.getAssessments()/DB.getPermits() just sees the merged result.
//   - localStorage -> Firestore: js/storage.js calls CloudSync.push()/
//     .remove() right after every local save/delete (see the _cloudPush /
//     _cloudRemove hooks added there). These are fire-and-forget — a slow or
//     offline connection never blocks or breaks the local save.
//
// No-ops entirely when Firebase isn't configured (FIREBASE_READY is false).

const CloudSync = (function () {
  let unsubAssessments = null;
  let unsubPermits = null;
  let currentUid = null;

  function userCollection(uid, name) {
    return firebase.firestore().collection('users').doc(uid).collection(name);
  }

  function mergeIncoming(localKey, incomingDocs) {
    let local = [];
    try { local = JSON.parse(localStorage.getItem(localKey) || '[]'); } catch (e) { /* start fresh */ }
    const byId = new Map(local.map(r => [r.id, r]));
    incomingDocs.forEach(doc => {
      const existing = byId.get(doc.id);
      if (!existing || (doc.updatedAt || 0) >= (existing.updatedAt || 0)) {
        byId.set(doc.id, doc);
      }
    });
    localStorage.setItem(localKey, JSON.stringify(Array.from(byId.values())));
  }

  return {
    async start(uid) {
      if (!FIREBASE_READY || currentUid === uid) return;
      this.stop();
      await firebaseReadyPromise;
      currentUid = uid;

      unsubAssessments = userCollection(uid, 'assessments').onSnapshot(snap => {
        mergeIncoming(DB.KEYS.assessments, snap.docs.map(d => Object.assign({ id: d.id }, d.data())));
      }, err => console.error('Assessment cloud sync error', err));

      unsubPermits = userCollection(uid, 'permits').onSnapshot(snap => {
        mergeIncoming(DB.KEYS.permits, snap.docs.map(d => Object.assign({ id: d.id }, d.data())));
      }, err => console.error('Permit cloud sync error', err));
    },

    stop() {
      if (unsubAssessments) unsubAssessments();
      if (unsubPermits) unsubPermits();
      unsubAssessments = null;
      unsubPermits = null;
      currentUid = null;
    },

    push(collectionName, record) {
      if (!FIREBASE_READY || !currentUid || !record || !record.id) return;
      record.updatedAt = Date.now();
      userCollection(currentUid, collectionName).doc(record.id)
        .set(record, { merge: true })
        .catch(err => console.error('Cloud push failed (saved locally regardless):', err));
    },

    remove(collectionName, id) {
      if (!FIREBASE_READY || !currentUid || !id) return;
      userCollection(currentUid, collectionName).doc(id).delete()
        .catch(err => console.error('Cloud delete failed (removed locally regardless):', err));
    }
  };
})();
