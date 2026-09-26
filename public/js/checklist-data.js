// checklist-data.js — the monthly inspection and maintenance checklist content
// for earthmoving machinery and cranes, in English, Arabic, Urdu and Hindi.
//
// Structure
// ---------
//   EQUIPMENT_TYPES  each machine type, with the tags that decide which
//                    sections apply to it.
//   CHECK_SECTIONS   sections of items. A section is shown when its
//                    `appliesTo` is 'all', or shares a tag with the selected
//                    machine. That is how one file serves an excavator and a
//                    50 t mobile crane without showing either of them a page of
//                    irrelevant items.
//   COLOUR_SCHEMES   the month/quarter colour-code tag system.
//   ICONS            inline SVG, so the icons work offline like everything else.
//
// Editing: add an item by appending to a section's `items` with a unique `id`
// and all four translations. Saved records store the answers keyed by item id,
// so never reuse an id for a different question — add a new one instead, or old
// records will silently start reporting the wrong thing.
//
// The translations are a careful working draft, not a certified translation.
// See the note at the top of js/i18n.js.

// ---------------------------------------------------------------------------
// Icons (24x24 viewBox, stroke uses currentColor)
// ---------------------------------------------------------------------------
const CHECK_ICONS = {
  doc:      '<path d="M6 2h9l4 4v16H6z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M9 12h7M9 16h7M9 8h3" stroke="currentColor" stroke-width="1.4"/>',
  badge:    '<circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 21c0-3.3 3.1-6 7-6s7 2.7 7 6" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  eye:      '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  cab:      '<path d="M4 20V9l6-5h7a3 3 0 013 3v13z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 9h10M12 9v11" stroke="currentColor" stroke-width="1.3"/>',
  engine:   '<path d="M3 14v-4h3l2-3h5l2 3h3a2 2 0 012 2v2a2 2 0 01-2 2h-2l-2 3H8l-2-3H3z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M9 10v4M13 10v4" stroke="currentColor" stroke-width="1.2"/>',
  hydraulic:'<path d="M12 3s5.5 6.3 5.5 10a5.5 5.5 0 11-11 0C6.5 9.3 12 3 12 3z" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  electric: '<path d="M13 2L4 14h6l-1 8 9-12h-6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  brake:    '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3" stroke="currentColor" stroke-width="1.3"/>',
  tyre:     '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4" stroke="currentColor" stroke-width="1.2"/>',
  track:    '<rect x="2.5" y="8" width="19" height="8" rx="4" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="7" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="17" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5 16.5v1.5M9 16.5v1.5M13 16.5v1.5M17 16.5v1.5" stroke="currentColor" stroke-width="1.2"/>',
  shield:   '<path d="M12 2.5l8 3v6c0 5-3.4 9.2-8 10.5C7.4 20.7 4 16.5 4 11.5v-6z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M9 12l2.2 2.2L15.5 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  boom:     '<path d="M3 19h8M4 19l1-4h5l1 4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 15L19 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 5v6" stroke="currentColor" stroke-width="1.2"/>',
  rope:     '<path d="M8 3c3 2 3 4 0 6s-3 4 0 6 3 4 0 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M16 3c-3 2-3 4 0 6s3 4 0 6-3 4 0 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  hook:     '<path d="M12 3v7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><rect x="8.5" y="10" width="7" height="5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M12 15v2.5a3 3 0 103-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  outrigger:'<path d="M8 6h8v6H8z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 9H3v6M16 9h5v6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M1 15h4M19 15h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  slew:     '<circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 2.5a9.5 9.5 0 019.2 7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M19 6.5l2.4 3.2-3.9.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  gauge:    '<path d="M4 18a8 8 0 1116 0" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 18l4.5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="18" r="1.4" fill="currentColor"/>',
  bucket:   '<path d="M4 6v5a7 7 0 007 7h3a5 5 0 005-5V9" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M19 9l-4-4M4 6h5" stroke="currentColor" stroke-width="1.4"/><path d="M6 18l-1 3M10 19.5l-.5 2.5M14 20l.3 2" stroke="currentColor" stroke-width="1.3"/>',
  blade:    '<path d="M4 5v11a3 3 0 003 3h13" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 19h3M7 8h10M7 12h10" stroke="currentColor" stroke-width="1.3"/>',
  forks:    '<path d="M5 3v14h14" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 17V7M13 17V7" stroke="currentColor" stroke-width="1.4"/><path d="M5 20h16" stroke="currentColor" stroke-width="1.4"/>',
  platform: '<rect x="3" y="4" width="10" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 10l6 7M14 17h6M17 17v3" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="4" y="18" width="8" height="3" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  wrench:   '<path d="M20 5.5a5 5 0 01-6.6 6.6L6 19.5 4.5 18l7.4-7.4A5 5 0 0118.5 4l-2.8 2.8 1.5 1.5L20 5.5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  fire:     '<path d="M12 2.5c1 3-2.5 4-2.5 7A2.5 2.5 0 0012 12a2 2 0 002-2c2 1.5 3 3.5 3 5.5a5 5 0 11-10 0c0-4 4-6 5-11z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  leaf:     '<path d="M20 4C9 4 4 9 4 16c0 2 1 4 1 4s6-1 10-5 5-11 5-11z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M5 20L15 9" stroke="currentColor" stroke-width="1.3"/>',
  battery:  '<rect x="2.5" y="7" width="16" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M18.5 10.5h3v3h-3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 12h6M9 9v6" stroke="currentColor" stroke-width="1.4"/>',
  filter:   '<path d="M3 4h18l-7 8v8l-4-2v-6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  truck:    '<path d="M2 7h11v9H2z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M13 10h4l4 4v2h-8z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="6" cy="18" r="2" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="17" cy="18" r="2" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  tower:    '<path d="M12 3v18M3 9h18" stroke="currentColor" stroke-width="1.5"/><path d="M12 3l-4 6M12 3l4 6" stroke="currentColor" stroke-width="1.3"/><path d="M7 9v3M17 9v3M5 21h14" stroke="currentColor" stroke-width="1.3"/>',
  warning:  '<path d="M12 2.5L1.5 21h21z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 9v5M12 17.5h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
};

// ---------------------------------------------------------------------------
// Equipment types
// ---------------------------------------------------------------------------
// `tags` decide which sections apply. Keep them accurate — they are the only
// thing stopping an excavator checklist from asking about outriggers.
const EQUIPMENT_TYPES = [
  { id: 'mobile-crane', icon: 'boom', tags: ['crane', 'lifting', 'wheeled', 'outriggers', 'road'],
    name: { en: 'Mobile crane (all-terrain / truck-mounted)', ar: 'رافعة متحركة (لجميع التضاريس / مركبة على شاحنة)', ur: 'موبائل کرین (آل ٹیرین / ٹرک ماؤنٹڈ)', hi: 'मोबाइल क्रेन (ऑल-टेरेन / ट्रक-माउंटेड)' } },

  { id: 'crawler-crane', icon: 'boom', tags: ['crane', 'lifting', 'tracked'],
    name: { en: 'Crawler crane', ar: 'رافعة زاحفة', ur: 'کرالر کرین', hi: 'क्रॉलर क्रेन' } },

  { id: 'tower-crane', icon: 'tower', tags: ['crane', 'lifting', 'tower'],
    name: { en: 'Tower crane', ar: 'رافعة برجية', ur: 'ٹاور کرین', hi: 'टावर क्रेन' } },

  { id: 'telehandler', icon: 'forks', tags: ['lifting', 'wheeled', 'outriggers', 'forks', 'attachments'],
    name: { en: 'Telehandler', ar: 'رافعة تلسكوبية', ur: 'ٹیلی ہینڈلر', hi: 'टेलीहैंडलर' } },

  { id: 'forklift', icon: 'forks', tags: ['lifting', 'wheeled', 'forks'],
    name: { en: 'Forklift', ar: 'رافعة شوكية', ur: 'فورک لفٹ', hi: 'फोर्कलिफ्ट' } },

  { id: 'mewp', icon: 'platform', tags: ['mewp', 'wheeled', 'outriggers'],
    name: { en: 'MEWP (boom / scissor lift)', ar: 'منصة عمل متحركة (رافعة ذراع / مقصية)', ur: 'ایم ای ڈبلیو پی (بوم / سیزر لفٹ)', hi: 'MEWP (बूम / सिज़र लिफ्ट)' } },

  { id: 'excavator', icon: 'bucket', tags: ['earthmoving', 'tracked', 'attachments'],
    name: { en: 'Excavator (tracked)', ar: 'حفارة (مجنزرة)', ur: 'ایکسکیویٹر (ٹریکڈ)', hi: 'एक्सकेवेटर (ट्रैक्ड)' } },

  { id: 'wheeled-excavator', icon: 'bucket', tags: ['earthmoving', 'wheeled', 'attachments', 'outriggers'],
    name: { en: 'Excavator (wheeled)', ar: 'حفارة (بعجلات)', ur: 'ایکسکیویٹر (وہیلڈ)', hi: 'एक्सकेवेटर (व्हील्ड)' } },

  { id: 'backhoe-loader', icon: 'bucket', tags: ['earthmoving', 'wheeled', 'attachments', 'outriggers', 'road'],
    name: { en: 'Backhoe loader', ar: 'حفارة لودر خلفية', ur: 'بیک ہو لوڈر', hi: 'बैकहो लोडर' } },

  { id: 'wheel-loader', icon: 'bucket', tags: ['earthmoving', 'wheeled', 'attachments'],
    name: { en: 'Wheel loader', ar: 'لودر بعجلات', ur: 'وہیل لوڈر', hi: 'व्हील लोडर' } },

  { id: 'bulldozer', icon: 'blade', tags: ['earthmoving', 'tracked', 'dozer'],
    name: { en: 'Bulldozer', ar: 'جرافة (بلدوزر)', ur: 'بلڈوزر', hi: 'बुलडोज़र' } },

  { id: 'motor-grader', icon: 'blade', tags: ['earthmoving', 'wheeled', 'dozer'],
    name: { en: 'Motor grader', ar: 'ممهدة (جريدر)', ur: 'موٹر گریڈر', hi: 'मोटर ग्रेडर' } },

  { id: 'skid-steer', icon: 'bucket', tags: ['earthmoving', 'wheeled', 'attachments'],
    name: { en: 'Skid-steer loader', ar: 'لودر انزلاقي التوجيه', ur: 'اسکڈ اسٹیئر لوڈر', hi: 'स्किड-स्टीयर लोडर' } },

  { id: 'roller', icon: 'tyre', tags: ['earthmoving', 'wheeled', 'compaction'],
    name: { en: 'Roller / compactor', ar: 'مدحلة / ضاغطة', ur: 'رولر / کمپیکٹر', hi: 'रोलर / कॉम्पैक्टर' } },

  { id: 'dump-truck', icon: 'truck', tags: ['earthmoving', 'wheeled', 'road', 'tipper'],
    name: { en: 'Dump truck / tipper', ar: 'شاحنة قلاب', ur: 'ڈمپ ٹرک / ٹپر', hi: 'डंप ट्रक / टिपर' } }
];

// ---------------------------------------------------------------------------
// Checklist sections
// ---------------------------------------------------------------------------
const CHECK_SECTIONS = [

  // ===================== 1. Documents & certification =====================
  {
    id: 'docs', icon: 'doc', appliesTo: 'all',
    title: { en: 'Documents & certification', ar: 'المستندات والشهادات', ur: 'دستاویزات اور سرٹیفکیشن', hi: 'दस्तावेज़ और प्रमाणन' },
    items: [
      { id: 'doc-01', text: { en: 'Third-party inspection certificate valid and held with the machine', ar: 'شهادة الفحص من جهة خارجية سارية ومحفوظة مع المعدة', ur: 'تھرڈ پارٹی معائنہ سرٹیفکیٹ کارآمد اور مشین کے ساتھ موجود', hi: 'थर्ड-पार्टी निरीक्षण प्रमाणपत्र वैध और मशीन के साथ उपलब्ध' } },
      { id: 'doc-02', text: { en: 'Operator holds a valid licence/certificate for this class of machine', ar: 'المشغّل يحمل رخصة/شهادة سارية لهذه الفئة من المعدات', ur: 'آپریٹر کے پاس اس قسم کی مشین کا کارآمد لائسنس/سرٹیفکیٹ ہے', hi: 'ऑपरेटर के पास इस श्रेणी की मशीन का वैध लाइसेंस/प्रमाणपत्र है' } },
      { id: 'doc-03', text: { en: 'Registration and third-party insurance in date', ar: 'التسجيل والتأمين ضد الغير ساريان', ur: 'رجسٹریشن اور تھرڈ پارٹی انشورنس کارآمد', hi: 'पंजीकरण और थर्ड-पार्टी बीमा वैध' } },
      { id: 'doc-04', text: { en: 'Operation & maintenance manual available in the cab', ar: 'دليل التشغيل والصيانة متوفر في الكابينة', ur: 'آپریشن اور مینٹیننس مینوئل کیبن میں موجود', hi: 'संचालन और रखरखाव मैनुअल केबिन में उपलब्ध' } },
      { id: 'doc-05', text: { en: 'Defects raised at the previous inspection have been closed out', ar: 'العيوب المسجلة في الفحص السابق تم إغلاقها', ur: 'پچھلے معائنے کی خرابیاں دور کی جا چکی ہیں', hi: 'पिछले निरीक्षण में दर्ज खराबियाँ दूर की जा चुकी हैं' } },
      { id: 'doc-06', text: { en: 'Daily/pre-use inspection records are being completed and kept', ar: 'سجلات الفحص اليومي/قبل الاستخدام تُستكمل وتُحفظ', ur: 'روزانہ/استعمال سے پہلے معائنے کے ریکارڈ مکمل اور محفوظ', hi: 'दैनिक/उपयोग-पूर्व निरीक्षण रिकॉर्ड भरे और सुरक्षित रखे जा रहे हैं' } },
      { id: 'doc-07', text: { en: 'Service/maintenance history up to date against the hour meter', ar: 'سجل الصيانة محدّث وفق عداد الساعات', ur: 'سروس/مینٹیننس ریکارڈ آور میٹر کے مطابق اپ ٹو ڈیٹ', hi: 'सर्विस/रखरखाव इतिहास आवर मीटर के अनुसार अद्यतन' } }
    ]
  },

  // ===================== 2. Load chart & rated capacity =====================
  {
    id: 'capacity', icon: 'gauge', appliesTo: ['crane', 'lifting'],
    title: { en: 'Load chart & rated capacity', ar: 'جدول الأحمال والسعة المقننة', ur: 'لوڈ چارٹ اور مقررہ صلاحیت', hi: 'लोड चार्ट और रेटेड क्षमता' },
    items: [
      { id: 'cap-01', text: { en: 'Load chart present in the cab, legible and correct for the machine and its configuration', ar: 'جدول الأحمال موجود في الكابينة، واضح ومطابق للمعدة وتهيئتها', ur: 'لوڈ چارٹ کیبن میں موجود، واضح اور مشین و کنفیگریشن کے مطابق', hi: 'लोड चार्ट केबिन में मौजूद, स्पष्ट और मशीन व कॉन्फ़िगरेशन के अनुरूप' } },
      { id: 'cap-02', text: { en: 'Rated capacity indicator / load moment indicator (LMI) powers up and self-tests', ar: 'مؤشر السعة المقننة / مؤشر عزم الحمل يعمل ويجري الاختبار الذاتي', ur: 'ریٹڈ کیپیسٹی انڈیکیٹر / لوڈ مومنٹ انڈیکیٹر (LMI) چالو اور سیلف ٹیسٹ کرتا ہے', hi: 'रेटेड कैपेसिटी इंडिकेटर / लोड मोमेंट इंडिकेटर (LMI) चालू और सेल्फ-टेस्ट करता है' } },
      { id: 'cap-03', text: { en: 'LMI calibration in date and the seal/settings have not been tampered with', ar: 'معايرة مؤشر عزم الحمل سارية ولم يتم العبث بالختم/الإعدادات', ur: 'LMI کیلیبریشن کارآمد اور سیل/سیٹنگز سے چھیڑ چھاڑ نہیں ہوئی', hi: 'LMI कैलिब्रेशन वैध और सील/सेटिंग्स से छेड़छाड़ नहीं हुई' } },
      { id: 'cap-04', text: { en: 'Overload cut-out / audible and visual overload alarm function correctly', ar: 'قاطع الحمل الزائد وإنذار التحميل الزائد الصوتي والمرئي يعملان بشكل صحيح', ur: 'اوورلوڈ کٹ آؤٹ / آواز اور روشنی والا اوورلوڈ الارم درست کام کرتا ہے', hi: 'ओवरलोड कट-आउट / श्रव्य और दृश्य ओवरलोड अलार्म सही काम करते हैं' } },
      { id: 'cap-05', text: { en: 'Boom angle / length / radius indicators read correctly', ar: 'مؤشرات زاوية وطول الذراع ونصف قطر العمل تعطي قراءات صحيحة', ur: 'بوم اینگل / لمبائی / ریڈیس انڈیکیٹر درست ریڈنگ دیتے ہیں', hi: 'बूम कोण / लंबाई / त्रिज्या संकेतक सही रीडिंग देते हैं' } },
      { id: 'cap-06', text: { en: 'Safe working load (SWL) clearly marked on the machine', ar: 'حمل التشغيل الآمن مُعلَّم بوضوح على المعدة', ur: 'محفوظ ورکنگ لوڈ (SWL) مشین پر واضح لکھا ہے', hi: 'सुरक्षित कार्य भार (SWL) मशीन पर स्पष्ट अंकित है' } }
    ]
  },

  // ===================== 3. Walk-around / structure =====================
  {
    id: 'structure', icon: 'eye', appliesTo: 'all',
    title: { en: 'Walk-around & structure', ar: 'الفحص الظاهري والهيكل', ur: 'واک اراؤنڈ اور ڈھانچہ', hi: 'वॉक-अराउंड और संरचना' },
    items: [
      { id: 'str-01', text: { en: 'Chassis, frame and welds free of cracks, bends or corrosion damage', ar: 'الشاسيه والهيكل واللحامات خالية من الشقوق أو الانحناء أو تلف التآكل', ur: 'چیسس، فریم اور ویلڈنگ میں دراڑ، خم یا زنگ کا نقصان نہیں', hi: 'चेसिस, फ्रेम और वेल्ड में दरार, मुड़ाव या जंग क्षति नहीं' } },
      { id: 'str-02', text: { en: 'No unauthorised repairs, modifications or field welding to load-bearing parts', ar: 'لا توجد إصلاحات أو تعديلات أو لحام ميداني غير مصرح به في الأجزاء الحاملة للأحمال', ur: 'بوجھ اٹھانے والے حصوں پر غیر منظور شدہ مرمت، ترمیم یا ویلڈنگ نہیں', hi: 'भार-वाहक भागों पर अनधिकृत मरम्मत, संशोधन या फील्ड वेल्डिंग नहीं' } },
      { id: 'str-03', text: { en: 'Access steps, ladders, handrails and walkways secure and non-slip', ar: 'الدرجات والسلالم والدرابزين وممرات المشي سليمة وغير قابلة للانزلاق', ur: 'رسائی کی سیڑھیاں، ریلنگ اور واک وے محفوظ اور نان سلپ', hi: 'पहुँच सीढ़ियाँ, रेलिंग और वॉकवे सुरक्षित और फिसलन-रहित' } },
      { id: 'str-04', text: { en: 'All guards, covers and engine panels fitted and secured', ar: 'جميع الواقيات والأغطية وألواح المحرك مركبة ومثبتة', ur: 'تمام گارڈز، کور اور انجن پینل نصب اور محفوظ', hi: 'सभी गार्ड, कवर और इंजन पैनल लगे और सुरक्षित' } },
      { id: 'str-05', text: { en: 'Pins, bushes and retaining bolts in place, secured and not excessively worn', ar: 'المسامير والجلب وبراغي التثبيت موجودة ومؤمّنة وغير مهترئة بشكل مفرط', ur: 'پن، بش اور ریٹیننگ بولٹ موجود، محفوظ اور زیادہ گھسے ہوئے نہیں', hi: 'पिन, बुश और रिटेनिंग बोल्ट लगे, सुरक्षित और अत्यधिक घिसे नहीं' } },
      { id: 'str-06', text: { en: 'Machine clean enough to inspect — no build-up hiding leaks or cracks', ar: 'المعدة نظيفة بما يكفي للفحص — لا تراكمات تخفي التسريبات أو الشقوق', ur: 'مشین معائنے کے لیے کافی صاف — کوئی جمی ہوئی گندگی رساؤ یا دراڑ نہیں چھپا رہی', hi: 'मशीन निरीक्षण के लिए पर्याप्त साफ़ — कोई जमाव रिसाव या दरार नहीं छिपा रहा' } },
      { id: 'str-07', text: { en: 'Safety decals, warning signs and capacity plates present and legible', ar: 'ملصقات السلامة ولافتات التحذير ولوحات السعة موجودة وواضحة', ur: 'حفاظتی اسٹیکر، وارننگ سائن اور کیپیسٹی پلیٹ موجود اور پڑھنے کے قابل', hi: 'सुरक्षा डिकल, चेतावनी चिह्न और क्षमता प्लेट मौजूद और पठनीय' } }
    ]
  },

  // ===================== 4. Cab & operator station =====================
  {
    id: 'cab', icon: 'cab', appliesTo: 'all',
    title: { en: 'Cab & operator station', ar: 'الكابينة ومحطة المشغّل', ur: 'کیبن اور آپریٹر اسٹیشن', hi: 'केबिन और ऑपरेटर स्टेशन' },
    items: [
      { id: 'cab-01', text: { en: 'ROPS / FOPS structure intact, undamaged and correctly mounted', ar: 'هيكل الحماية من الانقلاب/سقوط الأجسام سليم وغير تالف ومثبت بشكل صحيح', ur: 'ROPS / FOPS ڈھانچہ سالم، بغیر نقصان اور درست نصب', hi: 'ROPS / FOPS संरचना सही, क्षतिरहित और ठीक से लगी' } },
      { id: 'cab-02', text: { en: 'Seat, seat adjustment and seat belt serviceable; belt webbing not frayed', ar: 'المقعد وضبطه وحزام الأمان صالحة للاستخدام؛ نسيج الحزام غير متآكل', ur: 'سیٹ، سیٹ ایڈجسٹمنٹ اور سیٹ بیلٹ درست؛ بیلٹ کا کپڑا پھٹا ہوا نہیں', hi: 'सीट, सीट समायोजन और सीट बेल्ट ठीक; बेल्ट का कपड़ा घिसा नहीं' } },
      { id: 'cab-03', text: { en: 'Glass, wipers and washers clean, intact and giving clear all-round vision', ar: 'الزجاج والمساحات ورشاشات الغسيل نظيفة وسليمة وتوفر رؤية واضحة من جميع الجهات', ur: 'شیشہ، وائپر اور واشر صاف، سالم اور ہر طرف واضح نظارہ', hi: 'काँच, वाइपर और वॉशर साफ़, सही और चारों ओर स्पष्ट दृश्यता' } },
      { id: 'cab-04', text: { en: 'Mirrors and reversing/blind-spot camera clean, aligned and working', ar: 'المرايا وكاميرا الرجوع/النقاط العمياء نظيفة ومضبوطة وتعمل', ur: 'آئینے اور ریورس/بلائنڈ اسپاٹ کیمرہ صاف، درست اور کام کر رہے', hi: 'दर्पण और रिवर्स/ब्लाइंड-स्पॉट कैमरा साफ़, सही दिशा में और चालू' } },
      { id: 'cab-05', text: { en: 'All controls move freely, return to neutral and are correctly labelled', ar: 'جميع أدوات التحكم تتحرك بحرية وتعود إلى الوضع المحايد ومُعلَّمة بشكل صحيح', ur: 'تمام کنٹرول آزادی سے حرکت کرتے، نیوٹرل پر واپس آتے اور درست لیبل شدہ', hi: 'सभी नियंत्रण स्वतंत्र रूप से चलते, न्यूट्रल पर लौटते और सही लेबल वाले' } },
      { id: 'cab-06', text: { en: 'Gauges, warning lights and display screens all functional', ar: 'العدادات ومصابيح التحذير وشاشات العرض جميعها تعمل', ur: 'گیج، وارننگ لائٹس اور ڈسپلے اسکرین سب کام کر رہے', hi: 'गेज, चेतावनी लाइट और डिस्प्ले स्क्रीन सभी कार्यरत' } },
      { id: 'cab-07', text: { en: 'Air conditioning / heater and cab ventilation working', ar: 'التكييف/المدفأة والتهوية في الكابينة تعمل', ur: 'ایئر کنڈیشنگ / ہیٹر اور کیبن وینٹیلیشن کام کر رہے', hi: 'एयर कंडीशनिंग / हीटर और केबिन वेंटिलेशन कार्यरत' } },
      { id: 'cab-08', text: { en: 'Two-way radio / communication equipment working and on the agreed channel', ar: 'جهاز الاتصال اللاسلكي يعمل وعلى القناة المتفق عليها', ur: 'ٹو وے ریڈیو / رابطے کا آلہ کام کر رہا اور طے شدہ چینل پر', hi: 'टू-वे रेडियो / संचार उपकरण कार्यरत और तय चैनल पर' } }
    ]
  },

  // ===================== 5. Engine & powertrain =====================
  {
    id: 'engine', icon: 'engine', appliesTo: 'all',
    title: { en: 'Engine & powertrain', ar: 'المحرك ومجموعة نقل الحركة', ur: 'انجن اور پاور ٹرین', hi: 'इंजन और पावरट्रेन' },
    items: [
      { id: 'eng-01', text: { en: 'Starts readily, idles smoothly, no abnormal noise, smoke or vibration', ar: 'يبدأ بسهولة ويعمل بسلاسة دون ضوضاء أو دخان أو اهتزاز غير طبيعي', ur: 'آسانی سے اسٹارٹ، ہموار آئیڈل، غیر معمولی آواز، دھواں یا ارتعاش نہیں', hi: 'आसानी से चालू, सुचारू आइडल, असामान्य आवाज़, धुआँ या कंपन नहीं' } },
      { id: 'eng-02', text: { en: 'Engine oil level and condition correct; no leaks', ar: 'مستوى زيت المحرك وحالته صحيحان؛ لا توجد تسريبات', ur: 'انجن آئل کی سطح اور حالت درست؛ کوئی رساؤ نہیں', hi: 'इंजन ऑयल स्तर और स्थिति सही; कोई रिसाव नहीं' } },
      { id: 'eng-03', text: { en: 'Coolant level correct, radiator/cooler cores clean and unblocked', ar: 'مستوى سائل التبريد صحيح، وقلب الرادياتير/المبرد نظيف وغير مسدود', ur: 'کولنٹ کی سطح درست، ریڈی ایٹر/کولر کور صاف اور بند نہیں', hi: 'कूलेंट स्तर सही, रेडिएटर/कूलर कोर साफ़ और अवरुद्ध नहीं' } },
      { id: 'eng-04', text: { en: 'Belts and hoses in good condition, correctly tensioned, no chafing', ar: 'الأحزمة والخراطيم بحالة جيدة ومشدودة بشكل صحيح وبدون احتكاك', ur: 'بیلٹ اور ہوز اچھی حالت میں، درست کسے ہوئے، رگڑ نہیں', hi: 'बेल्ट और होज़ अच्छी स्थिति में, सही तनाव, घिसाव नहीं' } },
      { id: 'eng-05', text: { en: 'Air filter clean / restriction indicator within range', ar: 'فلتر الهواء نظيف / مؤشر الانسداد ضمن المدى المسموح', ur: 'ایئر فلٹر صاف / ریسٹرکشن انڈیکیٹر حد کے اندر', hi: 'एयर फ़िल्टर साफ़ / रेस्ट्रिक्शन इंडिकेटर सीमा के भीतर' } },
      { id: 'eng-06', text: { en: 'Exhaust system sound, no leaks, silencer and spark arrestor fitted where required', ar: 'نظام العادم سليم دون تسريبات، وكاتم الصوت ومانع الشرر مركبان عند اللزوم', ur: 'ایگزاسٹ سسٹم درست، رساؤ نہیں، ضرورت ہو تو سائلنسر اور اسپارک اریسٹر نصب', hi: 'एग्ज़ॉस्ट सिस्टम ठीक, रिसाव नहीं, आवश्यक हो तो साइलेंसर और स्पार्क अरेस्टर लगे' } },
      { id: 'eng-07', text: { en: 'Fuel tank cap, lines and water separator sound; no fuel leaks', ar: 'غطاء خزان الوقود والخطوط وفاصل الماء سليمة؛ لا تسرب وقود', ur: 'فیول ٹینک کیپ، لائنیں اور واٹر سیپریٹر درست؛ ایندھن کا رساؤ نہیں', hi: 'ईंधन टैंक कैप, लाइनें और वॉटर सेपरेटर ठीक; ईंधन रिसाव नहीं' } },
      { id: 'eng-08', text: { en: 'Transmission / torque converter operates through all ranges without slip', ar: 'ناقل الحركة/محول العزم يعمل في جميع النطاقات دون انزلاق', ur: 'ٹرانسمیشن / ٹارک کنورٹر تمام رینج میں بغیر پھسلن کام کرتا ہے', hi: 'ट्रांसमिशन / टॉर्क कन्वर्टर सभी रेंज में बिना फिसलन काम करता है' } }
    ]
  },

  // ===================== 6. Hydraulic system =====================
  {
    id: 'hydraulic', icon: 'hydraulic', appliesTo: 'all',
    title: { en: 'Hydraulic system', ar: 'النظام الهيدروليكي', ur: 'ہائیڈرولک سسٹم', hi: 'हाइड्रोलिक सिस्टम' },
    items: [
      { id: 'hyd-01', text: { en: 'Hydraulic oil level and condition correct (not milky, burnt or contaminated)', ar: 'مستوى وحالة الزيت الهيدروليكي صحيحان (ليس حليبياً أو محترقاً أو ملوثاً)', ur: 'ہائیڈرولک آئل کی سطح اور حالت درست (دودھیا، جلا ہوا یا آلودہ نہیں)', hi: 'हाइड्रोलिक तेल स्तर और स्थिति सही (दूधिया, जला या दूषित नहीं)' } },
      { id: 'hyd-02', text: { en: 'No hydraulic leaks from pumps, motors, valves, fittings or the tank', ar: 'لا تسريبات هيدروليكية من المضخات أو المحركات أو الصمامات أو الوصلات أو الخزان', ur: 'پمپ، موٹر، والو، فٹنگ یا ٹینک سے ہائیڈرولک رساؤ نہیں', hi: 'पंप, मोटर, वाल्व, फिटिंग या टैंक से हाइड्रोलिक रिसाव नहीं' } },
      { id: 'hyd-03', text: { en: 'Hoses free of bulges, cracks, chafing or exposed reinforcement', ar: 'الخراطيم خالية من الانتفاخ أو الشقوق أو الاحتكاك أو ظهور التسليح', ur: 'ہوز میں ابھار، دراڑ، رگڑ یا کھلی تاریں نہیں', hi: 'होज़ में उभार, दरार, घिसाव या खुली मजबूती-तार नहीं' } },
      { id: 'hyd-04', text: { en: 'Cylinders free of scoring, pitting, bending or rod seal leakage', ar: 'الأسطوانات خالية من الخدوش أو التنقر أو الانحناء أو تسرب مانع التسرب', ur: 'سلنڈر میں خراش، گڑھے، خم یا راڈ سیل کا رساؤ نہیں', hi: 'सिलेंडर में खरोंच, गड्ढे, मुड़ाव या रॉड सील रिसाव नहीं' } },
      { id: 'hyd-05', text: { en: 'No unintended drift of boom, arm, bucket or lift when held under load', ar: 'لا انزلاق غير مقصود للذراع أو الدلو أو الرافعة عند التحميل', ur: 'بوجھ کے تحت بوم، آرم، بکٹ یا لفٹ خود بخود نیچے نہیں آتی', hi: 'भार के तहत बूम, आर्म, बकेट या लिफ्ट स्वतः नीचे नहीं खिसकती' } },
      { id: 'hyd-06', text: { en: 'Relief valve settings correct; system pressure as specified', ar: 'إعدادات صمام التنفيس صحيحة؛ ضغط النظام حسب المواصفات', ur: 'ریلیف والو سیٹنگ درست؛ سسٹم پریشر مقررہ حد پر', hi: 'रिलीफ वाल्व सेटिंग सही; सिस्टम दबाव निर्दिष्ट अनुसार' } },
      { id: 'hyd-07', text: { en: 'Hose burst protection / load-holding check valves fitted where required', ar: 'صمامات حماية انفجار الخراطيم/حفظ الحمل مركبة حيثما يلزم', ur: 'جہاں ضروری ہو ہوز برسٹ پروٹیکشن / لوڈ ہولڈنگ چیک والو نصب', hi: 'जहाँ आवश्यक हो होज़ बर्स्ट प्रोटेक्शन / लोड-होल्डिंग चेक वाल्व लगे' } }
    ]
  },

  // ===================== 7. Electrical system =====================
  {
    id: 'electrical', icon: 'electric', appliesTo: 'all',
    title: { en: 'Electrical system', ar: 'النظام الكهربائي', ur: 'برقی نظام', hi: 'विद्युत प्रणाली' },
    items: [
      { id: 'ele-01', text: { en: 'Battery secure, terminals clean and protected, no leakage', ar: 'البطارية مثبتة، الأطراف نظيفة ومحمية، لا يوجد تسرب', ur: 'بیٹری محفوظ، ٹرمینل صاف اور محفوظ، رساؤ نہیں', hi: 'बैटरी सुरक्षित, टर्मिनल साफ़ और सुरक्षित, रिसाव नहीं' } },
      { id: 'ele-02', text: { en: 'Battery isolator fitted and working', ar: 'مفتاح فصل البطارية مركب ويعمل', ur: 'بیٹری آئسولیٹر نصب اور کام کر رہا', hi: 'बैटरी आइसोलेटर लगा और कार्यरत' } },
      { id: 'ele-03', text: { en: 'Wiring looms secured, insulated, clear of hot and moving parts', ar: 'ضفائر الأسلاك مثبتة ومعزولة وبعيدة عن الأجزاء الساخنة والمتحركة', ur: 'وائرنگ محفوظ، انسولیٹڈ اور گرم و حرکت کرنے والے حصوں سے دور', hi: 'वायरिंग सुरक्षित, इंसुलेटेड, गर्म और चलायमान भागों से दूर' } },
      { id: 'ele-04', text: { en: 'Head, tail, brake and indicator lights all working', ar: 'الأضواء الأمامية والخلفية وأضواء الفرامل والإشارة تعمل جميعها', ur: 'ہیڈ، ٹیل، بریک اور انڈیکیٹر لائٹس سب کام کر رہی', hi: 'हेड, टेल, ब्रेक और इंडिकेटर लाइट सभी कार्यरत' } },
      { id: 'ele-05', text: { en: 'Work lights and beacon/strobe working', ar: 'أضواء العمل والمنارة/الوماض تعمل', ur: 'ورک لائٹس اور بیکن/اسٹروب کام کر رہے', hi: 'वर्क लाइट और बीकन/स्ट्रोब कार्यरत' } },
      { id: 'ele-06', text: { en: 'Horn and reversing alarm audible above site noise', ar: 'البوق وإنذار الرجوع مسموعان فوق ضوضاء الموقع', ur: 'ہارن اور ریورسنگ الارم سائٹ کے شور سے اوپر سنائی دیتے ہیں', hi: 'हॉर्न और रिवर्सिंग अलार्म साइट के शोर से ऊपर सुनाई देते हैं' } },
      { id: 'ele-07', text: { en: 'Fuses and circuit breakers correct rating — no improvised repairs', ar: 'المصاهر وقواطع الدائرة بالقيمة الصحيحة — لا إصلاحات مرتجلة', ur: 'فیوز اور سرکٹ بریکر درست ریٹنگ کے — عارضی مرمت نہیں', hi: 'फ़्यूज़ और सर्किट ब्रेकर सही रेटिंग के — अस्थायी मरम्मत नहीं' } }
    ]
  },

  // ===================== 8. Brakes, steering & travel =====================
  {
    id: 'brakes', icon: 'brake', appliesTo: 'all',
    title: { en: 'Brakes, steering & travel', ar: 'الفرامل والتوجيه والحركة', ur: 'بریک، اسٹیئرنگ اور حرکت', hi: 'ब्रेक, स्टीयरिंग और चलन' },
    items: [
      { id: 'brk-01', text: { en: 'Service brake stops the machine evenly, no pulling to one side', ar: 'فرملة الخدمة توقف المعدة بانتظام دون انحراف لجانب', ur: 'سروس بریک مشین کو یکساں روکتی ہے، ایک طرف نہیں کھینچتی', hi: 'सर्विस ब्रेक मशीन को समान रूप से रोकता है, एक ओर नहीं खींचता' } },
      { id: 'brk-02', text: { en: 'Parking brake holds the machine on a slope', ar: 'فرملة الانتظار تُثبّت المعدة على منحدر', ur: 'پارکنگ بریک ڈھلوان پر مشین کو روکے رکھتی ہے', hi: 'पार्किंग ब्रेक ढलान पर मशीन को रोके रखता है' } },
      { id: 'brk-03', text: { en: 'Emergency/secondary brake functions', ar: 'الفرملة الطارئة/الثانوية تعمل', ur: 'ایمرجنسی/ثانوی بریک کام کرتی ہے', hi: 'आपातकालीन/द्वितीयक ब्रेक कार्यरत' } },
      { id: 'brk-04', text: { en: 'Air/hydraulic brake system holds pressure, no audible leaks', ar: 'نظام الفرامل الهوائي/الهيدروليكي يحافظ على الضغط دون تسريبات مسموعة', ur: 'ایئر/ہائیڈرولک بریک سسٹم پریشر برقرار رکھتا ہے، رساؤ کی آواز نہیں', hi: 'एयर/हाइड्रोलिक ब्रेक सिस्टम दबाव बनाए रखता है, रिसाव की आवाज़ नहीं' } },
      { id: 'brk-05', text: { en: 'Steering responds without excessive free play or wander', ar: 'التوجيه يستجيب دون خلوص زائد أو انحراف', ur: 'اسٹیئرنگ بغیر زیادہ ڈھیلے پن یا بھٹکاؤ کے جواب دیتی ہے', hi: 'स्टीयरिंग अत्यधिक ढीलापन या भटकाव के बिना प्रतिक्रिया देती है' } },
      { id: 'brk-06', text: { en: 'Travel alarm and travel interlocks function', ar: 'إنذار الحركة وأقفال الحركة تعمل', ur: 'ٹریول الارم اور ٹریول انٹرلاک کام کرتے ہیں', hi: 'ट्रैवल अलार्म और ट्रैवल इंटरलॉक कार्यरत' } }
    ]
  },

  // ===================== 9. Tyres & wheels =====================
  {
    id: 'tyres', icon: 'tyre', appliesTo: ['wheeled'],
    title: { en: 'Tyres & wheels', ar: 'الإطارات والعجلات', ur: 'ٹائر اور پہیے', hi: 'टायर और पहिये' },
    items: [
      { id: 'tyr-01', text: { en: 'Tread depth within limits; no cord showing', ar: 'عمق المداس ضمن الحدود؛ لا ظهور للأسلاك', ur: 'ٹائر کی گہرائی حد کے اندر؛ تاریں نظر نہیں آ رہیں', hi: 'ट्रेड गहराई सीमा के भीतर; कॉर्ड दिखाई नहीं दे रही' } },
      { id: 'tyr-02', text: { en: 'No cuts, bulges, sidewall damage or embedded objects', ar: 'لا توجد قطوع أو انتفاخات أو تلف في الجدار الجانبي أو أجسام مغروزة', ur: 'کٹاؤ، ابھار، سائیڈ وال نقصان یا پھنسی اشیاء نہیں', hi: 'कट, उभार, साइडवॉल क्षति या फँसी वस्तुएँ नहीं' } },
      { id: 'tyr-03', text: { en: 'Inflation pressures correct and even across axles', ar: 'ضغوط النفخ صحيحة ومتساوية عبر المحاور', ur: 'ہوا کا دباؤ درست اور تمام ایکسل پر یکساں', hi: 'हवा का दबाव सही और सभी एक्सल पर समान' } },
      { id: 'tyr-04', text: { en: 'All wheel nuts present and torqued; no movement marks', ar: 'جميع صواميل العجلات موجودة ومربوطة بالعزم؛ لا علامات حركة', ur: 'تمام وہیل نٹ موجود اور درست ٹارک پر؛ حرکت کے نشان نہیں', hi: 'सभी व्हील नट मौजूद और सही टॉर्क पर; हिलने के निशान नहीं' } },
      { id: 'tyr-05', text: { en: 'Rims free of cracks, buckling or weld repairs', ar: 'الجنوط خالية من الشقوق أو الالتواء أو إصلاحات اللحام', ur: 'رمز میں دراڑ، خم یا ویلڈ مرمت نہیں', hi: 'रिम में दरार, मुड़ाव या वेल्ड मरम्मत नहीं' } },
      { id: 'tyr-06', text: { en: 'Spare wheel and wheel-changing equipment serviceable (road machines)', ar: 'العجلة الاحتياطية ومعدات تغيير العجلات صالحة (للمعدات الطرقية)', ur: 'اسپیئر وہیل اور وہیل بدلنے کا سامان درست (روڈ مشینیں)', hi: 'स्पेयर व्हील और पहिया बदलने का सामान ठीक (रोड मशीनें)' } }
    ]
  },

  // ===================== 10. Undercarriage & tracks =====================
  {
    id: 'undercarriage', icon: 'track', appliesTo: ['tracked'],
    title: { en: 'Undercarriage & tracks', ar: 'الهيكل السفلي والجنزير', ur: 'انڈر کیریج اور ٹریک', hi: 'अंडरकैरिज और ट्रैक' },
    items: [
      { id: 'und-01', text: { en: 'Track tension correct per the manufacturer\'s figure', ar: 'شد الجنزير صحيح وفق قيمة الصانع', ur: 'ٹریک ٹینشن بنانے والے کی مقررہ حد کے مطابق', hi: 'ट्रैक तनाव निर्माता के मान के अनुसार' } },
      { id: 'und-02', text: { en: 'Track shoes, links and pins not cracked, loose or excessively worn', ar: 'نعال الجنزير والوصلات والمسامير غير متشققة أو مرتخية أو مهترئة بشدة', ur: 'ٹریک شو، لنک اور پن میں دراڑ، ڈھیلا پن یا زیادہ گھساؤ نہیں', hi: 'ट्रैक शू, लिंक और पिन में दरार, ढीलापन या अत्यधिक घिसाव नहीं' } },
      { id: 'und-03', text: { en: 'Idlers, rollers and sprockets turning freely, no leaks from seals', ar: 'البكرات والدلافين والتروس تدور بحرية دون تسرب من الموانع', ur: 'آئیڈلر، رولر اور اسپراکٹ آزادی سے گھوم رہے، سیل سے رساؤ نہیں', hi: 'आइडलर, रोलर और स्प्रॉकेट स्वतंत्र रूप से घूम रहे, सील से रिसाव नहीं' } },
      { id: 'und-04', text: { en: 'Final drives free of leaks; oil level correct', ar: 'التروس النهائية خالية من التسريبات؛ مستوى الزيت صحيح', ur: 'فائنل ڈرائیو میں رساؤ نہیں؛ آئل کی سطح درست', hi: 'फ़ाइनल ड्राइव में रिसाव नहीं; तेल स्तर सही' } },
      { id: 'und-05', text: { en: 'Track guards and frame free of packed material and damage', ar: 'واقيات الجنزير والإطار خالية من المواد المتراكمة والتلف', ur: 'ٹریک گارڈ اور فریم میں جمی مٹی اور نقصان نہیں', hi: 'ट्रैक गार्ड और फ्रेम में जमी सामग्री और क्षति नहीं' } }
    ]
  },

  // ===================== 11. Boom, jib & lattice =====================
  {
    id: 'boom', icon: 'boom', appliesTo: ['crane'],
    title: { en: 'Boom, jib & lattice sections', ar: 'الذراع والذراع الفرعي وأقسام الشبكية', ur: 'بوم، جِب اور لیٹس سیکشن', hi: 'बूम, जिब और लैटिस सेक्शन' },
    items: [
      { id: 'bom-01', text: { en: 'Boom sections straight, no dents, cracks, buckling or corrosion', ar: 'أقسام الذراع مستقيمة، بلا انبعاجات أو شقوق أو التواء أو تآكل', ur: 'بوم سیکشن سیدھے، کوئی ڈینٹ، دراڑ، خم یا زنگ نہیں', hi: 'बूम सेक्शन सीधे, कोई डेंट, दरार, मुड़ाव या जंग नहीं' } },
      { id: 'bom-02', text: { en: 'Lattice chords, lacings and welds sound; no distorted or repaired members', ar: 'أوتار الشبكية والتقاطعات واللحامات سليمة؛ لا أعضاء مشوهة أو مُصلحة', ur: 'لیٹس کورڈ، لیسنگ اور ویلڈ درست؛ کوئی مڑا یا مرمت شدہ حصہ نہیں', hi: 'लैटिस कॉर्ड, लेसिंग और वेल्ड सही; कोई विकृत या मरम्मत किया भाग नहीं' } },
      { id: 'bom-03', text: { en: 'Boom section connecting pins correct type, fully home and secured', ar: 'مسامير ربط أقسام الذراع من النوع الصحيح ومركّبة بالكامل ومؤمّنة', ur: 'بوم سیکشن جوڑنے والے پن درست قسم کے، مکمل بیٹھے اور محفوظ', hi: 'बूम सेक्शन जोड़ने वाले पिन सही प्रकार के, पूरी तरह बैठे और सुरक्षित' } },
      { id: 'bom-04', text: { en: 'Telescoping sections extend and retract smoothly; wear pads in good order', ar: 'الأقسام التلسكوبية تمتد وتنكمش بسلاسة؛ وسائد التآكل بحالة جيدة', ur: 'ٹیلی اسکوپنگ سیکشن ہموار کھلتے بند ہوتے؛ ویئر پیڈ اچھی حالت میں', hi: 'टेलीस्कोपिंग सेक्शन सुचारू रूप से खुलते-बंद होते; वियर पैड अच्छी स्थिति में' } },
      { id: 'bom-05', text: { en: 'Jib correctly stowed or erected, pinned and secured', ar: 'الذراع الفرعي مخزّن أو منصوب بشكل صحيح ومثبت بالمسامير ومؤمّن', ur: 'جِب درست طور پر اسٹو یا نصب، پن شدہ اور محفوظ', hi: 'जिब सही तरीके से स्टो या स्थापित, पिन और सुरक्षित' } },
      { id: 'bom-06', text: { en: 'Boom head and sheaves turn freely, grooves not worn, guards fitted', ar: 'رأس الذراع والبكرات تدور بحرية، الأخاديد غير مهترئة، الواقيات مركبة', ur: 'بوم ہیڈ اور شیو آزادی سے گھومتے، نالیاں گھسی نہیں، گارڈ نصب', hi: 'बूम हेड और शीव स्वतंत्र रूप से घूमते, खाँचे घिसे नहीं, गार्ड लगे' } },
      { id: 'bom-07', text: { en: 'Pendant ropes / backstays and their terminations undamaged', ar: 'حبال التعليق/الدعامات الخلفية ونهاياتها غير تالفة', ur: 'پینڈنٹ رسے / بیک اسٹے اور ان کے سرے بغیر نقصان', hi: 'पेंडेंट रोप / बैकस्टे और उनके सिरे क्षतिरहित' } }
    ]
  },

  // ===================== 12. Wire rope, hook & reeving =====================
  {
    id: 'rope', icon: 'rope', appliesTo: ['crane'],
    title: { en: 'Wire rope, hook & reeving', ar: 'الحبل السلكي والخطاف والتسليك', ur: 'وائر روپ، ہک اور ریوِنگ', hi: 'वायर रोप, हुक और रीविंग' },
    items: [
      { id: 'rop-01', text: { en: 'Rope free of broken wires beyond the discard criteria', ar: 'الحبل خالٍ من الأسلاك المكسورة بما يتجاوز حدود الاستبعاد', ur: 'رسے میں ٹوٹی تاریں مسترد کرنے کی حد سے کم', hi: 'रस्सी में टूटे तार त्याग मानदंड से कम' } },
      { id: 'rop-02', text: { en: 'No kinks, birdcaging, crushing, corrosion or heat damage', ar: 'لا التواءات أو انتفاخ قفصي أو سحق أو تآكل أو تلف حراري', ur: 'کنک، برڈ کیجنگ، کچلاؤ، زنگ یا حرارتی نقصان نہیں', hi: 'किंक, बर्डकेजिंग, कुचलाव, जंग या ताप-क्षति नहीं' } },
      { id: 'rop-03', text: { en: 'Rope correctly spooled on the drum, no cross-winding or slack wraps', ar: 'الحبل ملفوف بشكل صحيح على الأسطوانة، دون تداخل أو لفات مرتخية', ur: 'رسہ ڈرم پر درست لپٹا، کراس وائنڈنگ یا ڈھیلے لپیٹ نہیں', hi: 'रस्सी ड्रम पर सही लिपटी, क्रॉस-वाइंडिंग या ढीले लपेट नहीं' } },
      { id: 'rop-04', text: { en: 'Minimum dead wraps remain on the drum at full pay-out', ar: 'الحد الأدنى من اللفات الميتة باقٍ على الأسطوانة عند أقصى إنزال', ur: 'مکمل نکالنے پر ڈرم پر کم از کم ڈیڈ ریپ باقی', hi: 'पूरी तरह खोलने पर ड्रम पर न्यूनतम डेड रैप शेष' } },
      { id: 'rop-05', text: { en: 'Rope end terminations, wedge sockets and clamps correct and secure', ar: 'نهايات الحبل وأعشاش الإسفين والمشابك صحيحة ومؤمّنة', ur: 'رسے کے سرے، ویج ساکٹ اور کلیمپ درست اور محفوظ', hi: 'रस्सी के सिरे, वेज सॉकेट और क्लैंप सही और सुरक्षित' } },
      { id: 'rop-06', text: { en: 'Hook free of cracks, deformation, wear or twist; throat opening within limit', ar: 'الخطاف خالٍ من الشقوق أو التشوه أو التآكل أو الالتواء؛ فتحة الحلق ضمن الحد', ur: 'ہک میں دراڑ، بگاڑ، گھساؤ یا مروڑ نہیں؛ تھروٹ اوپننگ حد کے اندر', hi: 'हुक में दरार, विरूपण, घिसाव या मरोड़ नहीं; थ्रोट ओपनिंग सीमा के भीतर' } },
      { id: 'rop-07', text: { en: 'Hook safety latch present and springs closed', ar: 'مزلاج أمان الخطاف موجود ويغلق بالزنبرك', ur: 'ہک سیفٹی لیچ موجود اور اسپرنگ سے بند ہوتا ہے', hi: 'हुक सेफ़्टी लैच मौजूद और स्प्रिंग से बंद होता है' } },
      { id: 'rop-08', text: { en: 'Hook block sheaves turn freely; block swivel and bearing in order', ar: 'بكرات كتلة الخطاف تدور بحرية؛ محور الدوران والمحمل سليمان', ur: 'ہک بلاک شیو آزادی سے گھومتے؛ بلاک سویول اور بیئرنگ درست', hi: 'हुक ब्लॉक शीव स्वतंत्र रूप से घूमते; ब्लॉक स्विवेल और बेयरिंग ठीक' } },
      { id: 'rop-09', text: { en: 'Rope lubrication adequate and to the manufacturer\'s specification', ar: 'تشحيم الحبل كافٍ ووفق مواصفات الصانع', ur: 'رسے کی چکنائی مناسب اور بنانے والے کی ہدایت کے مطابق', hi: 'रस्सी का स्नेहन पर्याप्त और निर्माता के निर्देशानुसार' } }
    ]
  },

  // ===================== 13. Slew, winch & limit devices =====================
  {
    id: 'slew', icon: 'slew', appliesTo: ['crane'],
    title: { en: 'Slew, winch & limit devices', ar: 'الدوران والونش وأجهزة التحديد', ur: 'سلیو، ونچ اور لمٹ ڈیوائسز', hi: 'स्लू, विंच और लिमिट डिवाइस' },
    items: [
      { id: 'slw-01', text: { en: 'Slew ring bolts present and torqued; no play in the turntable', ar: 'براغي حلقة الدوران موجودة ومربوطة بالعزم؛ لا خلوص في المنصة الدوارة', ur: 'سلیو رنگ بولٹ موجود اور ٹارک شدہ؛ ٹرن ٹیبل میں ڈھیلا پن نہیں', hi: 'स्लू रिंग बोल्ट मौजूद और टॉर्क किए; टर्नटेबल में ढीलापन नहीं' } },
      { id: 'slw-02', text: { en: 'Slew brake and slew lock hold positively', ar: 'فرملة الدوران وقفل الدوران يثبتان بفعالية', ur: 'سلیو بریک اور سلیو لاک مضبوطی سے تھامتے ہیں', hi: 'स्लू ब्रेक और स्लू लॉक मज़बूती से पकड़ते हैं' } },
      { id: 'slw-03', text: { en: 'Hoist and luffing winch brakes hold the rated load without creep', ar: 'فرامل ونش الرفع والميلان تحمل الحمل المقنن دون انزلاق', ur: 'ہوسٹ اور لفنگ ونچ بریک مقررہ بوجھ بغیر کھسکے تھامتی ہیں', hi: 'होइस्ट और लफ़िंग विंच ब्रेक रेटेड लोड बिना खिसके थामते हैं' } },
      { id: 'slw-04', text: { en: 'Anti-two-block device and its weight/switch fitted and functional', ar: 'جهاز منع الاصطدام المزدوج ووزنه/مفتاحه مركبان ويعملان', ur: 'اینٹی ٹو بلاک ڈیوائس اور اس کا وزن/سوئچ نصب اور فعال', hi: 'एंटी-टू-ब्लॉक डिवाइस और उसका वज़न/स्विच लगा और कार्यरत' } },
      { id: 'slw-05', text: { en: 'Hoist upper and lower limit switches stop the motion correctly', ar: 'مفاتيح الحد العلوي والسفلي للرفع توقف الحركة بشكل صحيح', ur: 'ہوسٹ کے اوپری اور نچلے لمٹ سوئچ حرکت درست روکتے ہیں', hi: 'होइस्ट के ऊपरी और निचले लिमिट स्विच गति सही रोकते हैं' } },
      { id: 'slw-06', text: { en: 'Boom hoist upper/lower limits and boom stops in place', ar: 'حدود رفع الذراع العليا/السفلى ومصدات الذراع موجودة', ur: 'بوم ہوسٹ کے اوپری/نچلے لمٹ اور بوم اسٹاپ موجود', hi: 'बूम होइस्ट ऊपरी/निचली सीमाएँ और बूम स्टॉप मौजूद' } },
      { id: 'slw-07', text: { en: 'Counterweight correct for the configuration, secured and marked', ar: 'الثقل الموازن مطابق للتهيئة ومؤمّن ومُعلَّم', ur: 'کاؤنٹر ویٹ کنفیگریشن کے مطابق، محفوظ اور نشان زد', hi: 'काउंटरवेट कॉन्फ़िगरेशन के अनुरूप, सुरक्षित और चिह्नित' } },
      { id: 'slw-08', text: { en: 'Wind speed indicator (anemometer) fitted and reading correctly', ar: 'مقياس سرعة الرياح مركب ويعطي قراءة صحيحة', ur: 'ونڈ اسپیڈ انڈیکیٹر (اینیمومیٹر) نصب اور درست ریڈنگ', hi: 'पवन गति संकेतक (एनीमोमीटर) लगा और सही रीडिंग' } }
    ]
  },

  // ===================== 14. Outriggers & stabilisers =====================
  {
    id: 'outriggers', icon: 'outrigger', appliesTo: ['outriggers'],
    title: { en: 'Outriggers & stabilisers', ar: 'الدعامات والمثبتات', ur: 'آؤٹ ریگر اور اسٹیبلائزر', hi: 'आउटरिगर और स्टेबलाइज़र' },
    items: [
      { id: 'out-01', text: { en: 'Beams and jacks extend and retract fully and evenly', ar: 'العوارض والرافعات تمتد وتنكمش بالكامل وبانتظام', ur: 'بیم اور جیک مکمل اور یکساں طور پر کھلتے بند ہوتے ہیں', hi: 'बीम और जैक पूरी तरह और समान रूप से खुलते-बंद होते हैं' } },
      { id: 'out-02', text: { en: 'No drift or settlement when set and loaded', ar: 'لا انزلاق أو هبوط عند التثبيت والتحميل', ur: 'سیٹ اور لوڈ ہونے پر کھسکاؤ یا بیٹھنے کا مسئلہ نہیں', hi: 'सेट और लोड होने पर खिसकाव या धँसाव नहीं' } },
      { id: 'out-03', text: { en: 'Outrigger pads/floats present, correct size and undamaged', ar: 'قواعد/أقدام الدعامات موجودة وبالمقاس الصحيح وغير تالفة', ur: 'آؤٹ ریگر پیڈ/فلوٹ موجود، درست سائز اور بغیر نقصان', hi: 'आउटरिगर पैड/फ्लोट मौजूद, सही आकार और क्षतिरहित' } },
      { id: 'out-04', text: { en: 'Outrigger position sensing / interlock with the LMI works', ar: 'استشعار وضع الدعامات/التعشيق مع مؤشر عزم الحمل يعمل', ur: 'آؤٹ ریگر پوزیشن سینسنگ / LMI کے ساتھ انٹرلاک کام کرتا ہے', hi: 'आउटरिगर पोज़िशन सेंसिंग / LMI के साथ इंटरलॉक कार्यरत' } },
      { id: 'out-05', text: { en: 'Level indicator / bubble accurate and visible from the controls', ar: 'مؤشر الاستواء/الفقاعة دقيق ومرئي من موضع التحكم', ur: 'لیول انڈیکیٹر / ببل درست اور کنٹرول سے نظر آتا ہے', hi: 'लेवल इंडिकेटर / बबल सटीक और नियंत्रण से दिखाई देता है' } },
      { id: 'out-06', text: { en: 'Outrigger locking pins and travel locks in place', ar: 'مسامير قفل الدعامات وأقفال السفر موجودة', ur: 'آؤٹ ریگر لاکنگ پن اور ٹریول لاک موجود', hi: 'आउटरिगर लॉकिंग पिन और ट्रैवल लॉक लगे' } }
    ]
  },

  // ===================== 15. Tower crane specific =====================
  {
    id: 'tower', icon: 'tower', appliesTo: ['tower'],
    title: { en: 'Tower crane — mast, ties & trolley', ar: 'الرافعة البرجية — الصاري والروابط والعربة', ur: 'ٹاور کرین — ماسٹ، ٹائیز اور ٹرالی', hi: 'टावर क्रेन — मास्ट, टाई और ट्रॉली' },
    items: [
      { id: 'twr-01', text: { en: 'Mast sections, bolts and pins secure; torque check records available', ar: 'أقسام الصاري والبراغي والمسامير مؤمّنة؛ سجلات فحص العزم متوفرة', ur: 'ماسٹ سیکشن، بولٹ اور پن محفوظ؛ ٹارک چیک ریکارڈ دستیاب', hi: 'मास्ट सेक्शन, बोल्ट और पिन सुरक्षित; टॉर्क जाँच रिकॉर्ड उपलब्ध' } },
      { id: 'twr-02', text: { en: 'Foundation/base ballast and anchor bolts sound, no movement or cracking', ar: 'الأساس/الصابورة ومسامير التثبيت سليمة، بلا حركة أو تشقق', ur: 'بنیاد/بیس بیلسٹ اور اینکر بولٹ درست، حرکت یا دراڑ نہیں', hi: 'नींव/बेस बैलास्ट और एंकर बोल्ट सही, हलचल या दरार नहीं' } },
      { id: 'twr-03', text: { en: 'Tie-ins/collars to the structure correctly installed and inspected', ar: 'الروابط/الأطواق مع المنشأ مركبة بشكل صحيح ومفحوصة', ur: 'عمارت سے ٹائی اِن/کالر درست نصب اور معائنہ شدہ', hi: 'संरचना से टाई-इन/कॉलर सही स्थापित और निरीक्षित' } },
      { id: 'twr-04', text: { en: 'Trolley, trolley rope and end stops in good order', ar: 'العربة وحبل العربة والمصدات الطرفية بحالة جيدة', ur: 'ٹرالی، ٹرالی رسہ اور اینڈ اسٹاپ اچھی حالت میں', hi: 'ट्रॉली, ट्रॉली रस्सी और एंड स्टॉप अच्छी स्थिति में' } },
      { id: 'twr-05', text: { en: 'Slewing free / weathervaning works when out of service', ar: 'الدوران الحر/دوران الريح يعمل عند التوقف عن الخدمة', ur: 'سروس سے باہر ہونے پر فری سلیونگ / ویدر وینِنگ کام کرتی ہے', hi: 'सेवा से बाहर होने पर फ्री स्लूइंग / वेदरवेनिंग कार्यरत' } },
      { id: 'twr-06', text: { en: 'Aviation warning lights and obstruction marking working', ar: 'أضواء التحذير الجوي وعلامات العوائق تعمل', ur: 'ایوی ایشن وارننگ لائٹس اور رکاوٹ کی نشاندہی کام کر رہی', hi: 'विमानन चेतावनी लाइट और अवरोध चिह्न कार्यरत' } },
      { id: 'twr-07', text: { en: 'Climbing cage and access ladders with fall-arrest secured', ar: 'قفص التسلق وسلالم الوصول مع نظام منع السقوط مؤمّنة', ur: 'کلائمبنگ کیج اور رسائی سیڑھیاں فال اریسٹ کے ساتھ محفوظ', hi: 'क्लाइम्बिंग केज और पहुँच सीढ़ियाँ फॉल-अरेस्ट सहित सुरक्षित' } }
    ]
  },

  // ===================== 16. Attachments & GET =====================
  {
    id: 'attachments', icon: 'bucket', appliesTo: ['attachments'],
    title: { en: 'Attachments & ground engaging tools', ar: 'الملحقات وأدوات التلامس مع الأرض', ur: 'اٹیچمنٹ اور گراؤنڈ اینگیجنگ ٹولز', hi: 'अटैचमेंट और ग्राउंड एंगेजिंग टूल' },
    items: [
      { id: 'att-01', text: { en: 'Bucket/attachment free of cracks; cutting edge and teeth secure', ar: 'الدلو/الملحق خالٍ من الشقوق؛ حافة القطع والأسنان مؤمّنة', ur: 'بکٹ/اٹیچمنٹ میں دراڑ نہیں؛ کٹنگ ایج اور دانت محفوظ', hi: 'बकेट/अटैचमेंट में दरार नहीं; कटिंग एज और दाँत सुरक्षित' } },
      { id: 'att-02', text: { en: 'Teeth, adapters and side cutters present and not worn past limit', ar: 'الأسنان والمحولات والقواطع الجانبية موجودة وغير مهترئة فوق الحد', ur: 'دانت، اڈاپٹر اور سائیڈ کٹر موجود اور حد سے زیادہ گھسے نہیں', hi: 'दाँत, एडाप्टर और साइड कटर मौजूद और सीमा से अधिक घिसे नहीं' } },
      { id: 'att-03', text: { en: 'Quick coupler locks fully engaged, secondary lock/safety pin fitted', ar: 'قفل الوصلة السريعة مُعشَّق بالكامل، والقفل الثانوي/مسمار الأمان مركب', ur: 'کوئیک کپلر لاک مکمل بند، ثانوی لاک/سیفٹی پن نصب', hi: 'क्विक कपलर लॉक पूरी तरह लगा, द्वितीयक लॉक/सेफ़्टी पिन लगा' } },
      { id: 'att-04', text: { en: 'Quick coupler check function carried out and the attachment cannot release', ar: 'تم إجراء اختبار الوصلة السريعة ولا يمكن انفصال الملحق', ur: 'کوئیک کپلر چیک کیا گیا اور اٹیچمنٹ الگ نہیں ہو سکتا', hi: 'क्विक कपलर जाँच की गई और अटैचमेंट अलग नहीं हो सकता' } },
      { id: 'att-05', text: { en: 'Lifting eye/point on the attachment certified, marked with SWL and undamaged', ar: 'عين/نقطة الرفع على الملحق معتمدة ومُعلَّمة بحمل التشغيل الآمن وغير تالفة', ur: 'اٹیچمنٹ پر لفٹنگ آئی/پوائنٹ تصدیق شدہ، SWL درج اور بغیر نقصان', hi: 'अटैचमेंट पर लिफ्टिंग आई/पॉइंट प्रमाणित, SWL अंकित और क्षतिरहित' } },
      { id: 'att-06', text: { en: 'Hydraulic breaker/auger/other attachment lines and couplings leak-free', ar: 'خطوط ووصلات الكسارة الهيدروليكية/المثقاب/الملحقات الأخرى بلا تسريب', ur: 'ہائیڈرولک بریکر/آگر/دیگر اٹیچمنٹ لائنیں اور کپلنگ بغیر رساؤ', hi: 'हाइड्रोलिक ब्रेकर/ऑगर/अन्य अटैचमेंट लाइनें और कपलिंग रिसाव-रहित' } }
    ]
  },

  // ===================== 17. Blade, ripper & moldboard =====================
  {
    id: 'blade', icon: 'blade', appliesTo: ['dozer'],
    title: { en: 'Blade, moldboard & ripper', ar: 'الشفرة واللوح والمحراث', ur: 'بلیڈ، مولڈ بورڈ اور رپر', hi: 'ब्लेड, मोल्डबोर्ड और रिपर' },
    items: [
      { id: 'bld-01', text: { en: 'Blade/moldboard free of cracks; cutting edges and end bits secure', ar: 'الشفرة/اللوح خالية من الشقوق؛ حواف القطع والأطراف مؤمّنة', ur: 'بلیڈ/مولڈ بورڈ میں دراڑ نہیں؛ کٹنگ ایج اور اینڈ بٹ محفوظ', hi: 'ब्लेड/मोल्डबोर्ड में दरार नहीं; कटिंग एज और एंड बिट सुरक्षित' } },
      { id: 'bld-02', text: { en: 'Push arms, tilt cylinders and trunnions free of wear and play', ar: 'أذرع الدفع وأسطوانات الإمالة والمحاور خالية من التآكل والخلوص', ur: 'پُش آرم، ٹِلٹ سلنڈر اور ٹرنین میں گھساؤ اور ڈھیلا پن نہیں', hi: 'पुश आर्म, टिल्ट सिलेंडर और ट्रूनियन में घिसाव और ढीलापन नहीं' } },
      { id: 'bld-03', text: { en: 'Circle, circle drive and slide rails (grader) in good order', ar: 'الدائرة ومحرك الدائرة وقضبان الانزلاق (الجريدر) بحالة جيدة', ur: 'سرکل، سرکل ڈرائیو اور سلائیڈ ریل (گریڈر) اچھی حالت میں', hi: 'सर्कल, सर्कल ड्राइव और स्लाइड रेल (ग्रेडर) अच्छी स्थिति में' } },
      { id: 'bld-04', text: { en: 'Ripper shanks, tips and pins present, secure and not excessively worn', ar: 'أسنان المحراث والأطراف والمسامير موجودة ومؤمّنة وغير مهترئة بشدة', ur: 'رپر شینک، ٹپ اور پن موجود، محفوظ اور زیادہ گھسے نہیں', hi: 'रिपर शैंक, टिप और पिन मौजूद, सुरक्षित और अत्यधिक घिसे नहीं' } }
    ]
  },

  // ===================== 18. Forks & mast =====================
  {
    id: 'forks', icon: 'forks', appliesTo: ['forks'],
    title: { en: 'Forks, mast & carriage', ar: 'الشوكات والصاري والحامل', ur: 'فورکس، ماسٹ اور کیرج', hi: 'फोर्क, मास्ट और कैरिज' },
    items: [
      { id: 'frk-01', text: { en: 'Forks free of cracks, bends or heel wear beyond 10%', ar: 'الشوكات خالية من الشقوق أو الانحناء أو تآكل الكعب بأكثر من 10%', ur: 'فورکس میں دراڑ، خم یا 10% سے زیادہ ہیل گھساؤ نہیں', hi: 'फोर्क में दरार, मुड़ाव या 10% से अधिक हील घिसाव नहीं' } },
      { id: 'frk-02', text: { en: 'Fork tips level with each other; locking pins engaged', ar: 'أطراف الشوكات مستوية مع بعضها؛ مسامير القفل مُعشَّقة', ur: 'فورک کے سرے ایک سطح پر؛ لاکنگ پن لگے ہوئے', hi: 'फोर्क टिप एक समान स्तर पर; लॉकिंग पिन लगे' } },
      { id: 'frk-03', text: { en: 'Mast channels, chains and rollers lubricated and free of damage', ar: 'قنوات الصاري والسلاسل والبكرات مشحمة وخالية من التلف', ur: 'ماسٹ چینل، چین اور رولر چکنائی شدہ اور بغیر نقصان', hi: 'मास्ट चैनल, चेन और रोलर स्नेहित और क्षतिरहित' } },
      { id: 'frk-04', text: { en: 'Lift chains equally tensioned, no stretched, seized or cracked links', ar: 'سلاسل الرفع مشدودة بالتساوي، بلا وصلات ممطوطة أو عالقة أو متشققة', ur: 'لفٹ چینز یکساں کسی ہوئی، کھنچی، جام یا ٹوٹی کڑیاں نہیں', hi: 'लिफ्ट चेन समान तनाव में, खिंची, जाम या टूटी कड़ियाँ नहीं' } },
      { id: 'frk-05', text: { en: 'Load backrest extension fitted and secure', ar: 'امتداد مسند الحمل مركب ومؤمّن', ur: 'لوڈ بیک ریسٹ ایکسٹینشن نصب اور محفوظ', hi: 'लोड बैकरेस्ट एक्सटेंशन लगा और सुरक्षित' } }
    ]
  },

  // ===================== 19. MEWP specific =====================
  {
    id: 'mewp', icon: 'platform', appliesTo: ['mewp'],
    title: { en: 'Work platform & fall protection', ar: 'منصة العمل والحماية من السقوط', ur: 'ورک پلیٹ فارم اور فال پروٹیکشن', hi: 'वर्क प्लेटफ़ॉर्म और फ़ॉल प्रोटेक्शन' },
    items: [
      { id: 'mew-01', text: { en: 'Platform floor, guardrails, mid-rails and toe boards sound and complete', ar: 'أرضية المنصة والدرابزين والقضبان الوسطى وألواح القدم سليمة وكاملة', ur: 'پلیٹ فارم فرش، گارڈ ریل، مڈ ریل اور ٹو بورڈ درست اور مکمل', hi: 'प्लेटफ़ॉर्म फ़र्श, गार्डरेल, मिड-रेल और टो बोर्ड सही और पूर्ण' } },
      { id: 'mew-02', text: { en: 'Gate closes and latches automatically', ar: 'البوابة تُغلق وتُقفل تلقائياً', ur: 'گیٹ خودکار بند اور لاک ہوتا ہے', hi: 'गेट स्वतः बंद और लॉक होता है' } },
      { id: 'mew-03', text: { en: 'Harness anchor points certified, marked and undamaged', ar: 'نقاط ربط الحزام معتمدة ومُعلَّمة وغير تالفة', ur: 'ہارنیس اینکر پوائنٹ تصدیق شدہ، نشان زد اور بغیر نقصان', hi: 'हार्नेस एंकर पॉइंट प्रमाणित, चिह्नित और क्षतिरहित' } },
      { id: 'mew-04', text: { en: 'Ground controls override platform controls and are clearly marked', ar: 'أدوات التحكم الأرضية تتجاوز أدوات المنصة ومُعلَّمة بوضوح', ur: 'گراؤنڈ کنٹرول پلیٹ فارم کنٹرول کو اوور رائیڈ کرتے اور واضح نشان زد', hi: 'ग्राउंड नियंत्रण प्लेटफ़ॉर्म नियंत्रण को ओवरराइड करते और स्पष्ट चिह्नित' } },
      { id: 'mew-05', text: { en: 'Emergency lowering / auxiliary descent operates and is labelled', ar: 'نظام الإنزال الطارئ/المساعد يعمل ومُعلَّم', ur: 'ایمرجنسی لوورنگ / معاون نزول کام کرتا اور لیبل شدہ', hi: 'आपातकालीन अवतरण / सहायक डिसेंट कार्यरत और लेबल किया' } },
      { id: 'mew-06', text: { en: 'Tilt alarm, pothole protection and platform overload sensing function', ar: 'إنذار الميل وحماية الحفر واستشعار الحمل الزائد للمنصة تعمل', ur: 'ٹِلٹ الارم، پوٹ ہول پروٹیکشن اور پلیٹ فارم اوورلوڈ سینسنگ فعال', hi: 'टिल्ट अलार्म, पॉटहोल प्रोटेक्शन और प्लेटफ़ॉर्म ओवरलोड सेंसिंग कार्यरत' } }
    ]
  },

  // ===================== 20. Tipper body =====================
  {
    id: 'tipper', icon: 'truck', appliesTo: ['tipper'],
    title: { en: 'Tipper body & hoist', ar: 'صندوق القلاب ورافعته', ur: 'ٹپر باڈی اور ہوسٹ', hi: 'टिपर बॉडी और होइस्ट' },
    items: [
      { id: 'tip-01', text: { en: 'Body, tailgate and hinges sound; tailgate latches positively', ar: 'الصندوق والباب الخلفي والمفصلات سليمة؛ الباب يُقفل بإحكام', ur: 'باڈی، ٹیل گیٹ اور قبضے درست؛ ٹیل گیٹ مضبوطی سے بند', hi: 'बॉडी, टेलगेट और कब्ज़े सही; टेलगेट मज़बूती से लॉक' } },
      { id: 'tip-02', text: { en: 'Tipping ram, mountings and pivot pins secure and leak-free', ar: 'أسطوانة القلب والتثبيتات ومسامير المحور مؤمّنة وبلا تسريب', ur: 'ٹپنگ ریم، ماؤنٹنگ اور پیوٹ پن محفوظ اور بغیر رساؤ', hi: 'टिपिंग रैम, माउंटिंग और पिवट पिन सुरक्षित और रिसाव-रहित' } },
      { id: 'tip-03', text: { en: 'Body prop / safety stay available and in working order', ar: 'دعامة الصندوق/مسند الأمان متوفرة وصالحة للعمل', ur: 'باڈی پراپ / سیفٹی اسٹے دستیاب اور کارآمد', hi: 'बॉडी प्रॉप / सेफ़्टी स्टे उपलब्ध और कार्यशील' } },
      { id: 'tip-04', text: { en: 'Body-raised warning in the cab works', ar: 'تحذير رفع الصندوق في الكابينة يعمل', ur: 'کیبن میں باڈی اٹھی ہونے کا وارننگ کام کرتا ہے', hi: 'केबिन में बॉडी उठी होने की चेतावनी कार्यरत' } },
      { id: 'tip-05', text: { en: 'Load cover/sheeting system fitted and usable', ar: 'نظام تغطية الحمولة مركب وقابل للاستخدام', ur: 'لوڈ کور/شیٹنگ سسٹم نصب اور قابل استعمال', hi: 'लोड कवर/शीटिंग सिस्टम लगा और उपयोग योग्य' } }
    ]
  },

  // ===================== 21. Safety devices & emergency equipment =====================
  {
    id: 'safety', icon: 'shield', appliesTo: 'all',
    title: { en: 'Safety devices & emergency equipment', ar: 'أجهزة السلامة ومعدات الطوارئ', ur: 'حفاظتی آلات اور ایمرجنسی سامان', hi: 'सुरक्षा उपकरण और आपातकालीन सामग्री' },
    items: [
      { id: 'saf-01', text: { en: 'Emergency stop button(s) accessible and stop all motion', ar: 'أزرار التوقف الطارئ في متناول اليد وتوقف جميع الحركات', ur: 'ایمرجنسی اسٹاپ بٹن قابل رسائی اور تمام حرکت روکتے ہیں', hi: 'आपातकालीन स्टॉप बटन सुलभ और सभी गति रोकते हैं' } },
      { id: 'saf-02', text: { en: 'Fire extinguisher fitted, in date, charged, sealed and accessible', ar: 'طفاية الحريق مركبة وسارية ومشحونة ومختومة وسهلة الوصول', ur: 'آگ بجھانے کا آلہ نصب، کارآمد، بھرا، سیل شدہ اور قابل رسائی', hi: 'अग्निशामक लगा, वैध, चार्ज, सील और सुलभ' } },
      { id: 'saf-03', text: { en: 'First-aid kit present and complete', ar: 'حقيبة الإسعافات الأولية موجودة وكاملة', ur: 'فرسٹ ایڈ کٹ موجود اور مکمل', hi: 'प्राथमिक चिकित्सा किट मौजूद और पूर्ण' } },
      { id: 'saf-04', text: { en: 'Wheel chocks, warning triangle and high-visibility vest carried', ar: 'حواجز العجلات ومثلث التحذير وسترة عالية الوضوح متوفرة', ur: 'وہیل چاک، وارننگ ٹرائی اینگل اور ہائی ویزیبلٹی جیکٹ موجود', hi: 'व्हील चॉक, चेतावनी त्रिकोण और हाई-विज़िबिलिटी जैकेट उपलब्ध' } },
      { id: 'saf-05', text: { en: 'Proximity / anti-collision system fitted where required and working', ar: 'نظام القرب/منع التصادم مركب حيث يلزم ويعمل', ur: 'جہاں ضروری ہو پراکسیمیٹی / اینٹی کولیژن سسٹم نصب اور فعال', hi: 'जहाँ आवश्यक हो प्रॉक्सिमिटी / एंटी-कोलिज़न सिस्टम लगा और कार्यरत' } },
      { id: 'saf-06', text: { en: 'Isolation / lock-out tag-out points identified and usable', ar: 'نقاط العزل/القفل والوسم محددة وقابلة للاستخدام', ur: 'آئسولیشن / لاک آؤٹ ٹیگ آؤٹ پوائنٹ نشان زد اور قابل استعمال', hi: 'आइसोलेशन / लॉक-आउट टैग-आउट पॉइंट चिह्नित और उपयोग योग्य' } },
      { id: 'saf-07', text: { en: 'Rotating beacon, hazard marking and reflective tape intact', ar: 'المنارة الدوارة وعلامات الخطر والشريط العاكس سليمة', ur: 'روٹیٹنگ بیکن، ہیزرڈ مارکنگ اور ریفلیکٹو ٹیپ درست', hi: 'रोटेटिंग बीकन, हैज़र्ड मार्किंग और रिफ्लेक्टिव टेप सही' } }
    ]
  },

  // ===================== 22. Maintenance & servicing =====================
  {
    id: 'maintenance', icon: 'wrench', appliesTo: 'all', maintenance: true,
    title: { en: 'Maintenance & servicing', ar: 'الصيانة والخدمة', ur: 'دیکھ بھال اور سروسنگ', hi: 'रखरखाव और सर्विसिंग' },
    items: [
      { id: 'mnt-01', text: { en: 'Scheduled service carried out at the correct hour-meter interval', ar: 'الصيانة الدورية تمت عند الفاصل الصحيح لعداد الساعات', ur: 'شیڈول سروس درست آور میٹر وقفے پر کی گئی', hi: 'निर्धारित सर्विस सही आवर-मीटर अंतराल पर की गई' } },
      { id: 'mnt-02', text: { en: 'Engine oil and filter changed as scheduled', ar: 'تم تغيير زيت المحرك والفلتر حسب الجدول', ur: 'انجن آئل اور فلٹر شیڈول کے مطابق تبدیل', hi: 'इंजन ऑयल और फ़िल्टर निर्धारित अनुसार बदले' } },
      { id: 'mnt-03', text: { en: 'Hydraulic oil and filters changed / within service life', ar: 'تم تغيير الزيت الهيدروليكي والفلاتر / ضمن العمر الخدمي', ur: 'ہائیڈرولک آئل اور فلٹر تبدیل / سروس لائف کے اندر', hi: 'हाइड्रोलिक तेल और फ़िल्टर बदले / सर्विस लाइफ़ के भीतर' } },
      { id: 'mnt-04', text: { en: 'Fuel filter and water separator drained/replaced', ar: 'تم تصريف/استبدال فلتر الوقود وفاصل الماء', ur: 'فیول فلٹر اور واٹر سیپریٹر خالی/تبدیل', hi: 'ईंधन फ़िल्टर और वॉटर सेपरेटर खाली/बदला' } },
      { id: 'mnt-05', text: { en: 'All grease points lubricated to schedule', ar: 'جميع نقاط التشحيم مُشحمة حسب الجدول', ur: 'تمام گریس پوائنٹ شیڈول کے مطابق چکنے', hi: 'सभी ग्रीस पॉइंट निर्धारित अनुसार स्नेहित' } },
      { id: 'mnt-06', text: { en: 'Axle, transmission and final drive oil levels correct', ar: 'مستويات زيت المحاور وناقل الحركة والتروس النهائية صحيحة', ur: 'ایکسل، ٹرانسمیشن اور فائنل ڈرائیو آئل لیول درست', hi: 'एक्सल, ट्रांसमिशन और फ़ाइनल ड्राइव तेल स्तर सही' } },
      { id: 'mnt-07', text: { en: 'Coolant concentration and condition tested', ar: 'تم اختبار تركيز سائل التبريد وحالته', ur: 'کولنٹ کا ارتکاز اور حالت جانچی گئی', hi: 'कूलेंट सांद्रता और स्थिति जाँची गई' } },
      { id: 'mnt-08', text: { en: 'Air conditioning serviced and refrigerant handled by a competent person', ar: 'تمت صيانة التكييف والتعامل مع غاز التبريد بواسطة شخص مؤهل', ur: 'ایئر کنڈیشنگ سروس شدہ اور ریفریجرنٹ اہل شخص نے سنبھالا', hi: 'एयर कंडीशनिंग सर्विस्ड और रेफ्रिजरेंट सक्षम व्यक्ति द्वारा संभाला' } },
      { id: 'mnt-09', text: { en: 'Critical fasteners torque-checked to the manufacturer\'s figures', ar: 'تم فحص عزم المثبتات الحرجة وفق قيم الصانع', ur: 'اہم فاسٹنر بنانے والے کی مقررہ ٹارک پر جانچے گئے', hi: 'महत्वपूर्ण फ़ास्टनर निर्माता के मान पर टॉर्क-जाँचे गए' } },
      { id: 'mnt-10', text: { en: 'Oil sampling / condition monitoring done where specified', ar: 'تم أخذ عينات الزيت/مراقبة الحالة حيث هو محدد', ur: 'جہاں مقرر ہو آئل سیمپلنگ / کنڈیشن مانیٹرنگ کی گئی', hi: 'जहाँ निर्दिष्ट हो तेल नमूनाकरण / स्थिति निगरानी की गई' } },
      { id: 'mnt-11', text: { en: 'Spare/consumable parts used were genuine or approved equivalents', ar: 'قطع الغيار/المستهلكات المستخدمة أصلية أو معتمدة كمكافئ', ur: 'استعمال شدہ اسپیئر/کنزیومیبل اصلی یا منظور شدہ متبادل', hi: 'उपयोग किए गए स्पेयर/उपभोज्य असली या स्वीकृत समकक्ष' } },
      { id: 'mnt-12', text: { en: 'Next service due date/hours recorded and displayed on the machine', ar: 'موعد/ساعات الصيانة القادمة مسجلة ومعروضة على المعدة', ur: 'اگلی سروس کی تاریخ/گھنٹے درج اور مشین پر آویزاں', hi: 'अगली सर्विस तिथि/घंटे दर्ज और मशीन पर प्रदर्शित' } }
    ]
  },

  // ===================== 23. Environment & housekeeping =====================
  {
    id: 'environment', icon: 'leaf', appliesTo: 'all',
    title: { en: 'Environment & housekeeping', ar: 'البيئة والنظافة', ur: 'ماحول اور صفائی', hi: 'पर्यावरण और साफ़-सफ़ाई' },
    items: [
      { id: 'env-01', text: { en: 'No oil or fuel dripping onto the ground; drip tray used when parked', ar: 'لا تنقيط زيت أو وقود على الأرض؛ استخدام صينية التنقيط عند الوقوف', ur: 'زمین پر تیل یا ایندھن نہیں ٹپک رہا؛ کھڑی حالت میں ڈرپ ٹرے', hi: 'ज़मीन पर तेल या ईंधन नहीं टपक रहा; खड़े होने पर ड्रिप ट्रे' } },
      { id: 'env-02', text: { en: 'Spill kit available and the operator knows how to use it', ar: 'عدة احتواء الانسكاب متوفرة والمشغّل يعرف استخدامها', ur: 'اسپل کٹ دستیاب اور آپریٹر استعمال جانتا ہے', hi: 'स्पिल किट उपलब्ध और ऑपरेटर उपयोग जानता है' } },
      { id: 'env-03', text: { en: 'Exhaust emissions within the permitted limit, no excessive black smoke', ar: 'انبعاثات العادم ضمن الحد المسموح، دون دخان أسود مفرط', ur: 'ایگزاسٹ اخراج مقررہ حد میں، زیادہ کالا دھواں نہیں', hi: 'एग्ज़ॉस्ट उत्सर्जन अनुमत सीमा में, अत्यधिक काला धुआँ नहीं' } },
      { id: 'env-04', text: { en: 'Cab, steps and floor free of loose tools, rubbish and trip hazards', ar: 'الكابينة والدرجات والأرضية خالية من الأدوات السائبة والنفايات ومخاطر التعثر', ur: 'کیبن، سیڑھیاں اور فرش ڈھیلے اوزار، کچرے اور پھسلن سے پاک', hi: 'केबिन, सीढ़ियाँ और फ़र्श ढीले औज़ार, कचरे और ठोकर-जोखिम से मुक्त' } },
      { id: 'env-05', text: { en: 'Waste oil, filters and rags disposed of through the approved route', ar: 'التخلص من الزيت المستعمل والفلاتر والخِرق عبر المسار المعتمد', ur: 'فاضل تیل، فلٹر اور کپڑے منظور شدہ طریقے سے ٹھکانے', hi: 'अपशिष्ट तेल, फ़िल्टर और कपड़े स्वीकृत मार्ग से निपटाए' } },
      { id: 'env-06', text: { en: 'Noise levels acceptable; no missing acoustic panels', ar: 'مستويات الضوضاء مقبولة؛ لا ألواح عزل صوتي مفقودة', ur: 'شور کی سطح قابل قبول؛ کوئی صوتی پینل غائب نہیں', hi: 'ध्वनि स्तर स्वीकार्य; कोई ध्वनिरोधी पैनल गायब नहीं' } }
    ]
  }
];

// ---------------------------------------------------------------------------
// Colour-code tag system
// ---------------------------------------------------------------------------
// Equipment that passes the month's inspection carries that month's colour tag,
// so anyone on site can tell at a glance whether a machine's inspection is
// current. Two schemes are offered because sites run both: a 12-colour monthly
// rotation, and the 4-colour quarterly rotation common on lifting gear.
const COLOUR_SCHEMES = {
  monthly: {
    id: 'monthly',
    labelKey: 'c.scheme.monthly',
    // index 0 = January
    colours: [
      { hex: '#d93025', ink: '#ffffff', name: { en: 'Red',        ar: 'أحمر',      ur: 'سرخ',      hi: 'लाल' } },
      { hex: '#e8710a', ink: '#ffffff', name: { en: 'Orange',     ar: 'برتقالي',   ur: 'نارنجی',   hi: 'नारंगी' } },
      { hex: '#f2c000', ink: '#3d2f00', name: { en: 'Yellow',     ar: 'أصفر',      ur: 'پیلا',     hi: 'पीला' } },
      { hex: '#7cb342', ink: '#12240a', name: { en: 'Lime green', ar: 'أخضر ليموني', ur: 'ہلکا سبز', hi: 'हल्का हरा' } },
      { hex: '#1f7a4d', ink: '#ffffff', name: { en: 'Green',      ar: 'أخضر',      ur: 'سبز',      hi: 'हरा' } },
      { hex: '#00897b', ink: '#ffffff', name: { en: 'Teal',       ar: 'أزرق مخضر', ur: 'فیروزی',   hi: 'टील' } },
      { hex: '#0097a7', ink: '#ffffff', name: { en: 'Cyan',       ar: 'سماوي',     ur: 'آسمانی',   hi: 'सियान' } },
      { hex: '#1565c0', ink: '#ffffff', name: { en: 'Blue',       ar: 'أزرق',      ur: 'نیلا',     hi: 'नीला' } },
      { hex: '#3949ab', ink: '#ffffff', name: { en: 'Indigo',     ar: 'نيلي',      ur: 'انڈیگو',   hi: 'इंडिगो' } },
      { hex: '#6a1b9a', ink: '#ffffff', name: { en: 'Purple',     ar: 'بنفسجي',    ur: 'جامنی',    hi: 'बैंगनी' } },
      { hex: '#ad1457', ink: '#ffffff', name: { en: 'Magenta',    ar: 'أرجواني',   ur: 'میجنٹا',   hi: 'मैजेंटा' } },
      { hex: '#6d4c41', ink: '#ffffff', name: { en: 'Brown',      ar: 'بني',       ur: 'بھورا',    hi: 'भूरा' } }
    ]
  },
  quarterly: {
    id: 'quarterly',
    labelKey: 'c.scheme.quarterly',
    colours: [
      { hex: '#d93025', ink: '#ffffff', name: { en: 'Red (Q1)',    ar: 'أحمر (ر1)',   ur: 'سرخ (Q1)',  hi: 'लाल (Q1)' } },
      { hex: '#1f7a4d', ink: '#ffffff', name: { en: 'Green (Q2)',  ar: 'أخضر (ر2)',   ur: 'سبز (Q2)',  hi: 'हरा (Q2)' } },
      { hex: '#1565c0', ink: '#ffffff', name: { en: 'Blue (Q3)',   ar: 'أزرق (ر3)',   ur: 'نیلا (Q3)', hi: 'नीला (Q3)' } },
      { hex: '#f2c000', ink: '#3d2f00', name: { en: 'Yellow (Q4)', ar: 'أصفر (ر4)',   ur: 'پیلا (Q4)', hi: 'पीला (Q4)' } }
    ]
  }
};

const MONTH_NAMES = [
  { en: 'January',   ar: 'يناير',  ur: 'جنوری',   hi: 'जनवरी' },
  { en: 'February',  ar: 'فبراير', ur: 'فروری',   hi: 'फ़रवरी' },
  { en: 'March',     ar: 'مارس',   ur: 'مارچ',    hi: 'मार्च' },
  { en: 'April',     ar: 'أبريل',  ur: 'اپریل',   hi: 'अप्रैल' },
  { en: 'May',       ar: 'مايو',   ur: 'مئی',     hi: 'मई' },
  { en: 'June',      ar: 'يونيو',  ur: 'جون',     hi: 'जून' },
  { en: 'July',      ar: 'يوليو',  ur: 'جولائی',  hi: 'जुलाई' },
  { en: 'August',    ar: 'أغسطس',  ur: 'اگست',    hi: 'अगस्त' },
  { en: 'September', ar: 'سبتمبر', ur: 'ستمبر',   hi: 'सितंबर' },
  { en: 'October',   ar: 'أكتوبر', ur: 'اکتوبر',  hi: 'अक्टूबर' },
  { en: 'November',  ar: 'نوفمبر', ur: 'نومبر',   hi: 'नवंबर' },
  { en: 'December',  ar: 'ديسمبر', ur: 'دسمبر',   hi: 'दिसंबर' }
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ChecklistData = {

  typeById(id) {
    return EQUIPMENT_TYPES.find(t => t.id === id) || null;
  },

  // Sections that apply to a given equipment type id.
  sectionsFor(typeId) {
    const type = this.typeById(typeId);
    if (!type) return [];
    return CHECK_SECTIONS.filter(s => {
      if (s.appliesTo === 'all') return true;
      return s.appliesTo.some(tag => type.tags.includes(tag));
    });
  },

  itemCountFor(typeId) {
    return this.sectionsFor(typeId).reduce((n, s) => n + s.items.length, 0);
  },

  // Looks an item up by id across every section — used when rendering a saved
  // record whose equipment type may since have been edited.
  findItem(itemId) {
    for (const s of CHECK_SECTIONS) {
      const it = s.items.find(i => i.id === itemId);
      if (it) return { section: s, item: it };
    }
    return null;
  },

  // Colour for a given month index (0-11) under a scheme.
  colourFor(monthIndex, schemeId) {
    const scheme = COLOUR_SCHEMES[schemeId] || COLOUR_SCHEMES.monthly;
    const idx = scheme.id === 'quarterly' ? Math.floor(monthIndex / 3) : monthIndex;
    return scheme.colours[idx % scheme.colours.length];
  },

  monthName(monthIndex, lang) {
    const m = MONTH_NAMES[monthIndex];
    return m ? (m[lang] || m.en) : '';
  },

  // 'YYYY-MM' → { year, monthIndex }
  parseMonth(value) {
    if (!value || !/^\d{4}-\d{2}$/.test(value)) return null;
    const [y, m] = value.split('-').map(Number);
    if (m < 1 || m > 12) return null;
    return { year: y, monthIndex: m - 1 };
  },

  currentMonthValue() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  },

  icon(name, size) {
    const s = size || 18;
    const body = CHECK_ICONS[name] || CHECK_ICONS.doc;
    return `<svg class="chk-icon" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true">${body}</svg>`;
  }
};
