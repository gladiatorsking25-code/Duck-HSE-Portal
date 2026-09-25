// play.js — Google Play subscriptions: check a purchase with Google, then tie it
// to exactly one account.
//
// A Play purchase token belongs to the Google account that paid, not to a
// Duck HSE account, and the app's "Restore purchases" sends every purchase on
// the phone to whichever account is signed in. So the first account that
// verifies a token owns it (purchaseTokens/{token}.uid), and any other account
// is refused. A new token that replaces an older one (a re-signup or a plan
// change, found through linkedPurchaseToken) belongs to the older token's owner.
// Re-verifying from the owning account (renewals, restores) always works.
//
// Like stripe.js, the logic takes Firestore and the Play calls as arguments so
// it can be tested without network access (see test/play.test.mjs).

// Must match twa-manifest.json packageId. The package comes from here, never
// from the caller.
const DEFAULT_PACKAGE_NAME = 'Duck.HSE.Portal';
// Must match SUBSCRIPTION_CONFIG.PRODUCTS in public/js/subscription-config.js.
const DEFAULT_PRODUCT_IDS = ['pro_monthly'];
// How far back to follow linkedPurchaseToken.
const MAX_LINKS = 5;

const OTHER_ACCOUNT = 'This Google Play subscription belongs to another Duck HSE account. Sign in with that account, or contact support.';

class PlayError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function config(env = process.env) {
  return {
    packageName: String(env.PLAY_PACKAGE_NAME || DEFAULT_PACKAGE_NAME).trim(),
    productIds: String(env.PLAY_PRODUCT_IDS || DEFAULT_PRODUCT_IDS.join(','))
      .split(',').map((s) => s.trim()).filter(Boolean)
  };
}

// A purchase token is also a Firestore document id, so keep it to what one
// can hold. Real tokens are a few hundred letters, digits, dots and dashes.
function validToken(t) {
  return typeof t === 'string' && t.length > 0 && t.length <= 1000
    && !t.includes('/') && t !== '.' && t !== '..' && !/^__.*__$/.test(t);
}

// Play subscription (purchases.subscriptions.get) → the app's status.
// paymentState: 0 pending, 1 received, 2 free trial, 3 deferred.
function purchaseStatus(sub, now = Date.now()) {
  const expiry = sub && sub.expiryTimeMillis ? Number(sub.expiryTimeMillis) : null;
  const active = !!expiry && expiry > now;
  const status = active ? (Number(sub.paymentState) === 0 ? 'in_grace' : 'active') : 'expired';
  return { status, expiry, active };
}

// The users/{uid} fields to write for this purchase, or null when it must not
// be applied (a lapsed Play purchase must not end a card subscription that is
// still live).
function userPatch(sub, subscriptionId, current = {}, now = Date.now()) {
  const { status, expiry, active } = purchaseStatus(sub, now);
  const stripeLive = current.subscriptionProvider === 'stripe'
    && ['active', 'in_grace'].includes(current.subscriptionStatus)
    && Number(current.subscriptionExpiryMillis || 0) > now;
  if (!active && stripeLive) return null;
  const patch = {
    subscriptionProvider: 'play',
    subscriptionStatus: status,
    subscriptionId,
    subscriptionExpiryMillis: expiry
  };
  // An admin revoke stands until an admin lifts it; a purchase doesn't undo it
  // (the same rule as stripe.js).
  if (current.subscriptionStatus === 'revoked') delete patch.subscriptionStatus;
  return patch;
}

function tokenDoc(db, token) {
  return db.collection('purchaseTokens').doc(token);
}

// Older tokens this purchase replaced, newest first. Stops at the first one we
// already know (its owner decides), or when Play can no longer tell us more.
async function linkedTokens({ db, verify, packageName, productIds, subscriptionId, token, sub }) {
  const chain = [];
  let link = sub && sub.linkedPurchaseToken;
  while (link && validToken(link) && chain.length < MAX_LINKS && link !== token && !chain.includes(link)) {
    chain.push(link);
    if ((await tokenDoc(db, link).get()).exists) break;
    // Unknown to us: ask Play what it replaced in turn. A plan change links to
    // a token of another product, so try each one.
    let prev = null;
    for (const id of [subscriptionId].concat(productIds.filter((p) => p !== subscriptionId))) {
      try { prev = await verify(packageName, id, link); break; } catch (e) { /* not this product */ }
    }
    link = prev && prev.linkedPurchaseToken;
  }
  return chain;
}

/**
 * Check a purchase with Google Play and apply it to users/{uid}.
 * source 'client': the signed-in user sent this token; refused when the token,
 *   or a token it replaced, belongs to another account.
 * source 'rtdn': a Play notification; uid is the stored owner.
 * Returns { status, expiryTimeMillis }.
 */
async function applyPurchase({ db, verify, acknowledge, uid, subscriptionId, purchaseToken, source = 'client', sub = null, env, serverTimestamp, now = Date.now() }) {
  const cfg = config(env);
  if (!uid) throw new PlayError('unauthenticated', 'Sign in before verifying a purchase.');
  if (!validToken(purchaseToken) || !subscriptionId || typeof subscriptionId !== 'string') {
    throw new PlayError('invalid-argument', 'This purchase could not be read. Please try again.');
  }
  if (source === 'client' && !cfg.productIds.includes(subscriptionId)) {
    throw new PlayError('invalid-argument', 'That subscription is not offered in this app.');
  }

  const purchase = sub || await verify(cfg.packageName, subscriptionId, purchaseToken);
  const chain = await linkedTokens({ db, verify, packageName: cfg.packageName, productIds: cfg.productIds, subscriptionId, token: purchaseToken, sub: purchase });
  const { status, expiry } = purchaseStatus(purchase, now);

  await db.runTransaction(async (tx) => {
    const ownRef = tokenDoc(db, purchaseToken);
    const userRef = db.collection('users').doc(uid);
    const own = await tx.get(ownRef);
    const links = await Promise.all(chain.map((t) => tx.get(tokenDoc(db, t))));
    const user = await tx.get(userRef);

    const owners = [own].concat(links).filter((s) => s.exists).map((s) => s.data().uid).filter(Boolean);
    if (source === 'client' && owners.some((o) => o !== uid)) throw new PlayError('failed-precondition', OTHER_ACCOUNT);

    const patch = userPatch(purchase, subscriptionId, user.exists ? user.data() : {}, now);
    if (patch) tx.set(userRef, Object.assign(patch, { subscriptionUpdatedAt: serverTimestamp() }), { merge: true });

    // Remember who owns this token, so RTDN events find them later. An
    // existing owner is never replaced.
    if (!own.exists) {
      tx.set(ownRef, {
        uid, packageName: cfg.packageName, subscriptionId,
        linkedPurchaseToken: purchase.linkedPurchaseToken || null,
        createdAt: now, updatedAt: now
      });
    } else if (own.data().uid === uid) {
      tx.set(ownRef, { subscriptionId, updatedAt: now }, { merge: true });
    }
  });

  // Play refunds a purchase nobody acknowledges within 3 days. Only a purchase
  // accepted above gets here, so a refused one is refunded by Google.
  if (acknowledge && Number(purchase.acknowledgementState) === 0) {
    try { await acknowledge(cfg.packageName, subscriptionId, purchaseToken); }
    catch (e) { console.warn('Play acknowledge failed (does the functions account have "Manage orders and subscriptions"?)', e && e.message); }
  }
  return { status, expiryTimeMillis: expiry };
}

/**
 * One Real-time Developer Notification (already JSON-decoded). Re-reads the
 * purchase from Play and applies it to the account that owns the token, or to
 * the owner of a token it replaced. Returns a short outcome for the logs.
 */
async function handleNotification({ db, verify, acknowledge, payload, env, serverTimestamp, now = Date.now() }) {
  const note = payload && payload.subscriptionNotification;
  if (!note || !note.purchaseToken) return 'ignored';   // test or one-time-product notification
  const cfg = config(env);
  if (payload.packageName && payload.packageName !== cfg.packageName) return 'other-package';
  const token = note.purchaseToken;
  if (!validToken(token)) return 'bad-token';

  const map = await tokenDoc(db, token).get();
  let uid = map.exists ? map.data().uid : null;
  const subscriptionId = (map.exists && map.data().subscriptionId) || note.subscriptionId;
  if (!subscriptionId) return 'no-product';
  let sub = null;
  if (!uid) {
    // A new token nobody has verified yet: a re-signup or plan change of one we know?
    sub = await verify(cfg.packageName, subscriptionId, token);
    const chain = await linkedTokens({ db, verify, packageName: cfg.packageName, productIds: cfg.productIds, subscriptionId, token, sub });
    for (const t of chain) {
      const s = await tokenDoc(db, t).get();
      if (s.exists && s.data().uid) { uid = s.data().uid; break; }
    }
    if (!uid) return 'unknown-token';   // the app maps it when the buyer's account verifies it
  }
  const r = await applyPurchase({ db, verify, acknowledge, uid, subscriptionId, purchaseToken: token, source: 'rtdn', sub, env, serverTimestamp, now });
  return `applied:${r.status}`;
}

module.exports = {
  PlayError, OTHER_ACCOUNT, config, validToken, purchaseStatus, userPatch,
  linkedTokens, applyPurchase, handleNotification
};
