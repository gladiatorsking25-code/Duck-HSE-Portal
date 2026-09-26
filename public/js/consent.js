// consent.js — a lightweight, additive consent gate. This does NOT replace or
// modify js/auth.js's sign-in gate; it sits on top of it. It records that the
// signed-in user has seen and accepted the Terms of Use / Privacy Notice
// before the app is used, which matters both for UAE PDPL (Federal Decree-Law
// No. 45 of 2021) lawful-basis-for-processing purposes and for ordinary
// liability protection given this tool influences real HSE decisions.
//
// Like auth.js, this is a CLIENT-SIDE record only — it proves nothing to a
// server, because there is no server. Treat it as a UX/paper-trail aid, not a
// substitute for a real consent-logging backend before commercial launch.

const CONSENT_KEY = 'cla_tos_privacy_accepted_v1';
// Bump when the Terms or Privacy Notice change, so everyone accepts them again.
const CONSENT_VERSION = '2026-09-24.3';

function hasAcceptedConsent() {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return false;
    const rec = JSON.parse(raw);
    return rec.version === CONSENT_VERSION;
  } catch (e) {
    return false;
  }
}

function recordConsentAcceptance() {
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({
      version: CONSENT_VERSION,
      acceptedAt: new Date().toISOString()
    }));
  } catch (e) {
    console.error('Could not record consent acceptance', e);
  }
}

function requireConsent() {
  if (hasAcceptedConsent()) return;

  document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.createElement('div');
    overlay.id = 'consentOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,27,38,.72);z-index:999;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:4px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto;padding:26px 28px;font-family:'Inter',system-ui,sans-serif;">
        <h2 style="margin:0 0 10px;font-size:18px;">Before you continue</h2>
        <p style="font-size:13.5px;color:#52626d;line-height:1.55;">
          Duck HSE Portal helps you plan, record and track HSE work. It is not a substitute for
          competent-person judgement, your site's procedures, or applicable regulations such as the
          <strong>ADOSH-SF codes of practice</strong>. For lifting, it does not replace the crane's
          certified load chart or an Appointed Person's sign-off. What you enter is kept on this
          device and in your account, as described in the Privacy Notice.
        </p>
        <div style="display:flex; gap:16px; margin:14px 0;">
          <a href="terms.html" target="_blank" rel="noopener" style="font-size:13px;">Read Terms of Use</a>
          <a href="privacy.html" target="_blank" rel="noopener" style="font-size:13px;">Read Privacy Notice</a>
        </div>
        <label style="display:flex; gap:9px; align-items:flex-start; font-size:13.5px; margin-top:6px;">
          <input type="checkbox" id="consentCheckbox" style="margin-top:3px; width:16px; height:16px;">
          <span>I have read and accept the Terms of Use and Privacy Notice, and I understand this
          tool does not replace competent-person judgement or, for lifting, the manufacturer's load
          chart and a qualified Appointed Person's sign-off.</span>
        </label>
        <button id="consentAcceptBtn" disabled style="margin-top:16px;width:100%;padding:11px;border-radius:4px;border:none;background:#c8ccd0;color:#fff;font-weight:600;font-size:13.5px;cursor:not-allowed;">
          Accept & continue
        </button>
      </div>
    `;
    document.body.appendChild(overlay);

    const checkbox = document.getElementById('consentCheckbox');
    const acceptBtn = document.getElementById('consentAcceptBtn');
    checkbox.addEventListener('change', () => {
      acceptBtn.disabled = !checkbox.checked;
      acceptBtn.style.background = checkbox.checked ? '#16283a' : '#c8ccd0';
      acceptBtn.style.cursor = checkbox.checked ? 'pointer' : 'not-allowed';
    });
    acceptBtn.addEventListener('click', () => {
      if (!checkbox.checked) return;
      recordConsentAcceptance();
      overlay.remove();
    });
  });
}
