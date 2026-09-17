// The only network layer in the app.
//
// The CDR answers CORS preflight with `Access-Control-Allow-Headers: content-type`
// only, so `Prefer: return=representation` must never be sent — it would fail
// preflight. Callers that need the stored resource after a PATCH/PUT re-read it.

import { state } from './state.js';
import { TEAM_TAG_SYSTEM } from './config.js';

const FHIR_JSON = 'application/fhir+json';
const PATCH_JSON = 'application/json-patch+json';

/** Error carrying the parsed OperationOutcome so views can show real FHIR messages. */
export class FhirError extends Error {
  constructor(message, { status, outcome, url, method } = {}) {
    super(message);
    this.name = 'FhirError';
    this.status = status;
    this.outcome = outcome;
    this.url = url;
    this.method = method;
  }
}

// Rolling log of traffic, surfaced in the request/response panes.
const log = [];
const logListeners = new Set();

export function getLog() {
  return log.slice();
}

export function onLog(fn) {
  logListeners.add(fn);
  return () => logListeners.delete(fn);
}

function record(entry) {
  log.unshift(entry);
  if (log.length > 60) log.length = 60;
  logListeners.forEach((fn) => fn(entry));
}

function outcomeText(outcome) {
  if (!outcome || outcome.resourceType !== 'OperationOutcome') return '';
  return (outcome.issue || [])
    .map((i) => i.diagnostics || i.details?.text || `${i.severity}: ${i.code}`)
    .join(' | ');
}

function buildUrl(base, path, query) {
  const url = new URL(
    path ? `${base.replace(/\/$/, '')}/${String(path).replace(/^\//, '')}` : base
  );
  Object.entries(query || {}).forEach(([k, v]) => {
    // An array value repeats the parameter, which is how FHIR takes several _include values.
    if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item));
    else if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  return url.toString();
}

/**
 * @param {string} method
 * @param {string} path  resource path, e.g. 'Patient/123'. Empty string = the base URL.
 * @param {{body?: any, query?: object, base?: string, patch?: boolean, label?: string}} opts
 */
export async function request(method, path, opts = {}) {
  const base = opts.base || state.get('fhirBase');
  const url = buildUrl(base, path, opts.query);
  const headers = { Accept: FHIR_JSON };
  let payload;

  if (opts.body !== undefined) {
    headers['Content-Type'] = opts.patch ? PATCH_JSON : FHIR_JSON;
    payload = JSON.stringify(opts.body);
  }

  const entry = {
    at: new Date().toISOString(),
    label: opts.label || `${method} ${path || '(base)'}`,
    method,
    url,
    request: opts.body,
    status: null,
    response: null,
    error: null
  };

  let res;
  try {
    res = await fetch(url, { method, headers, body: payload });
  } catch (cause) {
    entry.error = `Network or CORS failure: ${cause.message}`;
    record(entry);
    throw new FhirError(entry.error, { url, method });
  }

  entry.status = res.status;
  entry.location = res.headers.get('Location') || res.headers.get('Content-Location') || null;
  entry.etag = res.headers.get('ETag') || null;

  const text = await res.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text.slice(0, 2000) };
    }
  }
  entry.response = parsed;

  if (!res.ok) {
    const detail = outcomeText(parsed) || res.statusText || 'Request failed';
    entry.error = `${res.status} — ${detail}`;
    record(entry);
    throw new FhirError(`${res.status} ${res.statusText}: ${detail}`, {
      status: res.status,
      outcome: parsed,
      url,
      method
    });
  }

  record(entry);
  return { resource: parsed, location: entry.location, status: res.status, etag: entry.etag };
}

/** Pull the logical ID out of a `Location` header like `.../Patient/42/_history/1`. */
export function idFromLocation(location, type) {
  if (!location) return '';
  const m = new RegExp(`${type}/([^/?]+)`).exec(location);
  return m ? m[1] : '';
}

export async function capability(base) {
  const { resource } = await request('GET', 'metadata', {
    base,
    label: 'CapabilityStatement'
  });
  return resource;
}

/** The `_tag` filter that limits a search to resources this team created. */
export function teamTagToken() {
  return `${TEAM_TAG_SYSTEM}|${state.get('teamCode')}`;
}

/**
 * Scoped search. Every search in the app goes through here, so the `_tag` filter is
 * applied in one place. Pass `{includeAll: true}` only for the list views' explicit
 * "include all server data" opt-out.
 */
export async function search(type, params = {}, { includeAll = false } = {}) {
  const query = { ...params };
  if (!includeAll) query._tag = teamTagToken();
  const { resource } = await request('GET', type, {
    query,
    label: `Search ${type}${includeAll ? ' (all server data)' : ''}`
  });
  return resource;
}

/** Flatten a searchset Bundle to its resources. */
export function entries(bundle) {
  return (bundle?.entry || []).map((e) => e.resource).filter(Boolean);
}

export async function read(type, id) {
  const { resource } = await request('GET', `${type}/${id}`, { label: `Read ${type}/${id}` });
  return resource;
}

/** POST a new resource. Returns `{resource, id}` — the id comes from Location when
 *  the server answers 201 with no body. */
export async function create(type, body) {
  const out = await request('POST', type, { body, label: `Create ${type}` });
  const id = out.resource?.id || idFromLocation(out.location, type);
  return { resource: out.resource, id };
}

export async function update(type, id, body) {
  const out = await request('PUT', `${type}/${id}`, {
    body: { ...body, id },
    label: `Update ${type}/${id}`
  });
  return out.resource || read(type, id);
}

/** JSON Patch. The server may return the updated resource, but we never rely on it
 *  (`Prefer` is blocked), so callers should re-read. */
export async function patch(type, id, ops, label) {
  await request('PATCH', `${type}/${id}`, {
    body: ops,
    patch: true,
    label: label || `Patch ${type}/${id}`
  });
  return read(type, id);
}

export async function remove(type, id) {
  await request('DELETE', `${type}/${id}`, { label: `Delete ${type}/${id}` });
}

/**
 * `Patient/{id}/$everything` — the whole patient compartment in one Bundle.
 * Not every CDR implements it, so callers are expected to catch and fall back to
 * per-type compartment searches (see workflow.patientEverything).
 */
export async function everything(id, params = {}) {
  const { resource } = await request('GET', `Patient/${id}/$everything`, {
    query: { _count: 200, ...params },
    label: `Everything for Patient/${id}`
  });
  return resource;
}

/** POST a transaction/batch Bundle to the server root (collection request 04.01). */
export async function transaction(bundle) {
  const { resource } = await request('POST', '', {
    body: bundle,
    label: 'Transaction Bundle'
  });
  return resource;
}

/** `$validate` against a profile (collection folder 03). Returns the OperationOutcome. */
export async function validate(type, body, profile) {
  try {
    const { resource } = await request('POST', `${type}/$validate`, {
      body,
      query: { profile },
      label: `Validate ${type}`
    });
    return resource;
  } catch (err) {
    if (err instanceof FhirError && err.outcome) return err.outcome;
    throw err;
  }
}

/** ValueSet `$expand` on the terminology server (collection folder 02). */
export async function expand(valueSetUrl) {
  const { resource } = await request('GET', 'ValueSet/$expand', {
    base: state.get('txBase'),
    query: { url: valueSetUrl },
    label: `Expand ${valueSetUrl}`
  });
  return resource?.expansion?.contains || [];
}

/** CodeSystem `$lookup`, used for the PSGC selects (collection 02.11-02.13). */
export async function lookup(system, code, property) {
  const { resource } = await request('GET', 'CodeSystem/$lookup', {
    base: state.get('txBase'),
    query: { system, code, property },
    label: `Lookup ${code}`
  });
  return resource;
}

/** True when an OperationOutcome has at least one error/fatal issue. */
export function hasErrors(outcome) {
  return (outcome?.issue || []).some((i) => i.severity === 'error' || i.severity === 'fatal');
}
