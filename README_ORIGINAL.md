# Duck HSE Portal — Web App

A browser-based rebuild of the original WinForms crane lifting assessment tool, for
daily lift assessments, permit-to-work management, and record keeping — no install,
runs from any browser, deployable free on GitHub Pages.

> **Trial · educational use only.** Not for real operational lift decisions.
> Developed by **Sabir Amin** — sabiriis143@gmail.com.

## Changelog

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
- **Lifting permits** — a full permit-to-work form: validity window, pre-start
  checklist, critical-lift flagging (which requires a linked, passing assessment and an
  approver signature before it can be saved), the linked assessment's lift diagrams
  and full pre-lift briefing/training/exclusion-zone summary, and on-screen signature
  capture for issuer/approver/verifier. Permits can be viewed read-only, edited,
  suspended with a reason, or printed / saved as PDF via the browser's print dialog
  (the lift diagrams print too).
- **All permits** — searchable list with active/expired/suspended status and lift type.
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
permit.html            New / view / edit lifting permit
permits.html           All permits list
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
js/permit.js           Permit page logic
js/consent.js          One-time Terms/Privacy acceptance gate (additive, sits above auth.js)
js/assessment-detail.js Full saved-assessment record renderer (shared; used by history.html)

--- Equipment checklists (EN / AR / UR / HI) ---
checklist.html          Monthly inspection & maintenance checklist form
checklists.html         Saved checklist records, colour coded by month
js/checklist-data.js    Machine types, sections, items, icons, colour schemes — EDIT THIS to add items
js/checklist.js         Checklist page logic
js/i18n.js              Translation layer + RTL handling + language switcher
js/mailer.js            Address parsing, randomised draft, .eml / mailto / clipboard
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
- **Add a permit checklist item**: add `{ key, label }` to `CHECKLIST_ITEMS` in `js/permit.js`.
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

