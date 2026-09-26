# Duck HSE Portal — Certificate Management Update v1.3.0

This update adds third-party certificate management to the Equipment Checklist.

## Replaced files
- `checklist.html`
- `checklists.html`
- `storage.js`
- `styles.css`
- `sw.js`
- `app-version.js`
- `twa-manifest.json`

## New files
- `js/certificate-storage.js` — IndexedDB storage for certificate photos.
- `js/certificate-report.js` — certificate compliance report rendering and device share support.

## Checklist features added
- Equipment third-party certificates
- Personnel competency/licence certificates
- Lifting accessory certificates
- Certificate number, issuer, issue date, expiry date, WLL/SWL and notes
- Camera/gallery certificate photo capture
- Photo resizing before storage
- Certificate expiry status: Valid / Expiring within 30 days / Expired
- Certificate compliance summary
- Certificate photos included in the printable checklist report
- Self-contained HTML certificate report for device sharing
- Android share sheet support so users can choose Email or WhatsApp when supported
- Certificate count on Checklist Records
- Report sharing from Checklist Records
- Certificate-photo cleanup when a checklist is deleted

## Important storage design
Certificate image bytes are stored in IndexedDB, not localStorage. The checklist record stores certificate metadata and photo IDs. This avoids putting multiple large certificate images into the localStorage quota.

## Deployment
Copy the staged files into the same locations in the existing application. Deploy the site over HTTPS. The service-worker cache version was raised to `v1.3.0` and application build was raised to `1.3.0 / build 4`.

The Android share workflow uses the browser/TWA Web Share API. On Android devices that support file sharing, selecting Email or WhatsApp from the share sheet can share the generated self-contained HTML certificate report. A PDF can still be produced through the existing browser Print / Save as PDF workflow; the certificate photos are included in the printable page.
