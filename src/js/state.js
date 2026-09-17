// localStorage-backed session state. Mirrors the Postman collection variables:
// the connection settings, the per-run `runId`, and the logical IDs captured
// as each resource is created.

import { DEFAULTS } from './config.js';

const KEY = 'connr12.state';

// myFacilityId is identity, not run data: it survives clearIds() so the inbox keeps
// working across runs. Everything below it is created fresh each run.
const BLANK_IDS = {
  patientId: '',
  refPractitionerId: '',
  // Where the current referral is being sent. Unlike myFacilityId this is per-referral,
  // and it usually points at an Organization another team owns.
  destinationOrgId: '',
  refRoleId: '',
  conditionId: '',
  bpObservationId: '',
  serviceRequestId: '',
  taskId: '',
  receivingEncounterId: ''
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...BLANK_IDS, ...JSON.parse(raw) };
  } catch {
    // Corrupt or unavailable storage: fall through to defaults.
  }
  return { ...DEFAULTS, ...BLANK_IDS, runId: String(Date.now()) };
}

const data = load();
if (!data.runId) data.runId = String(Date.now());

const listeners = new Set();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Private mode / blocked storage: the app still works, just not across reloads.
  }
  listeners.forEach((fn) => fn(data));
}

export const state = {
  get all() {
    return { ...data };
  },
  get(key) {
    return data[key];
  },
  set(key, value) {
    data[key] = value;
    persist();
  },
  merge(patch) {
    Object.assign(data, patch);
    persist();
  },
  clearIds() {
    Object.assign(data, BLANK_IDS);
    data.runId = String(Date.now());
    persist();
  },
  resetAll() {
    Object.assign(data, DEFAULTS, BLANK_IDS, { runId: String(Date.now()) });
    persist();
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
};

export const ID_KEYS = Object.keys(BLANK_IDS);

/** Current instant in the format the collection's `{{now}}` produces. */
export function now() {
  return new Date().toISOString();
}

/** Same generator as the collection pre-request script. */
export function uuidv4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
