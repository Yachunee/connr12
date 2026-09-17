import * as fhir from '../fhir.js';
import * as tpl from '../templates.js';
import * as wf from '../workflow.js';
import { SYSTEMS, PROFILES, GENDERS, PSGC_FALLBACK } from '../config.js';
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
import { demographics, patientSubline, psgcFromResource, vitalsCard } from '../patientCard.js';

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
                label: 'Patient number',
                render: (r) => el('span', { text: identifierOf(r, SYSTEMS.patient) || '—' })
              },
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

// ---- full record ----

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
        pageHeader(humanName(resource), patientSubline(resource) || 'Patient record', [
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
