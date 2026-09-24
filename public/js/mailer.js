// mailer.js — prepares a checklist for forwarding by email.
//
// Be clear about what this can and cannot do: the app has no mail server, so it
// cannot send anything itself. It composes the message and hands it to the
// device's own email client. Three routes, because each fails differently:
//
//   1. .eml download  — a real RFC 5322 message file. Keeps From, To, Cc,
//      Subject and the full body intact, opens in Outlook/Gmail/Thunderbird.
//      This is the reliable one, and the only one that carries a From address.
//   2. mailto:        — quickest, opens the default mail app already addressed.
//      But mailto URLs have length limits (some clients silently truncate past
//      ~2000 characters), and a full checklist body will exceed that, so the
//      mailto route sends a short covering note and says the rest is attached
//      or pasted.
//   3. Copy to clipboard — works everywhere, user pastes it themselves.

const Mailer = (function () {

  // Deliberately permissive: this catches typos and obviously broken input
  // without rejecting the unusual-but-valid addresses that stricter patterns
  // trip over.
  const ADDRESS_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

  // Splits a free-text recipient field on commas, semicolons or newlines and
  // reports which entries don't look like addresses, rather than silently
  // dropping them.
  function parseAddresses(raw) {
    const parts = String(raw || '')
      .split(/[,;\n]+/)
      .map(s => s.trim())
      .filter(Boolean);
    const valid = [];
    const invalid = [];
    parts.forEach(p => {
      // tolerate "Name <a@b.com>"
      const m = p.match(/<([^>]+)>\s*$/);
      const addr = m ? m[1].trim() : p;
      (ADDRESS_RE.test(addr) ? valid : invalid).push(p);
    });
    return { valid, invalid, all: parts };
  }

  function addressOnly(entry) {
    const m = String(entry).match(/<([^>]+)>\s*$/);
    return (m ? m[1] : entry).trim();
  }

  // ---- base64 of a UTF-8 string, for MIME ----
  function b64utf8(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  function foldBase64(b64) {
    return (b64.match(/.{1,76}/g) || []).join('\r\n');
  }

  function isAscii(s) { return /^[\x00-\x7F]*$/.test(s); }

  // RFC 2047 encoded-word, needed for Arabic/Urdu/Hindi subject lines.
  function encodeHeaderValue(value) {
    if (isAscii(value)) return value;
    return '=?UTF-8?B?' + b64utf8(value) + '?=';
  }

  function encodeAddressHeader(entries) {
    return entries.map(e => {
      const m = String(e).match(/^(.*?)\s*<([^>]+)>\s*$/);
      if (!m) return String(e).trim();
      const name = m[1].trim().replace(/^"|"$/g, '');
      return `${encodeHeaderValue(name)} <${m[2].trim()}>`;
    }).join(', ');
  }

  // ---- Build a full .eml message ----
  function buildEml({ from, to, cc, subject, body }) {
    const now = new Date();
    const lines = [];
    lines.push('MIME-Version: 1.0');
    lines.push(`Date: ${now.toUTCString().replace('GMT', '+0000')}`);
    if (from) lines.push(`From: ${encodeAddressHeader([from])}`);
    if (to && to.length) lines.push(`To: ${encodeAddressHeader(to)}`);
    if (cc && cc.length) lines.push(`Cc: ${encodeAddressHeader(cc)}`);
    lines.push(`Subject: ${encodeHeaderValue(subject || '')}`);
    lines.push('Content-Type: text/plain; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('X-Unsent: 1'); // Outlook opens this as an editable draft
    lines.push('');
    lines.push(foldBase64(b64utf8(String(body || '').replace(/\r?\n/g, '\r\n'))));
    return lines.join('\r\n') + '\r\n';
  }

  function downloadEml(msg, filename) {
    const blob = new Blob([buildEml(msg)], { type: 'message/rfc822' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (filename || 'message') + '.eml';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // mailto: has a practical length ceiling, and the ceiling applies to the
  // percent-ENCODED url, not to the characters you typed. That distinction
  // matters here: an Arabic or Hindi character costs 9 encoded characters where
  // a Latin one costs 1, so a body that is comfortably short in English can be
  // five times over the limit in Urdu. Trimming on raw length would therefore
  // "work" in testing and quietly produce a truncated email on site.
  //
  // So the budget is measured on the finished URL, and the body is trimmed back
  // until it fits — always at a line break, with an explicit marker, so the
  // reader can see the message was shortened rather than losing the tail of a
  // defect list without warning.
  const MAILTO_URL_LIMIT = 1800;

  function composeMailtoUrl(to, cc, subject, body) {
    const params = [];
    if (cc && cc.length) params.push('cc=' + encodeURIComponent(cc.map(addressOnly).join(',')));
    if (subject) params.push('subject=' + encodeURIComponent(subject));
    params.push('body=' + encodeURIComponent(body));
    const toPart = (to && to.length) ? encodeURIComponent(to.map(addressOnly).join(',')) : '';
    return `mailto:${toPart}${params.length ? '?' + params.join('&') : ''}`;
  }

  function buildMailto({ to, cc, subject, body, truncationNote }) {
    const note = '\n\n' + (truncationNote ||
      '[Message shortened for the email app — use the .eml download or Copy for the full record.]');
    const full = String(body || '');

    let url = composeMailtoUrl(to, cc, subject, full);
    if (url.length <= MAILTO_URL_LIMIT) return url;

    // Binary search for the longest prefix that still fits once encoded.
    let lo = 0, hi = full.length, best = '';
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const candidate = full.slice(0, mid).replace(/\n[^\n]*$/, '') + note;
      if (composeMailtoUrl(to, cc, subject, candidate).length <= MAILTO_URL_LIMIT) {
        best = candidate; lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return composeMailtoUrl(to, cc, subject, best || note.trim());
  }

  function openMailto(msg) {
    const href = buildMailto(msg);
    // location.href rather than window.open: on Android/TWA this fires the
    // email intent without a popup blocker getting in the way.
    window.location.href = href;
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fall through to the legacy path */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:absolute;left:-9999px;top:0;';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  return {
    parseAddresses, addressOnly, buildEml, downloadEml,
    buildMailto, openMailto, copyText, MAILTO_URL_LIMIT
  };
})();


// ---------------------------------------------------------------------------
// ChecklistEmail — turns a saved checklist record into a covering note plus a
// plain-text version of the record, in the selected language.
//
// "Random draft": the covering wording is assembled from a pool of phrasings
// each time, so consecutive emails don't read like a machine sent them, and so
// the user has something to react to and edit rather than a blank box. The
// facts (equipment, result, defect list) are never randomised — only the
// wording around them.
// ---------------------------------------------------------------------------
const ChecklistEmail = (function () {

  // Covering-note phrasings. Index [lang] → array of variants.
  const OPENERS = {
    en: [
      'Please find below the monthly inspection record for the equipment detailed here.',
      'The monthly equipment inspection has been completed. The record is set out below.',
      'Attached below is the completed monthly checklist for the machine shown.',
      'This is the monthly inspection report for the equipment listed below.',
      'The scheduled monthly check on this machine has been carried out. Details follow.'
    ],
    ar: [
      'تجدون أدناه سجل الفحص الشهري للمعدة الموضحة تفاصيلها.',
      'تم إنجاز الفحص الشهري للمعدة، والسجل مُبيَّن أدناه.',
      'مرفق أدناه قائمة الفحص الشهرية المكتملة للمعدة المذكورة.',
      'هذا هو تقرير الفحص الشهري للمعدة المدرجة أدناه.',
      'تم تنفيذ الفحص الشهري المقرر لهذه المعدة، والتفاصيل كما يلي.'
    ],
    ur: [
      'ذیل میں مذکورہ مشین کا ماہانہ معائنہ ریکارڈ پیش ہے۔',
      'مشین کا ماہانہ معائنہ مکمل کر لیا گیا ہے۔ ریکارڈ ذیل میں درج ہے۔',
      'منسلک ذیل میں مذکورہ مشین کی مکمل ماہانہ چیک لسٹ ہے۔',
      'یہ ذیل میں درج مشین کی ماہانہ معائنہ رپورٹ ہے۔',
      'اس مشین کا مقررہ ماہانہ معائنہ کر لیا گیا ہے۔ تفصیلات حسب ذیل ہیں۔'
    ],
    hi: [
      'नीचे उल्लिखित उपकरण का मासिक निरीक्षण रिकॉर्ड प्रस्तुत है।',
      'उपकरण का मासिक निरीक्षण पूर्ण कर लिया गया है। रिकॉर्ड नीचे दिया गया है।',
      'नीचे संलग्न है उल्लिखित मशीन की पूर्ण मासिक चेकलिस्ट।',
      'यह नीचे सूचीबद्ध उपकरण की मासिक निरीक्षण रिपोर्ट है।',
      'इस मशीन की निर्धारित मासिक जाँच कर ली गई है। विवरण निम्नानुसार है।'
    ]
  };

  // Action lines, chosen by result so the ask matches the situation.
  const ACTIONS = {
    en: {
      fit: [
        'This is submitted for your information and records. No action is required beyond the next scheduled inspection.',
        'Forwarded for your information and necessary action. The machine is cleared to continue in service.',
        'Please retain this for the equipment file. The machine remains fit for service.'
      ],
      conditional: [
        'Forwarded for your information and necessary action. The machine may continue in service only under the conditions noted below.',
        'Please review the observations below and arrange the necessary action. The machine is fit for service subject to those conditions.',
        'Submitted for your information and action. The conditions listed below must be met while the machine remains in use.'
      ],
      unfit: [
        'Forwarded for your urgent information and necessary action. The machine has been taken OUT OF SERVICE and must not be operated until the defects below are rectified and it is re-inspected.',
        'This requires your immediate attention. The machine is OUT OF SERVICE. Please arrange rectification and re-inspection before it returns to work.',
        'Submitted for urgent action. The machine must not be used until the defects listed below are closed out and a re-inspection is recorded.'
      ]
    },
    ar: {
      fit: [
        'يُرفع هذا للعلم وللحفظ في الملف. لا يلزم أي إجراء حتى موعد الفحص التالي.',
        'محال إليكم للعلم واتخاذ اللازم. المعدة مصرّح لها بالاستمرار في الخدمة.',
        'يرجى الاحتفاظ بهذا في ملف المعدة. المعدة لا تزال صالحة للخدمة.'
      ],
      conditional: [
        'محال إليكم للعلم واتخاذ اللازم. يجوز استمرار المعدة في الخدمة وفق الشروط المبينة أدناه فقط.',
        'يرجى مراجعة الملاحظات أدناه واتخاذ الإجراء اللازم. المعدة صالحة للخدمة رهناً بتلك الشروط.',
        'يُرفع للعلم واتخاذ الإجراء. يجب استيفاء الشروط المدرجة أدناه طوال فترة استخدام المعدة.'
      ],
      unfit: [
        'محال إليكم للعلم العاجل واتخاذ اللازم. تم إخراج المعدة من الخدمة ولا يجوز تشغيلها حتى إصلاح العيوب أدناه وإعادة فحصها.',
        'يتطلب هذا اهتمامكم الفوري. المعدة خارج الخدمة. يرجى ترتيب الإصلاح وإعادة الفحص قبل عودتها للعمل.',
        'يُرفع لاتخاذ إجراء عاجل. لا يجوز استخدام المعدة حتى إغلاق العيوب المدرجة أدناه وتسجيل إعادة الفحص.'
      ]
    },
    ur: {
      fit: [
        'یہ آپ کی معلومات اور ریکارڈ کے لیے پیش ہے۔ اگلے مقررہ معائنے تک کسی کارروائی کی ضرورت نہیں۔',
        'برائے اطلاع و ضروری کارروائی ارسال۔ مشین کو سروس جاری رکھنے کی اجازت ہے۔',
        'براہ کرم اسے مشین کی فائل میں محفوظ رکھیں۔ مشین بدستور سروس کے قابل ہے۔'
      ],
      conditional: [
        'برائے اطلاع و ضروری کارروائی ارسال۔ مشین صرف ذیل میں درج شرائط کے تحت سروس جاری رکھ سکتی ہے۔',
        'براہ کرم ذیل کے مشاہدات کا جائزہ لیں اور ضروری کارروائی کریں۔ مشین ان شرائط سے مشروط طور پر قابل استعمال ہے۔',
        'برائے اطلاع و کارروائی پیش۔ مشین کے استعمال کے دوران ذیل کی شرائط پوری کرنا لازم ہے۔'
      ],
      unfit: [
        'برائے فوری اطلاع و ضروری کارروائی ارسال۔ مشین کو سروس سے باہر کر دیا گیا ہے اور ذیل کی خرابیاں دور کر کے دوبارہ معائنہ ہونے تک اسے نہ چلایا جائے۔',
        'اس پر آپ کی فوری توجہ درکار ہے۔ مشین سروس سے باہر ہے۔ کام پر واپسی سے پہلے درستگی اور دوبارہ معائنے کا انتظام کریں۔',
        'فوری کارروائی کے لیے پیش۔ ذیل میں درج خرابیاں دور ہونے اور دوبارہ معائنہ درج ہونے تک مشین استعمال نہ کی جائے۔'
      ]
    },
    hi: {
      fit: [
        'यह आपकी जानकारी और अभिलेख हेतु प्रस्तुत है। अगले निर्धारित निरीक्षण तक कोई कार्रवाई अपेक्षित नहीं।',
        'सूचनार्थ एवं आवश्यक कार्रवाई हेतु अग्रेषित। मशीन को सेवा जारी रखने की अनुमति है।',
        'कृपया इसे उपकरण फ़ाइल में सुरक्षित रखें। मशीन सेवा योग्य बनी हुई है।'
      ],
      conditional: [
        'सूचनार्थ एवं आवश्यक कार्रवाई हेतु अग्रेषित। मशीन केवल नीचे दी गई शर्तों के अधीन सेवा में रह सकती है।',
        'कृपया नीचे दिए अवलोकनों की समीक्षा कर आवश्यक कार्रवाई करें। मशीन उन शर्तों के अधीन सेवा योग्य है।',
        'सूचनार्थ एवं कार्रवाई हेतु प्रस्तुत। मशीन के उपयोग के दौरान नीचे सूचीबद्ध शर्तें पूरी करना अनिवार्य है।'
      ],
      unfit: [
        'तत्काल सूचनार्थ एवं आवश्यक कार्रवाई हेतु अग्रेषित। मशीन को सेवा से बाहर कर दिया गया है और नीचे दी गई खराबियाँ दूर कर पुनः निरीक्षण होने तक इसे न चलाया जाए।',
        'इस पर आपका तत्काल ध्यान अपेक्षित है। मशीन सेवा से बाहर है। कार्य पर वापसी से पूर्व सुधार और पुनः निरीक्षण की व्यवस्था करें।',
        'तत्काल कार्रवाई हेतु प्रस्तुत। नीचे सूचीबद्ध खराबियाँ बंद होने और पुनः निरीक्षण दर्ज होने तक मशीन का उपयोग न करें।'
      ]
    }
  };

  const CLOSERS = {
    en: [
      'Please acknowledge receipt.',
      'Happy to provide the signed copy or any further detail on request.',
      'Do come back to me if anything needs clarifying.',
      'Please confirm once the required action has been arranged.'
    ],
    ar: [
      'يرجى إفادتنا باستلام الرسالة.',
      'يسعدنا تزويدكم بالنسخة الموقّعة أو أي تفاصيل إضافية عند الطلب.',
      'يرجى التواصل معنا إذا احتاج أي بند إلى توضيح.',
      'يرجى التأكيد بمجرد ترتيب الإجراء المطلوب.'
    ],
    ur: [
      'براہ کرم وصولی کی تصدیق کریں۔',
      'درخواست پر دستخط شدہ نقل یا مزید تفصیل فراہم کی جا سکتی ہے۔',
      'کسی بھی وضاحت کی ضرورت ہو تو رابطہ کریں۔',
      'مطلوبہ کارروائی کا بندوبست ہو جانے پر تصدیق فرمائیں۔'
    ],
    hi: [
      'कृपया प्राप्ति की पुष्टि करें।',
      'अनुरोध पर हस्ताक्षरित प्रति या अतिरिक्त विवरण उपलब्ध कराया जा सकता है।',
      'किसी स्पष्टीकरण की आवश्यकता हो तो कृपया संपर्क करें।',
      'आवश्यक कार्रवाई की व्यवस्था हो जाने पर कृपया पुष्टि करें।'
    ]
  };

  const LBL = {
    greeting:    { en: 'Dear all,', ar: 'السادة الأفاضل،', ur: 'محترم حضرات،', hi: 'महोदय/महोदया,' },
    equipment:   { en: 'EQUIPMENT', ar: 'المعدة', ur: 'مشین', hi: 'उपकरण' },
    result:      { en: 'RESULT', ar: 'النتيجة', ur: 'نتیجہ', hi: 'परिणाम' },
    colour:      { en: 'Colour code fitted', ar: 'رمز اللون المركّب', ur: 'لگایا گیا رنگ کوڈ', hi: 'लगाया गया रंग कोड' },
    defects:     { en: 'DEFECTS REQUIRING ACTION', ar: 'العيوب التي تتطلب إجراءً', ur: 'کارروائی کی متقاضی خرابیاں', hi: 'कार्रवाई हेतु खराबियाँ' },
    monitor:     { en: 'ITEMS TO MONITOR', ar: 'بنود تحت المراقبة', ur: 'نگرانی طلب آئٹمز', hi: 'निगरानी हेतु आइटम' },
    noDefects:   { en: 'No defects were recorded.', ar: 'لم تُسجَّل أي عيوب.', ur: 'کوئی خرابی درج نہیں ہوئی۔', hi: 'कोई खराबी दर्ज नहीं हुई।' },
    summary:     { en: 'SUMMARY', ar: 'الملخص', ur: 'خلاصہ', hi: 'सारांश' },
    remarks:     { en: 'GENERAL REMARKS', ar: 'ملاحظات عامة', ur: 'عمومی تبصرہ', hi: 'सामान्य टिप्पणी' },
    regards:     { en: 'Regards,', ar: 'وتفضلوا بقبول فائق الاحترام،', ur: 'والسلام،', hi: 'सादर,' },
    footer:      { en: 'Generated by Duck HSE Portal — a planning aid. This monthly check does not replace statutory third-party examination.', ar: 'صادر عن تطبيق Duck HSE Portal — أداة تخطيط. لا يُغني هذا الفحص الشهري عن الفحص القانوني من جهة خارجية.', ur: 'Duck HSE Portal سے تیار شدہ — ایک منصوبہ بندی کا ذریعہ۔ یہ ماہانہ جانچ قانونی تھرڈ پارٹی معائنے کا متبادل نہیں۔', hi: 'Duck HSE Portal द्वारा निर्मित — एक नियोजन सहायक। यह मासिक जाँच वैधानिक थर्ड-पार्टी परीक्षण का विकल्प नहीं है।' },
    inspected:   { en: 'Inspected by', ar: 'تم الفحص بواسطة', ur: 'معائنہ کرنے والا', hi: 'निरीक्षणकर्ता' },
    reviewed:    { en: 'Reviewed by', ar: 'روجع بواسطة', ur: 'جائزہ لینے والا', hi: 'समीक्षक' },
    date:        { en: 'Inspection date', ar: 'تاريخ الفحص', ur: 'معائنہ کی تاریخ', hi: 'निरीक्षण तिथि' },
    location:    { en: 'Location', ar: 'الموقع', ur: 'مقام', hi: 'स्थान' },
    hours:       { en: 'Hour meter', ar: 'عداد الساعات', ur: 'آور میٹر', hi: 'आवर मीटर' },
    subjPrefix:  { en: 'Monthly Equipment Inspection', ar: 'الفحص الشهري للمعدات', ur: 'ماہانہ آلات معائنہ', hi: 'मासिक उपकरण निरीक्षण' },
    actionReq:   { en: 'ACTION REQUIRED', ar: 'مطلوب إجراء', ur: 'کارروائی درکار', hi: 'कार्रवाई अपेक्षित' },
    outOfService:{ en: 'OUT OF SERVICE', ar: 'خارج الخدمة', ur: 'سروس سے باہر', hi: 'सेवा से बाहर' }
  };

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function L(key, lang) { const e = LBL[key]; return (e && (e[lang] || e.en)) || key; }

  function verdictText(verdict, lang) {
    return I18n.t('v.' + verdict, lang);
  }

  // Builds { subject, body } for a saved (or in-progress) checklist record.
  function draft(record, lang) {
    const l = lang || I18n.get();
    const type = ChecklistData.typeById(record.equipmentType);
    const typeName = type ? (type.name[l] || type.name.en) : (record.equipmentType || '');
    const parsed = ChecklistData.parseMonth(record.month);
    const monthLabel = parsed
      ? `${ChecklistData.monthName(parsed.monthIndex, l)} ${parsed.year}`
      : (record.month || '');

    const idBits = [record.assetNo, record.make, record.model].filter(Boolean).join(' · ');

    // ---- Subject ----
    const urgent = record.verdict === 'unfit' ? `[${L('outOfService', l)}] ` :
      (record.verdict === 'conditional' ? `[${L('actionReq', l)}] ` : '');
    const subject = `${urgent}${L('subjPrefix', l)} — ${typeName}${record.assetNo ? ' (' + record.assetNo + ')' : ''} — ${monthLabel}`;

    // ---- Body ----
    const defects = (record.answers ? Object.entries(record.answers) : [])
      .filter(([, a]) => a && a.status === 'defect');
    const monitors = (record.answers ? Object.entries(record.answers) : [])
      .filter(([, a]) => a && a.status === 'monitor');

    function itemLine(itemId, ans, n) {
      const found = ChecklistData.findItem(itemId);
      const secTitle = found ? (found.section.title[l] || found.section.title.en) : '';
      const text = found ? (found.item.text[l] || found.item.text.en) : itemId;
      const note = ans.note ? `\n     → ${ans.note}` : '';
      return `  ${n}. [${secTitle}] ${text}${note}`;
    }

    const colour = parsed ? ChecklistData.colourFor(parsed.monthIndex, record.colourScheme) : null;
    const colourName = colour ? (colour.name[l] || colour.name.en) : '';

    const counts = record.counts || {};

    const parts = [];
    parts.push(L('greeting', l));
    parts.push('');
    parts.push(pick(OPENERS[l] || OPENERS.en));
    parts.push('');
    parts.push(pick((ACTIONS[l] || ACTIONS.en)[record.verdict] || (ACTIONS.en.fit)));
    parts.push('');
    parts.push('────────────────────────────');
    parts.push(L('equipment', l));
    parts.push('────────────────────────────');
    parts.push(`${typeName}${idBits ? '\n' + idBits : ''}`);
    if (record.location) parts.push(`${L('location', l)}: ${record.location}`);
    if (record.hourMeter) parts.push(`${L('hours', l)}: ${record.hourMeter}`);
    parts.push(`${L('date', l)}: ${record.inspectionDate || '—'}   (${monthLabel})`);
    parts.push('');
    parts.push(`${L('result', l)}: ${verdictText(record.verdict, l)}`);
    if (colourName) parts.push(`${L('colour', l)}: ${colourName}${record.tagFitted ? ' ✓' : ''}`);
    parts.push('');
    parts.push('────────────────────────────');
    parts.push(L('summary', l));
    parts.push('────────────────────────────');
    parts.push(`${I18n.t('sum.ok', l)}: ${counts.ok || 0}   ${I18n.t('sum.monitor', l)}: ${counts.monitor || 0}   ${I18n.t('sum.defect', l)}: ${counts.defect || 0}   ${I18n.t('sum.na', l)}: ${counts.na || 0}   (${I18n.t('sum.total', l)}: ${counts.total || 0})`);
    parts.push('');

    if (defects.length) {
      parts.push('────────────────────────────');
      parts.push(`${L('defects', l)} (${defects.length})`);
      parts.push('────────────────────────────');
      defects.forEach(([id, a], i) => parts.push(itemLine(id, a, i + 1)));
      parts.push('');
    }
    if (monitors.length) {
      parts.push('────────────────────────────');
      parts.push(`${L('monitor', l)} (${monitors.length})`);
      parts.push('────────────────────────────');
      monitors.forEach(([id, a], i) => parts.push(itemLine(id, a, i + 1)));
      parts.push('');
    }
    if (!defects.length && !monitors.length) {
      parts.push(L('noDefects', l));
      parts.push('');
    }

    if (record.remarks) {
      parts.push('────────────────────────────');
      parts.push(L('remarks', l));
      parts.push('────────────────────────────');
      parts.push(record.remarks);
      parts.push('');
    }

    parts.push(pick(CLOSERS[l] || CLOSERS.en));
    parts.push('');
    parts.push(L('regards', l));
    parts.push(record.inspector || '');
    if (record.inspectorId) parts.push(record.inspectorId);
    parts.push('');
    parts.push(`${L('inspected', l)}: ${record.inspector || '—'}`);
    parts.push(`${L('reviewed', l)}: ${record.supervisor || '—'}`);
    parts.push('');
    parts.push('— — —');
    parts.push(L('footer', l));

    return { subject, body: parts.join('\n') };
  }

  function filenameFor(record) {
    const bits = ['checklist', record.assetNo || record.equipmentType || 'equipment', record.month || ''];
    return bits.filter(Boolean).join('-').replace(/[^\w.-]+/g, '-').toLowerCase();
  }

  return { draft, filenameFor };
})();
