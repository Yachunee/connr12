// The PSGC address hierarchy behind the patient address selects.
//
// The terminology server publishes Region XII down to barangay as a CodeSystem fragment
// (`psgc-r12-mini`, version 2Q-2026). It is fetched once per session and turned into a
// tree, so the four selects offer every place the server knows rather than the single
// hardcoded chain the Postman collection uses. When the server is unreachable, the
// hardcoded chain is still there as a fallback so the form keeps working offline.

import * as fhir from './fhir.js';
import { SYSTEMS, PSGC_VERSION, PSGC_FALLBACK } from './config.js';

/** `level` property values, mapped to the select each concept belongs in. */
const STEP_OF_LEVEL = {
  region: 'region',
  province: 'province',
  // A highly urbanised city (General Santos) hangs off the region, where a province
  // normally sits, so it is offered in the province select and again as its own city.
  city: 'cityMunicipality',
  municipality: 'cityMunicipality',
  barangay: 'barangay'
};

let pending = null;

function levelOf(concept) {
  return (
    concept.property?.find((p) => p.code === 'level')?.valueCode ||
    concept.property?.find((p) => p.code === 'level')?.valueString ||
    ''
  );
}

/** Flatten the nested CodeSystem concepts into `{code, display, level, children}` nodes. */
function toTree(codeSystem) {
  const byCode = new Map();
  const roots = [];

  const walk = (concepts, parent) => {
    (concepts || []).forEach((c) => {
      const node = {
        code: c.code,
        display: c.display || c.code,
        level: levelOf(c),
        parent: parent?.code || '',
        children: []
      };
      byCode.set(node.code, node);
      (parent ? parent.children : roots).push(node);
      walk(c.concept, node);
    });
  };
  walk(codeSystem?.concept, null);

  return {
    byCode,
    roots,
    version: codeSystem?.version || PSGC_VERSION,
    source: 'terminology server'
  };
}

/** The Postman collection's single chain, shaped like a server tree. */
function fallbackTree() {
  const chain = [
    { ...PSGC_FALLBACK.region[0], level: 'region' },
    { ...PSGC_FALLBACK.province[0], level: 'province' },
    { ...PSGC_FALLBACK.cityMunicipality[0], level: 'city' },
    { ...PSGC_FALLBACK.barangay[0], level: 'barangay' }
  ];
  const byCode = new Map();
  let parent = null;
  const roots = [];
  chain.forEach((c) => {
    const node = { ...c, parent: parent?.code || '', children: [] };
    byCode.set(node.code, node);
    (parent ? parent.children : roots).push(node);
    parent = node;
  });
  return { byCode, roots, version: PSGC_VERSION, source: 'offline fallback' };
}

/**
 * The PSGC tree for this session. Fetched once; a failure resolves to the offline chain
 * rather than rejecting, because a patient form must stay usable without terminology.
 */
export function loadPsgc() {
  if (!pending) {
    pending = fhir
      .codeSystem(SYSTEMS.psgc, PSGC_VERSION)
      .then((cs) => (cs?.concept?.length ? toTree(cs) : fallbackTree()))
      .catch(() => fallbackTree());
  }
  return pending;
}

export function nodeOf(tree, code) {
  return code ? tree?.byCode.get(code) || null : null;
}

const childrenAtStep = (node, step) =>
  (node?.children || []).filter((c) => STEP_OF_LEVEL[c.level] === step);

/**
 * Options for the four selects, given whatever is chosen so far. Each level lists the
 * children of the level above, so picking Sarangani cannot leave a Koronadal barangay
 * selected underneath it.
 */
export function psgcOptions(tree, selection = {}) {
  const region = (tree?.roots || []).filter((n) => n.level === 'region');
  const regionNode = nodeOf(tree, selection.region) || region[0] || null;

  // Provinces, plus any city sitting directly under the region.
  const province = [
    ...childrenAtStep(regionNode, 'province'),
    ...childrenAtStep(regionNode, 'cityMunicipality')
  ];
  const provinceNode = nodeOf(tree, selection.province) || province[0] || null;

  // A highly urbanised city is its own city entry; a real province lists its cities.
  const cityMunicipality =
    provinceNode && STEP_OF_LEVEL[provinceNode.level] === 'cityMunicipality'
      ? [provinceNode]
      : childrenAtStep(provinceNode, 'cityMunicipality');
  const cityNode = nodeOf(tree, selection.cityMunicipality) || cityMunicipality[0] || null;

  const barangay = childrenAtStep(cityNode, 'barangay');

  return { region, province, cityMunicipality, barangay };
}

/**
 * What a new patient form starts on: the training chain the collection uses (Koronadal,
 * Assumption) when the tree still has it, otherwise the first chain there is.
 */
export function defaultSelection(tree) {
  return resolveSelection(tree, {
    region: PSGC_FALLBACK.region[0].code,
    province: PSGC_FALLBACK.province[0].code,
    cityMunicipality: PSGC_FALLBACK.cityMunicipality[0].code,
    barangay: PSGC_FALLBACK.barangay[0].code
  });
}

/**
 * Narrow a selection to what the tree actually allows, keeping every choice that is still
 * reachable and falling back to the first option below the point where it stops matching.
 */
export function resolveSelection(tree, wanted = {}) {
  const selection = {};
  ['region', 'province', 'cityMunicipality', 'barangay'].forEach((step) => {
    const options = psgcOptions(tree, selection)[step];
    const keep = options.find((o) => o.code === wanted[step]);
    selection[step] = (keep || options[0])?.code || '';
  });
  return selection;
}

/** The `valueCoding` written into the address extension, version included. */
export function codingFor(tree, code) {
  const node = nodeOf(tree, code);
  if (!node) return null;
  return { system: SYSTEMS.psgc, version: tree.version, code: node.code, display: node.display };
}

/**
 * `{region, province, cityMunicipality, barangay}` codings for a whole selection.
 *
 * A highly urbanised city sits in the province select but is not a province: writing it
 * into the province extension fails the phcore Provinces binding, so that extension is
 * left out and the city is stated once, as a city.
 */
export function codingsFor(tree, selection = {}) {
  const provinceNode = nodeOf(tree, selection.province);
  const provinceIsCity = STEP_OF_LEVEL[provinceNode?.level] === 'cityMunicipality';
  return {
    region: codingFor(tree, selection.region),
    province: provinceIsCity ? null : codingFor(tree, selection.province),
    cityMunicipality: codingFor(tree, selection.cityMunicipality),
    barangay: codingFor(tree, selection.barangay)
  };
}
