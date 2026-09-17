// Everything a Patient resource states, rendered once and shared by the Patients view and
// the Referrals view. Fields that the CDR does not hold are dropped rather than shown as
// '—', so the card is a readable mirror of the stored resource.

import * as wf from './workflow.js';
import { PSGC_EXTENSIONS, SYSTEMS } from './config.js';
import {
  el,
  replace,
  kvList,
  jsonView,
  humanName,
  shortDate,
  spinner,
  table,
  statusPill,
  errorBox
} from './ui.js';

/** Whole years at `on` (default today), or '' when there is no birth date. */
export function ageFrom(birthDate, on = new Date()) {
  if (!birthDate) return '';
  const born = new Date(birthDate);
  if (Number.isNaN(born.getTime())) return '';
  let years = on.getFullYear() - born.getFullYear();
  const monthDelta = on.getMonth() - born.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && on.getDate() < born.getDate())) years -= 1;
  return years >= 0 ? `${years} yr` : '';
}

/** The four PSGC `valueCoding` extensions carried on an address. */
export function psgcFromAddress(address) {
  const exts = address?.extension || [];
  const at = (url) => exts.find((e) => e.url === url)?.valueCoding;
  return {
    region: at(PSGC_EXTENSIONS.region),
    province: at(PSGC_EXTENSIONS.province),
    cityMunicipality: at(PSGC_EXTENSIONS.cityMunicipality),
    barangay: at(PSGC_EXTENSIONS.barangay)
  };
}

/** PSGC codings off the patient's first address — what the edit form round-trips. */
export function psgcFromResource(resource) {
  return psgcFromAddress(resource?.address?.[0]);
}

/** One readable line for a single Address, PSGC place names included. */
export function addressText(address) {
  if (!address) return '';
  const psgc = psgcFromAddress(address);
  const place = [psgc.barangay, psgc.cityMunicipality, psgc.province, psgc.region]
    .map((c) => c?.display)
    .filter(Boolean)
    .join(', ');
  const parts = [
    address.line?.join(', '),
    place,
    // Only fall back to the plain string fields when no PSGC coding supplied them.
    place ? '' : [address.district, address.city, address.state].filter(Boolean).join(', '),
    address.postalCode,
    address.country
  ].filter(Boolean);
  const label = [address.use, address.type].filter(Boolean).join('/');
  return `${parts.join(' · ')}${label ? ` (${label})` : ''}`;
}

/** 'https://…/identifier/patient' -> 'Patient number'. Users read words, not URLs. */
function systemLabel(system) {
  if (!system) return 'Identifier';
  const known = {
    [SYSTEMS.patient]: 'Training patient number',
    [SYSTEMS.nhfr]: 'DOH facility code',
    [SYSTEMS.practitioner]: 'Practitioner number',
    [SYSTEMS.referral]: 'Referral number'
  };
  if (known[system]) return known[system];
  const slug = system.split(/[/#]/).filter(Boolean).pop() || system;
  const words = slug.replace(/[-_]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Every identifier the resource carries, labelled by what it is rather than by its URL. */
export function identifierList(resource) {
  return (resource?.identifier || []).map(
    (i) => `${i.value || '—'} — ${systemLabel(i.system)}${i.use ? ` (${i.use})` : ''}`
  );
}

function nameText(name) {
  if (!name) return '';
  const full =
    name.text ||
    [name.prefix?.join(' '), name.given?.join(' '), name.family, name.suffix?.join(' ')]
      .filter(Boolean)
      .join(' ');
  return `${full}${name.use ? ` (${name.use})` : ''}${periodText(name.period) ? ` · ${periodText(name.period)}` : ''}`;
}

function telecomText(t) {
  if (!t?.value) return '';
  return `${t.value}${t.use ? ` (${t.use})` : ''}${t.system ? ` — ${t.system}` : ''}`;
}

function codeText(concept) {
  if (!concept) return '';
  return concept.text || concept.coding?.[0]?.display || concept.coding?.[0]?.code || '';
}

function periodText(period) {
  if (!period) return '';
  return [period.start, period.end].filter(Boolean).join(' → ');
}

/**
 * A reference as words. `display` is used when the server sent one; otherwise the linked
 * resource is read and its name swapped in, so the card never shows `Organization/24729`.
 */
function refNode(reference) {
  if (!reference?.reference && !reference?.display) return '';
  if (reference.display) return reference.display;
  const node = el('span', { text: 'Loading…' });
  wf.labelFor(reference.reference)
    .then((label) => {
      node.textContent = label || 'Not available';
    })
    .catch(() => {
      node.textContent = 'Not available';
    });
  return node;
}

/** Emergency contacts / related persons stated inline on the Patient. */
function contactLines(resource) {
  return (resource?.contact || []).map((c) =>
    [
      (c.relationship || []).map(codeText).filter(Boolean).join(', '),
      nameText(c.name),
      (c.telecom || []).map(telecomText).filter(Boolean).join(' · '),
      addressText(c.address),
      c.gender,
      c.organization?.display || '',
      periodText(c.period)
    ]
      .filter(Boolean)
      .join(' — ')
  );
}

/** `value[x]` of a simple extension; nested ones fall back to the raw JSON view. */
function extensionValue(ext) {
  const key = Object.keys(ext || {}).find((k) => k.startsWith('value'));
  if (!key) return '';
  const value = ext[key];
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);
  if (value.coding || value.text) return codeText(value) || '';
  if (value.reference) return value.display || '';
  if (value.code || value.display) return value.display || value.code;
  if (value.value !== undefined) return `${value.value}${value.unit ? ` ${value.unit}` : ''}`;
  return '';
}

/**
 * The narrative is XHTML from the server, so it is parsed inert and stripped of scripts
 * and event handlers before it goes anywhere near the live document.
 */
function narrativeNode(div) {
  const doc = new DOMParser().parseFromString(div, 'text/html');
  doc.body.querySelectorAll('script, style, iframe, object, embed, link').forEach((n) => n.remove());
  doc.body.querySelectorAll('*').forEach((n) => {
    [...n.attributes].forEach((a) => {
      if (a.name.startsWith('on') || /^javascript:/i.test(a.value.trim())) n.removeAttribute(a.name);
    });
  });
  const host = el('div', { class: 'narrative' });
  host.append(...doc.body.childNodes);
  return host;
}

function photoNodes(resource) {
  return (resource?.photo || []).map((p) => {
    const label = [p.title, p.contentType, p.creation].filter(Boolean).join(' · ');
    if (p.data && p.contentType) {
      return el('figure', { class: 'photo' }, [
        el('img', { src: `data:${p.contentType};base64,${p.data}`, alt: p.title || 'Patient photo' }),
        label ? el('figcaption', { class: 'muted', text: label }) : null
      ]);
    }
    return p.url ? `${p.url}${label ? ` · ${label}` : ''}` : label;
  });
}

/**
 * Vital-signs observations for a patient. Renders a spinner and swaps itself when the
 * search returns, so a slow CDR does not hold up the page around it.
 */
export function vitalsCard(patientId) {
  const heading = () => el('h2', { text: 'Vital signs' });
  const host = el('section', { class: 'card' }, [
    heading(),
    spinner('Loading vital-signs observations…')
  ]);

  wf.vitalSigns(patientId)
    .then((observations) => {
      const rows = observations.flatMap(wf.vitalRows);
      replace(
        host,
        heading(),
        el('p', {
          class: 'muted',
          text: `${observations.length} vital-signs observation(s) on file for this patient.`
        }),
        table(
          [
            { key: 'label', label: 'Measurement' },
            { key: 'value', label: 'Value' },
            { key: 'panel', label: 'Panel' },
            { key: 'status', label: 'Status', render: (r) => statusPill(r.status) },
            { key: 'when', label: 'Taken', render: (r) => shortDate(r.when) }
          ],
          rows,
          { emptyText: 'No vital-signs observations recorded for this patient.' }
        ),
        observations.length ? jsonView(observations, 'Raw Observations') : null
      );
    })
    .catch((err) => replace(host, heading(), errorBox(err)));

  return host;
}

/** Gender · birth date · age — everything but the name, for a page that shows it already. */
export function patientSubline(patient) {
  if (!patient) return '';
  return [patient.gender, patient.birthDate, ageFrom(patient.birthDate)].filter(Boolean).join(' · ');
}

/** Name · gender · birth date — the one-line label for a table cell. */
export function patientLine(patient) {
  if (!patient) return '';
  const name = humanName(patient);
  return [name === '(no name)' ? '' : name, patientSubline(patient)].filter(Boolean).join(' · ');
}

/**
 * Definition list of everything the Patient resource states, plus its narrative and
 * extensions. `opts.title` renames the card heading for the referral view.
 */
export function demographics(resource, opts = {}) {
  const deceased = resource?.deceasedDateTime
    ? `Yes — ${resource.deceasedDateTime}`
    : resource?.deceasedBoolean === true
      ? 'Yes'
      : '';
  const multipleBirth =
    resource?.multipleBirthInteger !== undefined
      ? `Yes — ${resource.multipleBirthInteger}`
      : resource?.multipleBirthBoolean === true
        ? 'Yes'
        : resource?.multipleBirthBoolean === false
          ? 'No'
          : '';

  const entries = [
    ['Full name', humanName(resource)],
    ['Names', (resource?.name || []).map(nameText)],
    ['Gender', resource?.gender],
    ['Birth date', [resource?.birthDate, ageFrom(resource?.birthDate)].filter(Boolean).join(' · ')],
    ['Active', resource?.active === false ? 'No' : 'Yes'],
    ['Deceased', deceased],
    ['Multiple birth', multipleBirth],
    ['Marital status', codeText(resource?.maritalStatus)],
    ['Identifiers', identifierList(resource)],
    ['Contact', (resource?.telecom || []).map(telecomText)],
    ['Address', (resource?.address || []).map(addressText)],
    ['Emergency contacts', contactLines(resource)],
    [
      'Language',
      (resource?.communication || []).map((c) =>
        `${codeText(c.language)}${c.preferred ? ' (preferred)' : ''}`
      )
    ],
    ['Managing facility', refNode(resource?.managingOrganization)],
    ['General practitioner', (resource?.generalPractitioner || []).map(refNode)],
    ['Linked records', (resource?.link || []).map((l) => l.other?.display || l.type || '')],
    ['Photo', photoNodes(resource)],
    // The IG profile and team tag say where the record came from; show their names, not URLs.
    ['Follows', (resource?.meta?.profile || []).map(systemLabel)],
    ['Team', (resource?.meta?.tag || []).map((t) => t.display || t.code)],
    ['Confidentiality', (resource?.meta?.security || []).map((s) => s.display || s.code)],
    ['Record version', resource?.meta?.versionId],
    ['Last updated', resource?.meta?.lastUpdated ? shortDate(resource.meta.lastUpdated) : '']
  ];

  // Anything profile-specific the IG adds (PWD type, indigenous group, …) lives in
  // extensions; label what can be read flat and keep the raw JSON for the rest.
  const extensions = resource?.extension || [];
  const extensionRows = extensions.map((e) => [systemLabel(e.url), extensionValue(e)]);

  const narrative = resource?.text?.div
    ? el('details', { class: 'json' }, [
        el('summary', { text: `Narrative (${resource.text.status || 'generated'})` }),
        narrativeNode(resource.text.div)
      ])
    : null;

  return el('section', { class: 'card' }, [
    el('h2', { text: opts.title || 'Demographics' }),
    kvList(entries),
    extensionRows.length
      ? el('div', {}, [el('h3', { text: 'Extensions' }), kvList(extensionRows)])
      : null,
    extensions.length ? jsonView(extensions, `${extensions.length} extension(s), raw`) : null,
    narrative
  ]);
}
