# Duck HSE Portal — Web App

An HSE portal for teams: projects and tracked actions, permits to work, equipment
inspections, HSE audit evidence packs, and lifting operations (crane lift assessments
and lifting permits). It started as a browser rebuild of a WinForms crane lifting
assessment tool.
No install; runs in any modern browser on phone, tablet or desktop.

> Supports, never replaces, competent-person decisions.
> Developed by **Sabir Amin** — sabiriis143@gmail.com.

## Changelog

- **Project files, photos and backups in Google Drive (v1.12.0)**
  - **Files and photos on every project.** Editors, managers and the owner can add
    method statements, risk assessments, certificates, drawings, emails and site
    photos to a project, with a kind, a note, and optionally a link to a tracked
    item (the item's window lists its files and has **Attach a file**). Every
    member can search, download and view them; photos open on screen. Editors can
    delete their own files, managers any file. Up to 7 MB per file; photos over
    2 MB are made smaller (at most 2400 px) on the device first, which also strips
    the location data inside them.
  - **Kept in the portal's Google Drive.** Each project gets its own folder
    (`<project name> (<id>)`, with `Files` and `Backups` inside) in a shared drive
    the portal owner controls. Only the Cloud Functions reach Drive, signed in as
    their own service account, so there is no key file to leak and team members
    never need a Google account. Settings: `DRIVE_ROOT_FOLDER_ID` and optionally
    `DRIVE_PROJECT_QUOTA_MB` (2 GB per project by default) in `functions/.env`.
  - **Safe file handling.** Only listed file types are accepted (no web pages,
    scripts, programs or archives); the stored type comes from the extension, and
    PDFs, photos and Office files must really be what their extension says. Only
    photos are ever shown in the app; everything else is saved as a download. File
    records can only be written by the server (Firestore rules), and a file can only
    be reached through a project its caller belongs to.
  - **Backups.** Every night at 02:00 UAE time, each project that changed is backed
    up to its `Backups` folder as JSON (details, tracked items, file list, recent
    activity). Owners and managers can also **Back up now**, **Download** a backup,
    and **Restore items**, which puts the tracked items back as they were (items
    added since are removed); a backup of the current state is made first, so a
    restore can be undone. Each project keeps 30 nightly, 20 manual and 10
    before-restore backups.
  - **Privacy and Terms** describe project files and backups, so everyone is asked
    to accept them again once.
  - **Tests.** 16 unit tests for the file and backup rules (`test/files.test.mjs`),
    4 new Firestore rules tests, and 4 new browser test steps (upload, photo
    shrinking, refused files, download and view, item attachments, backup, restore)
    run against a local stand-in for Drive.

- **Permits to work for all high-risk work (v1.11.0)**
  - **Seven permit types.** Lifting (as before), hot work, confined space entry,
    work at height, excavation, energy isolation (lock-out, tag-out) and general
    work. **New permit** opens a chooser; each type has its own work details,
    precautions, close-out checks and number series (`LP-`, `HW-`, `CSE-`, `WAH-`,
    `EXC-`, `ISO-`, `GW-` + year + sequence). Numbers are given when the permit is
    saved and continue from the highest number already on file, so a new or wiped
    device never reuses one.
  - **Content from the ADOSH-SF codes of practice**: CoP 21.0 (permit to work),
    27.0 (confined spaces), 28.0 (hot work), 23.0 (working at heights), 29.0
    (excavation), 24.0 (lock-out, tag-out) and 34.0 (lifting). A permit can be
    valid for at most 12 hours. **A competent person must check the precautions
    and limits against the site's own permit system before the portal is used on
    a live site.**
  - **Rules that stop a permit being issued**, for example:
    - Gas tests record the time, where the reading was taken, the tester and the
      detector. Oxygen must be 19.5–23.5 % and flammable gas below 5 % LEL;
      confined spaces and excavations also test H₂S (no more than 1 ppm) and CO
      (no more than 25 ppm). The latest reading at every test point (top, middle,
      bottom...) must pass, so re-testing one point cannot clear another, and it
      must be no more than 2 hours before the permit starts. Every reading needs its
      time, and times in the future or after the permit ends are refused. Confined space
      entry always needs a test; hot work needs one in hazardous areas, confined
      spaces, near live plant and on containers; excavations when they could be a
      confined space or are over 1.2 m deep near a gas source; general work when
      opening lines, chemical cleaning or in a hazardous area.
    - The issuer and the permit holder, the fire watcher and the welders, and the
      standby person and the entrants must be different people.
    - Hot work cannot go ahead with sprinklers impaired, and cannot be closed until
      the fire watch has run for at least 1 hour after the work ended and any
      isolated detectors are restored.
    - Confined spaces list the other gases to test for when the space held fuel,
      chemicals, sewage or inert gas, or when oxygen is below 20.5 %, and need heat
      controls and a time limit at 30 °C or more inside.
    - Work at height: for falls of 2 m or more, guardrails or nets, or a recorded
      reason why not; fall arrest needs anchors, named rescuers and enough clear
      distance below for the lanyard or SRL; ladders above 2 m need a harness;
      MEWPs, cradles and rope access need a wind limit and reading, and work stops
      above the limit.
    - Excavations deeper than 1.2 m need support (unsupported only in rock with a
      written assessment); battered sides are checked against the safe slope for
      the ground type (CoP 29.0 Table 1), using the flattest slope for fill or
      unknown ground, unless an engineer's design is recorded.
    - Energy isolation lists each isolation point with its lock number, who
      isolated it and proof of zero energy; stop buttons, interlocks and drives are
      refused as isolation; live work is refused; electrical isolation records the
      authorised electrician, system voltage and tester.
    - Heat stress controls become required at a forecast 35 °C or more (CoP 11.0)
      for work at height, excavation and general work.
    - Precautions that only apply sometimes (flashback arrestors for gas cutting,
      a proven voltage tester for electrical isolation, tower checks for mobile
      towers) become required when they apply.
  - **Printing.** Gas and isolation tables fit the printed page.
  - **Terms and Privacy** mention the permit records, so everyone is asked to
    accept them again once.
  - **Records.** Deleting a permit warns that CoP 21.0 asks for permit records to
    be kept for at least 1 year.
  - **Re-tests during the work.** A failed gas re-test on an issued permit is saved
    and suspends the permit, with the readings as the reason, so the record is
    kept and work stops.
  - **Editing older permits.** Rules added in this version (the 12-hour limit, the
    issuer being someone other than the permit holder) apply only when those
    values change, so permits saved before v1.11.0 can still be updated.
  - **Close-out.** Closing a permit records who closed it, when, and the
    close-out checks; closed permits are read-only. The verifier's name and
    signature entered on the form are kept; any other unsaved change must be saved
    first, so closing never throws it away. Permits linked to a project
    update the tracked item (suspended = open, closed or expired = closed).
  - **Permit list and dashboard.** The list filters by type and status (now
    including closed). The dashboard counts active permits, high-risk permits
    and critical lifts, and shows permits coming due with their type.
  - **Existing lifting permits keep working.** Permits saved before this version
    are read as lifting permits, with the same checklist and critical-lift rules.
  - **Fixes.** Permit fields, status banners and the list are escaped before
    display. New permits get sensible default times again.
  - **Tests.** 33 unit tests for the permit rules (`test/permit-types.test.mjs`);
    the browser test issues a confined space permit (refused on low oxygen),
    tracks it on a project, prints it, suspends it on a failed re-test and closes
    it, and checks the hot work fire watch.

- **For all of HSE, and a safer "Delete my data" (v1.10.0)**
  - **Erasing data needs your password.** The Delete my data page is still public
    (Google Play requires that), so anyone can read it and ask for an account to be
    deleted. Erasing data from the device now needs you to be signed in and to
    re-enter your password; signed-out visitors get no erase button, and a copy of
    the portal without sign-in set up shows none at all. Erasing also signs you out.
    The password-free "Erase all local data" button on the settings page now leads
    to that page instead.
  - **Dashboard for all HSE work.** Open projects, inspections due or overdue,
    equipment not fit for use and active lifting permits; a tile for each module
    (projects, inspections, audits, lifting operations); a "Coming due" list of
    inspections and permits; and recent records from every module. Everything on
    it is escaped before display.
  - **Menus and wording.** The menu is grouped into Overview, Inspections, Audits,
    Lifting operations and Settings, with the lift tools and lifting permits named
    as such. The general warning banner, footer, sign-in page, consent screen,
    About page, app and Play shortcuts, and page descriptions now describe an HSE
    portal; the load-chart and ADOSH-SF CoP 34.0 warnings stay on the lifting
    pages. "Fleet & backup" is now "Settings & backup". The "Trial · Educational
    use only" tag is gone from the footer, since the portal is now a paid product.
  - **Terms and Privacy** now describe the whole HSE portal and where data really
    lives (account, projects and synced records in Firebase; photos and audit
    evidence on the device). The consent screen asks everyone to accept the
    updated terms once.
  - **Tests.** The browser test now checks the dashboard and that erasing needs
    the password.

- **Card payments on the website (v1.9.0)**: customers can now subscribe by
  card with Stripe Checkout. Setup guide: `docs/PAYMENTS.md`.
  - **Subscribe page.** On the web it offers the plans from
    `WEB_PAYMENTS` in `subscription-config.js` and opens Stripe's hosted
    checkout. Inside the Android app it still uses Google Play Billing, as
    Play's policy requires. The invoice / bank transfer request stays as an
    option. After paying, the page waits for the confirmation and opens the app.
  - **Free trial kept.** Subscribing during the 14-day trial starts billing when
    the trial ends (when at least 2 days are left). No second trial on a later
    subscription.
  - **Dashboard plan panel.** Card subscribers get **Manage plan** (Stripe's
    billing portal: card, cancel, invoices). Play subscribers get a link to
    Google Play. The panel shows when a cancelled plan ends and when a payment
    failed. Admin grants no longer show a dead "Manage plan" link.
  - **Server.** New Cloud Functions `stripeCreateCheckout`, `stripePortal` and
    `stripeWebhook` (`functions/stripe.js`). The webhook checks Stripe's
    signature and always re-reads the subscription from Stripe, so repeated or
    out-of-order events end in the right state. Secrets live in Firebase's
    secret storage, settings in `functions/.env` (see `.env.example`).
  - **Safety.** `firestore.rules` block clients from writing
    `subscriptionProvider`, `stripeCustomerId`, `stripeSubscriptionId` and
    `cancelAtPeriodEnd`. A lapsed Stripe subscription never ends a live Play
    one, and the other way round. A payment does not lift an admin revoke, and
    an admin grant no longer hides a paying customer's status.
  - **Admin page** shows each account's payment provider and pending
    cancellations.
  - **Tests.** Stripe unit tests (22), a rules test for the new fields, and
    `npm run test:e2e:payments` (10 steps against the emulators and a fake
    Stripe API). The shared browser test setup moved to `test/e2e-lib.mjs`.

- **Projects and teams (v1.8.0)**: new `projects.html` and `project.html`.
  - **Projects are shared.** A project has an owner, and can have managers,
    editors and viewers. People are invited by email. An invite only lands on an
    account whose email address is **verified**, so nobody can claim an invite
    by signing up with someone else's address first.
  - **Tracked items** hold each project's work: actions, inspections,
    observations, incidents, documents, meetings, plus linked permits, lift
    assessments and equipment checklists. Each item has a status, priority, due
    date and assignee. The dashboard shows open, in-progress, overdue and
    recently closed counts, with filters and a CSV export (formula-safe).
  - **Linking records.** The permit, assessment and checklist forms have a
    "Track on project" picker. Saving creates or updates one item on that
    project, so the team sees it without sharing the record itself.
  - **Activity log** per project, append-only and stamped by the server clock.
  - **Security.** Projects live in Firestore under `projects/{id}` with
    `items` and `activity` subcollections. `firestore.rules` enforces roles,
    validates every field, and blocks clients from changing membership (only
    the `projectSetMember`, `projectRemoveMember` and `projectAcceptInvites`
    Cloud Functions can). Writes to shared data need an active trial or
    subscription, checked by the rules (`hasAccess()`), not just the page.
    Lapsed members can still read. Projects are archived, never hard-deleted.
  - **Fixes:** an admin "Revoke" now also ends a running trial (before, a
    revoked account kept trial access). `isAdmin()` in the rules no longer
    errors on accounts without a role. Cloud Functions import `FieldValue` from
    `firebase-admin/firestore` (the old `admin.firestore.FieldValue` was
    undefined at runtime). Elements with the `hidden` attribute are now always
    hidden, and search/email/URL inputs pick up the standard input style.
  - **Tests** in `test/`: Firestore rules (22), membership logic (10), and an
    end-to-end browser run against the Firebase emulators (12 steps).

- **HSE audit preparation for contractors and consultants (v1.7.0)**: new
  `audits.html` / `audit.html`. Builds an evidence checklist from **ADOSH-SF
  Technical Guideline 15** (Audit Non-Conformance, v4.0, July 2024) and the **TAQA WS
  SOPs** (SOP-3501…3547), lets you attach documents to each serial-numbered point,
  compiles the lot into one `.zip`, and uploads it to Google Drive at
  `Project Number / HSE Audit`.
  - **Two checklists, from the SOPs' own wording.** Every operational SOP says in §3
    that contractors *execute* it and consultants *ensure contractors fulfil it*;
    SOP-3509 §7.2.2 spells out the consultant side (review and conditionally
    approve, monitor, close out). So the contractor list asks for implementation
    evidence (186 points by default) and the consultant list for review, approval
    and monitoring evidence (132 points). SOP-3546 — how TAQA WS audits both — sets
    the readiness section.
  - **TG 15 inverted.** TG 15 lists the non-conformances ADPHC auditors raise, each
    with a suggested Major/Minor level. Each becomes the evidence that prevents it,
    and keeps its level, so the workspace can show how many *Major*-rated points
    are still open — a far better readiness signal than a percentage alone.
    Requirements are paraphrased with clause references; no numeric limit is stated
    that isn't in a source (e.g. first-aider ratio is quoted from SOP-3512, and no
    midday-break dates are given because SOP-3532 contains none).
  - **S/No. are frozen at creation.** Adding an SOP later appends a new section
    number, so the evidence folders named after existing S/No. never move.
  - **Evidence stays on the device** (IndexedDB) until you compile — viewable in-app,
    including Excel (as a table, via the XLSX reader) and Word (as text, read straight
    from the .docx). Large phone photos are shrunk to 2000 px on the way in.
  - **The pack** (`js/zip-writer.js`, dependency-free) has one folder per S/No.,
    `00 Index.html` linking every file, `00 Checklist.csv`, and a `manifest.json`
    that lets any pack be re-opened, browsed or imported on another device. Generated
    folder names are ASCII-only, because older Windows Explorer ignores the zip
    UTF-8 flag. Verified against .NET's zip reader and Windows `tar` (CRC-checked).
  - **Google Drive** (`js/gdrive.js`) signs in with Google Identity Services — token
    in memory only, no service-account key in the page — defaults to the least
    privileged `drive.file` scope, and uploads resumably in 8 MiB chunks. Under
    `drive.file` a folder made by hand in Drive is invisible to the app, so a missing
    project folder offers **Create**, **Pick the existing folder** or **Paste its
    link**, and remembers the answer. **Needs a one-time OAuth Client ID** — steps are
    in the Drive settings dialog.
  - Storage calls now carry a watchdog: on a completely full device an IndexedDB
    write can stall silently; it now fails with a message saying so.
  - The account-deletion wipe also removes the audit database.

- **Admin control centre: HSE statistics analytics, reconciliation and a local AI
  analyst (v1.6.0)**: `admin.html` grew from a subscription table into an eight-tab
  control centre. It reads the monthly **TAQA SWS HSE Statistics** return (Form
  F-019-F / 3.1-A / 3.1-B) and the **internal HEGC monthly report**
  (HEGC-IMS-P06-FM-03 / 03A), reconciles one against the other, and produces charts,
  findings, a dated action plan and written reports. Everything happens in the
  browser — no workbook, and nothing read out of one, is uploaded anywhere.
  - **`js/xlsx-reader.js`** reads .xlsx with no dependencies: it parses the ZIP
    itself, inflates with `DecompressionStream` (with a hand-rolled DEFLATE
    fallback for older WebViews) and the XML with `DOMParser`. A CDN bundle would
    have broken both the offline cache and the no-build-step rule. Formula cells
    yield their cached value; error cells (`#DIV/0!`) come back as `null` rather
    than as Excel's sentinel `-2146826281`.
  - **`js/hse-parser.js`** finds every column by its header text, never by cell
    address, because these forms get re-issued and a parser pinned to "column M is
    August" silently reads the wrong month the first time someone inserts a column.
  - **The comparison is TAQA *Contractor* against internal *Total***, because the
    internal report covers this company only. Comparing against the TAQA Total would
    build in a permanent false gap equal to the consultant's own numbers.
  - **Cumulative columns are deliberately not compared.** TAQA's YTD is
    calendar-year-to-date; the internal cumulative runs from contract start. In
    August 2026 that is 201,480 man-hours against 450,625 — two different questions,
    not a discrepancy. The dashboard states the basis difference once instead of
    manufacturing a gap on every row.
  - **Five analysis passes**: reconciliation, workbook self-consistency (does YTD
    equal the sum of its months?), target attainment, trend detection (an indicator
    that has gone quiet), and data quality. On the August 2026 files this surfaces
    414 cells holding the letter "o" where a zero belongs — which Excel stores as
    text and silently excludes from every SUM on the sheet.
  - **`js/hse-ai.js`** is local in both senses. The built-in engine resolves a
    plain-English question to a KPI, a period and an operation, then answers it from
    the parsed data — offline, with no model and no network — and writes the six
    report types. Optionally it bridges to a model server **on your own machine**
    (Ollama, LM Studio, llama.cpp) for phrasing; there is no cloud fallback, and if
    the server is not running every question still gets answered by the engine.
  - **`js/hse-charts.js`** ships its own SVG chart set for the same offline reason.
    The palette was validated against this app's real chart surface before being
    adopted, and the results constrain the code: radar caps at three series, the
    heatmap ramp at five steps, every chart carries a table view, and no chart
    anywhere plots two different scales against one another.
  - **Targets are house targets, not regulatory thresholds**, editable on the
    Targets & settings tab, and the UI says so everywhere they appear.

- **The developer's mobile number is no longer published in the app (v1.6.0)**:
  `APP_PUBLISHER.phone` is now empty and every consumer — the footer, About, and the
  account-deletion contact table — omits the row entirely when it is blank. Support
  runs through email, which also leaves an auditable trail. Setting the field again
  brings the rows back automatically.

- **Rebrand to "Duck HSE Portal", Firebase activated, direct-payment option (v1.5.0)**:
  the app is renamed throughout (titles, manifest, TWA, sidebar/login brand) with a
  new **funny-duck** icon set (`assets/icons/*`, regenerated), and the live
  `duck-hse-portal` Firebase **web** config is now in `js/firebase-config.js` — so the
  app runs in **real-accounts mode**. TWA `packageId` and `.well-known/assetlinks.json`
  are set to `Duck.HSE.Portal` to match the registered Android app.
  - **Direct / offline payment** added to the paywall (`subscribe.html`): PayPal +
    Commercial Bank of Dubai transfer details, with a "request activation" mailto. It's
    for **B2B / non-Play** sales, activated manually from the admin dashboard —
    configurable via `OFFLINE_PAYMENT` in `js/subscription-config.js`. **Note:** Google
    Play requires Play Billing for in-app digital subscriptions, so set
    `OFFLINE_PAYMENT.enabled=false` in the Play build to stay policy-compliant.
  - **Before sign-in works**, you must finish the backend setup (SECURITY.md §6):
    enable Email/Password auth, deploy `firestore.rules` and `functions`, and set your
    own `users/{uid}.role = "admin"`. Until then the app shows the login screen but
    Firestore reads return `permission-denied` (fail-closed — expected).

- **Real accounts, trial→paid subscriptions & owner control (v1.4.0)**: replaced
  the fake local login with a real-accounts-only model and put subscription control
  on the server. New: `js/subscription-config.js` (trial length, product IDs),
  `js/entitlements.js` (server-truth access state machine), `js/access.js` (the
  `requireAccess()` gate that routes to login/paywall), `js/billing.js` (Play
  Billing via the Digital Goods API), `subscribe.html` (paywall), `admin.html` +
  `js/admin.js` (owner dashboard to grant/revoke/extend/comp and set admins).
  Extended `functions/index.js` (trial-on-signup trigger, admin-only callables,
  Play real-time notifications) and hardened `firestore.rules` (admin role;
  **all** entitlement fields are now server-only). **Read `SECURITY.md`** — it's
  the honest security model + the activation checklist.
  - **Model:** free trial → all paid. A new account gets `TRIAL_DAYS` of full
    access, then the app is gated behind the paywall until there's an active Play
    subscription or an admin grant. Owner keeps a manual override (comp/extend/
    revoke) in the admin dashboard. Purchases auto-unlock; RTDN reflects cancels.
  - **Security truth:** the client only *reads* entitlement; the Firestore rules
    forbid a user writing any entitlement field, so nobody can self-grant. The
    Firebase web config is public by design (not a secret); the only real secret
    (Play API access) stays server-side in the Cloud Function.
  - **Safe rollout:** everything is dormant behind `FIREBASE_READY`. Until you
    paste a real Firebase config into `js/firebase-config.js`, the app is
    **unchanged** and still uses the local gate — it is not bricked waiting for
    setup. Verified: with Firebase off, every page loads and gates exactly as
    before. The live Firebase/Play flows are built to spec but must be tested
    against your own project (checklist in `SECURITY.md` §7).

- **Third-party certificate register with photo capture (v1.3.1)**: each equipment
  checklist can now hold third-party certificates — inspection certificates,
  operator/rigger/banksman competency certificates, and lifting-accessory
  certificates — each with a category, holder/item, number, issuer, issue and expiry
  dates, WLL/SWL, notes, and **photos taken with the device camera** (or chosen from
  the gallery). New files: `js/photo.js` (camera capture + on-device resize),
  `js/certificate-storage.js` (photo blobs in IndexedDB), `js/certificate-report.js`
  (row rendering + a standalone shareable HTML report).
  - **Storage.** Photos are resized (longest edge 1600 px, JPEG) and stored in
    **IndexedDB**, keyed to the checklist; the checklist record in `localStorage`
    keeps only the certificate metadata and photo references, so a record stays a few
    hundred bytes even with several photos attached. Deleting a checklist, or using
    "erase all data" / the account-deletion page, now also purges the IndexedDB
    photos — no orphaned images.
  - **Expiry awareness.** Each certificate shows a Valid / Expiring ≤30 days /
    Expired badge, and the section header summarises the counts.
  - **Forward by Email and WhatsApp.** "Share report" builds a self-contained HTML
    certificate report (photos embedded) and hands it to the device share sheet, from
    which the user picks Email or WhatsApp; on a desktop with no share sheet it
    downloads the report to attach. This is the honest path for WhatsApp, which cannot
    receive file attachments through a plain link.
  - **Four languages.** The whole certificate feature — section, buttons, the editor
    modal, the on-screen report, status badges, share messages, and the generated
    HTML report (with `dir="rtl"` for Arabic/Urdu) — is translated EN/AR/UR/HI like
    the rest of the checklist.
  - Fixes made while wiring this up: the certificate modal was writing into
    `document.body` (no `#lightboxRoot` on `checklist.html`) and **wiped the whole
    page** on save/cancel — now fixed; and the app's three version numbers had drifted
    apart — realigned to 1.3.1 / build 5 across `js/app-version.js`, `sw.js` and
    `twa-manifest.json`.

- **Multilingual equipment checklists (English / Arabic / Urdu / Hindi)**: a new
  monthly inspection and maintenance checklist for earthmoving machinery and cranes.
  `checklist.html` + `js/checklist.js` (the form), `checklists.html` (saved records),
  `js/checklist-data.js` (15 machine types, 23 icon-headed sections, ~150 items, all
  four languages), `js/i18n.js` (translation layer, RTL handling), `js/mailer.js`
  (email forwarding). Nothing was removed; `DB` gained `getChecklists` /
  `saveChecklist` / `deleteChecklist` and backup export/import now carries them, with
  backups written before this version still importing cleanly.
  - **Sections are filtered by machine.** Each equipment type carries tags, and a
    section appears only if it applies — an excavator gets undercarriage and
    attachments, a mobile crane gets load chart, rope/hook, slew and outriggers. A
    mobile crane comes out at 117 items, an excavator at 86, rather than one
    undifferentiated list with half of it marked N/A.
  - **Colour coding.** Equipment passing the month's inspection carries that month's
    colour tag, so anyone on site can see at a glance whether a machine's inspection
    is current. Both a 12-colour monthly rotation and the 4-colour quarterly rotation
    are supported; the records page shows the legend with the current period marked.
  - **Maintenance checklist** is a section of its own (service intervals, oil and
    filter changes, greasing, torque checks, oil sampling, next service due).
  - **Email forwarding.** From and To are left empty for you to fill; To and Cc accept
    multiple addresses and are validated, naming any entry that looks wrong rather than
    dropping it. The covering note is drafted fresh each time from a pool of phrasings —
    the facts never vary, only the wording — and the ask is matched to the result
    ("for your information and necessary action" for a pass, an out-of-service
    instruction for a failure). Three hand-off routes, since the app has no mail server:
    a proper `.eml` file (keeps From/To/Cc and the full body, opens as a draft in
    Outlook), `mailto:`, and copy-to-clipboard.
  - Right-to-left is handled for Arabic and Urdu across the whole document, including
    the mobile nav drawer, with Noto webfonts and system fallbacks.
- **Play Store launch readiness (PWA → TWA)**: the app is now an installable,
  offline-capable progressive web app, which is what Google's `Bubblewrap` needs in
  order to wrap it as a Trusted Web Activity. Added `manifest.webmanifest`, `sw.js`
  (offline cache + update handling), `js/pwa.js` (registration, update prompt,
  offline bar, install button), `offline.html`, a full icon set in
  `assets/icons/` (including maskable icons, the 512×512 Play listing icon and the
  1024×500 feature graphic), `.well-known/assetlinks.json` + its README,
  `twa-manifest.json`, `js/app-version.js`, `about.html`, `account-deletion.html`,
  and `PLAY_STORE_LAUNCH.md`. Nothing was removed.
- **Phone layout**: the fixed-sidebar desktop layout overflowed badly below ~900px,
  which would have been a problem for an app shipped on phones. Added a responsive
  layer to `css/styles.css` — off-canvas nav drawer (hamburger injected by
  `js/nav.js`), stacked topbar, horizontally scrolling data tables, full-screen
  modals, and 44px touch targets. The desktop layout is untouched; all of it lives
  inside media queries.
- **Legal pages made publicly reachable**: `terms.html` and `privacy.html` no longer
  sit behind `requireAuth()`. Google Play requires the privacy policy URL to load
  without signing in, and a gated policy URL is a routine cause of rejection. Both
  pages also gained UAE-specific sections — cross-border transfer under PDPL,
  Play Billing, retention, deletion route, controller identity, subscription
  auto-renewal/cancellation, and refunds under Consumer Protection Law 15/2020.
- **History → full assessment record**: `js/assessment-detail.js` is a new shared
  module that renders a saved assessment completely — verdict and utilization bar,
  every lift parameter plus the remaining margin and load-vs-crane-max, the wind
  stop-work rule that was applied and which limit governed, environment/site
  conditions, exclusion zone, pre-lift briefing, categorized training requirements,
  both lift diagrams, notes, every linked permit, and the record metadata. Two
  things it does that the old inline version did not: it **regenerates** the
  briefing/training/exclusion-zone sections for records saved before those fields
  existed (clearly labelled as a reconstruction), which is why older records used to
  render as little more than the two diagrams; and it HTML-escapes all user-entered
  text. `history.html` delegates to it; the old inline renderer is still there as
  `viewAssessmentBasic()`, and `viewDiagram()` is untouched.
- **Cloud sync, real accounts & subscription scaffold (Firebase)**: added an
  optional Firebase backend — `js/firebase-config.js`, `js/firebase-init.js`,
  `js/firebase-auth.js`, `js/cloud-sync.js`, `firestore.rules`, and a
  `functions/` Cloud Function that verifies Google Play subscription purchases.
  `js/storage.js` now mirrors saves/deletes to Firestore when signed into a cloud
  account, and `login.html` shows a cloud sign-in/sign-up option. **All of this is
  dormant until you fill in a real Firebase config** — see `FIREBASE_SETUP.md`.
  Nothing existing was removed; `js/auth.js` and the local-only flow are untouched
  and remain the default.
- **Play Console Data Safety answers**: added `PLAY_DATA_SAFETY.md` with ready-to-
  enter answers for both the local-only and the Firebase-enabled build.

- **History → "View full assessment"**: the history page's diagram-only lightbox is
  now a full assessment detail view — lift parameters, environment/site conditions,
  exclusion zone, pre-lift briefing, categorized training requirements, the lift
  diagrams (still downloadable), notes, and a link straight to any permit this
  assessment is attached to — plus a "Print / save as PDF" button scoped to just that
  record. The old diagram-only `viewDiagram()` function is still in the code and
  still works; nothing was removed, `viewAssessment()` is additive.
- **Terms of Use / Privacy Notice + consent gate**: added `terms.html`, `privacy.html`,
  and `js/consent.js` (a one-time acceptance screen layered on top of the existing
  `js/auth.js` sign-in — neither file was changed). See "Launching on Google Play"
  below for why these were added and what still needs a lawyer's review.

## Launching on Google Play — cheapest path that's still legally sound

This section is additive guidance, not a rebuild — nothing above has been removed to
make room for it. I'm not a lawyer, and this isn't legal advice; treat it as a
starting point to bring to a UAE-licensed lawyer, not a finished compliance package.

**1. Legal groundwork (done in this update, needs a lawyer's pass)**
- `terms.html` and `privacy.html` are now in the app, drafted with UAE Federal
  Decree-Law No. 45 of 2021 (PDPL) and the ADOSH-SF safety context in mind.
- `js/consent.js` adds a one-time "accept before use" screen, separate from the
  existing sign-in gate — gives you a recorded (client-side) acceptance, which matters
  both for PDPL consent and for limiting liability on a safety-adjacent product.
- Before charging money: get these reviewed by a UAE-licensed lawyer. Many startup-
  focused firms and free-zone legal clinics (DIFC, ADGM, Sharjah Media City, etc.) offer
  fixed-fee ToS/Privacy review packages that are far cheaper than a full engagement —
  worth asking for one specifically, rather than open-ended hourly billing.
- Given this app influences real lifting decisions, get a quote for **professional
  indemnity / errors & omissions insurance** even at a small scale. This is the one
  place where "cheaper" has a real ceiling — it's the main financial protection if a
  lift goes wrong and someone argues the app contributed.

**2. Cheapest technical path onto the Play Store**
- Package the existing web app as a **Trusted Web Activity (TWA)** using Google's free
  `Bubblewrap` CLI, rather than rewriting it natively. A TWA is effectively a thin
  Android wrapper around the hosted site (GitHub Pages already gives you free HTTPS
  hosting, which TWA requires).
- One-time Google Play Developer registration fee: **US$25**. No recurring Play fee
  beyond Google's standard revenue share on in-app purchases.
- For subscriptions sold *through* Google Play: use the **Play Billing / Digital Goods
  API** for TWAs (Google's supported path for billing web-wrapped apps) rather than
  linking out to an external checkout page. Routing digital subscription purchases
  outside Play Billing is against Play Store policy for this kind of app and risks
  suspension — it isn't actually the cheap option once you account for that risk.
- You'll need a minimal backend to verify purchase tokens against the Google Play
  Developer API before unlocking paid features — a single serverless function (Firebase
  Cloud Functions or a Cloudflare Worker, both with generous free tiers) is enough at
  small scale, and is the natural place to also start the Firebase/Supabase migration
  `js/storage.js` is already structured for (see "Data storage" below).

**3. Play Console submission basics**
- **Data Safety form**: answer it honestly against what's actually true today (all
  data stored locally on-device, nothing collected by the developer) — and update it
  the day you add any backend, since Google spot-checks this against real app
  behaviour.
- **Content rating**: this is a professional planning tool, not directed at children —
  rate it accordingly in Play Console's questionnaire.
- **Privacy policy URL**: point it at the hosted `privacy.html`.

## Signing in

This build sits behind a simple sign-in screen:

- **Username:** `Sabir`
- **Password:** `admin`

This is a **client-side-only access gate, not real security** — the credentials live
in plain text in `js/auth.js`, which the browser downloads, so anyone with the page
open can read them (view-source, devtools, etc.), and there's no server enforcing
anything. It exists only to keep this trial build from being stumbled into by
accident. Do not rely on it to protect real operational or personal data — put a
proper authenticated backend behind it for that. Sign out from the link at the
bottom of the sidebar.

## ⚠️ Before you use this on a real site

`js/crane-data.js` now ships with the **certified XCMG load-chart figures**, transcribed
directly from the manufacturer's technical specification sheets for the two cranes on
file (QY50KD, 2020-07-01 edition; QY25K5D, 2021-03 2nd edition) — main-boom capacities
across every printed outrigger-span/counterweight combination, plus the jib charts. It
is no longer placeholder/interpolated data. Even so:

1. A `DATA_NOTES` array at the top of `js/crane-data.js` flags two spots that were
   transcribed exactly as printed but are worth a second look against your paper copy
   (a highlighted cell on the manufacturer's own QY50KD sheet, and two QY50KD reduced-
   outrigger charts that print identical numbers for two different counterweights).
2. Have a competent/appointed person verify the tool's output against the printed chart
   before relying on it, and whenever you add a new crane model.
3. Keep treating the manufacturer's printed chart as the authority on site — this tool
   is a planning aid, not a substitute for it.
4. Lifting operations should be planned and controlled in line with **ADOSH-SF CoP
   34.0 – Safe Use of Lifting Equipment and Lifting Accessories** and any other
   applicable local regulations, which take precedence over anything shown here.

## Wind stop-work rule

Every assessment checks wind speed against **two** limits and applies whichever is
**lower**:

- the crane's own manufacturer-rated wind limit (from `js/crane-data.js`), and
- a **38 km/h (≈10.56 m/s) site stop-work threshold**, applied here consistent with
  ADOSH-SF CoP 34.0's requirement to suspend lifting once wind conditions become
  unsafe.

The assessment page shows both figures, states which one is binding for the crane in
use, and refuses the lift once either is exceeded. Confirm the current, site-specific
wind action limit with your appointed person/OSH team — this constant does not
replace that determination.

## What it does

- **New assessment** — pick a crane and configuration (counterweight and outrigger
  span, where the crane offers more than one), enter load/radius/boom/wind, and get an
  allowed/not-allowed verdict with a capacity-utilization readout. Capacity is
  interpolated across both radius *and* boom length, using only the radius range the
  chart actually prints for that boom (no more silently allowing an out-of-range
  radius). Wind speed is checked live against the effective (crane-rated vs. ADOSH
  38 km/h) limit as you type.
- **Main boom + jib assessments** — for cranes with a jib chart on file, switch "Boom
  setup" to "Main boom + jib" to pick the jib configuration/length/offset and enter a
  boom angle instead of a radius, matching how manufacturers actually publish jib
  capacity tables. The result panel reminds you to cross-check the lifting-height
  diagram for the radius a given angle produces.
- **Lift diagram** — a live, drag-to-rotate 3D wireframe of the crane, load, boom
  angle, and wind direction (dependency-free animated SVG, no WebGL/three.js), plus a
  2D plan sketch, both updating as you edit the form. Either can be downloaded as a
  PNG, and both are automatically captured and attached to the assessment (and, from
  there, to any permit you link it to) when you save.
- **Environmental & site conditions** — record visibility, precipitation, lighting,
  and ground conditions, plus the load's largest dimension, alongside the lift.
- **Pre-lift briefing** — automatically generated, tailored to the specific lift: wind
  limit and source, exclusion zone, environmental cautions (poor visibility/lighting,
  adverse weather, poor ground), communications, load path/tag lines, emergency
  arrangements, and required roles.
- **Exclusion zone** — a suggested starting-point radius (working radius + half the
  load's largest dimension + a generic slew/rigger margin, with an extra allowance
  when wind is approaching the stop-work limit), with the calculation shown — not a
  mandated figure; the appointed person and site risk assessment set the final
  barriered distance.
- **Training requirements, categorized** — Appointed Person, Lift Supervisor, Crane
  Operator, Rigger/Slinger, and Banksman/Signaller, each with the specific
  competencies expected and flagged mandatory/standard based on the lift's risk
  profile (utilization, jib use, load vs. crane capacity).
- **Crane selector** — enter a load weight and required working radius (and,
  optionally, a maximum boom length) and it scans every crane/configuration/boom
  combination on file, filters to the ones that can lift it safely, and ranks them by
  a **cost-efficiency proxy** (smallest adequate crane class, then shortest boom, then
  best use of that crane's capacity). This is a heuristic, not real pricing — it
  doesn't know your actual rental rates or availability. Each result links straight
  into a pre-filled full assessment.
- **Assessment history** — searchable, filterable log of every assessment, exportable
  to CSV, with a "View" button to open its saved lift diagrams.
- **Permits to work** — hot work, confined space entry, work at height, excavation,
  energy isolation (LOTO), general work and lifting permits, each with its own work
  details, precautions, gas tests or isolation points where they apply, close-out
  checks and number series. The rules for each type live in `js/permit-types.js`.
- **Lifting permits** — a full permit-to-work form: validity window, pre-start
  checklist, critical-lift flagging (which requires a linked, passing assessment and an
  approver signature before it can be saved), the linked assessment's lift diagrams
  and full pre-lift briefing/training/exclusion-zone summary, and on-screen signature
  capture for issuer/approver/verifier. Permits can be viewed read-only, edited,
  suspended with a reason, or printed / saved as PDF via the browser's print dialog
  (the lift diagrams print too).
- **Permits to work list** — searchable list filtered by permit type and by
  active/expired/suspended/closed status, with lift type for lifting permits.
- **Fleet & backup** — read-only summary of the cranes on file, plus JSON export/import
  so you can back up or move your records between browsers or machines.

## Data storage — read this

There is no server or database. All assessments and permits are stored in the
browser's `localStorage`, scoped to whichever URL you open this from. That means:

- Data does **not** sync between devices or browsers on its own.
- Clearing your browser's site data deletes your records.
- **Export a backup regularly** from the Fleet & Backup page, and keep the `.json`
  file somewhere shared with your team (e.g. in the same repo, or a shared drive).
- If your team needs shared, always-in-sync records across multiple people, this
  static-site design isn't enough on its own — you'd want to add a small backend
  (e.g. Firebase, Supabase, or a simple API) behind the same UI. The `js/storage.js`
  file is written as a single data-access layer specifically so that swap is
  localized to one file.

## Running it locally

No build step. Open `index.html` directly in a browser (you'll land on the sign-in
screen first — see **Signing in** above), or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploying on GitHub Pages

1. Create a new GitHub repository and push this folder's contents to it.
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to "Deploy from a branch", pick your
   default branch and the `/ (root)` folder, then save.
4. GitHub will publish the site at `https://<your-username>.github.io/<repo-name>/`
   within a minute or two.

```bash
git init
git add .
git commit -m "Crane lifting assessment web app"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

## Project structure

```
index.html            Dashboard
login.html             Sign-in screen (see Signing in above)
assessment.html        New lift assessment, lift diagram, briefing & training
crane-selector.html    Cost-efficient crane recommendation tool
history.html           Assessment history
permit.html            New / view / edit / close a permit to work (every type)
permits.html           Permits to work list
settings.html          Fleet reference + backup/restore
css/styles.css         Shared design system
js/auth.js              Client-side-only sign-in gate — NOT real security
js/crane-data.js       Crane specs & load charts — EDIT THIS with your certified data
                        (also holds the ADOSH_WIND_STOP_* wind rule constants)
js/storage.js          localStorage data layer + load-chart interpolation math
js/crane-visual.js     Dependency-free 3D lift viewer + 2D plan sketch + PNG export
js/lift-planning.js    Pre-lift briefing / training requirements / exclusion zone
js/crane-selector.js   Crane recommendation engine used by crane-selector.html
js/nav.js              Shared sidebar + disclaimer banner + footer + sign-out
js/signature-pad.js    Canvas-based signature capture
js/assessment.js       Assessment page logic
js/permit-types.js     Permit types: fields, precautions, gas limits, close-out, rules — EDIT THIS
js/permit.js           Permit page logic
js/consent.js          One-time Terms/Privacy acceptance gate (additive, sits above auth.js)
js/assessment-detail.js Full saved-assessment record renderer (shared; used by history.html)

--- Equipment checklists (EN / AR / UR / HI) ---
checklist.html          Monthly inspection & maintenance checklist form
checklists.html         Saved checklist records, colour coded by month
js/checklist-data.js    Machine types, sections, items, icons, colour schemes — EDIT THIS to add items
js/checklist.js         Checklist page logic (incl. certificate register)
js/i18n.js              Translation layer + RTL handling + language switcher
js/mailer.js            Address parsing, randomised draft, .eml / mailto / clipboard
js/photo.js             Camera capture + on-device image resize (canvas)
js/certificate-storage.js  Certificate photo blobs in IndexedDB (out of localStorage)
js/certificate-report.js   Certificate rows + shareable HTML report + Email/WhatsApp share

--- Projects, files and backups ---
projects.html + js/projects.js    Project list; Firestore data layer for projects, items, activity
project.html + js/project-page.js Project dashboard: items, team, activity
js/project-files.js        Project files, photos and backups panel (talks to the functions below)
js/project-link.js         Links permits, assessments and checklists to project items
functions/projects.js      Team membership rules (invites, roles, ownership)
functions/files.js         File and backup rules: allowed types, sizes, who may delete, restore plan
functions/project-drive.js Firestore + Drive work behind the file and backup functions
functions/drive.js         The Google Drive calls (service account), plus the local test stand-in

--- Accounts & subscriptions (activation-ready; see SECURITY.md) ---
js/subscription-config.js  Trial length, Play product IDs, package name
js/entitlements.js         Server-truth access state machine (computeAccess)
js/access.js               requireAccess() gate → login / paywall routing
js/billing.js              Play Billing purchase flow (Digital Goods API)
subscribe.html             Paywall (trial ended / subscribe)
js/admin.js                Subscription table: grant/revoke/extend/comp, set admins
functions/index.js         Cloud Functions: trial trigger, verify, RTDN, admin actions
firestore.rules            Server-enforced boundary (admin role; entitlement fields locked)
SECURITY.md                The security model + activation & test checklist
--- Admin control centre: HSE statistics analytics (all client-side) ---
admin.html                 The control centre itself — 8 tabs
js/admin-dashboard.js      Tabs, file intake, every render on the page
css/hse-dashboard.css      Dashboard + chart styles, and the validated chart palette
js/xlsx-reader.js          .xlsx reader — ZIP + XML, no dependencies, works offline
js/hse-parser.js           TAQA Form F-019-F and HEGC FM-03/03A → structured reports
js/hse-kpi.js              Canonical KPI vocabulary shared by both forms + house targets
js/hse-analysis.js         Reconciliation, self-consistency, targets, trends, actions
js/hse-charts.js           SVG chart set (bars, lines, donut, heatmap, bullet, radar…)
js/hse-ai.js               On-device analyst + optional local-model bridge

--- HSE audit preparation (ADOSH-SF TG 15 + TAQA WS SOPs) ---
audits.html + js/audits.js Audit list: create (contractor / consultant), open, delete, open a pack
audit.html + js/audit.js   Workspace: per-S/No. upload, status, notes, links, compile, Drive upload
css/audit.css              Audit pages + evidence viewer
js/audit-checklists.js     The two checklists, with TG 15 / SOP clause references — EDIT THIS to change points
js/audit-store.js          IndexedDB for audits and evidence files (with a stall watchdog)
js/audit-pack.js           Compiles / re-reads packs; readiness scoring
js/audit-viewer.js         In-app viewer: image, PDF, video, text, HTML (sandboxed), Excel, Word
js/zip-writer.js           Dependency-free .zip writer (stores Blobs by reference)
js/gdrive.js               Google Drive: GIS sign-in, folder find/create, Picker, resumable upload

terms.html              Terms of Use
privacy.html            Privacy Notice
about.html              Version, support, licences, safety scope
account-deletion.html   Public data/account deletion page (required by Google Play)
offline.html            Offline fallback shown by the service worker

--- Play Store / installable-app packaging ---
manifest.webmanifest    Web app manifest (name, icons, start_url, scope)
sw.js                   Service worker — offline cache + update handling
js/pwa.js               SW registration, update prompt, offline bar, install button
js/app-version.js       APP_VERSION / APP_VERSION_CODE / publisher identity — fill this in
assets/icons/           Launcher + maskable icons, Play listing icon, feature graphic
.well-known/assetlinks.json  Digital Asset Links (see .well-known/README.md)
twa-manifest.json       Bubblewrap config for building the Android package
PLAY_STORE_LAUNCH.md    Cheapest legally-sound launch path, UAE specifics, checklist
.claude/launch.json     Local dev-server config (dev convenience only)
```

### Versioning — four numbers that must move together

A deployment where these drift is exactly what makes a shipped fix look like it
never landed, because the browser keeps serving the cached build:

| Where | Field |
|---|---|
| `js/app-version.js` | `APP_VERSION`, `APP_VERSION_CODE` |
| `sw.js` | `CACHE_VERSION` |
| `twa-manifest.json` | `appVersionName`, `appVersionCode` |

`APP_VERSION_CODE` must strictly increase for every Play upload and can never be
reused.

## Extending it

- **Add a crane model**: add a new entry to `CRANE_DATA` in `js/crane-data.js`
  following the existing shape — no other file needs to change; the crane selector
  and lift diagrams pick it up automatically.
- **Add a permit precaution or close-out check**: add `{ key, label, required }` to the
  type's `checks` or `closeout` list in `js/permit-types.js` (lifting checks are in
  `LIFTING_CHECKS`). Use a new `key`; saved permits store answers by key. To add a
  permit type, add an entry to `TYPES` with a new `key` and `prefix`.
  `test/permit-types.test.mjs` checks every type, so run `npm run test:unit` after.
- **Add an equipment-checklist item**: append to the relevant section's `items` in
  `js/checklist-data.js` with a unique `id` and all four translations. **Never reuse an
  `id` for a different question** — saved records store answers keyed by id, so a reused
  id makes old records report the wrong thing. Add a new id instead.
- **Add a machine type**: add an entry to `EQUIPMENT_TYPES` with the `tags` that decide
  which sections it gets. Tags in use: `crane`, `lifting`, `earthmoving`, `wheeled`,
  `tracked`, `outriggers`, `tower`, `forks`, `mewp`, `attachments`, `dozer`, `tipper`,
  `road`, `compaction`.
- **Add a language**: add the code to `LANGS` in `js/i18n.js`, add the key to every
  entry in `STRINGS`, and to every `{ en, ar, ur, hi }` object in `js/checklist-data.js`.
  `I18n.t()` falls back to English for anything missing, so a partial translation
  degrades rather than breaking.
- **Change the sign-in credentials**: edit `CREDENTIALS` in `js/auth.js` (remember:
  still not real security — see **Signing in** above).
- **Change the wind stop-work threshold**: edit `ADOSH_WIND_STOP_KMH` in
  `js/crane-data.js`.
- **Change the look**: all styling lives in `css/styles.css` as CSS custom properties
  at the top of the file.

