// functions/index.js — the server-side authority for accounts and subscriptions.
//
// This is where "control over subscriptions" actually lives. The client can only
// READ a user's entitlement; every WRITE to an entitlement field happens here,
// with the Admin SDK (which bypasses Firestore rules), so a user can never grant
// themselves access by editing the app.
//
// It is a SCAFFOLD: structured correctly, but you must deploy it and complete the
// one-time Google Play / Firebase setup — I can't do either from here. See
// SECURITY.md and the setup notes below.
//
// ---- One-time setup ----
// 1. Firebase project on the "Blaze" plan (Cloud Functions require it; the free
//    tier inside Blaze means a small subscriber base costs ~$0/month).
// 2. Google Cloud Console (same project): APIs & Services → enable
//    "Google Play Android Developer API".
// 3. Play Console → Setup → API access → link this Cloud project, then give the
//    Functions runtime service account (PROJECT_ID@appspot.gserviceaccount.com)
//    the "View financial data" permission.
// 4. Make yourself the first admin: Firebase Console → Firestore → users/<your uid>
//    → set field  role: "admin"  (String). Only an admin can use the admin
//    functions below; this bootstrap is done once, by hand, with console rights.
// 5. For Real-time Developer Notifications: Play Console → Monetization setup →
//    create a Pub/Sub topic named to match RTDN_TOPIC below.
// 6. `firebase deploy --only functions,firestore:rules`

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { google } = require('googleapis');

admin.initializeApp();
const db = admin.firestore();

// Must match SUBSCRIPTION_CONFIG.TRIAL_DAYS in js/subscription-config.js.
const TRIAL_DAYS = 14;
const RTDN_TOPIC = 'play-rtdn';
const DAY_MS = 86400000;

// -------------------------------------------------------------------------
// Account creation → start the free trial, server-side (tamper-proof).
// -------------------------------------------------------------------------
exports.onUserCreate = functions.auth.user().onCreate(async (user) => {
  const now = Date.now();
  await db.collection('users').doc(user.uid).set({
    email: user.email || null,
    role: 'user',
    subscriptionStatus: 'trial',
    trialStartedAt: now,
    trialEndsAt: now + TRIAL_DAYS * DAY_MS,
    createdAt: FieldValue.serverTimestamp()
  }, { merge: true });
});

// -------------------------------------------------------------------------
// Play Billing purchase verification (called by the app after a purchase).
// -------------------------------------------------------------------------
async function getAndroidPublisher() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/androidpublisher']
  });
  const authClient = await auth.getClient();
  return google.androidpublisher({ version: 'v3', auth: authClient });
}

async function applyPurchaseToUser(uid, packageName, subscriptionId, purchaseToken) {
  const androidpublisher = await getAndroidPublisher();
  const res = await androidpublisher.purchases.subscriptions.get({
    packageName, subscriptionId, token: purchaseToken
  });
  const sub = res.data;
  const expiry = sub.expiryTimeMillis ? Number(sub.expiryTimeMillis) : null;
  // paymentState: 0 pending, 1 received, 2 free trial, 3 deferred.
  const active = expiry && expiry > Date.now();
  const status = active ? (sub.paymentState === 0 ? 'in_grace' : 'active') : 'expired';

  // A lapsed Play purchase must not end a card subscription that is still live.
  const userRef = db.collection('users').doc(uid);
  const current = (await userRef.get()).data() || {};
  const stripeLive = current.subscriptionProvider === 'stripe'
    && ['active', 'in_grace'].includes(current.subscriptionStatus)
    && Number(current.subscriptionExpiryMillis || 0) > Date.now();
  if (active || !stripeLive) {
    await userRef.set({
      subscriptionProvider: 'play',
      subscriptionStatus: status,
      subscriptionId,
      subscriptionExpiryMillis: expiry,
      subscriptionUpdatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  }

  // Remember which user owns this token so RTDN events can find them later.
  await db.collection('purchaseTokens').doc(purchaseToken).set({
    uid, packageName, subscriptionId, updatedAt: Date.now()
  }, { merge: true });

  return { status, expiryTimeMillis: expiry };
}

exports.verifyPlayPurchase = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in before verifying a purchase.');
  }
  const { packageName, subscriptionId, purchaseToken } = data || {};
  if (!packageName || !subscriptionId || !purchaseToken) {
    throw new functions.https.HttpsError('invalid-argument', 'packageName, subscriptionId, and purchaseToken are all required.');
  }
  try {
    return await applyPurchaseToUser(context.auth.uid, packageName, subscriptionId, purchaseToken);
  } catch (err) {
    console.error('Play purchase verification failed', err);
    throw new functions.https.HttpsError('internal', 'Could not verify this purchase with Google Play.');
  }
});

// -------------------------------------------------------------------------
// Real-time Developer Notifications: Play pushes renew/cancel/expire/grace
// events here the moment they happen, so a cancelled subscription is reflected
// immediately instead of only when the user reopens the app.
// -------------------------------------------------------------------------
exports.playRTDN = functions.pubsub.topic(RTDN_TOPIC).onPublish(async (message) => {
  let payload;
  try {
    payload = JSON.parse(Buffer.from(message.data, 'base64').toString());
  } catch (e) {
    console.error('Bad RTDN payload', e);
    return;
  }
  const note = payload.subscriptionNotification;
  if (!note || !note.purchaseToken) return; // ignore test/other notifications

  const map = await db.collection('purchaseTokens').doc(note.purchaseToken).get();
  if (!map.exists) { console.warn('RTDN for unknown token', note.purchaseToken); return; }
  const { uid, packageName, subscriptionId } = map.data();
  try {
    await applyPurchaseToUser(uid, packageName, subscriptionId || note.subscriptionId, note.purchaseToken);
  } catch (err) {
    console.error('RTDN re-verification failed', err);
  }
});

// -------------------------------------------------------------------------
// Admin control — grant / revoke / extend a subscription by hand.
// -------------------------------------------------------------------------
async function assertAdmin(context) {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in.');
  const snap = await db.collection('users').doc(context.auth.uid).get();
  if (!snap.exists || snap.data().role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required.');
  }
  return context.auth.uid;
}

// action: 'grant' (comp access until a date or forever), 'revoke', 'extendTrial'.
exports.adminSetSubscription = functions.https.onCall(async (data, context) => {
  const adminUid = await assertAdmin(context);
  const { targetUid, action, untilMillis } = data || {};
  if (!targetUid || !action) {
    throw new functions.https.HttpsError('invalid-argument', 'targetUid and action are required.');
  }
  const ref = db.collection('users').doc(targetUid);
  const patch = { subscriptionUpdatedAt: FieldValue.serverTimestamp() };
  // A grant or trial extension must not hide a live paid subscription's
  // status (it would read as unpaid once the grant ends).
  const cur = (await ref.get()).data() || {};
  const paying = ['active', 'in_grace'].includes(cur.subscriptionStatus) && Number(cur.subscriptionExpiryMillis || 0) > Date.now();

  if (action === 'grant') {
    if (untilMillis === 'forever') { patch.compForever = true; patch.adminGrantUntil = FieldValue.delete(); }
    else {
      const until = Number(untilMillis);
      if (!until || until <= Date.now()) throw new functions.https.HttpsError('invalid-argument', 'untilMillis must be a future timestamp or "forever".');
      patch.adminGrantUntil = until; patch.compForever = false;
    }
    if (!paying) patch.subscriptionStatus = 'comped';
  } else if (action === 'revoke') {
    patch.adminGrantUntil = FieldValue.delete();
    patch.compForever = false;
    patch.subscriptionStatus = 'revoked';
    // End any running trial too, or the account would keep trial access.
    patch.trialEndsAt = Date.now();
  } else if (action === 'extendTrial') {
    const until = Number(untilMillis);
    if (!until || until <= Date.now()) throw new functions.https.HttpsError('invalid-argument', 'untilMillis must be a future timestamp.');
    patch.trialEndsAt = until;
    if (!paying) patch.subscriptionStatus = 'trial';
  } else {
    throw new functions.https.HttpsError('invalid-argument', 'Unknown action: ' + action);
  }

  await ref.set(patch, { merge: true });
  await db.collection('adminLog').add({
    at: FieldValue.serverTimestamp(),
    byUid: adminUid, targetUid, action, untilMillis: untilMillis || null
  });
  const after = await ref.get();
  return Object.assign({ uid: targetUid }, after.data());
});

// Set (or clear) another account's admin role. Only an existing admin can do
// this; you bootstrap the very first admin by hand in the Firebase Console.
exports.adminSetRole = functions.https.onCall(async (data, context) => {
  const adminUid = await assertAdmin(context);
  const { targetUid, role } = data || {};
  if (!targetUid || (role !== 'admin' && role !== 'user')) {
    throw new functions.https.HttpsError('invalid-argument', 'targetUid and role ("admin"|"user") required.');
  }
  if (targetUid === adminUid && role !== 'admin') {
    throw new functions.https.HttpsError('failed-precondition', 'You cannot remove your own admin role.');
  }
  await db.collection('users').doc(targetUid).set({ role }, { merge: true });
  await db.collection('adminLog').add({
    at: FieldValue.serverTimestamp(), byUid: adminUid, targetUid, action: 'setRole:' + role
  });
  return { uid: targetUid, role };
});

// List accounts for the admin dashboard (paged).
exports.adminListUsers = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);
  const limit = Math.min(Number((data && data.limit) || 100), 500);
  let q = db.collection('users').orderBy('createdAt', 'desc').limit(limit);
  if (data && data.startAfterCreatedAt) {
    q = db.collection('users').orderBy('createdAt', 'desc').startAfter(new Date(data.startAfterCreatedAt)).limit(limit);
  }
  const snap = await q.get();
  const users = snap.docs.map(d => {
    const u = d.data();
    return {
      uid: d.id,
      email: u.email || null,
      role: u.role || 'user',
      subscriptionStatus: u.subscriptionStatus || null,
      trialEndsAt: u.trialEndsAt || null,
      subscriptionExpiryMillis: u.subscriptionExpiryMillis || null,
      adminGrantUntil: u.adminGrantUntil || null,
      compForever: !!u.compForever,
      subscriptionProvider: u.subscriptionProvider || null,
      cancelAtPeriodEnd: !!u.cancelAtPeriodEnd,
      createdAt: u.createdAt && u.createdAt.toMillis ? u.createdAt.toMillis() : null
    };
  });
  return { users, count: users.length };
});

// -------------------------------------------------------------------------
// Projects — team membership (see projects.js for the rules it enforces).
// -------------------------------------------------------------------------
const { planSetMember, planRemoveMember, normEmail, PlanError } = require('./projects');

// Mirrors hasAccess() in firestore.rules and computeAccess() in the app.
function userHasAccess(u, now = Date.now()) {
  if (!u) return false;
  if (u.role === 'admin') return true;
  if (u.subscriptionStatus === 'revoked') return false;
  return u.compForever === true
    || Number(u.adminGrantUntil || 0) > now
    || (['active', 'in_grace'].includes(u.subscriptionStatus) && Number(u.subscriptionExpiryMillis || 0) > now)
    || Number(u.trialEndsAt || 0) > now;
}

async function assertSubscribed(context, why) {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in.');
  const snap = await db.collection('users').doc(context.auth.uid).get();
  if (!userHasAccess(snap.data())) {
    throw new functions.https.HttpsError('permission-denied', `An active subscription is required to ${why || 'manage a team'}.`);
  }
  return context.auth.uid;
}

function asHttpsError(err) {
  if (err instanceof PlanError) return new functions.https.HttpsError(err.code, err.message);
  if (err instanceof functions.https.HttpsError) return err;
  console.error(err);
  return new functions.https.HttpsError('internal', 'Something went wrong. Please try again.');
}

async function findUserByEmail(email) {
  try {
    const u = await admin.auth().getUserByEmail(email);
    return { uid: u.uid, email, verified: !!u.emailVerified };
  } catch (e) {
    if (e.code === 'auth/user-not-found') return { uid: null, email, verified: false };
    throw e;
  }
}

function logActivity(tx, projectRef, uid, email, action, summary) {
  tx.set(projectRef.collection('activity').doc(), {
    at: FieldValue.serverTimestamp(), uid, email: email || '',
    action, itemId: '', summary: String(summary).slice(0, 300)
  });
}

// Invite someone by email, change their role, or hand over ownership.
// data: { projectId, email, role }
exports.projectSetMember = functions.https.onCall(async (data, context) => {
  try {
    const callerUid = await assertSubscribed(context);
    const { projectId, role } = data || {};
    const email = normEmail(data && data.email);
    if (!projectId || typeof projectId !== 'string') throw new PlanError('invalid-argument', 'projectId is required.');
    const target = await findUserByEmail(email);
    const ref = db.collection('projects').doc(projectId);
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new PlanError('not-found', 'Project not found.');
      const { patch, invite } = planSetMember(snap.data(), callerUid, target, role);
      tx.update(ref, Object.assign({}, patch, {
        updatedAt: FieldValue.serverTimestamp(), updatedBy: callerUid
      }));
      if (invite) {
        tx.set(db.collection('projectInvites').doc(invite.email),
          { invites: { [projectId]: invite.role } }, { merge: true });
      }
      logActivity(tx, ref, callerUid, context.auth.token.email,
        'project.update', invite ? `Invited ${email} as ${role}` : `Set ${email} as ${role}`);
      return { status: invite ? 'invited' : 'added' };
    });
  } catch (err) { throw asHttpsError(err); }
});

// Remove a member (data.uid) or cancel a pending invite (data.email).
exports.projectRemoveMember = functions.https.onCall(async (data, context) => {
  try {
    if (!context.auth) throw new PlanError('unauthenticated', 'Sign in.');
    const callerUid = context.auth.uid;
    const { projectId, uid, email } = data || {};
    if (!projectId || typeof projectId !== 'string') throw new PlanError('invalid-argument', 'projectId is required.');
    const ref = db.collection('projects').doc(projectId);
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new PlanError('not-found', 'Project not found.');
      const project = snap.data();
      const plan = planRemoveMember(project, callerUid, { uid, email });
      tx.update(ref, Object.assign({}, plan.patch, {
        updatedAt: FieldValue.serverTimestamp(), updatedBy: callerUid
      }));
      if (plan.email) {
        tx.set(db.collection('projectInvites').doc(plan.email),
          { invites: { [projectId]: FieldValue.delete() } }, { merge: true });
      }
      const who = plan.email || (project.memberEmails || {})[uid] || 'a member';
      logActivity(tx, ref, callerUid, context.auth.token.email, 'project.update',
        plan.email ? `Cancelled the invite for ${who}` : (uid === callerUid ? `${who} left the project` : `Removed ${who}`));
      return { status: 'removed' };
    });
  } catch (err) { throw asHttpsError(err); }
});

// Called by the app after sign-in: joins every project this (verified) email
// address was invited to.
exports.projectAcceptInvites = functions.https.onCall(async (data, context) => {
  try {
    if (!context.auth) throw new PlanError('unauthenticated', 'Sign in.');
    if (!context.auth.token.email_verified) return { joined: [], needsVerification: true };
    const uid = context.auth.uid;
    const email = normEmail(context.auth.token.email);
    const inviteRef = db.collection('projectInvites').doc(email);
    const inviteSnap = await inviteRef.get();
    const invites = (inviteSnap.exists && inviteSnap.data().invites) || {};
    const joined = [];
    for (const projectId of Object.keys(invites)) {
      const ref = db.collection('projects').doc(projectId);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return;
        const p = snap.data();
        // The project's own pending list is the source of truth: an invite
        // that was cancelled there is ignored.
        const invite = (p.pendingInvites || []).find((i) => i.email === email);
        if (!invite || p.status === 'archived') return;
        const members = Object.assign({}, p.members);
        const memberEmails = Object.assign({}, p.memberEmails);
        if (!members[uid]) members[uid] = invite.role;
        memberEmails[uid] = email;
        tx.update(ref, {
          members, memberUids: Object.keys(members), memberEmails,
          pendingInvites: p.pendingInvites.filter((i) => i.email !== email),
          updatedAt: FieldValue.serverTimestamp(), updatedBy: uid
        });
        logActivity(tx, ref, uid, email, 'project.update', `${email} joined as ${invite.role}`);
        joined.push(projectId);
      });
    }
    if (inviteSnap.exists) await inviteRef.delete();
    return { joined, needsVerification: false };
  } catch (err) { throw asHttpsError(err); }
});

// -------------------------------------------------------------------------
// Stripe — card subscriptions on the website (see stripe.js).
// Secrets: firebase functions:secrets:set STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET
// Settings: functions/.env (APP_ORIGIN, STRIPE_PRICE_MONTHLY, …) — see .env.example
// -------------------------------------------------------------------------
const billing = require('./stripe');
const STRIPE_SECRETS = { secrets: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] };
let stripeClient = null;
function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new functions.https.HttpsError('failed-precondition', 'Card payments are not set up yet.');
  }
  if (!stripeClient) stripeClient = require('stripe')(process.env.STRIPE_SECRET_KEY, stripeTestHost());
  return stripeClient;
}
// Local testing only: STRIPE_API_BASE points the emulator at a fake Stripe API
// (test/e2e-payments.mjs, or stripe-mock). Ignored when deployed.
function stripeTestHost() {
  const base = process.env.FUNCTIONS_EMULATOR === 'true' && process.env.STRIPE_API_BASE;
  if (!base) return {};
  const u = new URL(base);
  return { host: u.hostname, port: u.port, protocol: u.protocol.replace(':', '') };
}
function billingError(err) {
  if (err instanceof billing.BillingError) return new functions.https.HttpsError(err.code, err.message);
  if (err instanceof functions.https.HttpsError) return err;
  console.error('Stripe call failed', err);
  return new functions.https.HttpsError('internal', 'The payment service could not be reached. Please try again.');
}

exports.stripeCreateCheckout = functions.runWith(STRIPE_SECRETS).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
  try {
    return await billing.createCheckout({
      stripe: stripe(), db, uid: context.auth.uid, email: context.auth.token.email,
      plan: String((data && data.plan) || ''), env: process.env,
      serverTimestamp: () => FieldValue.serverTimestamp()
    });
  } catch (err) { throw billingError(err); }
});

exports.stripePortal = functions.runWith(STRIPE_SECRETS).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
  try {
    return await billing.createPortal({ stripe: stripe(), db, uid: context.auth.uid, env: process.env });
  } catch (err) { throw billingError(err); }
});

// Stripe → us. Point a Stripe webhook endpoint at this function's URL with the
// events listed in docs/PAYMENTS.md. The signature check is what makes it safe
// to be public.
exports.stripeWebhook = functions.runWith(STRIPE_SECRETS).https.onRequest(async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return; }
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('Stripe webhook called but STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET are not set');
    res.status(500).send('Not configured');   // Stripe keeps retrying until it is
    return;
  }
  let event;
  try {
    event = stripe().webhooks.constructEvent(req.rawBody, req.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.warn('Stripe webhook rejected:', err.message);
    res.status(400).send('Invalid signature');
    return;
  }
  try {
    const outcome = await billing.handleEvent({
      stripe: stripe(), db, event, env: process.env, serverTimestamp: () => FieldValue.serverTimestamp()
    });
    console.log('Stripe event', event.id, event.type, outcome);
    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook failed', event.id, err);
    res.status(500).send('Retry later');   // Stripe retries with backoff
  }
});

// -------------------------------------------------------------------------
// Project files and backups in Google Drive (see files.js, project-drive.js).
// Settings: functions/.env → DRIVE_ROOT_FOLDER_ID (the shared drive), and
// optionally DRIVE_PROJECT_QUOTA_MB. Setup steps: docs/DEPLOY.md.
// -------------------------------------------------------------------------
const files = require('./files');
const { drive } = require('./drive');
const { makeProjectDrive } = require('./project-drive');
let projectDriveInstance = null;
function projectDrive() {
  if (!projectDriveInstance) {
    projectDriveInstance = makeProjectDrive({ db, FieldValue, Timestamp, drive: drive(), env: process.env });
  }
  return projectDriveInstance;
}
function fileError(err) {
  if (err instanceof files.FileError || err instanceof PlanError) return new functions.https.HttpsError(err.code, err.message);
  if (err instanceof functions.https.HttpsError) return err;
  console.error('Project file call failed', err);
  return new functions.https.HttpsError('internal', 'Google Drive could not be reached. Please try again.');
}
function signedIn(context) {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in.');
  return context.auth.uid;
}
const FILE_RUN = { timeoutSeconds: 120, memory: '512MB' };

// data: { projectId, name, size, category, note, itemId, data (base64) }
exports.projectFileUpload = functions.runWith(FILE_RUN).https.onCall(async (data, context) => {
  try {
    const uid = await assertSubscribed(context, 'add files');
    const d = data || {};
    return await projectDrive().uploadFile({
      uid, email: context.auth.token.email, projectId: d.projectId, data: d.data,
      input: { name: d.name, size: d.size, category: d.category, note: d.note, itemId: d.itemId }
    });
  } catch (err) { throw fileError(err); }
});

// Any member may download, even with a lapsed subscription (read-only access).
exports.projectFileDownload = functions.runWith(FILE_RUN).https.onCall(async (data, context) => {
  try {
    const uid = signedIn(context);
    return await projectDrive().downloadFile({ uid, projectId: (data || {}).projectId, fileId: (data || {}).fileId });
  } catch (err) { throw fileError(err); }
});

exports.projectFileDelete = functions.https.onCall(async (data, context) => {
  try {
    const uid = await assertSubscribed(context, 'delete files');
    return await projectDrive().deleteFile({ uid, email: context.auth.token.email, projectId: (data || {}).projectId, fileId: (data || {}).fileId });
  } catch (err) { throw fileError(err); }
});

exports.projectBackupNow = functions.runWith(FILE_RUN).https.onCall(async (data, context) => {
  try {
    const uid = await assertSubscribed(context, 'back up a project');
    return await projectDrive().backupNow({ uid, email: context.auth.token.email, projectId: (data || {}).projectId });
  } catch (err) { throw fileError(err); }
});

exports.projectBackupDownload = functions.runWith(FILE_RUN).https.onCall(async (data, context) => {
  try {
    const uid = signedIn(context);
    return await projectDrive().downloadBackup({ uid, projectId: (data || {}).projectId, backupId: (data || {}).backupId });
  } catch (err) { throw fileError(err); }
});

exports.projectRestoreItems = functions.runWith({ timeoutSeconds: 300, memory: '512MB' }).https.onCall(async (data, context) => {
  try {
    const uid = await assertSubscribed(context, 'restore a backup');
    return await projectDrive().restoreItems({ uid, email: context.auth.token.email, projectId: (data || {}).projectId, backupId: (data || {}).backupId });
  } catch (err) { throw fileError(err); }
});

// Every night at 02:00 UAE time: give back the space of files deleted 30 days
// ago, then back up each project that changed.
exports.projectBackupsDaily = functions.runWith({ timeoutSeconds: 540, memory: '1GB' })
  .pubsub.schedule('every day 02:00').timeZone('Asia/Dubai')
  .onRun(async () => {
    const tally = await projectDrive().dailyBackups();
    console.log('Daily project backups', tally);
  });
