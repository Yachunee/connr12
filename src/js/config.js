// Static configuration ported from the Postman collection/environment
// (docs/api/collection/R12_PHeRef_Guided_Connectathon_v2.postman_collection.json).
// Values the user may override at runtime live in state.js instead.

export const DEFAULTS = {
  fhirBase: 'https://cdr.pheref.fhirlab.net/fhir',
  txBase: 'https://tx.fhirlab.net/fhir',
  teamCode: 'TEAM01',
  // Who I am. myFacilityId is the Organization that receives my incoming referrals;
  // the NHFR code and name are the seed values used when creating it.
  myFacilityId: '',
  myFacilityName: '',
  referringFacilityNhfr: 'SET-ME-REFERRING-NHFR',
  referringFacilityName: 'R12 Training Referring Facility'
};

// The CDR is shared with every other Connectathon team and carries the server's own
// reference data. Everything this app creates is stamped with a meta.tag in this system
// (the shape ACTIVITY1.json already uses) and every search filters on it, so we never
// list — or silently reuse — somebody else's resources.
export const TEAM_TAG_SYSTEM = 'https://r12-connectathon.example/team';

export const SYSTEMS = {
  nhfr: 'https://fhir.doh.gov.ph/phcore/Identifier/doh-nhfr-code',
  patient: 'https://r12-connectathon.example/identifier/patient',
  practitioner: 'https://r12-connectathon.example/identifier/practitioner',
  practitionerRole: 'https://r12-connectathon.example/identifier/practitioner-role',
  referral: 'https://r12-connectathon.example/identifier/referral',
  condition: 'https://r12-connectathon.example/identifier/condition',
  observation: 'https://r12-connectathon.example/identifier/observation',
  task: 'https://r12-connectathon.example/identifier/task',
  psgc: 'https://psa.gov.ph/classification/psgc',
  snomed: 'http://snomed.info/sct',
  loinc: 'http://loinc.org',
  ucum: 'http://unitsofmeasure.org'
};

export const PROFILES = {
  patient: 'https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-patient',
  condition: 'https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-condition',
  observation: 'https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-observation',
  serviceRequest: 'https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-service-request',
  task: 'https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-task',
  encounter: 'https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-encounter',
  practitionerRole: 'https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-practitioner-role',
  phcorePractitioner: 'https://fhir.doh.gov.ph/phcore/StructureDefinition/ph-core-practitioner',
  phcoreOrganization: 'https://fhir.doh.gov.ph/phcore/StructureDefinition/ph-core-organization'
};

export const VALUESETS = {
  practitionerRole: 'https://www.fhir.doh.gov.ph/pheref/ValueSet/practitioner-role',
  referralCategory: 'https://www.fhir.doh.gov.ph/pheref/ValueSet/referral-category',
  reasonForReferral: 'https://www.fhir.doh.gov.ph/pheref/ValueSet/reason-for-referral-service-type',
  pwdDisabilityType: 'https://fhir.doh.gov.ph/pheref/ValueSet/pwd-disability-type-vs',
  administrativeGender: 'http://hl7.org/fhir/ValueSet/administrative-gender',
  taskStatus: 'http://hl7.org/fhir/ValueSet/task-status',
  contactPointSystem: 'http://hl7.org/fhir/ValueSet/contact-point-system',
  contactPointUse: 'http://hl7.org/fhir/ValueSet/contact-point-use'
};

// PSGC address extension URLs, in the order the collection writes them.
export const PSGC_EXTENSIONS = {
  region: 'https://fhir.doh.gov.ph/phcore/StructureDefinition/region',
  province: 'https://fhir.doh.gov.ph/phcore/StructureDefinition/province',
  cityMunicipality: 'https://fhir.doh.gov.ph/phcore/StructureDefinition/city-municipality',
  barangay: 'https://fhir.doh.gov.ph/phcore/StructureDefinition/barangay'
};

// Offline fallback for the PSGC selects. The terminology server is queried first;
// these are the exact values the collection hardcodes for the Region XII training case.
export const PSGC_FALLBACK = {
  region: [{ code: '1200000000', display: 'Region XII (SOCCSKSARGEN)' }],
  province: [{ code: '1206300000', display: 'South Cotabato' }],
  cityMunicipality: [{ code: '1206306000', display: 'City of Koronadal' }],
  barangay: [{ code: '1206306001', display: 'Assumption' }]
};

export const GENDERS = ['female', 'male', 'other', 'unknown'];

export const TASK_FLOW = ['requested', 'received', 'accepted', 'completed'];
