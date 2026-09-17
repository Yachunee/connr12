// FHIR resource builders. Each one mirrors a request body in
// docs/api/collection/R12_PHeRef_Guided_Connectathon_v2.postman_collection.json,
// with `{{variables}}` replaced by arguments.

import {
  SYSTEMS,
  PROFILES,
  PSGC_EXTENSIONS,
  PSGC_FALLBACK,
  PSGC_VERSION,
  TEAM_TAG_SYSTEM
} from './config.js';
import { state, now, uuidv4 } from './state.js';

const pick = (v, fallback) => (v === undefined || v === '' ? fallback : v);

/**
 * `meta` for everything this app creates: the IG profile plus a team tag.
 * The tag is what every search filters on, so the shared CDR's reference data and the
 * other teams' resources stay out of our lists — omitting it here silently breaks that.
 */
function teamMeta(profile) {
  const teamCode = state.get('teamCode');
  return {
    profile: [profile],
    tag: [{ system: TEAM_TAG_SYSTEM, code: teamCode, display: `Team ${teamCode}` }]
  };
}

function addressExtensions(a = {}) {
  const parts = [
    ['region', a.region],
    ['province', a.province],
    ['cityMunicipality', a.cityMunicipality],
    ['barangay', a.barangay]
  ];
  return parts
    .map(([key, coding]) => {
      // `null` means the caller deliberately has no code for this level (a highly
      // urbanised city has no province); only `undefined` falls back to the training chain.
      const c = coding === null ? null : coding || PSGC_FALLBACK[key][0];
      if (!c || !c.code) return null;
      return {
        url: PSGC_EXTENSIONS[key],
        valueCoding: {
          system: SYSTEMS.psgc,
          // Which PSGC edition the code came from — codes are reused across editions.
          version: c.version || PSGC_VERSION,
          code: c.code,
          display: c.display
        }
      };
    })
    .filter(Boolean);
}

function telecom(form) {
  const out = [];
  if (form.phone) out.push({ system: 'phone', value: form.phone, use: form.phoneUse || 'mobile' });
  if (form.email) out.push({ system: 'email', value: form.email });
  return out;
}

/** Collection 03B.01 — Create Patient */
export function patient(form = {}) {
  const s = state.all;
  const res = {
    resourceType: 'Patient',
    meta: teamMeta(PROFILES.patient),
    identifier: [
      {
        system: SYSTEMS.patient,
        value: pick(form.identifierValue, `${s.teamCode}-PATIENT-${s.runId}`)
      }
    ],
    active: form.active !== false,
    name: [
      {
        use: 'official',
        family: pick(form.family, 'Santos'),
        given: String(pick(form.given, 'Maria Test')).trim().split(/\s+/)
      }
    ],
    telecom: telecom(form),
    gender: pick(form.gender, 'female'),
    birthDate: pick(form.birthDate, '1988-03-12'),
    address: [
      {
        extension: addressExtensions(form.address),
        use: 'home',
        line: [pick(form.addressLine, 'R12 Connectathon Training Address')],
        postalCode: pick(form.postalCode, '9506'),
        country: 'PH'
      }
    ]
  };
  if (!res.telecom.length) delete res.telecom;
  return res;
}

/** Collection 03B.03 — Create Organization.
 *  Only facilities we own are ever created here; referral destinations are picked from
 *  the ones already on the server. */
export function organization(form = {}) {
  const s = state.all;
  return {
    resourceType: 'Organization',
    meta: teamMeta(PROFILES.phcoreOrganization),
    identifier: [{ system: SYSTEMS.nhfr, value: pick(form.nhfr, s.referringFacilityNhfr) }],
    active: form.active !== false,
    name: pick(form.name, s.referringFacilityName),
    telecom: [{ system: 'phone', value: pick(form.phone, '+639000000001'), use: 'work' }]
  };
}

/** Collection 03B.02 — Create Practitioner */
export function practitioner(form = {}) {
  const s = state.all;
  return {
    resourceType: 'Practitioner',
    meta: teamMeta(PROFILES.phcorePractitioner),
    identifier: [
      { system: SYSTEMS.practitioner, value: pick(form.identifierValue, `${s.teamCode}-REFERRER`) }
    ],
    active: form.active !== false,
    name: [
      {
        use: 'official',
        family: pick(form.family, 'Demo'),
        given: String(pick(form.given, 'Rosa')).trim().split(/\s+/),
        prefix: [pick(form.prefix, 'Dr.')]
      }
    ]
  };
}

/** Collection 03B.05 — Create PractitionerRole */
export function practitionerRole(form = {}) {
  const s = state.all;
  return {
    resourceType: 'PractitionerRole',
    meta: teamMeta(PROFILES.practitionerRole),
    identifier: [
      {
        system: SYSTEMS.practitionerRole,
        value: pick(form.identifierValue, `${s.teamCode}-REFERRER-ROLE`)
      }
    ],
    active: form.active !== false,
    practitioner: { reference: `Practitioner/${pick(form.practitionerId, s.refPractitionerId)}` },
    organization: { reference: `Organization/${pick(form.organizationId, s.myFacilityId)}` },
    code: [
      {
        coding: [
          {
            system: SYSTEMS.snomed,
            code: pick(form.roleCode, '158965000'),
            display: pick(form.roleDisplay, 'Medical practitioner')
          }
        ]
      }
    ]
  };
}

/** Collection 03B.06 — Create Condition */
export function condition(form = {}) {
  const s = state.all;
  return {
    resourceType: 'Condition',
    meta: teamMeta(PROFILES.condition),
    identifier: [
      {
        system: SYSTEMS.condition,
        value: pick(form.identifierValue, `${s.teamCode}-CONDITION-${s.runId}`)
      }
    ],
    clinicalStatus: {
      coding: [
        { system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }
      ]
    },
    verificationStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
          code: 'provisional',
          display: 'Provisional'
        }
      ]
    },
    category: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/condition-category',
            code: 'encounter-diagnosis',
            display: 'Encounter Diagnosis'
          }
        ]
      }
    ],
    code: {
      coding: [
        {
          system: SYSTEMS.snomed,
          code: pick(form.code, '398254007'),
          display: pick(form.display, 'Pre-eclampsia')
        }
      ],
      text: pick(form.text, 'Severe pre-eclampsia requiring urgent referral')
    },
    subject: { reference: `Patient/${pick(form.patientId, s.patientId)}` },
    note: [{ text: pick(form.note, '32 weeks AOG with severe headache and visual symptoms.') }]
  };
}

/** Collection 03B.07 — Create BP Observation */
export function bpObservation(form = {}) {
  const s = state.all;
  const component = (code, display, value) => ({
    code: { coding: [{ system: SYSTEMS.loinc, code, display }] },
    valueQuantity: { value, unit: 'mmHg', system: SYSTEMS.ucum, code: 'mm[Hg]' }
  });
  return {
    resourceType: 'Observation',
    meta: teamMeta(PROFILES.observation),
    identifier: [
      {
        system: SYSTEMS.observation,
        value: pick(form.identifierValue, `${s.teamCode}-BP-${s.runId}`)
      }
    ],
    status: 'final',
    category: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
            code: 'vital-signs',
            display: 'Vital Signs'
          }
        ]
      }
    ],
    code: {
      coding: [
        {
          system: SYSTEMS.loinc,
          code: '85354-9',
          display: 'Blood pressure panel with all children optional'
        }
      ]
    },
    subject: { reference: `Patient/${pick(form.patientId, s.patientId)}` },
    effectiveDateTime: now(),
    component: [
      component('8480-6', 'Systolic blood pressure', Number(pick(form.systolic, 180))),
      component('8462-4', 'Diastolic blood pressure', Number(pick(form.diastolic, 110)))
    ]
  };
}

/** Collection 03B.08 — Create ServiceRequest */
export function serviceRequest(form = {}) {
  const s = state.all;
  const requisition = pick(form.requisition, `R12-${s.teamCode}-${s.runId}`);
  const ts = now();
  return {
    resourceType: 'ServiceRequest',
    meta: teamMeta(PROFILES.serviceRequest),
    identifier: [{ system: SYSTEMS.referral, value: requisition }],
    requisition: { system: SYSTEMS.referral, value: requisition },
    status: pick(form.status, 'active'),
    intent: 'order',
    priority: pick(form.priority, 'urgent'),
    category: [
      {
        coding: [
          {
            system: SYSTEMS.snomed,
            code: pick(form.categoryCode, '73770003'),
            display: pick(
              form.categoryDisplay,
              'Hospital-based outpatient emergency care center'
            )
          }
        ],
        text: pick(form.categoryText, 'Emergency')
      }
    ],
    subject: { reference: `Patient/${pick(form.patientId, s.patientId)}` },
    occurrenceDateTime: ts,
    authoredOn: ts,
    requester: { reference: `PractitionerRole/${pick(form.roleId, s.refRoleId)}` },
    performer: [{ reference: `Organization/${pick(form.receivingOrgId, s.destinationOrgId)}` }],
    reasonCode: [
      {
        coding: [
          {
            system: SYSTEMS.snomed,
            code: pick(form.reasonCode, '71388002'),
            display: pick(form.reasonDisplay, 'Procedure')
          }
        ],
        text: pick(form.reasonText, 'Urgent referral for management')
      }
    ],
    reasonReference: [{ reference: `Condition/${pick(form.conditionId, s.conditionId)}` }],
    supportingInfo: [
      { reference: `Observation/${pick(form.observationId, s.bpObservationId)}` }
    ],
    note: [
      {
        text: pick(
          form.note,
          'IG-inspired lightweight training case: BP 180/110 mmHg with severe pre-eclampsia.'
        )
      }
    ]
  };
}

/** Collection 03B.09 — Create Task */
export function task(form = {}) {
  const s = state.all;
  const ts = now();
  return {
    resourceType: 'Task',
    meta: teamMeta(PROFILES.task),
    identifier: [
      { system: SYSTEMS.task, value: pick(form.identifierValue, `${s.teamCode}-TASK-${s.runId}`) }
    ],
    status: pick(form.status, 'requested'),
    intent: 'order',
    code: {
      coding: [{ system: SYSTEMS.snomed, code: '3457005', display: 'Patient referral' }],
      text: 'R12 Connectathon eReferral'
    },
    focus: { reference: `ServiceRequest/${pick(form.serviceRequestId, s.serviceRequestId)}` },
    for: { reference: `Patient/${pick(form.patientId, s.patientId)}` },
    authoredOn: ts,
    lastModified: ts,
    requester: { reference: `PractitionerRole/${pick(form.roleId, s.refRoleId)}` },
    note: [
      { text: pick(form.note, 'Referral sent. Awaiting receiving-facility acknowledgement.') }
    ]
  };
}

/** Collection 07.01 — Create Receiving Encounter */
export function encounter(form = {}) {
  const s = state.all;
  const ts = now();
  return {
    resourceType: 'Encounter',
    meta: teamMeta(PROFILES.encounter),
    status: 'finished',
    class: {
      system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
      code: 'AMB',
      display: 'ambulatory'
    },
    subject: { reference: `Patient/${pick(form.patientId, s.patientId)}` },
    basedOn: [
      { reference: `ServiceRequest/${pick(form.serviceRequestId, s.serviceRequestId)}` }
    ],
    period: { start: ts, end: ts },
    // The completion Encounter happens at the facility doing the completing — us.
    serviceProvider: {
      reference: `Organization/${pick(form.receivingOrgId, s.myFacilityId)}`
    }
    // The collection body carries a `note`, but R4 Encounter has no such element
    // and the CDR rejects it with 422 "Unrecognized property 'note'".
  };
}

/** Collection 04.01 — the whole referral as one transaction Bundle.
 *  Conditional PUTs make it idempotent, exactly as the lab does. */
export function referralBundle(form = {}) {
  const s = state.all;
  const uuid = {
    patient: `urn:uuid:${uuidv4()}`,
    pract: `urn:uuid:${uuidv4()}`,
    refOrg: `urn:uuid:${uuidv4()}`,
    role: `urn:uuid:${uuidv4()}`,
    condition: `urn:uuid:${uuidv4()}`,
    bp: `urn:uuid:${uuidv4()}`,
    serviceRequest: `urn:uuid:${uuidv4()}`,
    task: `urn:uuid:${uuidv4()}`
  };

  const p = patient(form.patient);
  const pr = practitioner(form.practitioner);
  const refOrg = organization(form.referringOrg);
  const role = practitionerRole(form.role);
  const cond = condition(form.condition);
  const bp = bpObservation(form.observation);
  const sr = serviceRequest(form.serviceRequest);
  const tk = task(form.task);

  // Inside a transaction, references point at the bundle-local urn:uuid entries.
  role.practitioner = { reference: uuid.pract };
  role.organization = { reference: uuid.refOrg };
  cond.subject = { reference: uuid.patient };
  bp.subject = { reference: uuid.patient };
  sr.subject = { reference: uuid.patient };
  sr.requester = { reference: uuid.role };
  // The destination already exists on the server and usually belongs to another team, so
  // it is referenced by logical ID rather than created as a bundle entry.
  sr.performer = [
    { reference: `Organization/${form.serviceRequest?.receivingOrgId || s.destinationOrgId}` }
  ];
  sr.reasonReference = [{ reference: uuid.condition }];
  sr.supportingInfo = [{ reference: uuid.bp }];
  tk.focus = { reference: uuid.serviceRequest };
  tk.for = { reference: uuid.patient };
  tk.requester = { reference: uuid.role };

  // Each entry is a conditional PUT, which the server rejects with
  // "HAPI-2207: Multiple resources match this search" if the criteria hit more than one
  // resource. The placeholder NHFR codes are shared across teams on this CDR, so the
  // match URL carries the team tag for the same reason every search does.
  const teamTag = `${TEAM_TAG_SYSTEM}|${s.teamCode}`;
  const cond5 = (type, system, value) => ({
    method: 'PUT',
    url: `${type}?identifier=${system}|${value}&_tag=${teamTag}`
  });

  return {
    resourceType: 'Bundle',
    type: 'transaction',
    timestamp: now(),
    entry: [
      {
        fullUrl: uuid.patient,
        resource: p,
        request: cond5('Patient', SYSTEMS.patient, p.identifier[0].value)
      },
      {
        fullUrl: uuid.pract,
        resource: pr,
        request: cond5('Practitioner', SYSTEMS.practitioner, pr.identifier[0].value)
      },
      {
        fullUrl: uuid.refOrg,
        resource: refOrg,
        request: cond5('Organization', SYSTEMS.nhfr, refOrg.identifier[0].value)
      },
      {
        fullUrl: uuid.role,
        resource: role,
        request: cond5('PractitionerRole', SYSTEMS.practitionerRole, role.identifier[0].value)
      },
      {
        fullUrl: uuid.condition,
        resource: cond,
        request: cond5('Condition', SYSTEMS.condition, cond.identifier[0].value)
      },
      {
        fullUrl: uuid.bp,
        resource: bp,
        request: cond5('Observation', SYSTEMS.observation, bp.identifier[0].value)
      },
      {
        fullUrl: uuid.serviceRequest,
        resource: sr,
        request: cond5('ServiceRequest', SYSTEMS.referral, sr.identifier[0].value)
      },
      {
        fullUrl: uuid.task,
        resource: tk,
        request: cond5('Task', SYSTEMS.task, tk.identifier[0].value)
      }
    ]
  };
}

// ---- JSON Patch op arrays (collection folders 06 and 07) ----

/** 06.01 — Task requested -> received.
 *  The owner becomes the facility taking the referral on: us. */
export function receiveTaskOps({ receivingOrgId, receivingFacilityName } = {}) {
  const s = state.all;
  return [
    { op: 'replace', path: '/status', value: 'received' },
    { op: 'replace', path: '/lastModified', value: now() },
    {
      op: 'add',
      path: '/owner',
      value: {
        reference: `Organization/${receivingOrgId || s.myFacilityId}`,
        display: receivingFacilityName || s.myFacilityName
      }
    },
    {
      op: 'add',
      path: '/note/-',
      value: { text: 'Referral received by the receiving facility. Pending review.' }
    }
  ];
}

/** 06.02 — Task received -> accepted */
export function acceptTaskOps() {
  return [
    { op: 'replace', path: '/status', value: 'accepted' },
    { op: 'replace', path: '/lastModified', value: now() },
    {
      op: 'add',
      path: '/note/-',
      value: { text: 'Referral accepted for urgent evaluation and management.' }
    }
  ];
}

/** 07.02 — Task accepted -> completed, with the encounter as output */
export function completeTaskOps(encounterId) {
  return [
    { op: 'replace', path: '/status', value: 'completed' },
    { op: 'replace', path: '/lastModified', value: now() },
    {
      op: 'add',
      path: '/output',
      value: [
        {
          type: { text: 'Referral completion encounter' },
          valueReference: { reference: `Encounter/${encounterId}` }
        }
      ]
    },
    {
      op: 'add',
      path: '/note/-',
      value: { text: 'Referral completed; receiving encounter recorded.' }
    }
  ];
}

/** 07.03 — ServiceRequest -> completed */
export function completeServiceRequestOps() {
  return [{ op: 'replace', path: '/status', value: 'completed' }];
}
