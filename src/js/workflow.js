// Referral workflow steps shared by the Referrals view and the guided demo.
// Each helper performs one collection request and records the resulting logical
// ID in state, so both entry points stay in sync.

import * as fhir from './fhir.js';
import * as tpl from './templates.js';
import { SYSTEMS, PROFILES } from './config.js';
import { state } from './state.js';

/**
 * Options for the referral form's pickers: our own patients, requester roles and
 * receiving facilities, labelled by name rather than by logical ID.
 *
 * Roles come back with their Practitioner and Organization `_include`d, so one search
 * yields the full "Dr. Rosa Demo — R12 Training Referring Facility" label.
 */
export async function referralOptions() {
  const [patientBundle, roleBundle] = await Promise.all([
    fhir.search('Patient', { _count: 50, _sort: '-_lastUpdated' }),
    fhir.search('PractitionerRole', {
      _count: 50,
      _include: ['PractitionerRole:practitioner', 'PractitionerRole:organization']
    })
  ]);

  const included = fhir.entries(roleBundle);
  const byRef = new Map(included.map((r) => [`${r.resourceType}/${r.id}`, r]));
  const nameOf = (resource) => {
    const n = resource?.name?.[0];
    if (!n) return resource?.name || '';
    return [n.prefix?.join(' '), n.given?.join(' '), n.family].filter(Boolean).join(' ');
  };

  return {
    patients: fhir.entries(patientBundle).map((p) => ({
      value: p.id,
      label: `${nameOf(p) || '(unnamed)'}${p.birthDate ? ` · ${p.birthDate}` : ''}`
    })),
    roles: included
      .filter((r) => r.resourceType === 'PractitionerRole')
      .map((r) => {
        const pract = byRef.get(r.practitioner?.reference);
        const org = byRef.get(r.organization?.reference);
        const who = nameOf(pract) || r.practitioner?.reference || '(unknown practitioner)';
        return { value: r.id, label: org?.name ? `${who} — ${org.name}` : who };
      })
    // Destination facilities are not listed here: they come from searchFacilities(),
    // which covers the whole server rather than just our own.
  };
}

/** Find an existing resource by identifier, or create it. Returns {id, created}.
 *  The search is team-scoped (see fhir.search), which is what stops us adopting another
 *  team's Organization when both use the same placeholder NHFR code. */
export async function ensure(type, system, value, buildResource) {
  const bundle = await fhir.search(type, { identifier: `${system}|${value}` });
  const [existing] = fhir.entries(bundle);
  if (existing) return { id: existing.id, resource: existing, created: false };
  const { id, resource } = await fhir.create(type, buildResource());
  return { id, resource, created: true };
}

/**
 * Steps 03B.03 / 03B.02 / 03B.05 — my own side of a referral: my facility, my
 * practitioner and their role. The destination facility is *not* created here; it already
 * exists on the server and belongs to somebody else.
 */
export async function ensureSetup(form = {}) {
  const s = state.all;

  const mine = await ensure('Organization', SYSTEMS.nhfr, s.referringFacilityNhfr, () =>
    tpl.organization(form.referringOrg)
  );
  state.merge({ myFacilityId: mine.id, myFacilityName: mine.resource?.name || s.referringFacilityName });

  const practValue = `${s.teamCode}-REFERRER`;
  const pract = await ensure('Practitioner', SYSTEMS.practitioner, practValue, () =>
    tpl.practitioner({ ...form.practitioner, identifierValue: practValue })
  );
  state.set('refPractitionerId', pract.id);

  const roleValue = `${s.teamCode}-REFERRER-ROLE`;
  const role = await ensure('PractitionerRole', SYSTEMS.practitionerRole, roleValue, () =>
    tpl.practitionerRole({
      identifierValue: roleValue,
      practitionerId: pract.id,
      organizationId: mine.id
    })
  );
  state.set('refRoleId', role.id);

  return { myFacility: mine, practitioner: pract, role };
}

/**
 * Facilities to refer *to*. Deliberately unscoped: the point is to reach the other teams'
 * facilities, so this searches the whole server. A bare NHFR-looking string is treated as
 * an identifier, anything else as a name.
 */
export async function searchFacilities(text = '') {
  const term = text.trim();
  const params = { _count: 20, _sort: 'name' };
  if (term) {
    // Only treat it as an identifier when it looks like a code rather than a word:
    // no spaces, and containing a digit or a hyphen. "Davao" is a name; "NHFR-12-CHO-01"
    // and "275" are codes.
    const looksLikeCode = !/\s/.test(term) && /[\d-]/.test(term);
    if (looksLikeCode) params.identifier = term;
    else params.name = term;
  }
  const bundle = await fhir.search('Organization', params, { includeAll: true });
  return fhir.entries(bundle);
}

/** Referrals sent *to* my facility, by anyone. Unscoped — other teams created them. */
export async function incomingReferrals(myFacilityId, params = {}) {
  return fhir.search(
    'ServiceRequest',
    { performer: `Organization/${myFacilityId}`, _count: 20, _sort: '-_lastUpdated', ...params },
    { includeAll: true }
  );
}

/** Steps 03B.06 -> 03B.09, run one at a time so each response is visible. */
export async function createReferralStepwise(form = {}, { validate = false, onStep } = {}) {
  const report = (label, payload) => onStep?.(label, payload);

  const condition = tpl.condition(form.condition);
  if (validate) {
    const outcome = await fhir.validate('Condition', condition, PROFILES.condition);
    report('Validate Condition', outcome);
    if (fhir.hasErrors(outcome)) throw new fhir.FhirError('Condition failed profile validation', { outcome });
  }
  const c = await fhir.create('Condition', condition);
  state.set('conditionId', c.id);
  report('Condition created', { id: c.id, resource: condition });

  const observation = tpl.bpObservation(form.observation);
  const o = await fhir.create('Observation', observation);
  state.set('bpObservationId', o.id);
  report('BP Observation created', { id: o.id, resource: observation });

  const sr = tpl.serviceRequest({ ...form.serviceRequest, conditionId: c.id, observationId: o.id });
  if (validate) {
    const outcome = await fhir.validate('ServiceRequest', sr, PROFILES.serviceRequest);
    report('Validate ServiceRequest', outcome);
    if (fhir.hasErrors(outcome))
      throw new fhir.FhirError('ServiceRequest failed profile validation', { outcome });
  }
  const srOut = await fhir.create('ServiceRequest', sr);
  state.set('serviceRequestId', srOut.id);
  report('ServiceRequest created', { id: srOut.id, resource: sr });

  const tk = tpl.task({ ...form.task, serviceRequestId: srOut.id });
  if (validate) {
    const outcome = await fhir.validate('Task', tk, PROFILES.task);
    report('Validate Task', outcome);
    if (fhir.hasErrors(outcome)) throw new fhir.FhirError('Task failed profile validation', { outcome });
  }
  const tkOut = await fhir.create('Task', tk);
  state.set('taskId', tkOut.id);
  report('Task created', { id: tkOut.id, resource: tk });

  return { serviceRequestId: srOut.id, taskId: tkOut.id };
}

/** Collection 04.01 — everything in one transaction. */
export async function createReferralBundle(form = {}, { onStep } = {}) {
  const bundle = tpl.referralBundle(form);
  onStep?.('Transaction request', bundle);
  const result = await fhir.transaction(bundle);
  onStep?.('Transaction response', result);

  // Map each entry's response.location back onto the state keys.
  const targets = [
    ['Patient', 'patientId'],
    ['Practitioner', 'refPractitionerId'],
    ['PractitionerRole', 'refRoleId'],
    ['Condition', 'conditionId'],
    ['Observation', 'bpObservationId'],
    ['ServiceRequest', 'serviceRequestId'],
    ['Task', 'taskId']
  ];
  const locations = (result?.entry || []).map((e) => e.response?.location || '');

  targets.forEach(([type, key]) => {
    const hit = locations.find((l) => l.startsWith(`${type}/`));
    if (hit) state.set(key, fhir.idFromLocation(hit, type));
  });

  // The only Organization the bundle creates is my own facility; the destination was
  // referenced by ID, so it has no entry here.
  const org = locations.find((l) => l.startsWith('Organization/'));
  if (org) state.set('myFacilityId', fhir.idFromLocation(org, 'Organization'));

  return {
    serviceRequestId: state.get('serviceRequestId'),
    taskId: state.get('taskId'),
    bundle: result
  };
}

/** Collection 06.01 — requested -> received. */
export async function receiveTask(taskId) {
  return fhir.patch('Task', taskId, tpl.receiveTaskOps(), 'RECEIVE Task (06.01)');
}

/** Collection 06.02 — received -> accepted. */
export async function acceptTask(taskId) {
  return fhir.patch('Task', taskId, tpl.acceptTaskOps(), 'ACCEPT Task (06.02)');
}

/** Collection 07.01 -> 07.03 — encounter, then close both Task and ServiceRequest. */
export async function completeReferral(taskId, serviceRequestId, { onStep } = {}) {
  const enc = await fhir.create('Encounter', tpl.encounter({ serviceRequestId }));
  state.set('receivingEncounterId', enc.id);
  onStep?.('Receiving Encounter created (07.01)', { id: enc.id });

  const task = await fhir.patch(
    'Task',
    taskId,
    tpl.completeTaskOps(enc.id),
    'COMPLETE Task (07.02)'
  );
  const serviceRequest = await fhir.patch(
    'ServiceRequest',
    serviceRequestId,
    tpl.completeServiceRequestOps(),
    'COMPLETE ServiceRequest (07.03)'
  );
  return { encounterId: enc.id, task, serviceRequest };
}

/**
 * Delete a referral and everything that points at it, dependents first.
 * The server refuses to delete a resource another one references, so the Encounter
 * created on completion (Encounter.basedOn) and the tracking Task (Task.focus) have to go
 * first — otherwise the ServiceRequest delete fails with a 409 and leaves the Task gone.
 */
export async function deleteReferral(serviceRequestId, task) {
  // Unscoped on purpose: this asks "what points at *this* resource", not "what belongs to
  // my team". A tag filter here would hide a blocking reference and leave a half-deleted
  // referral behind — which is exactly what happens when the team code no longer matches
  // the one the referral was created under.
  const encounters = fhir.entries(
    await fhir.search(
      'Encounter',
      { 'based-on': `ServiceRequest/${serviceRequestId}` },
      { includeAll: true }
    )
  );
  for (const enc of encounters) await fhir.remove('Encounter', enc.id);

  const tracking = task || (await taskForServiceRequest(serviceRequestId));
  if (tracking) await fhir.remove('Task', tracking.id);

  await fhir.remove('ServiceRequest', serviceRequestId);
  return { encounters: encounters.length, task: Boolean(tracking) };
}

/** Collection 05.04 — the Task that tracks a given ServiceRequest.
 *  Unscoped: it resolves one named referral's Task, so the current team code is
 *  irrelevant — scoping it would make an existing referral look Task-less. */
export async function taskForServiceRequest(serviceRequestId) {
  const bundle = await fhir.search(
    'Task',
    { focus: `ServiceRequest/${serviceRequestId}` },
    { includeAll: true }
  );
  return fhir.entries(bundle)[0] || null;
}

// ---- patient record ----

/** Resource types searched when $everything is unavailable, in the order they are shown. */
const COMPARTMENT_TYPES = [
  'Encounter',
  'Condition',
  'Observation',
  'ServiceRequest',
  'Task',
  'Procedure',
  'AllergyIntolerance',
  'MedicationRequest',
  'Immunization',
  'DiagnosticReport',
  'DocumentReference'
];

/**
 * Everything the CDR holds for one patient.
 *
 * `$everything` is the one call that gets it all, but it is an optional operation and the
 * Connectathon CDR may answer 404/501, so a failure falls back to one compartment search
 * per type. The fallback is deliberately unscoped (`includeAll`): a patient's clinical
 * record may include resources another team wrote, and hiding those would misrepresent
 * the chart.
 *
 * Returns `{groups, total, source, partial}` where `groups` is
 * `[{type, resources}]` in COMPARTMENT_TYPES order and `partial` lists the types whose
 * search failed, so the view can say so instead of implying the chart is empty.
 */
export async function patientEverything(patientId) {
  try {
    const bundle = await fhir.everything(patientId);
    const resources = fhir.entries(bundle).filter((r) => r.resourceType !== 'Patient');
    return { ...group(resources), source: '$everything', partial: [] };
  } catch {
    const partial = [];
    const settled = await Promise.all(
      COMPARTMENT_TYPES.map(async (type) => {
        try {
          const bundle = await fhir.search(
            type,
            { patient: `Patient/${patientId}`, _count: 100, _sort: '-_lastUpdated' },
            { includeAll: true }
          );
          return fhir.entries(bundle);
        } catch {
          // A type the server does not support answers 404 — that is not a chart error.
          partial.push(type);
          return [];
        }
      })
    );
    return { ...group(settled.flat()), source: 'compartment search', partial };
  }
}

function group(resources) {
  const byType = new Map();
  resources.forEach((r) => {
    if (!byType.has(r.resourceType)) byType.set(r.resourceType, []);
    byType.get(r.resourceType).push(r);
  });
  const known = COMPARTMENT_TYPES.filter((t) => byType.has(t));
  const extra = [...byType.keys()].filter((t) => !COMPARTMENT_TYPES.includes(t)).sort();
  return {
    groups: [...known, ...extra].map((type) => ({ type, resources: byType.get(type) })),
    total: resources.length
  };
}

/** Vital-signs Observations for a patient, newest first. Unscoped for the same reason
 *  as the compartment sweep above. */
export async function vitalSigns(patientId) {
  const bundle = await fhir.search(
    'Observation',
    {
      patient: `Patient/${patientId}`,
      category: 'vital-signs',
      _count: 100,
      _sort: '-date'
    },
    { includeAll: true }
  );
  return fhir.entries(bundle);
}

/**
 * Flatten one Observation to display rows. A panel such as the blood-pressure
 * Observation built by templates.bpObservation carries its numbers in `component`, so it
 * yields one row per component; a simple Observation yields a single row.
 */
export function vitalRows(observation) {
  const when = observation.effectiveDateTime || observation.effectivePeriod?.start || observation.issued;
  const base = {
    id: observation.id,
    status: observation.status,
    when,
    panel: codeText(observation.code)
  };
  const parts = observation.component?.length
    ? observation.component.map((c) => ({
        ...base,
        label: codeText(c.code),
        value: quantityText(c)
      }))
    : [{ ...base, label: codeText(observation.code), value: quantityText(observation) }];
  return parts;
}

function codeText(concept) {
  return concept?.text || concept?.coding?.[0]?.display || concept?.coding?.[0]?.code || '—';
}

/** Render whichever value[x] the Observation actually used. */
function quantityText(node) {
  if (node?.valueQuantity) {
    const q = node.valueQuantity;
    return `${q.value ?? ''} ${q.unit || q.code || ''}`.trim();
  }
  if (node?.valueCodeableConcept) return codeText(node.valueCodeableConcept);
  if (node?.valueString) return node.valueString;
  if (typeof node?.valueBoolean === 'boolean') return String(node.valueBoolean);
  if (typeof node?.valueInteger === 'number') return String(node.valueInteger);
  if (node?.dataAbsentReason) return `(${codeText(node.dataAbsentReason)})`;
  return '—';
}
