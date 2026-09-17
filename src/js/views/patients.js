import * as fhir from '../fhir.js';
import * as tpl from '../templates.js';
import * as wf from '../workflow.js';
import { SYSTEMS, PROFILES, GENDERS, PSGC_FALLBACK, PSGC_EXTENSIONS } from '../config.js';
import { state } from '../state.js';
import { go } from '../router.js';
import {
  el,
  replace,
  scopeToggle,
  scopeWarning,
  pageHeader,
  link,
  button,
  spinner,
  table,
  empty,
  statusPill,
  form,
  setBusy,
  toast,
  errorBox,
  jsonView,
  humanName,
  identifierOf,
  shortDate,
  confirmDialog
} from '../ui.js';

// ---- list ----

export const list = {
  async render(outlet) {
    outlet.append(
      pageHeader('Patients', 'Search the CDR and register new patients (collection 01.01, 03B.01).', [
        link('Register patient', '#/patients/new', { variant: 'primary' })
      ])
    );

    const searchBar = el('form', { class: 'searchbar' }, [
      el('input', { type: 'search', name: 'name', placeholder: 'Name contains…', 'aria-label': 'Name' }),
      el('input', {
        type: 'search',
        name: 'identifier',
        placeholder: 'Identifier value…',
        'aria-label': 'Identifier'
      }),
      button('Search', { type: 'submit', variant: 'primary' }),
      button('Reset', {
        onClick: () => {
          searchBar.reset();
          load({});
        }
      })
    ]);
    const scope = scopeToggle(() => load(Object.fromEntries(new FormData(searchBar))));
    outlet.append(searchBar, scope);

    const results = el('section', { class: 'card' });
    outlet.append(results);

    searchBar.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(searchBar));
      load(data);
    });

    async function load(filters) {
      results.replaceChildren(spinner('Searching patients…'));
      const params = { _count: 20, _sort: '-_lastUpdated' };
      if (filters.name) params.name = filters.name;
      if (filters.identifier) params.identifier = filters.identifier;
      try {
        const bundle = await fhir.search('Patient', params, { includeAll: scope.checked });
        const rows = fhir.entries(bundle);
        replace(
          results,
          scope.checked ? scopeWarning() : null,
          el('p', { class: 'muted', text: `${bundle.total ?? rows.length} match(es)` }),
          table(
            [
              { key: 'name', label: 'Name', render: humanName },
              { key: 'gender', label: 'Gender' },
              { key: 'birthDate', label: 'Birth date' },
              {
                key: 'identifier',
                label: 'Training ID',
                render: (r) => el('code', { text: identifierOf(r, SYSTEMS.patient) || '—' })
              },
              { key: 'id', label: 'Logical ID', render: (r) => el('code', { text: r.id }) },
              {
                key: 'updated',
                label: 'Updated',
                render: (r) => shortDate(r.meta?.lastUpdated)
              },
              {
                key: 'actions',
                label: '',
                render: (r) => link('Open', `#/patients/${r.id}`)
              }
            ],
            rows,
            {
              emptyText: scope.checked
                ? 'No patients matched.'
                : 'No patients your team created. Tick the box above to see the whole shared server.'
            }
          )
        );
      } catch (err) {
        results.replaceChildren(errorBox(err));
      }
    }

    load({});
  }
};

// ---- PSGC selects ----

function psgcFields(address = {}) {
  const opt = (key) =>
    PSGC_FALLBACK[key].map((c) => ({ value: c.code, label: `${c.display} (${c.code})` }));
  return [
    { type: 'section', label: 'Address (PSGC)' },
    {
      name: 'psgcRegion',
      label: 'Region',
      type: 'select',
      options: opt('region'),
      value: address.region?.code
    },
    {
      name: 'psgcProvince',
      label: 'Province',
      type: 'select',
      options: opt('province'),
      value: address.province?.code
    },
    {
      name: 'psgcCity',
      label: 'City / Municipality',
      type: 'select',
      options: opt('cityMunicipality'),
      value: address.cityMunicipality?.code
    },
    {
      name: 'psgcBarangay',
      label: 'Barangay',
      type: 'select',
      options: opt('barangay'),
      value: address.barangay?.code,
      hint: 'Verified against the terminology server with CodeSystem/$lookup (02.13).'
    }
  ];
}

function readPsgc(data) {
  const find = (key, code) =>
    PSGC_FALLBACK[key].find((c) => c.code === code) || PSGC_FALLBACK[key][0];
  return {
    region: find('region', data.psgcRegion),
    province: find('province', data.psgcProvince),
    cityMunicipality: find('cityMunicipality', data.psgcCity),
    barangay: find('barangay', data.psgcBarangay)
  };
}

function psgcFromResource(resource) {
  const exts = resource?.address?.[0]?.extension || [];
  const at = (url) => exts.find((e) => e.url === url)?.valueCoding;
  return {
    region: at(PSGC_EXTENSIONS.region),
    province: at(PSGC_EXTENSIONS.province),
    cityMunicipality: at(PSGC_EXTENSIONS.cityMunicipality),
    barangay: at(PSGC_EXTENSIONS.barangay)
  };
}

function patientFields(resource) {
  const name = resource?.name?.[0] || {};
  const phone = resource?.telecom?.find((t) => t.system === 'phone')?.value;
  const email = resource?.telecom?.find((t) => t.system === 'email')?.value;
  const address = resource?.address?.[0] || {};
  const s = state.all;
  return [
    { type: 'section', label: 'Identity' },
    {
      name: 'identifierValue',
      label: 'Training identifier',
      value: identifierOf(resource, SYSTEMS.patient) || `${s.teamCode}-PATIENT-${s.runId}`,
      required: true,
      hint: SYSTEMS.patient
    },
    { name: 'family', label: 'Family name', value: name.family ?? 'Santos', required: true },
    { name: 'given', label: 'Given name(s)', value: (name.given || ['Maria', 'Test']).join(' '), required: true },
    { name: 'gender', label: 'Gender', type: 'select', options: GENDERS, value: resource?.gender ?? 'female' },
    { name: 'birthDate', label: 'Birth date', type: 'date', value: resource?.birthDate ?? '1988-03-12' },
    { name: 'active', label: 'Active', type: 'checkbox', value: resource ? resource.active !== false : true },
    { type: 'section', label: 'Contact' },
    { name: 'phone', label: 'Mobile', value: phone ?? '+639000000000' },
    { name: 'email', label: 'Email', type: 'email', value: email ?? '' },
    ...psgcFields(psgcFromResource(resource)),
    {
      name: 'addressLine',
      label: 'Street address',
      value: address.line?.[0] ?? 'R12 Connectathon Training Address',
      span: 'full'
    },
    { name: 'postalCode', label: 'Postal code', value: address.postalCode ?? '9506' }
  ];
}

function toResource(data) {
  return tpl.patient({ ...data, address: readPsgc(data) });
}

// ---- demographics summary ----

/** Whole years at `on` (default today), or '' when there is no birth date. */
function ageFrom(birthDate, on = new Date()) {
  if (!birthDate) return '';
  const born = new Date(birthDate);
  if (Number.isNaN(born.getTime())) return '';
  let years = on.getFullYear() - born.getFullYear();
  const monthDelta = on.getMonth() - born.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && on.getDate() < born.getDate())) years -= 1;
  return years >= 0 ? `${years} yr` : '';
}

function addressText(resource) {
  const a = resource?.address?.[0];
  if (!a) return '';
  const psgc = psgcFromResource(resource);
  const place = [psgc.barangay, psgc.cityMunicipality, psgc.province, psgc.region]
    .map((c) => c?.display)
    .filter(Boolean)
    .join(', ');
  return [a.line?.join(', '), place, a.postalCode, a.country].filter(Boolean).join(' · ');
}

/** Every identifier the resource carries, not just the training one. */
function identifierList(resource) {
  return (resource?.identifier || []).map((i) =>
    `${i.value || '—'}${i.system ? ` (${i.system})` : ''}`
  );
}

/**
 * Definition list of everything the Patient resource states. Empty fields are dropped
 * rather than shown as '—', so the card reflects what the CDR actually holds.
 */
function demographics(resource) {
  const name = resource?.name?.[0] || {};
  const contacts = (resource?.telecom || []).map(
    (t) => `${t.value}${t.use ? ` (${t.use})` : ''} — ${t.system}`
  );
  const deceased = resource?.deceasedDateTime
    ? `Yes — ${resource.deceasedDateTime}`
    : resource?.deceasedBoolean === true
      ? 'Yes'
      : '';

  const entries = [
    ['Full name', humanName(resource)],
    ['Name use', name.use],
    ['Gender', resource?.gender],
    ['Birth date', [resource?.birthDate, ageFrom(resource?.birthDate)].filter(Boolean).join(' · ')],
    ['Active', resource?.active === false ? 'No' : 'Yes'],
    ['Deceased', deceased],
    ['Marital status', resource?.maritalStatus?.text || resource?.maritalStatus?.coding?.[0]?.display],
    ['Identifiers', identifierList(resource)],
    ['Contact', contacts],
    ['Address', addressText(resource)],
    ['Language', (resource?.communication || []).map((c) => c.language?.text || c.language?.coding?.[0]?.display)],
    ['Managing organization', resource?.managingOrganization?.reference],
    ['General practitioner', (resource?.generalPractitioner || []).map((g) => g.reference)],
    ['Profile', resource?.meta?.profile || []],
    ['Team tag', (resource?.meta?.tag || []).map((t) => t.code)],
    ['Last updated', shortDate(resource?.meta?.lastUpdated)]
  ];

  const rows = entries
    .map(([label, value]) => [label, Array.isArray(value) ? value.filter(Boolean) : value])
    .filter(([, value]) => (Array.isArray(value) ? value.length : Boolean(value)));

  const dl = el('dl', { class: 'kv' });
  rows.forEach(([label, value]) => {
    dl.append(
      el('dt', { text: label }),
      el(
        'dd',
        {},
        Array.isArray(value)
          ? value.map((v) => el('div', { text: v }))
          : [document.createTextNode(value)]
      )
    );
  });

  // Anything profile-specific the IG adds (PWD type, indigenous group, …) lives in
  // extensions; list them raw rather than silently dropping them.
  const extensions = resource?.extension || [];
  return el('section', { class: 'card' }, [
    el('h2', { text: 'Demographics' }),
    dl,
    extensions.length ? jsonView(extensions, `${extensions.length} extension(s)`) : null
  ]);
}

// ---- vital signs + full record ----

function vitalsCard(patientId) {
  const host = el('section', { class: 'card' }, [
    el('h2', { text: 'Vital signs' }),
    spinner('Loading vital-signs observations…')
  ]);

  wf.vitalSigns(patientId)
    .then((observations) => {
      const rows = observations.flatMap(wf.vitalRows);
      replace(
        host,
        el('h2', { text: 'Vital signs' }),
        el('p', {
          class: 'muted',
          text: `${observations.length} observation(s) · Observation?patient=${patientId}&category=vital-signs`
        }),
        table(
          [
            { key: 'label', label: 'Measurement' },
            { key: 'value', label: 'Value' },
            { key: 'panel', label: 'Panel' },
            { key: 'status', label: 'Status', render: (r) => statusPill(r.status) },
            { key: 'when', label: 'Taken', render: (r) => shortDate(r.when) },
            { key: 'id', label: 'Observation', render: (r) => el('code', { text: r.id }) }
          ],
          rows,
          { emptyText: 'No vital-signs observations recorded for this patient.' }
        ),
        observations.length ? jsonView(observations, 'Raw Observations') : null
      );
    })
    .catch((err) => replace(host, el('h2', { text: 'Vital signs' }), errorBox(err)));

  return host;
}

function everythingCard(patientId) {
  const host = el('section', { class: 'card' }, [
    el('h2', { text: 'Everything on file' }),
    spinner('Gathering the patient compartment…')
  ]);

  wf.patientEverything(patientId)
    .then(({ groups, total, source, partial }) => {
      replace(
        host,
        el('h2', { text: 'Everything on file' }),
        el('p', {
          class: 'muted',
          text: `${total} resource(s) across ${groups.length} type(s), via ${source}. Covers the whole server, not just this team.`
        }),
        partial.length
          ? el('p', { class: 'muted', text: `Not searchable on this server: ${partial.join(', ')}.` })
          : null,
        groups.length
          ? el(
              'div',
              {},
              groups.map((g) =>
                el('div', { class: 'record-group' }, [
                  el('h3', {}, [
                    g.type,
                    el('span', { class: 'count', text: String(g.resources.length) })
                  ]),
                  table(
                    [
                      { key: 'id', label: 'ID', render: (r) => el('code', { text: r.id }) },
                      { key: 'summary', label: 'Summary', render: resourceSummary },
                      { key: 'status', label: 'Status', render: (r) => statusPill(r.status || r.clinicalStatus?.coding?.[0]?.code) },
                      { key: 'updated', label: 'Updated', render: (r) => shortDate(r.meta?.lastUpdated) }
                    ],
                    g.resources
                  ),
                  jsonView(g.resources, `Raw ${g.type}`)
                ])
              )
            )
          : empty('Nothing else on file for this patient yet.')
      );
    })
    .catch((err) => replace(host, el('h2', { text: 'Everything on file' }), errorBox(err)));

  return host;
}

/** One readable line per resource, whatever its type. */
function resourceSummary(r) {
  const text =
    r.code?.text ||
    r.code?.coding?.[0]?.display ||
    r.type?.[0]?.text ||
    r.type?.[0]?.coding?.[0]?.display ||
    r.class?.display ||
    r.description ||
    r.medicationCodeableConcept?.text ||
    r.vaccineCode?.text ||
    r.category?.[0]?.text ||
    r.category?.[0]?.coding?.[0]?.display ||
    '—';
  return el('span', { text });
}

// ---- create ----

export const create = {
  async render(outlet) {
    outlet.append(
      pageHeader('Register patient', 'Builds the ereferral-patient resource from collection 03B.01.', [
        link('Back to list', '#/patients')
      ])
    );

    const preview = el('section', { class: 'card' });
    const messages = el('div');

    const validateToggle = el('label', { class: 'toggle' }, [
      el('input', { type: 'checkbox', id: 'validateFirst', checked: true }),
      ' Run $validate against the profile before creating (collection 03.01)'
    ]);

    const node = form(patientFields(null), {
      submitLabel: 'Create patient',
      extra: validateToggle,
      onSubmit: async (data, formNode) => {
        messages.replaceChildren();
        setBusy(formNode, true);
        const resource = toResource(data);
        try {
          if (document.getElementById('validateFirst').checked) {
            const outcome = await fhir.validate('Patient', resource, PROFILES.patient);
            messages.append(jsonView(outcome, 'Validation OperationOutcome'));
            if (fhir.hasErrors(outcome)) {
              messages.prepend(
                el('div', { class: 'alert alert--warn' }, [
                  el('strong', { text: 'Profile validation reported errors.' }),
                  el('p', { text: 'The resource was not created. Expand the outcome below.' })
                ])
              );
              setBusy(formNode, false);
              return;
            }
          }
          const { id } = await fhir.create('Patient', resource);
          state.set('patientId', id);
          toast(`Patient ${id} created`, 'ok');
          go(`/patients/${id}`);
        } catch (err) {
          messages.append(errorBox(err));
          setBusy(formNode, false);
        }
      }
    });

    const refresh = () => {
      preview.replaceChildren(
        el('h2', { text: 'Request preview' }),
        jsonView(toResource(Object.fromEntries(new FormData(node))), 'POST /Patient body')
      );
    };
    node.addEventListener('input', refresh);
    node.addEventListener('change', refresh);

    outlet.append(el('section', { class: 'card' }, [node]), messages, preview);
    refresh();
  }
};

// ---- detail / edit / delete ----

export const detail = {
  async render(outlet, params) {
    const { id } = params;
    const host = el('div');
    outlet.append(host);
    await draw();

    // Saving keeps the same hash, so the router never re-runs — redraw in place.
    // `known` is the resource a PUT just returned — no need to read it back.
    async function draw(known) {
      host.replaceChildren(spinner('Loading patient…'));

      let resource;
      try {
        resource = known || (await fhir.read('Patient', id));
      } catch (err) {
        host.replaceChildren(pageHeader('Patient', id, [link('Back', '#/patients')]), errorBox(err));
        return;
      }

      host.replaceChildren();
      host.append(
        pageHeader(humanName(resource), `Patient/${id} · version ${resource.meta?.versionId || '—'}`, [
          link('Referrals for this patient', `#/referrals?patient=${id}`),
          button('Use in demo', {
            onClick: () => {
              state.set('patientId', id);
              toast('Patient selected for the demo path', 'ok');
            }
          }),
          button('Delete', {
            variant: 'danger',
            onClick: async () => {
              if (!confirmDialog(`Delete Patient/${id}? This cannot be undone.`)) return;
              try {
                await fhir.remove('Patient', id);
                if (state.get('patientId') === id) state.set('patientId', '');
                toast('Patient deleted', 'ok');
                go('/patients');
              } catch (err) {
                host.append(errorBox(err));
              }
            }
          }),
          link('Back', '#/patients')
        ])
      );

      const messages = el('div');
      const node = form(patientFields(resource), {
        submitLabel: 'Save changes (PUT)',
        onSubmit: async (data, formNode) => {
          messages.replaceChildren();
          setBusy(formNode, true);
          try {
            const updated = await fhir.update('Patient', id, toResource(data));
            toast(`Saved — version ${updated?.meta?.versionId || '?'}`, 'ok');
            await draw(updated);
          } catch (err) {
            messages.append(errorBox(err));
            setBusy(formNode, false);
          }
        }
      });

      // The two cards below fetch on their own and swap their contents in — a slow or
      // unsupported compartment search must not hold up the demographics and the edit form.
      host.append(
        demographics(resource),
        vitalsCard(id),
        everythingCard(id),
        el('section', { class: 'card' }, [el('h2', { text: 'Edit' }), node]),
        messages,
        el('section', { class: 'card' }, [
          el('h2', { text: 'Stored resource' }),
          jsonView(resource, `GET /Patient/${id}`)
        ])
      );
    }
  }
};
