// app-version.js — single place the app's version/build identity is declared.
//
// Keep APP_VERSION in step with:
//   • CACHE_VERSION in sw.js            (so a deploy busts the offline cache)
//   • "appVersionName"/"appVersionCode" in twa-manifest.json (Play Store build)
//
// APP_VERSION_CODE is the integer Google Play uses to order releases. It must
// increase with every upload to Play, and it can never be reused or lowered.

const APP_VERSION = '1.7.1';
const APP_VERSION_CODE = 14;
const APP_RELEASE_DATE = '2026-09-21';

// Shown in the Terms/Privacy pages and on the About page so a user can tell
// support exactly which build they are on.
const APP_BUILD_LABEL = `v${APP_VERSION} (build ${APP_VERSION_CODE}) · ${APP_RELEASE_DATE}`;

// Publisher identity used in the legal pages, the Play listing, and the
// Data Safety form. Change these in ONE place when the trade licence is issued
// and the entity name/address becomes final.
const APP_PUBLISHER = {
  developerName: 'Sabir Amin',
  // Fill in once the UAE trade licence is issued — Google Play requires a
  // verified legal name and address for the developer account, and UAE law
  // requires a licensed entity to trade commercially.
  legalEntity: '',
  licenceNumber: '',
  address: '',
  email: 'sabiriis143@gmail.com',
  // Deliberately blank: the developer's personal mobile number is not published
  // in the app. Every consumer of this field (About, Account deletion, the
  // footer) omits the contact row entirely when it is empty, so support runs
  // through email alone. If a business landline is ever issued for the licensed
  // entity, put it here and the rows come back automatically.
  phone: '',
  // Public URLs — these are what go into the Play Console listing fields.
  websiteUrl: '',
  privacyUrl: 'privacy.html',
  termsUrl: 'terms.html',
  deletionUrl: 'account-deletion.html'
};
