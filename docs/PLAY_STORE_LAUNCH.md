# Launching on Google Play — the cheapest route that still holds up under UAE law

> **Not legal, tax, or insurance advice.** I'm not a lawyer and this isn't a
> compliance package. Every figure below is a *planning* figure that changes —
> government fees, Play policies, and free-zone packages all move. Verify each
> one against its official source before you spend money, and put the legal
> pieces in front of a UAE-licensed lawyer.
>
> One thing deserves saying plainly up front: this app influences decisions that
> can kill people. That changes the risk calculus compared with a normal app.
> The place **not** to economise is the disclaimer wording and the professional
> indemnity cover (§6). Everything else here is safe to do cheaply.

---

## 0. The short version

| Step | Cost | Recurring? |
|---|---|---|
| Package the existing site as a TWA with Bubblewrap | free | — |
| Domain name (`.com` or `.ae`) — **required**, see §2 | ~AED 40–150 / yr | yearly |
| Hosting (GitHub Pages, already in use) | free | — |
| Google Play developer registration | US$25 (~AED 92) | one-time |
| Play's revenue share on paid subscriptions | 15% of first US$1M/yr | per sale |
| UAE trade licence (needed to *sell*, not to publish free) | ~AED 1,000–12,500 / yr | yearly |
| Fixed-fee lawyer review of Terms + Privacy | ~AED 2,000–6,000 | one-off |
| Professional indemnity insurance | quote — get one | yearly |

**Free app, no payments:** you can be live for roughly the cost of a domain plus
US$25. **Charging money:** the licence, the lawyer, and the insurance are where
the real money is, and none of the three is optional.

---

## 1. What was added to the code for this

Everything below is already in the repo — nothing was removed to make room.

| File | Why Play needs it |
|---|---|
| `manifest.webmanifest` | TWA requires an installable web app manifest: name, icons, `start_url`, `scope`, theme colour. |
| `sw.js` | Offline. Without it, the TWA shows a Chrome error page whenever there's no signal — which on a site is most of the time. Reviewers and users both read that as a crash. |
| `js/pwa.js` | Registers the worker, prompts on update, shows an offline bar, exposes an install button. |
| `offline.html` | Friendly fallback instead of a browser error. |
| `assets/icons/*` | Full launcher icon set, including **maskable** variants (Android crops icons to arbitrary shapes) and the 512×512 Play listing icon + 1024×500 feature graphic. |
| `.well-known/assetlinks.json` | Digital Asset Links — proves the app and site are yours so the URL bar is hidden. See `.well-known/README.md`. |
| `twa-manifest.json` | Bubblewrap config. |
| `account-deletion.html` | Play's User Data policy requires a **publicly reachable** deletion URL. |
| `about.html` | Version/build, support contacts, licences, safety scope. |
| `js/app-version.js` | One place for version + publisher identity, mirrored into the Play build. |
| `terms.html` §4a–4c, §9–11 | Auto-renewal, cancellation, refunds, licence, age. Both Play policy and UAE consumer law want these stated plainly. |
| `privacy.html` §3a, §3b, §10–13 | Cross-border transfer, Play Billing, retention, deletion route, controller identity. |

`privacy.html` and `terms.html` are no longer behind the sign-in gate. That was
deliberate: a policy URL that 404s or redirects to a login screen is one of the
most common Play rejections. The sign-in gate still protects everything else.

---

## 2. Hosting and the domain you cannot avoid

GitHub Pages is fine and free. But Android fetches Digital Asset Links from the
**root of the domain**:

```
https://<domain>/.well-known/assetlinks.json
```

On `https://<user>.github.io/<repo>/` your files live in a sub-path, and you
don't control `github.io`'s root. Verification fails and the app opens with a
Chrome address bar across the top.

**So: buy a domain, point it at Pages, and serve the site from its root.** That
single yearly fee is the only unavoidable recurring cost of the free tier.

1. Buy a domain (any registrar).
2. Repo → **Settings → Pages → Custom domain**, enter it, tick **Enforce HTTPS**.
3. Add the DNS records GitHub shows you.
4. Keep the `.nojekyll` file at the repo root — without it, Jekyll processing can
   interfere with dot-directories like `.well-known`.
5. Verify:
   ```bash
   curl -i https://<domain>/.well-known/assetlinks.json
   ```
   Expect `200` and `content-type: application/json`.

---

## 3. Build the Android package (Bubblewrap)

Bubblewrap wraps the hosted site in a thin Android shell. No rewrite, no
Android code to maintain.

**Prerequisites:** Node.js 18+, and a JDK (Bubblewrap will offer to download the
JDK and Android SDK command-line tools itself — let it).

```bash
npm install -g @bubblewrap/cli
```

Edit `twa-manifest.json` first: replace every `HOST_DOMAIN` with your real
domain, and settle on `packageId`. **`packageId` can never change once
published** — use reverse-DNS on a domain you control, e.g. `ae.sabiramin.cranelifting`.

```bash
bubblewrap init --manifest ./twa-manifest.json
bubblewrap build
```

On first build it creates `android.keystore`. **Back that file and its passwords
up somewhere you will still have them in five years.** Lose the upload key and
recovery means a support request to Google; there is no self-service fix.

Output: `app-release-bundle.aab` (upload this to Play) and `app-release-signed.apk`
(sideload this to test).

Test the APK on a real Android phone before uploading:

```bash
adb install -r app-release-signed.apk
```

Check, in order:
- **No address bar at the top.** If there is one, assetlinks verification failed — re-read `.well-known/README.md`.
- Turn on airplane mode, kill the app, reopen it. It must still work — that's `sw.js` doing its job.
- Save an assessment offline, then reconnect. The record must survive.
- The Android back button behaves sensibly.
- Signature capture works with a finger, not just a mouse.

Then bump `appVersionCode` in `twa-manifest.json` for every subsequent upload —
Play rejects a reused version code. Keep it in step with `APP_VERSION_CODE` in
`js/app-version.js` and `CACHE_VERSION` in `sw.js`.

---

## 4. Play Console

**Registration: US$25, one-time**, at <https://play.google.com/console/signup>.

Two decisions worth getting right before you pay:

**Personal vs organisation account.** An *organisation* account needs a
D-U-N-S number and takes longer to verify, but it's the honest answer once a
company is selling the app, and it publishes the company name on the listing.
A *personal* account is faster and cheaper — but at time of writing Google
requires new personal accounts to run a **closed test with a minimum number of
testers for a continuous period** before production access is unlocked. Budget
several weeks and line up real testers (site engineers are ideal — you get
useful feedback out of a requirement you can't skip anyway). Check the current
threshold in Play Console; Google has changed it more than once.

**Developer name and address are published.** Play requires verified identity
details, and for a trader account the address appears on the store listing. If
that's your home address, that's a reason to get the trade licence (§5) and use
the business address instead.

### App content declarations — all mandatory

| Section | Answer for this app |
|---|---|
| Privacy policy URL | `https://<domain>/privacy.html` |
| Data deletion URL | `https://<domain>/account-deletion.html` |
| Data safety | See `PLAY_DATA_SAFETY.md` — answer for the build you actually ship |
| Content rating (IARC questionnaire) | Utility/productivity, no objectionable content → lowest rating |
| Target audience | 18+. Do **not** tick anything that opts you into the Families policy |
| Ads | No ads |
| Government app | No |
| Financial features | No — subscriptions via Play Billing are not "financial features" |
| News app | No |
| Health apps | No — this is occupational safety planning, not health |
| COVID-19 / contact tracing | No |

### Store listing assets — already generated

- App icon: `assets/icons/play-store-icon-512.png` (512×512, no transparency)
- Feature graphic: `assets/icons/play-feature-graphic-1024x500.png`
- Screenshots: **you still need these.** Minimum 2 phone screenshots, 16:9 or
  9:16, at least 320px on the short side. Take them from the installed app —
  dashboard, an assessment with the 3D lift diagram, the full assessment record,
  and a permit are the four that sell it.

### Short description (80 char limit) — suggested

```
Crane load-chart checks, lift plans and permits to work. Works offline.
```

### Full description — suggested opening

Put the disclaimer high. It sets expectations with users and it is evidence of
reasonable care if anything ever goes wrong:

```
Duck HSE Portal is a planning aid for lifting operations: check a load
against the manufacturer's load chart, generate a lift diagram and pre-lift
briefing, set a starting exclusion zone, and raise a permit to work — all
offline, on site, with no signal needed.

IMPORTANT: This app is a planning aid. It does not replace the crane
manufacturer's certified load chart, a competent Appointed Person's judgement, a
site-specific risk assessment, or applicable regulations. Every lift must be
verified against the manufacturer's current certified chart before work begins.
```

---

## 5. UAE legal groundwork

### Do you need a trade licence?

- **Publishing a free app with no payments:** generally not a commercial activity
  that requires a licence, though Play still needs verified identity.
- **Charging money — in any form:** you are trading, and trading in the UAE
  requires a licence. Google will also need a payments profile with a bank
  account, which in practice means a business account, which means a licence.

Cheapest routes, roughly ascending — **confirm current fees directly, these move
every year and packages are frequently discounted**:

| Route | Rough annual cost | Notes |
|---|---|---|
| Dubai DED **e-Trader** | ~AED 1,000–1,500 | Cheapest by far — but restricted to **UAE and GCC nationals**. Check eligibility before planning around it. |
| Free-zone package (SHAMS, IFZA, Meydan, RAKEZ, Ajman) | ~AED 5,500–15,000 | Open to expatriates. Includes a visa quota you may not need — ask for the zero-visa package, which is cheaper. |
| Mainland LLC | ~AED 15,000+ | Only needed if you intend to sell/invoice UAE mainland companies directly. |

If your customers are UAE contractors who will want a proper tax invoice, ask
the free zone whether their licence lets you invoice mainland clients before you
commit — this catches people out.

### Tax

- **Corporate tax:** registration with the Federal Tax Authority is required for
  licensed businesses. The 9% rate applies above the small-business threshold;
  below it there is still a filing obligation. Don't skip registration because
  you're small.
- **VAT:** mandatory registration above the turnover threshold, voluntary above
  a lower one. For sales *through Google Play*, Google typically handles VAT as
  the seller of record in many markets — **confirm how that works for UAE sales
  with a tax adviser before you assume you have no VAT obligation.**

### Data protection (PDPL)

Federal Decree-Law No. 45 of 2021. What matters for this app:

- Local-only build: you're barely a controller at all, because nothing leaves
  the device. This is genuinely the safest posture and it's free — a real
  argument for keeping cloud sync optional rather than default.
- Cloud sync build: you become a controller, Firebase is your processor, and
  data leaves the UAE. `privacy.html` §3a now discloses this and names the
  safeguard relied on. **Choose the Firestore region deliberately — it is fixed
  at creation and cannot be changed.**
- Confirm the current status of the PDPL Executive Regulations with your lawyer;
  some obligations (DPO appointment thresholds, breach-notification timelines,
  the adequacy list for cross-border transfers) turn on them.
- If you're licensed in **DIFC or ADGM**, those have their own data protection
  laws which may apply instead of the federal PDPL. This affects which regulator
  you name in `privacy.html` §8.

### Lifting-specific regulation

The app references **ADOSH-SF CoP 34.0**, which is Abu Dhabi's framework. If you
sell into Dubai or the Northern Emirates, the governing regime differs (Dubai
Municipality, Trakhees for special development zones, DDA, and so on). Two
consequences:

1. Don't claim in the listing that the app makes anyone compliant with any
   specific regulation. Say it "supports planning in line with" them.
2. The 38 km/h wind stop-work constant is an Abu Dhabi–derived figure. Keep the
   in-app note saying the site's appointed person sets the actual limit.

---

## 6. The two things not to economise on

**Terms and Privacy review.** Ask specifically for a **fixed-fee review** of an
existing draft, not open-ended hourly work — you already have drafts, so this is
a review not a drafting job, and firms price it accordingly. Several UAE
startup-focused firms and free-zone legal clinics (DIFC, ADGM, Hub71, in5) offer
this. Bring them `terms.html` and `privacy.html` and tell them explicitly:
*safety-critical output, sold by subscription, users are employers in the
construction sector.* That framing changes the advice.

**Professional indemnity / errors & omissions insurance.** Get a quote even at
one-person scale. If a lift goes wrong and someone argues the app contributed,
the limitation-of-liability clause in `terms.html` is your first line of defence
and insurance is your second — and clauses limiting liability don't always
survive contact with a court, particularly where injury is involved. Brokers
will ask what the software does; answer honestly, because a policy sold on a
wrong description doesn't pay out.

---

## 7. Pre-submission checklist

**Technical**
- [ ] Domain live, HTTPS enforced, site at the domain root
- [ ] `assetlinks.json` returns 200 with the real SHA-256 fingerprint
- [ ] `APP_VERSION` / `APP_VERSION_CODE` / `CACHE_VERSION` / `twa-manifest.json` all in step
- [ ] Installed APK opens with **no** address bar
- [ ] Works fully in airplane mode
- [ ] Tested on a real phone at phone width, not just a resized desktop browser
- [ ] `js/firebase-config.js` matches the Data Safety answers you submitted

**Content**
- [ ] Privacy policy URL loads **without signing in**
- [ ] Data deletion URL loads **without signing in**
- [ ] At least 2 phone screenshots uploaded
- [ ] Disclaimer appears in the store description, not only in the app

**Legal**
- [ ] Trade licence issued (if charging) and its details filled into `js/app-version.js`
- [ ] Terms + Privacy reviewed by a UAE-licensed lawyer
- [ ] PI/E&O insurance quoted, and bound before the first paying customer
- [ ] Load-chart figures verified against the manufacturers' printed charts by a competent person

**Fill in `js/app-version.js`** — `legalEntity`, `licenceNumber`, `address`, and
`websiteUrl` are deliberately left blank. The About page and Privacy Notice read
from them, so filling that one file updates the whole app.

---

## 8. After launch

- Bump all four version numbers on every release, or the offline cache serves
  users a stale build. (That is exactly what makes an updated feature look like
  it "didn't change" — the code was fine, the browser was serving yesterday's
  copy.)
- Update the Data Safety form **the same day** any backend behaviour changes.
- Watch Play Console's policy notices — target-API-level requirements ratchet up
  annually, and a TWA that falls behind gets delisted. Rebuilding with a newer
  Bubblewrap is usually the whole fix.
- Keep `DATA_NOTES` in `js/crane-data.js` honest as cranes are added. It is the
  in-app record that transcription uncertainty was disclosed rather than hidden.
