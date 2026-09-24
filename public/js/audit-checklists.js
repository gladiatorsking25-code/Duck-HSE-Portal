// audit-checklists.js — HSE audit preparation checklists (contractor & consultant).
//
// SOURCES — every item below traces to one of these, and cites it in `ref`:
//
//   • ADOSH-SF Technical Guideline 15, "ADOSH-SF Audit Non-Conformance (A Guide
//     for Auditors)", v4.0, July 2024 — referenced as "TG 15 §x.y". TG 15 lists
//     the non-conformances ADPHC auditors actually raise, element by element,
//     with a suggested Major/Minor level for each. This checklist inverts those
//     entries: each issue TG 15 describes becomes the evidence you must be able
//     to show so it is NOT raised. The `nc` field carries TG 15's suggested level
//     if the evidence is missing — that is what makes a readiness score useful.
//
//   • TAQA WS (formerly SWS) Standard Operating Procedures SOP-3501…3547 —
//     referenced as "SOP-35xx §x.y". SOP-3546 "OHSE Audits on Service Providers"
//     defines how TAQA WS audits both contractors and consultants, which is why
//     the readiness section follows it.
//
// ROLE SPLIT. Each operational SOP states it in §3 in almost the same words:
// contractors are responsible for executing the SOP; consultants are
// responsible for ensuring the contractor fulfils it (SOP-3509 §7.2.2 spells the
// consultant's side out: review and recommend approval of the safe system of
// work, monitor site compliance, manage close-out of non-conformances). So the
// contractor checklist asks for *implementation* evidence and the consultant
// checklist asks for *review, approval and monitoring* evidence.
//
// WORDING. Requirements are paraphrased, not copied — the clause references
// point auditors and preparers back to the controlled documents, which remain
// the authority. Nothing here states a numeric limit that is not in a source.
//
// Serial numbers are NOT stored here. They are assigned when an audit is
// created and then frozen into that audit, so the S/No. that names an evidence
// folder never shifts when the scope is changed later.

(function (global) {
  'use strict';

  const ROLES = {
    contractor: { label: 'Contractor', desc: 'Implementation evidence — you execute the SOPs and run the project OSHMS.' },
    consultant: { label: 'Consultant', desc: 'Supervision evidence — you review, approve and monitor the contractor on TAQA WS\'s behalf.' }
  };

  // Suggested non-conformance if the evidence cannot be shown (TG 15 §3.2).
  const NC = { MAJOR: 'Major', MINOR: 'Minor', EITHER: 'Minor / Major' };

  // item(text, evidence[], ref, nc, tip) — text/evidence/tip may be a string or
  // { contractor, consultant } when the two roles need different wording.
  function item(text, evidence, ref, nc, tip, roles) {
    return { text: text, evidence: evidence || [], ref: ref || '', nc: nc || null, tip: tip || '', roles: roles || null };
  }
  const onlyContractor = ['contractor'];
  const onlyConsultant = ['consultant'];

  // =========================================================================
  // PART A — AUDIT READINESS (SOP-3546)
  // =========================================================================

  const READINESS = {
    key: 'readiness', part: 'A', title: 'Audit readiness & previous findings', ref: 'TAQA WS SOP-3546',
    items: [
      item('Audit notification received and the OHSE Audit Plan agreed — date, scope, audit team, agenda and the people to be interviewed.',
        ['Audit notification (TAQA WS must notify at least 7 working days ahead)', 'OHSE Audit Plan SOF-3546-A (issued at least 3 working days ahead)', 'Attendee / interviewee list'],
        'SOP-3546 §7.3', null,
        'Confirm the interviewees are on site on the day — auditors test awareness by questioning staff, not only by reading documents.'),
      item('Findings from the previous OHSE audit, with objective evidence that each one is closed and effective.',
        ['Previous OHSE Audit Report SOF-3546-D', 'Previous NCRs SOF-3546-C with the closure section completed', 'Close-out evidence per NCR (photos, revised documents, records)'],
        'SOP-3546 §7.4 · TG 15 §9.11–9.13', NC.MINOR,
        'SOP-3546 makes reviewing previous findings mandatory for the audit team. An open NCR from last time is the fastest route to a repeat — and a repeat minor can be raised to major (TG 15 §3.2).'),
      item('Post-audit action plan from the last audit, with the current status of every action.',
        ['OHSE Post-Audit Action Plan SOF-3546-F', 'Action tracker showing owner, due date and status'],
        'SOP-3546 §7.5', NC.MINOR),
      item({
        contractor: 'Project organisation chart showing HSE personnel, supervisors and their approval status by TAQA WS / the consultant.',
        consultant: 'Supervision organisation chart showing the consultant\'s HSE team, resident engineer and site supervisors assigned to the contract.'
      },
        ['Organisation chart (current revision)', 'HSE personnel approvals / CVs', 'Deputising arrangements'],
        'TG 15 §2.6', NC.EITHER,
        'TG 15 compares the org chart against what is actually in place — a large gap between the two can be raised as a major.'),
      item({
        contractor: 'Contract HSE requirements and the approved Project HSE Plan (OHS Construction Management Plan).',
        consultant: 'Consultancy agreement HSE scope and the consultant\'s HSE supervision plan for this contract.'
      },
        { contractor: ['HSE specification / contract HSE clauses', 'Approved Project HSE Plan (ADOSH-SF CoP 53.1)', 'Consultant / TAQA WS approval letter'],
          consultant: ['Consultancy agreement — HSE scope', 'HSE supervision / monitoring plan', 'Approved contractor Project HSE Plan (for reference)'] },
        'TG 15 §4.6 · SOP-3509 §7.2.2–7.2.3', NC.MAJOR)
    ]
  };

  // =========================================================================
  // PART B — ADOSH-SF MANAGEMENT SYSTEM (TG 15 §1–§11)
  // =========================================================================

  const ELEMENTS = [
    {
      key: 'policy', part: 'B', title: 'OSH Policy', ref: 'ADOSH-SF Element 9 · Clause 3.1 — TG 15 §1',
      items: [
        item('OSH Policy in place, signed by top management, dated within the current year, and standalone — not merged with quality or environment policies.',
          ['Signed & dated OSH Policy'], 'TG 15 §1.3, 1.4, 1.6', NC.MAJOR,
          'A combined QHSE policy is a major under TG 15 §1.4 — ADOSH-SF requires the OSH policy to stand alone.'),
        item('Policy contains every commitment required by ADOSH-SF Element 9 §3.1(a)(iv) and fits the scale and nature of the undertaking.',
          ['OSH Policy', 'Cross-check of commitments against Element 9 §3.1'], 'TG 15 §1.1, 1.2', NC.EITHER),
        item('Policy communicated — displayed at site offices and notice boards, covered in induction, and understood by staff.',
          ['Photos of displayed policy', 'Induction content covering the policy', 'Acknowledgement / attendance records'],
          'TG 15 §1.5', NC.EITHER, 'Auditors ask workers what the policy says. Brief the likely interviewees.'),
        item('Evidence the policy has been reviewed within the last two years, even where no change was needed.',
          ['Policy review record / management review minutes'], 'TG 15 §1.3', NC.MAJOR)
      ]
    },
    {
      key: 'roles', part: 'B', title: 'Roles, responsibilities & self-regulation', ref: 'ADOSH-SF Element 1 — TG 15 §2',
      items: [
        item('Documented, implemented roles and responsibilities procedure covering everything in Element 1 §3.1.',
          ['Roles & responsibilities procedure', 'Evidence of implementation'], 'TG 15 §2.1, 2.2', NC.MAJOR),
        item('OSH Management Representative appointed from top management.',
          ['MR appointment letter'], 'TG 15 §2.3', NC.MINOR),
        item('OSH responsibilities defined for every position and communicated to the post-holders.',
          ['Job descriptions with OSH duties', 'Signed acknowledgements'], 'TG 15 §2.4', NC.EITHER,
          'TG 15 tests this by interview; if staff are unaware of their duties the NC can be raised to major.'),
        item('Mechanism to measure how well people perform their OSH responsibilities.',
          ['Appraisal form with OSH objectives', 'Sample completed appraisals'], 'TG 15 §2.5', NC.MINOR),
        item({
          contractor: 'Adequate, competent HSE resources in place against the organisation chart — HSE manager, officers, first aiders, fire wardens.',
          consultant: 'Adequate, competent HSE supervision resources in place against the consultancy agreement and organisation chart.'
        },
          ['HSE staffing matrix vs contract requirement', 'Appointment letters & qualifications', 'Recruitment plan for any vacancy'],
          'TG 15 §2.6', NC.EITHER)
      ]
    },
    {
      key: 'risk', part: 'B', title: 'Risk management', ref: 'ADOSH-SF Element 2 — TG 15 §3',
      items: [
        item('Documented risk management procedure, implemented and meeting ADOSH-SF requirements.',
          ['Risk management procedure'], 'TG 15 §3.1, 3.2', NC.MAJOR),
        item({
          contractor: 'Project risk register covering all routine and non-routine activities, every person affected (workers, subcontractors, public, visitors) and all site locations.',
          consultant: 'Risk register for the consultant\'s own activities — site supervision, inspections, travel to site, lone working, office.'
        },
          ['Risk register / HIRA', 'Scope cross-check against activities on the programme'], 'TG 15 §3.3', NC.EITHER,
          'A missing high-risk activity is a major; a missing low-risk one is usually minor (TG 15 §3.3).'),
        item({
          contractor: 'Activity risk assessments and method statements for current works, approved by the consultant before work started.',
          consultant: 'Risk assessments for supervision activities, and the RA/MS register showing which contractor documents were reviewed and approved.'
        },
          { contractor: ['Approved RA/MS for each active work activity', 'Consultant approval / transmittal'],
            consultant: ['Consultant activity RAs', 'RA/MS review & approval register'] },
          'TG 15 §3.2 · §4.7', NC.MAJOR),
        item('Control measures chosen by the hierarchy of controls — PPE is not the primary control for higher risks.',
          ['Sample RAs showing elimination / engineering controls'], 'TG 15 §3.4', NC.EITHER,
          'TG 15 flags entities that repeatedly rely on PPE for high risks as a major.'),
        item('Evidence the identified controls are actually implemented on site.',
          ['Inspection records / photos matched to RA controls', 'Sample verification of 3–5 RAs on site'], 'TG 15 §3.5', NC.MAJOR),
        item('Risk assessments reviewed on a schedule and after incidents, changes and non-conformances.',
          ['RA review log with dates and triggers'], 'TG 15 §3.6', NC.EITHER),
        item('Workers consulted on risk assessments and briefed on the results.',
          ['RA briefing / toolbox talk attendance sheets', 'Worker sign-off on RA'], 'TG 15 §3.7', NC.MINOR)
      ]
    },
    {
      key: 'contractors', part: 'B',
      title: { contractor: 'Subcontractor & supplier management', consultant: 'Contractor management & HSE supervision' },
      ref: 'ADOSH-SF Element 3 — TG 15 §4',
      items: [
        item({
          contractor: 'Documented, implemented procedure for managing subcontractors and suppliers, covering their scope and risk.',
          consultant: 'Documented, implemented procedure / plan for supervising the contractor\'s HSE performance.'
        }, ['Procedure', 'Evidence of implementation'], 'TG 15 §4.1–4.3', NC.MAJOR),
        item({
          contractor: 'OSH requirements written into subcontract tender documents and agreements.',
          consultant: 'HSE requirements specified in the tender / contract documents issued to the contractor (and the consultant\'s input to them).'
        }, ['Tender HSE requirements', 'Signed agreement HSE clauses'], 'TG 15 §4.4, 4.6', NC.MAJOR),
        item('OSH criteria used when selecting subcontractors, with a minimum pass mark.',
          ['Prequalification / HSE evaluation forms', 'Approved subcontractor list'], 'TG 15 §4.5', NC.MAJOR, '', onlyContractor),
        item('Subcontractors\' RA/MS reviewed and approved before they start work.',
          ['Subcontractor RA/MS with approval'], 'TG 15 §4.7', NC.MAJOR, '', onlyContractor),
        item('Subcontractor activities monitored, with performance evaluated.',
          ['Subcontractor inspection records', 'Performance evaluations'], 'TG 15 §4.8', NC.MAJOR, '', onlyContractor),
        item('Every subcontractor worker inducted before starting work.',
          ['Induction register including subcontractor staff'], 'TG 15 §4.9', NC.MINOR, '', onlyContractor),
        item('Contractor\'s Project HSE Plan reviewed and approved, with review comments tracked to closure.',
          ['Review comment sheets', 'Approval letter / transmittal'], 'TG 15 §4.7 · SOP-3509 §7.2.2', NC.MAJOR, '', onlyConsultant),
        item('Contractor RA/MS, environmental assessments and temporary works designs reviewed and conditionally approved — the "Review / Approval of EHS procedures" line on the monthly TAQA return.',
          ['Document review register', 'Approved RA/MS with conditions', 'Transmittals'], 'SOP-3509 §7.2.2 · TG 15 §4.7', NC.MAJOR,
          'SOP-3509 requires consultant approval to be conditional on new or previously unknown hazards being addressed.', onlyConsultant),
        item('Contractor HSE personnel reviewed and approved (CVs, qualifications, interviews).',
          ['HSE personnel approval records'], 'TG 15 §2.6, §4.8', NC.EITHER, '', onlyConsultant),
        item('Planned site inspections of the contractor carried out and recorded — the "Inspections performed by Consultant" line on the monthly TAQA return.',
          ['Inspection schedule', 'Inspection reports', 'Monthly inspection count'], 'TG 15 §4.8', NC.MAJOR, '', onlyConsultant),
        item('Non-conformances, corrective action requests, breach notices and stop-work notices issued to the contractor, tracked to verified closure.',
          ['NCR / CAR register', 'Breach & stop-work notices', 'Closure evidence'], 'TG 15 §9.11–9.13 · SOP-3509 §7.2.2', NC.MINOR, '', onlyConsultant),
        item('Contractor incidents investigated or reviewed by the consultant, with lessons learnt shared.',
          ['Incident review records', 'Lessons-learnt circulars'], 'TG 15 §8.2', NC.EITHER, '', onlyConsultant),
        item('Contractor\'s monthly HSE statistics (TAQA Form F-019-F) checked and validated before submission.',
          ['Validated F-019-F returns (signed "Validated by")', 'Source data checked'], 'TG 15 §8.3.4', NC.EITHER,
          'The two reports in the Admin control centre can reconcile the contractor\'s submission against its internal record.', onlyConsultant),
        item('Contractor HSE performance evaluated periodically and reported to TAQA WS.',
          ['Contractor HSE performance evaluations', 'Monthly consultant HSE report'], 'TG 15 §4.8', NC.MAJOR, '', onlyConsultant),
        item('Contractor workforce inductions and mandatory training verified.',
          ['Verification records / sampled training certificates'], 'TG 15 §4.9', NC.MINOR, '', onlyConsultant)
      ]
    },
    {
      key: 'comms', part: 'B', title: 'Communication & consultation', ref: 'ADOSH-SF Element 4 — TG 15 §5',
      items: [
        item('Documented, implemented communication and consultation procedures.',
          ['Communication procedure', 'Consultation procedure'], 'TG 15 §5.1.1–5.1.3, 5.2.1–5.2.3', NC.MAJOR),
        item('Annual OSH performance report produced as part of management review.',
          ['Annual OSH performance report'], 'TG 15 §5.1.4', NC.MINOR),
        item('OSH committee established and chaired by a member of top management with delegated authority to decide.',
          ['Committee terms of reference', 'Membership list', 'Chair\'s delegation of authority'], 'TG 15 §5.2.5, 5.2.7', NC.MAJOR),
        item('OSH committee met at least four times in the last calendar year, with minutes distributed to stakeholders including staff.',
          ['Minutes of each meeting', 'Distribution evidence'], 'TG 15 §5.2.6, 5.2.8', NC.EITHER),
        item('Actions agreed by the OSH committee implemented and tracked.',
          ['Committee action log with status'], 'TG 15 §5.2.9', NC.EITHER),
        item('Workers consulted at every stage of risk management.',
          ['Toolbox talks', 'HSE meetings with workers', 'Worker feedback / suggestion records'], 'TG 15 §5.2.4', NC.MINOR),
        item('HSE alerts, lessons learnt and TAQA WS safety communications cascaded to the workforce.',
          ['Alert distribution records', 'Notice board photos', 'Toolbox talk records on alerts'], 'ADOSH-SF Element 4 · SOP-3538 §7.1.8', NC.MINOR)
      ]
    },
    {
      key: 'training', part: 'B', title: 'Training, awareness & competency', ref: 'ADOSH-SF Element 5 — TG 15 §6',
      items: [
        item('Documented, implemented training and competency procedure.',
          ['Training procedure'], 'TG 15 §6.1–6.3', NC.MAJOR),
        item('Training needs analysis / training matrix covering every role, every required OSH course and refresher intervals.',
          ['Training needs analysis', 'Training matrix'], 'TG 15 §6.4', NC.EITHER, 'No training needs analysis at all is a major (TG 15 §6.4).'),
        item('Training planned against the matrix and delivered.',
          ['Training plan / calendar', 'Delivered vs planned tracker'], 'TG 15 §6.5', NC.MINOR,
          'If little of the identified training has been delivered, TG 15 allows this to be raised to major.'),
        item('Training content meets the matrix, and training effectiveness is evaluated.',
          ['Course content / lesson plans', 'Evaluation forms or tests'], 'TG 15 §6.6, 6.7', NC.EITHER),
        item('OSH induction developed for all relevant topics and given to every new starter.',
          ['Induction presentation / checklist', 'Induction register'], 'TG 15 §6.8, 6.9', NC.MINOR),
        item('Internal trainers are competent (train-the-trainer or teaching qualification plus subject knowledge).',
          ['Trainer certificates'], 'TG 15 §6.10', NC.MINOR),
        item('Competency requirements defined for each role and individuals assessed against them.',
          ['Role competency requirements', 'Competency assessment records'], 'TG 15 §6.11, 6.12', NC.EITHER),
        item({
          contractor: 'Training records and valid certificates available — including third-party certificates for operators, riggers, confined space entrants, first aiders and fire wardens.',
          consultant: 'Training records and valid certificates for the consultant\'s supervision team.'
        }, ['Training records', 'Certificate register with expiry dates'], 'TG 15 §6.13', NC.MINOR),
        item('Toolbox talks delivered regularly and recorded.',
          ['Toolbox talk records with attendance'], 'SOP-3509 §8.15 · TG 15 §6', NC.MINOR, '', onlyContractor)
      ]
    },
    {
      key: 'emergency', part: 'B', title: 'Emergency management', ref: 'ADOSH-SF Element 6 — TG 15 §7',
      items: [
        item('Documented, implemented emergency management procedure.',
          ['Emergency management procedure'], 'TG 15 §7.1–7.3', NC.MAJOR),
        item('Emergency scenarios identified by risk assessment and specific to the site — not generic.',
          ['Emergency scenario risk assessment'], 'TG 15 §7.4', NC.MAJOR,
          'TG 15 does not accept a generic scenario list as compliant.'),
        item('Emergency response plans for every identified scenario, including at minimum a fire management plan and an evacuation plan.',
          ['Site emergency response plan', 'Fire management plan', 'Evacuation plan', 'Scenario plans (e.g. confined space rescue, excavation collapse, heat stress)'],
          'TG 15 §7.5–7.8', NC.MAJOR),
        item('Emergency response team identified, trained, fit for the role and made known across the site.',
          ['ERT list', 'ERT training certificates', 'Communication evidence'], 'TG 15 §7.9, 7.10', NC.MAJOR),
        item('Evacuation procedures, routes and assembly points posted, and staff aware of them.',
          ['Photos of posted routes / assembly points', 'Staff awareness checks'], 'TG 15 §7.11', NC.EITHER),
        item('Emergency plans tested regularly — covering every scenario, not only fire.',
          ['Drill schedule', 'Drill reports with lessons learnt'], 'TG 15 §7.12', NC.EITHER, 'Never tested is a major (TG 15 §7.12).'),
        item('Emergency plans reviewed at least annually and after drills or real events.',
          ['ERP review record'], 'TG 15 §7.13', NC.MINOR),
        item('Emergency equipment in place, maintained and in service — extinguishers, first aid, rescue equipment, alarms, signage, communications.',
          ['Emergency equipment register', 'Inspection / maintenance records'], 'TG 15 §7.14', NC.MAJOR)
      ]
    },
    {
      key: 'monitoring', part: 'B', title: 'Monitoring, investigation & reporting', ref: 'ADOSH-SF Element 7 — TG 15 §8',
      items: [
        item('Documented, implemented procedure for OSH targets and objectives.',
          ['Objectives & targets procedure'], 'TG 15 §8.1.1–8.1.3', NC.MAJOR),
        item('Documented KPIs, including the mandatory ADOSH-SF KPIs (Mechanism 6.0), each with a measurable target and baseline.',
          ['KPI register with targets and baselines'], 'TG 15 §8.1.4–8.1.6', NC.MAJOR,
          'TG 15 names a common error: a "10% reduction" target with no baseline to measure it from.'),
        item('A programme for achieving each KPI (actions, owners, timelines), monitored, with corrective action where targets are missed, and communicated.',
          ['KPI programmes', 'Monitoring records', 'Actions on missed targets', 'Communication evidence'], 'TG 15 §8.1.7–8.1.10', NC.MAJOR),
        item('Documented, implemented incident notification, investigation and reporting procedure (including Mechanism 11.0).',
          ['Incident procedure'], 'TG 15 §8.2.1–8.2.3', NC.MAJOR),
        item('Investigation reports contain everything Mechanism 11.0 requires, identify true root causes, and are signed off by top management.',
          ['Incident register', 'Sample investigation reports', 'Top-management sign-off'], 'TG 15 §8.2.5, 8.2.6, 8.2.13', NC.EITHER,
          'TG 15 warns against naming an immediate cause or "human error" as the root cause.'),
        item('Competency defined for people who investigate incidents.',
          ['Investigator competency criteria', 'Investigator training records'], 'TG 15 §8.2.4', NC.MINOR),
        item('Status of every investigation and every resulting corrective action can be shown; outcomes communicated.',
          ['Investigation & action tracker', 'Lessons-learnt communications'], 'TG 15 §8.2.7–8.2.9', NC.MINOR),
        item('Risk assessments, SOPs and training reviewed after each incident.',
          ['Post-incident review records'], 'TG 15 §8.2.10', NC.MAJOR),
        item('Serious incidents notified to the SRA / ADPHC — and to TAQA WS — within the required timescales.',
          ['Notification records with timestamps'], 'TG 15 §8.2.11, 8.2.12', NC.MAJOR),
        item({
          contractor: 'Monthly HSE statistics submitted to TAQA WS (Form F-019-F) and matching the internal monthly report.',
          consultant: 'Monthly consultant HSE statistics and the validated contractor returns submitted to TAQA WS.'
        }, ['F-019-F returns', 'Internal monthly report (HEGC-IMS-P06-FM-03 / 03A or equivalent)'], 'TG 15 §8.3.4', NC.EITHER,
          'Discrepancies between the submission and the internal record are exactly what an auditor samples. Reconcile them in the Admin control centre before the audit.'),
        item('Monitoring requirements identified and carried out — e.g. noise, air quality, heat stress, lighting.',
          ['Monitoring plan', 'Monitoring results against limits'], 'TG 15 §8.3.1, 8.3.2', NC.MAJOR),
        item('Monitoring equipment calibrated (typically annually), with a certificate for each device.',
          ['Calibration certificates — gas detectors, sound level meters, heat stress meters'], 'TG 15 §8.3.3', NC.MINOR),
        item('Safety observations and near misses reported, recorded and closed out.',
          ['Safety Observation Reports SOF-3537-A', 'Near-miss register with closure'], 'SOP-3537 §7.2–7.3', NC.MINOR)
      ]
    },
    {
      key: 'audit', part: 'B', title: 'Audit & inspection', ref: 'ADOSH-SF Element 8 — TG 15 §9',
      items: [
        item('Documented, implemented audit and inspection procedure, plus a non-conformance and corrective action procedure.',
          ['Audit & inspection procedure', 'NC & corrective action procedure'], 'TG 15 §9.1–9.3, 9.9, 9.10', NC.MAJOR),
        item('Audit and inspection plan covering the whole undertaking and OSHMS, and implemented.',
          ['Audit & inspection plan', 'Completed audit / inspection records'], 'TG 15 §9.4–9.6', NC.MINOR),
        item('Documented audit criteria (checklists) covering all ADOSH-SF and legal requirements.',
          ['Internal audit checklists'], 'TG 15 §9.7', NC.MINOR),
        item('Internal auditors are knowledgeable in auditing and in ADOSH-SF.',
          ['Auditor training / qualifications'], 'TG 15 §9.8', NC.MINOR),
        item({
          contractor: 'Site inspections carried out and recorded — daily / weekly HSE inspections and plant and equipment checks.',
          consultant: 'Consultant site inspections recorded, with findings communicated to the contractor.'
        }, ['Inspection reports', 'Inspection schedule vs completed'], 'TG 15 §9.6', NC.MINOR),
        item('Corrective action register showing owner, timescale, status and effectiveness for every non-conformance.',
          ['CAR / NCR register'], 'TG 15 §9.11–9.13', NC.MINOR),
        item('Annual third-party ADOSH-SF audit by an ADPHC-approved entity and practitioner, independent of the OSHMS developer, adequately resourced, and reported to the SRA within 30 days.',
          ['Third-party audit report', 'Auditor ADPHC approval', 'Independence declaration', 'SRA submission evidence'],
          'TG 15 §9.14–9.19', NC.MAJOR,
          'Scope must be ADOSH-SF itself — an ISO 45001 certificate audit does not satisfy it (TG 15 §9.18).')
      ]
    },
    {
      key: 'compliance', part: 'B', title: 'Legal compliance, SOPs, document control, change & management review', ref: 'ADOSH-SF Element 9 — TG 15 §10',
      items: [
        item('Documented, implemented legal compliance procedure and a legal register covering all applicable legislation and ADOSH-SF requirements.',
          ['Legal compliance procedure', 'Legal register'], 'TG 15 §10.1.1–10.1.3, 10.1.5–10.1.7', NC.MAJOR),
        item('Compliance with identified legal requirements monitored and verified.',
          ['Compliance evaluation records'], 'TG 15 §10.1.4', NC.MAJOR),
        item('Legal requirements communicated to relevant stakeholders.',
          ['Communication records'], 'TG 15 §10.1.8', NC.MINOR),
        item('SOPs / safe work procedures developed for higher-risk tasks, adequate to control the risk and consistent with ADOSH-SF and the CoPs.',
          ['SOP list cross-referenced to the risk register'], 'TG 15 §10.2.1, 10.2.3, 10.2.4', NC.MAJOR),
        item('Staff trained on the SOPs that apply to their work.',
          ['SOP training records'], 'TG 15 §10.2.2', NC.MAJOR),
        item('Document control in place — master document list, revision history, no obsolete versions in use.',
          ['Document control procedure', 'Master document list', 'Revision history samples'], 'TG 15 §10.3.1–10.3.5', NC.EITHER),
        item('Record retention periods defined for each record type.',
          ['Record retention schedule'], 'TG 15 §10.3.6', NC.MINOR),
        item('Management of change process implemented, with hazard identification and risk assessment before any change.',
          ['MOC procedure', 'MOC register and completed MOC forms'], 'TG 15 §10.4 · SOP-3539', NC.MAJOR),
        item('OSH management review held within the last calendar year, chaired by top management, covering the required inputs and recording outputs with owners and timescales.',
          ['Management review minutes', 'Attendance', 'Output action list'], 'TG 15 §10.5', NC.MAJOR)
      ]
    },
    {
      key: 'cops', part: 'B', title: 'Codes of Practice', ref: 'ADOSH-SF CoPs — TG 15 §11',
      items: [
        item('Applicable ADOSH-SF Codes of Practice identified (through the legal register) and complied with.',
          ['CoP applicability register mapped to project activities', 'Compliance evidence per CoP'], 'TG 15 §11.1', NC.MAJOR,
          'Every entity must comply with the CoPs relevant to its operations regardless of risk level (TG 15 §11.1).'),
        item('OSH practitioners hold the qualifications and registrations required by the contract and the SRA.',
          ['Practitioner qualifications', 'Registration evidence (e.g. Qudorat, as tracked on the TAQA monthly return)'], 'TG 15 §2.6 · TAQA F-019-F KPI 5-01', NC.EITHER)
      ]
    }
  ];

  // =========================================================================
  // PART C — TAQA WS SOP OPERATIONAL COMPLIANCE
  // =========================================================================
  //
  // `on` sets which SOPs are ticked by default for each role when a new audit
  // is created. Defaults suit a water / wastewater network construction
  // contract (excavation-led house connections); every SOP can be switched on
  // or off when the audit is set up.

  // Standard consultant verification pair for an SOP: review what the
  // contractor submits, then monitor what it does on site.
  function verify(sop, review, monitor, extra) {
    return [
      item('Contractor\'s ' + review + ' reviewed and approved before the work started.',
        ['Review & approval records / transmittals', 'Approved documents with any conditions'], sop + ' §3', NC.MAJOR),
      item('Contractor compliance with ' + sop + ' monitored on site — ' + monitor + ' — with findings issued and closed.',
        ['Consultant inspection records for this activity', 'NCRs / observations issued and closed'], sop + ' §3', NC.EITHER)
    ].concat(extra || []);
  }

  const SOPS = [
    {
      code: 'SOP-3542', title: 'Permit to Work', on: { contractor: true, consultant: true },
      contractor: [
        item('Permit to work system operated for every permit-required activity, using the TAQA WS forms.',
          ['PTW register / log', 'Sample closed permits: Hot Work SOF-3542-A, Lifting SOF-3542-C, Work at Height SOF-3542-E, LOTO SOF-3542-F, Excavation SOF-3542-H, Confined Space SOF-3542-I'],
          'SOP-3542 §7.2–7.4 · ADOSH-SF CoP 21.0', NC.MAJOR),
        item('Permit issuers, receivers and PTW coordinators trained and formally authorised.',
          ['PTW training records', 'Authorisation letters / authorised persons list'], 'SOP-3542 §7.6', NC.MAJOR),
        item('Lock-out / tag-out applied to isolations, with an isolation register.',
          ['LOTO forms SOF-3542-F', 'Isolation register', 'Lock & tag issue log'], 'SOP-3542 §7.5', NC.MAJOR),
        item('PTW system verified and monitored — periodic permit audits with findings actioned, and PTW records kept.',
          ['PTW audit reports', 'PTW KPIs', 'Retained permit copies'], 'SOP-3542 §7.9, 7.10, 7.12', NC.EITHER)
      ],
      consultant: verify('SOP-3542', 'permit procedure and the list of authorised issuers / receivers', 'field audits of live permits', [
        item('Live permits audited in the field — the "PTWs audited vs issued" line on the monthly TAQA return — with actions raised and closed.',
          ['PTW audit records', 'PTWs audited vs issued (%)', 'Actions from PTW audits'], 'SOP-3542 §7.9 · TAQA F-019-F KPI 12', NC.EITHER)
      ])
    },
    {
      code: 'SOP-3509', title: 'Excavation works', on: { contractor: true, consultant: true },
      contractor: [
        item('Excavation permit (SOF-3542-H) prepared and approved before every excavation, including "excavate to locate" trial pits.',
          ['Excavation permits', 'Trial pit records'], 'SOP-3509 §7.2.3, 8.3', NC.MAJOR),
        item('Buried services located before digging — service drawings, utility NOCs, cable avoidance (CAT) scans and hand-dug trial pits with non-conducting tools.',
          ['Utility NOCs', 'Service drawings', 'CAT scan records'], 'SOP-3509 §7.2.3, 8.12', NC.MAJOR),
        item('Support system as designed — safe slopes, or shoring to an approved temporary works design — plus ground and groundwater assessment.',
          ['Approved shoring / temporary works design', 'Ground condition assessment', 'Dewatering method & discharge approval'], 'SOP-3509 §8.4–8.7 · SOP-3541', NC.MAJOR),
        item('Safe access and egress, barriers, lighting and ventilation provided at every excavation.',
          ['Site photos', 'Barrier / access inspection records'], 'SOP-3509 §8.8–8.11', NC.MAJOR),
        item('Competent supervisor appointed, and a weekly inspection register kept on site recording date, time, result and remedial action.',
          ['Supervisor appointment letter', 'Excavation inspection register'], 'SOP-3509 §7.2.3, 8.13', NC.EITHER),
        item('Excavation training and toolbox talks delivered.',
          ['Training records', 'Toolbox talk records'], 'SOP-3509 §8.14, 8.15', NC.MAJOR)
      ],
      consultant: verify('SOP-3509', 'excavation safe system of work, risk assessments and environmental assessments', 'including the permit to excavate', [
        item('Temporary works design for shoring and groundwater management reviewed and conditionally approved (or third-party approval ensured).',
          ['Design review comments', 'Conditional approval letter'], 'SOP-3509 §7.2.2', NC.MAJOR),
        item('Applicable site information collated and handed to the contractor; residual design risks formally communicated.',
          ['Site information pack', 'Residual risk register / transmittal'], 'SOP-3509 §7.2.2', NC.MINOR),
        item('Utility NOCs and permits verified before excavation.',
          ['NOC verification records'], 'SOP-3509 §7.2.2', NC.MAJOR)
      ])
    },
    {
      code: 'SOP-3504', title: 'Confined spaces', on: { contractor: true, consultant: true },
      contractor: [
        item('Confined spaces identified and risk assessed; entry prohibited where the atmosphere is IDLH.',
          ['Confined space register', 'Confined space risk assessments'], 'SOP-3504 §8.2', NC.MAJOR),
        item('Confined space entry permit (SOF-3542-I) with atmosphere testing before and during entry.',
          ['Entry permits', 'Gas test records'], 'SOP-3504 §8.3, 8.5', NC.MAJOR),
        item('Gas detectors calibrated — third-party calibrated where testing for toxic or asphyxiating atmospheres.',
          ['Calibration certificates', 'Bump-test log'], 'SOP-3504 §8.5', NC.MAJOR),
        item('Ventilation, isolation and flooding controls in place.',
          ['Ventilation arrangements', 'Isolation records'], 'SOP-3504 §8.6–8.9', NC.MAJOR),
        item('Rescue plan with inspected rescue and resuscitation equipment, and rescue drills held.',
          ['Rescue plan', 'Tripod / harness / breathing apparatus inspection records', 'Rescue drill reports'], 'SOP-3504 §8.10', NC.MAJOR),
        item('Entrants, attendants and supervisors trained and certified.',
          ['Confined space training certificates'], 'SOP-3504 §8.11', NC.MAJOR)
      ],
      consultant: verify('SOP-3504', 'confined space procedure, entry permits and rescue plan', 'including gas testing and attendant presence')
    },
    {
      code: 'SOP-3507', title: 'Cranes, hoists & lifting equipment', on: { contractor: true, consultant: true },
      contractor: [
        item('Lifting permit (SOF-3542-C) and lift plan for each lifting operation, prepared by the appointed person.',
          ['Lifting permits', 'Lift plans'], 'SOP-3507 §6.2 · SOP-3542', NC.MAJOR),
        item('Valid third-party examination certificate for every crane and lifting accessory before mobilisation.',
          ['Third-party certificates', 'Lifting gear register with colour coding'], 'SOP-3507 §6.2', NC.MAJOR),
        item('Operators, riggers and signallers hold valid certificates from a recognised training body.',
          ['Operator / rigger / signaller certificates'], 'SOP-3507 §6.2.3', NC.MAJOR),
        item('Appointed person and lifting supervisor formally appointed.',
          ['Appointment letters'], 'SOP-3507 §6.2.2', NC.MAJOR),
        item('Daily pre-use crane checks and NOCs for lifting near overhead lines.',
          ['Pre-use checklists', 'Overhead line NOC where applicable'], 'SOP-3507', NC.EITHER)
      ],
      consultant: verify('SOP-3507', 'lift plans (critical lifts in particular) and lifting equipment certificates', 'including crane set-up and exclusion zones')
    },
    {
      code: 'SOP-3508', title: 'Electricity & electrical equipment', on: { contractor: true, consultant: true },
      contractor: [
        item('Temporary site electrical supply installed and inspected by a competent electrician.',
          ['Temporary supply layout', 'Installation inspection records'], 'SOP-3508 §7.2 · ADOSH-SF CoP 15.0', NC.MAJOR),
        item('Distribution boards and earth-leakage protection tested.',
          ['DB inspection records', 'RCD / ELCB test records'], 'SOP-3508 §7.3', NC.MAJOR),
        item('Portable electrical tools inspected and tagged.',
          ['Tool inspection register / tags'], 'SOP-3508 §7.4', NC.EITHER),
        item('Lock-out / tag-out used for electrical isolation.',
          ['LOTO permits SOF-3542-F'], 'SOP-3508 §7.5 · ADOSH-SF CoP 24.0', NC.MAJOR),
        item('Electricians competent and trained.',
          ['Electrician certificates / licences'], 'SOP-3508 §8', NC.MAJOR)
      ],
      consultant: verify('SOP-3508', 'temporary electrical installation design', 'including DB condition and LOTO practice')
    },
    {
      code: 'SOP-3530', title: 'Underground & overhead services', on: { contractor: true, consultant: true },
      contractor: [
        item('Underground services identified from drawings and NOCs and located before work.',
          ['Utility drawings', 'NOCs', 'Service detection records'], 'SOP-3530 §7.3.1', NC.MAJOR),
        item('Controls for work near overhead lines — clearances, goal posts, permits.',
          ['Overhead line permits / NOCs', 'Goal post photos'], 'SOP-3530 §7.3.3', NC.MAJOR),
        item('Backfilling follows the method, with warning tape over services.',
          ['Backfilling method', 'Photos'], 'SOP-3530 §7.3.2', NC.MINOR),
        item('Competent person appointed and workers trained.',
          ['Appointment letter', 'Training records'], 'SOP-3530 §7.2.2, 7.4', NC.MAJOR)
      ],
      consultant: verify('SOP-3530', 'service-location method and NOCs', 'including trial pits and overhead clearances')
    },
    {
      code: 'SOP-3528', title: 'Traffic & incident site management', on: { contractor: true, consultant: true },
      contractor: [
        item('Site traffic plan separating pedestrians from vehicles and plant.',
          ['Site traffic management plan', 'Photos'], 'SOP-3528 §7.3.4', NC.MAJOR),
        item('Traffic marshals trained and deployed.',
          ['Marshal training records', 'Deployment rota'], 'SOP-3528 §7.3.2', NC.MAJOR),
        item('Drivers licensed and trained in defensive driving; vehicles inspected.',
          ['Driver licence register', 'Defensive driving certificates', 'Vehicle inspection checklists'], 'SOP-3528 §7.3.3', NC.EITHER),
        item('Traffic management arrangements inspected regularly.',
          ['Traffic management inspection records'], 'SOP-3528 §7.3.6', NC.MINOR),
        item('Road incident site management arrangements in place.',
          ['Road incident response procedure'], 'SOP-3528 §7.3.7', NC.MINOR)
      ],
      consultant: verify('SOP-3528', 'site traffic management plan', 'including marshal deployment and segregation')
    },
    {
      code: 'SOP-3544', title: 'Working on or adjacent to roads', on: { contractor: true, consultant: true },
      contractor: [
        item('Approved traffic control plan and road authority permits for every road work.',
          ['Traffic control plans', 'Road authority permits / NOCs'], 'SOP-3544 §7.2', NC.MAJOR),
        item('Roadwork signage, barriers and diversions installed as per the approved plan.',
          ['Photos against the approved layout', 'Diversion inspection records'], 'SOP-3544 §7.3, 7.4', NC.MAJOR),
        item('Workers trained for roadwork hazards.',
          ['Training records'], 'SOP-3544 §8', NC.MAJOR)
      ],
      consultant: verify('SOP-3544', 'traffic control plans and road permits', 'against the approved diversion layouts')
    },
    {
      code: 'SOP-3543', title: 'Barricading of hazards', on: { contractor: true, consultant: true },
      contractor: [
        item('Barricades chosen to suit the risk profile — hard barriers where the risk demands them.',
          ['Barricading plan / photos'], 'SOP-3543 §7.2, 7.4', NC.MAJOR),
        item('Barricades inspected routinely and after any incident.',
          ['Barricade inspection records'], 'SOP-3543 §7.8, 7.9', NC.MINOR),
        item('Signs and night lighting provided, and unauthorised access prevented.',
          ['Photos (day and night)'], 'SOP-3543 §7.3, 7.6, 7.7', NC.EITHER)
      ],
      consultant: verify('SOP-3543', 'barricading arrangements', 'including night-time checks')
    },
    {
      code: 'SOP-3541', title: 'Safety in design of temporary works', on: { contractor: true, consultant: true },
      contractor: [
        item('Temporary works designers assessed as competent.',
          ['Designer competency assessment'], 'SOP-3541 §7.2', NC.MAJOR),
        item('Temporary works designs submitted and safety-reviewed before use, with a temporary works register.',
          ['Design submissions', 'Design safety review records', 'Temporary works register'], 'SOP-3541 §7.3–7.5 · ADOSH-SF CoP 20.0', NC.MAJOR),
        item('Shoring designs follow the defined workflow and safety requirements.',
          ['Shoring design packages'], 'SOP-3541 §8', NC.MAJOR)
      ],
      consultant: verify('SOP-3541', 'temporary works designs', 'that installed works match the approved designs')
    },
    {
      code: 'SOP-3511', title: 'Fire prevention & protection', on: { contractor: true, consultant: true },
      contractor: [
        item('Fire risk assessment for the site, and a fire & explosion risk assessment where the SOP requires one.',
          ['Fire risk assessment', 'FERA report where applicable'], 'SOP-3511 §8', NC.MAJOR),
        item('Fire extinguishers provided and inspected.',
          ['Extinguisher register', 'Inspection records'], 'SOP-3511 §7.3', NC.MAJOR),
        item('Hot work controlled with fire watch.',
          ['Hot work permits with fire-watch sign-off'], 'SOP-3511 §7.4', NC.MAJOR),
        item('Fire wardens appointed and trained.',
          ['Fire warden list', 'Training certificates'], 'SOP-3511 §7.2.2, 7.5', NC.MAJOR)
      ],
      consultant: verify('SOP-3511', 'fire risk assessment and fire safety arrangements', 'including extinguisher condition and hot work fire watch')
    },
    {
      code: 'SOP-3531', title: 'Welding & cutting operations', on: { contractor: true, consultant: true },
      contractor: [
        item('Hot work permit (SOF-3542-A) for all welding and cutting outside designated hot work areas.',
          ['Hot work permits'], 'SOP-3531 §7.3.2, 7.3.7', NC.MAJOR),
        item('Gas cylinders stored and secured; flashback arrestors fitted; welding equipment inspected.',
          ['Cylinder storage photos', 'Equipment inspection records'], 'SOP-3531 §7.3.5, 7.3.8', NC.MAJOR),
        item('Welders trained and provided with the right PPE and ventilation.',
          ['Welder qualifications', 'PPE issue records'], 'SOP-3531 §7.3.3, 7.3.4, 7.4', NC.MAJOR)
      ],
      consultant: verify('SOP-3531', 'hot work arrangements', 'including cylinder storage and permit compliance')
    },
    {
      code: 'SOP-3512', title: 'First aid', on: { contractor: true, consultant: true },
      contractor: [
        item('First aiders provided in the required number — one per work site per shift below 50 employees, one per 50 employees per shift above that — with qualifications renewed at least every two years.',
          ['First aider list per site / shift', 'First aid certificates with expiry'], 'SOP-3512 §7.3.3', NC.MAJOR),
        item('First aid kits stocked and inspected.',
          ['Kit inspection checklists'], 'SOP-3512 §7.3.2', NC.MINOR),
        item('Accident response plan and accident register maintained.',
          ['Accident response plan', 'Accident / first aid register'], 'SOP-3512 §7.3.1, 7.3.7', NC.EITHER),
        item('First aid signs and emergency contacts displayed.',
          ['Photos of signs and contact lists'], 'SOP-3512 §7.3.5, 7.3.6', NC.MINOR)
      ],
      consultant: verify('SOP-3512', 'first aid arrangements', 'including first aider cover per shift')
    },
    {
      code: 'SOP-3532', title: 'Working in high temperatures & remote locations', on: { contractor: true, consultant: true },
      contractor: [
        item('Heat stress controls in place — work / rest scheduling, shaded rest areas, drinking water and heat stress monitoring.',
          ['Heat stress management plan', 'Heat stress monitoring records', 'Rest shelter photos'], 'SOP-3532 §7.3.1', NC.MAJOR),
        item('Safe arrangements for driving to remote sites and for lone working.',
          ['Journey management records', 'Lone working procedure / check-in log'], 'SOP-3532 §7.3.2–7.3.4', NC.EITHER),
        item('Workers trained on heat illness and remote-site hazards.',
          ['Training / toolbox talk records'], 'SOP-3532 §7.4', NC.MAJOR)
      ],
      consultant: verify('SOP-3532', 'heat stress management plan', 'including rest facilities and water provision')
    },
    {
      code: 'SOP-3510', title: 'Health & wellness', on: { contractor: true, consultant: false },
      contractor: [
        item('Occupational health and fitness-for-work arrangements, including medical fitness for safety-critical roles.',
          ['Medical fitness records', 'Health programme'], 'SOP-3510', NC.EITHER),
        item('Health and wellness awareness delivered to the workforce.',
          ['Campaign / awareness records'], 'SOP-3510', NC.MINOR)
      ],
      consultant: verify('SOP-3510', 'occupational health arrangements', 'including fitness-for-work records')
    },
    {
      code: 'SOP-3521', title: 'Personal protective equipment', on: { contractor: true, consultant: true },
      contractor: [
        item('PPE selected by task through a PPE matrix, issued with signed records, and maintained.',
          ['PPE matrix', 'PPE issue register'], 'SOP-3521 §8 · ADOSH-SF CoP 2.0', NC.MAJOR),
        item('Specialist PPE controlled — harnesses inspected, respiratory protection fit-tested.',
          ['Harness inspection register', 'RPE fit-test records'], 'SOP-3521 §8.8, 8.9', NC.MAJOR),
        item('Workers trained in PPE use and care.',
          ['PPE training records'], 'SOP-3521 §9', NC.MAJOR)
      ],
      consultant: verify('SOP-3521', 'PPE matrix', 'including PPE compliance by task')
    },
    {
      code: 'SOP-3540', title: 'Fall prevention', on: { contractor: true, consultant: true },
      contractor: [
        item('Work at height permits (SOF-3542-E) and fall prevention measures for every work at height.',
          ['Work at height permits', 'Fall protection plan'], 'SOP-3540 §7.3 · SOP-3542', NC.MAJOR),
        item('Protection from falling objects, and safe work on roofs where applicable.',
          ['Photos', 'Exclusion zone arrangements'], 'SOP-3540 §7.4, 7.5', NC.MAJOR),
        item('Fall rescue plan and inspected rescue equipment.',
          ['Rescue plan', 'Rescue equipment inspection records'], 'SOP-3540 §7.6, 7.7', NC.MAJOR),
        item('Work at height training.',
          ['Training records'], 'SOP-3540 §7.8', NC.MAJOR)
      ],
      consultant: verify('SOP-3540', 'work at height arrangements and rescue plan', 'including harness use and edge protection')
    },
    {
      code: 'SOP-3519', title: 'Mobile plant & equipment', on: { contractor: true, consultant: true },
      contractor: [
        item('Mobile plant register with valid third-party certificates.',
          ['Plant register', 'Third-party certificates'], 'SOP-3519 §8.1', NC.MAJOR),
        item('Operators hold valid certificates for the plant they operate.',
          ['Operator certificates'], 'SOP-3519 §7.2.3, 8.3', NC.MAJOR),
        item('Daily pre-use inspections by operators, checked by a competent person.',
          ['Pre-use checklists'], 'SOP-3519 §7.2.2', NC.EITHER),
        item('Signallers / banksmen appointed and trained.',
          ['Signaller appointments', 'Training records'], 'SOP-3519 §7.2.4', NC.MAJOR)
      ],
      consultant: verify('SOP-3519', 'plant certificates and operator competency', 'including plant condition and exclusion zones')
    },
    {
      code: 'SOP-3518', title: 'Materials handling & storage', on: { contractor: true, consultant: false },
      contractor: [
        item('Mechanical handling equipment certified and operated by competent operators.',
          ['Forklift / handling equipment certificates', 'Operator certificates'], 'SOP-3518 §8.2', NC.MAJOR),
        item('Materials stored safely and stably, with waste material removed.',
          ['Storage area photos', 'Housekeeping inspections'], 'SOP-3518 §8.3, 8.4', NC.MINOR),
        item('Materials handling training.',
          ['Training records'], 'SOP-3518 §8.5', NC.MAJOR)
      ],
      consultant: verify('SOP-3518', 'materials handling arrangements', 'including storage and laydown areas')
    },
    {
      code: 'SOP-3523', title: 'Portable tools & equipment', on: { contractor: true, consultant: false },
      contractor: [
        item('Hand and power tools inspected, tagged and guarded.',
          ['Tool inspection register / colour coding'], 'SOP-3523 §8.2, 8.3', NC.EITHER),
        item('Tool users trained.',
          ['Training records'], 'SOP-3523 §8.4', NC.MAJOR)
      ],
      consultant: verify('SOP-3523', 'tool inspection arrangements', 'including tool condition and guarding')
    },
    {
      code: 'SOP-3517', title: 'Manual handling & lifting', on: { contractor: true, consultant: false },
      contractor: [
        item('Manual handling risk assessed, with mechanical aids provided where the task needs them.',
          ['Manual handling assessments', 'Mechanical aid photos'], 'SOP-3517 §7.1.2', NC.EITHER),
        item('Manual handling training.',
          ['Training records'], 'SOP-3517 §7.3', NC.MAJOR)
      ],
      consultant: verify('SOP-3517', 'manual handling assessments', 'including use of mechanical aids')
    },
    {
      code: 'SOP-3520', title: 'Noise & vibration management', on: { contractor: true, consultant: false },
      contractor: [
        item('Noise and vibration assessed and monitored, with hearing protection zones marked.',
          ['Noise survey / monitoring results', 'Zone signage photos'], 'SOP-3520 §8.2, 8.3 · ADOSH-SF CoP 3.1', NC.MAJOR),
        item('Health surveillance (audiometry) for exposed workers.',
          ['Audiometric test records'], 'SOP-3520 §8.4', NC.MAJOR),
        item('Noise and vibration training.',
          ['Training records'], 'SOP-3520 §8.5', NC.MAJOR)
      ],
      consultant: verify('SOP-3520', 'noise assessment', 'including hearing protection compliance')
    },
    {
      code: 'SOP-3515', title: 'Hazardous substances', on: { contractor: true, consultant: false },
      contractor: [
        item('Chemical register with current safety data sheets at the point of use.',
          ['Chemical register', 'SDS file'], 'SOP-3515 §7.3', NC.MAJOR),
        item('Hazardous materials handled and stored safely, with spill kits available.',
          ['Chemical risk assessments', 'Storage photos', 'Spill kit checks'], 'SOP-3515 §7.4.1, 7.4.2', NC.MAJOR),
        item('Health surveillance where exposure requires it, and training.',
          ['Health surveillance records', 'Training records'], 'SOP-3515 §7.4.3, 7.4.4', NC.MAJOR)
      ],
      consultant: verify('SOP-3515', 'chemical register and SDS', 'including storage and labelling')
    },
    {
      code: 'SOP-3513', title: 'Flammable liquids & gases', on: { contractor: true, consultant: false },
      contractor: [
        item('Flammable liquids and gas cylinders stored correctly, indoors and outdoors.',
          ['Storage area photos', 'Inspection records'], 'SOP-3513 §8.1', NC.MAJOR),
        item('Temporary fuel tanks bunded and inspected; refuelling controlled.',
          ['Fuel tank inspection records', 'Bund photos'], 'SOP-3513 §8.2.1–8.2.3', NC.MAJOR),
        item('Handling training.',
          ['Training records'], 'SOP-3513 §8.4', NC.MAJOR)
      ],
      consultant: verify('SOP-3513', 'flammable storage arrangements', 'including fuel tank bunding')
    },
    {
      code: 'SOP-3506', title: 'Environmental management', on: { contractor: true, consultant: true },
      contractor: [
        item('Environmental permits in place and their conditions complied with.',
          ['Environmental permits / approvals', 'Permit condition compliance log'], 'SOP-3506 §7.1, 7.2', NC.MAJOR),
        item('Air (dust), water (including dewatering discharge), land and noise impacts controlled and monitored.',
          ['Environmental monitoring records', 'Discharge approvals', 'Dust control records'], 'SOP-3506 §7.3–7.6', NC.MAJOR),
        item('Hazardous materials and waste controlled, and spills prevented or cleaned up.',
          ['Spill kits', 'Spill records'], 'SOP-3506 §7.7', NC.MAJOR),
        item('Environmental records maintained.',
          ['Environmental records file'], 'SOP-3506 §8', NC.MINOR)
      ],
      consultant: verify('SOP-3506', 'environmental assessments and permits', 'including dewatering discharge and dust control')
    },
    {
      code: 'SOP-3516', title: 'Waste management', on: { contractor: true, consultant: true },
      contractor: [
        item('Waste classified, segregated and stored correctly.',
          ['Waste management plan', 'Segregation area photos'], 'SOP-3516 §7.5.1–7.5.4', NC.MAJOR),
        item('Waste removed only by transporters licensed by CWM-AD, with a manifest for each load and consignment numbers for hazardous waste.',
          ['Transporter licences', 'Waste manifests', 'Hazardous waste consignment records'], 'SOP-3516 §7.5.5', NC.MAJOR),
        item('Waste generation and disposal records maintained.',
          ['Waste records / tracker'], 'SOP-3516 §7.9', NC.MINOR)
      ],
      consultant: verify('SOP-3516', 'waste management plan and transporter licences', 'including manifests against loads removed')
    },
    {
      code: 'SOP-3505', title: 'Contractor\'s camp & temporary buildings', on: { contractor: true, consultant: false },
      contractor: [
        item('Site offices and camp meet the fire, means-of-escape and emergency requirements.',
          ['Fire safety inspection', 'Escape route photos'], 'SOP-3505 §7.3.5–7.3.7', NC.MAJOR),
        item('Welfare, food hygiene, drinking water and legionella controls in place.',
          ['Hygiene inspections', 'Water tank cleaning records', 'Legionella controls'], 'SOP-3505 §7.3.3, 7.3.4 · ADOSH-SF CoP 18.1', NC.EITHER),
        item('Dangerous goods storage and waste at the camp controlled.',
          ['Storage photos'], 'SOP-3505 §7.3.8, 7.3.9', NC.MINOR)
      ],
      consultant: verify('SOP-3505', 'site facilities', 'including welfare and fire safety')
    },
    {
      code: 'SOP-3524', title: 'Safety signage & signals', on: { contractor: true, consultant: false },
      contractor: [
        item('Safety and fire signs displayed to the standard at entrances and work areas.',
          ['Signage photos'], 'SOP-3524 §8.1–8.3', NC.MINOR),
        item('Workers trained to recognise signs and signals.',
          ['Training records'], 'SOP-3524 §8.4', NC.MINOR)
      ],
      consultant: verify('SOP-3524', 'signage arrangements', 'including signage at work fronts')
    },
    {
      code: 'SOP-3527', title: 'Surveying safety', on: { contractor: true, consultant: false },
      contractor: [
        item('Surveying risk assessed for remote, public and construction-site areas.',
          ['Surveying risk assessment'], 'SOP-3527 §7.3', NC.EITHER),
        item('Surveyors trained.',
          ['Training records'], 'SOP-3527 §7.4', NC.MAJOR)
      ],
      consultant: verify('SOP-3527', 'surveying risk assessment', 'including traffic protection for surveyors')
    },
    {
      code: 'SOP-3537', title: 'Safety observation', on: { contractor: true, consultant: true },
      contractor: [
        item('Safety observations raised on the TAQA WS form, near misses managed, and actions closed.',
          ['Safety Observation Reports SOF-3537-A', 'Near-miss register', 'Closure evidence'], 'SOP-3537 §7.2, 7.3', NC.MINOR)
      ],
      consultant: [
        item('Consultant staff raise safety observations regularly, and near misses are managed through to closure.',
          ['Safety Observation Reports SOF-3537-A', 'Near-miss register'], 'SOP-3537 §7.2–7.4', NC.MINOR)
      ]
    },
    {
      code: 'SOP-3539', title: 'Management of change', on: { contractor: true, consultant: true },
      contractor: [
        item('Changes to methods, design, equipment or organisation assessed, approved and communicated before implementation.',
          ['MOC register', 'Completed MOC forms with risk assessment', 'Communication records'], 'SOP-3539 §7.2–7.4 · TG 15 §10.4.4', NC.MAJOR)
      ],
      consultant: verify('SOP-3539', 'management of change requests', 'that changes are not implemented before approval')
    },
    {
      code: 'SOP-3538', title: 'Site visits', on: { contractor: true, consultant: true },
      contractor: [
        item('Visitors briefed on site hazards at the gate, signed in and out, and escorted at all times.',
          ['Visitor induction / briefing record', 'Sign-in register'], 'SOP-3538 §7.1.5, 7.1.6', NC.MINOR)
      ],
      consultant: [
        item('Office-based staff visiting site review the risk assessment first, wear the required PPE, receive the gate briefing, sign in and out, are escorted, and never work alone.',
          ['Site visit records', 'Sign-in evidence', 'Risk assessment review evidence'], 'SOP-3538 §7.1', NC.MINOR)
      ]
    },

    // ---- specialist SOPs: off by default, switch on where the work exists ----
    {
      code: 'SOP-3502', title: 'Asbestos management (incl. AC pipes)', on: { contractor: false, consultant: false },
      contractor: [
        item('Asbestos-containing materials (including asbestos-cement pipes) identified, risk assessed and recorded in an ACM register.',
          ['Asbestos management plan', 'ACM register', 'Risk assessment'], 'SOP-3502 §7.3 · ADOSH-SF CoP 1.10', NC.MAJOR),
        item('Warning signs, controls, health surveillance and training in place.',
          ['Labels / signs', 'Health surveillance records', 'Training records'], 'SOP-3502 §7.3.5, 7.3.6, 7.4, 7.5', NC.MAJOR)
      ],
      consultant: verify('SOP-3502', 'asbestos management plan and register', 'including ACM handling on site')
    },
    {
      code: 'SOP-3501', title: 'Asbestos removal', on: { contractor: false, consultant: false },
      contractor: [
        item('Specialist asbestos removal contractor and supervising consultant engaged and approved.',
          ['Removal contractor approval', 'Asbestos supervising consultant approval'], 'SOP-3501 §7.2', NC.MAJOR),
        item('Removal method, waste disposal and air testing follow the SOP.',
          ['Removal method statement', 'Waste disposal records', 'Clearance testing'], 'SOP-3501 §7.4', NC.MAJOR),
        item('Health surveillance, emergency plans and training for removal workers.',
          ['Health surveillance', 'Emergency plan', 'Training records'], 'SOP-3501 §7.5–7.7', NC.MAJOR)
      ],
      consultant: verify('SOP-3501', 'asbestos removal plan', 'including enclosure, air testing and waste consignment')
    },
    {
      code: 'SOP-3503', title: 'Concrete pumping', on: { contractor: false, consultant: false },
      contractor: [
        item('Concrete pumping planned; pump certified and set up safely.',
          ['Pumping plan', 'Pump certificates', 'Set-up checks'], 'SOP-3503 §7.3 · ADOSH-SF CoP 38.0', NC.MAJOR),
        item('Pump operators trained.',
          ['Operator certificates'], 'SOP-3503 §7.4', NC.MAJOR)
      ],
      consultant: verify('SOP-3503', 'concrete pumping plan', 'including outrigger set-up and overhead clearance')
    },
    {
      code: 'SOP-3514', title: 'Formwork', on: { contractor: false, consultant: false },
      contractor: [
        item('Formwork designed, erected, used and dismantled safely.',
          ['Formwork design', 'Erection / pre-pour inspections'], 'SOP-3514 §8.2–8.5', NC.MAJOR),
        item('Formwork training.',
          ['Training records'], 'SOP-3514 §8.6', NC.MAJOR)
      ],
      consultant: verify('SOP-3514', 'formwork design', 'including pre-pour inspections')
    },
    {
      code: 'SOP-3525', title: 'Scaffolding, work platforms & ladders', on: { contractor: false, consultant: false },
      contractor: [
        item('Scaffolds designed where required, erected by competent scaffolders, inspected and tagged.',
          ['Scaffold design', 'Scaffolder certificates', 'Scaffold tags / inspection register'], 'SOP-3525 §7.2, 7.3', NC.MAJOR),
        item('Documented safe systems of work and safe dismantling.',
          ['Method statements'], 'SOP-3525 §7.3.5, 7.3.6', NC.MAJOR),
        item('Scaffolding and ladder training.',
          ['Training records'], 'SOP-3525 §7.4', NC.MAJOR)
      ],
      consultant: verify('SOP-3525', 'scaffold designs and scaffolder competency', 'including scaffold tagging')
    },
    {
      code: 'SOP-3522', title: 'Piling operations', on: { contractor: false, consultant: false },
      contractor: [
        item('Piling method, rig certification and protection of open pile shafts.',
          ['Piling method statement', 'Rig certificates', 'Pile shaft protection photos'], 'SOP-3522 §8', NC.MAJOR),
        item('Piling rig operators and signallers trained.',
          ['Operator / signaller certificates'], 'SOP-3522 §7.2.2, 7.2.3, 8.8', NC.MAJOR)
      ],
      consultant: verify('SOP-3522', 'piling method statement', 'including rig stability and exclusion zones')
    },
    {
      code: 'SOP-3526', title: 'Static plant & equipment', on: { contractor: false, consultant: false },
      contractor: [
        item('Static plant guarded, installed by competent installers, and records kept.',
          ['Guarding inspections', 'Installation records', 'Maintenance records'], 'SOP-3526 §7.3', NC.MAJOR),
        item('Static plant training.',
          ['Training records'], 'SOP-3526 §7.4', NC.MAJOR)
      ],
      consultant: verify('SOP-3526', 'static plant installation', 'including machine guarding')
    },
    {
      code: 'SOP-3529', title: 'Tunnelling operations', on: { contractor: false, consultant: false },
      contractor: [
        item('Tunnel emergency response plan and trained emergency response team.',
          ['Tunnel ERP', 'ERT training records'], 'SOP-3529 §8.2, 8.3', NC.MAJOR),
        item('Atmospheric monitoring and fire prevention in the tunnel.',
          ['Gas monitoring records', 'Fire protection arrangements'], 'SOP-3529 §8.4, 8.5', NC.MAJOR),
        item('Tunnelling training.',
          ['Training records'], 'SOP-3529 §8.7', NC.MAJOR)
      ],
      consultant: verify('SOP-3529', 'tunnelling ERP and monitoring plan', 'including atmospheric monitoring')
    },
    {
      code: 'SOP-3533', title: 'Working over or adjacent to water', on: { contractor: false, consultant: false },
      contractor: [
        item('Access platforms, edge protection, buoyancy aids and rescue equipment provided.',
          ['Photos', 'Rescue equipment inspections'], 'SOP-3533 §7.3.4–7.3.10 · ADOSH-SF CoP 31.0', NC.MAJOR),
        item('Training for work over water.',
          ['Training records'], 'SOP-3533 §7.4', NC.MAJOR)
      ],
      consultant: verify('SOP-3533', 'work-over-water arrangements', 'including rescue readiness')
    },
    {
      code: 'SOP-3545', title: 'Local exhaust ventilation', on: { contractor: false, consultant: false },
      contractor: [
        item('LEV systems tested and inspected, with records kept.',
          ['LEV test certificates', 'Inspection records'], 'SOP-3545 §9.1, 9.3', NC.MAJOR)
      ],
      consultant: verify('SOP-3545', 'LEV design', 'including test records')
    },
    {
      code: 'SOP-3547', title: 'Process safety', on: { contractor: false, consultant: false },
      contractor: [
        item('Contractor activities at operational facilities regulated and monitored against process safety requirements.',
          ['Process safety risk assessments', 'Monitoring records'], 'SOP-3547 §9', NC.MAJOR),
        item('Process safety KPIs reported (loss of containment, overdue safety-critical maintenance, overdue actions).',
          ['Process safety KPI returns (TAQA F-019-F Part 3)'], 'SOP-3547 §9.4, 10.6', NC.EITHER)
      ],
      consultant: verify('SOP-3547', 'process safety risk assessments', 'at operational facilities')
    },
    {
      code: 'SOP-3536', title: 'Emergency evacuation — TAQA WS locations', on: { contractor: false, consultant: false },
      contractor: [
        item('Staff working at a TAQA WS location know its evacuation arrangements and assembly points.',
          ['Evacuation briefing records'], 'SOP-3536 §7', NC.MINOR)
      ],
      consultant: [
        item('Staff working at a TAQA WS location know its evacuation arrangements and assembly points.',
          ['Evacuation briefing records'], 'SOP-3536 §7', NC.MINOR)
      ]
    }
  ];

  // ------------------------------------------------------------ assembly ---

  function pick(v, role) {
    if (v && typeof v === 'object' && !Array.isArray(v) && (v.contractor !== undefined || v.consultant !== undefined)) {
      return v[role] !== undefined ? v[role] : (v.contractor !== undefined ? v.contractor : v.consultant);
    }
    return v;
  }

  function resolveItem(it, role) {
    return {
      text: pick(it.text, role),
      evidence: (pick(it.evidence, role) || []).slice(),
      ref: pick(it.ref, role),
      nc: it.nc,
      tip: pick(it.tip, role) || ''
    };
  }

  let seq = 0;
  function uid(prefix) {
    seq++;
    return prefix + '-' + Date.now().toString(36) + '-' + seq.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // Builds the frozen section/item list for a new audit. S/No. are assigned
  // here, once: 1 = readiness, 2.. = ADOSH-SF elements, then one section per
  // selected SOP in the order listed above.
  function build(role, selectedSops) {
    const chosen = new Set(selectedSops || defaultSops(role));
    const sections = [];

    function pushSection(def, items, extra) {
      const no = String(sections.length + 1);
      const list = items.map((it, i) => Object.assign(resolveItem(it, role), {
        id: uid('it'),
        no: no + '.' + (i + 1),
        status: 'pending',
        note: '',
        files: [],
        links: []
      }));
      if (!list.length) return;
      sections.push(Object.assign({
        id: uid('sec'),
        no: no,
        key: def.key || def.code,
        part: def.part,
        title: pick(def.title, role),
        ref: def.ref || '',
        items: list
      }, extra || {}));
    }

    const forRole = (it) => !it.roles || it.roles.indexOf(role) !== -1;

    pushSection(READINESS, READINESS.items.filter(forRole));
    ELEMENTS.forEach((el) => pushSection(el, el.items.filter(forRole)));
    SOPS.forEach((s) => {
      if (!chosen.has(s.code)) return;
      pushSection({ key: s.code, part: 'C', title: s.code + ' — ' + s.title, ref: 'TAQA WS ' + s.code }, s[role] || [], { sop: s.code });
    });
    return sections;
  }

  // Adds an SOP section to an existing audit, numbered after the current last
  // section so existing S/No. — and the evidence folders named after them —
  // never move.
  function sectionForSop(role, code, nextNo) {
    const s = SOPS.find((x) => x.code === code);
    if (!s) return null;
    const no = String(nextNo);
    return {
      id: uid('sec'), no: no, key: s.code, part: 'C', sop: s.code,
      title: s.code + ' — ' + s.title, ref: 'TAQA WS ' + s.code,
      items: (s[role] || []).map((it, i) => Object.assign(resolveItem(it, role), {
        id: uid('it'), no: no + '.' + (i + 1), status: 'pending', note: '', files: [], links: []
      }))
    };
  }

  function defaultSops(role) {
    return SOPS.filter((s) => s.on && s.on[role]).map((s) => s.code);
  }

  function sopCatalogue() {
    return SOPS.map((s) => ({ code: s.code, title: s.title, on: s.on }));
  }

  global.AuditChecklists = {
    ROLES: ROLES, NC: NC,
    build: build, sectionForSop: sectionForSop,
    defaultSops: defaultSops, sopCatalogue: sopCatalogue,
    uid: uid,
    SOURCES: [
      'ADOSH-SF Technical Guideline 15 — ADOSH-SF Audit Non-Conformance (A Guide for Auditors), v4.0, July 2024',
      'TAQA WS Standard Operating Procedures SOP-3501 to SOP-3547 (HSED procedures, Aug 2024 set)',
      'TAQA WS SOP-3546 OHSE Audits on Service Providers, v004, May 2024'
    ]
  };
})(window);
