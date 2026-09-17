import * as fhir from '../fhir.js';
import * as tpl from '../templates.js';
import * as wf from '../workflow.js';
import { SYSTEMS } from '../config.js';
import { state } from '../state.js';
import { go } from '../router.js';
import {
  el,
  replace,
  facilityPicker,
  scopeToggle,
  scopeWarning,
  pageHeader,
  link,
  button,
  spinner,
  table,
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

function fields(resource) {
  const s = state.all;
  const name = resource?.name?.[0] || {};
  return [
    { type: 'section', label: 'Practitioner' },
    {
      name: 'identifierValue',
      label: 'Training identifier',
      value: identifierOf(resource, SYSTEMS.practitioner) || `${s.teamCode}-REFERRER`,
      required: true,
      hint: SYSTEMS.practitioner
    },
    { name: 'prefix', label: 'Prefix', value: name.prefix?.[0] ?? 'Dr.' },
    { name: 'given', label: 'Given name(s)', value: (name.given || ['Rosa']).join(' '), required: true },
    { name: 'family', label: 'Family name', value: name.family ?? 'Demo', required: true },
    {
      name: 'active',
      label: 'Active',
      type: 'checkbox',
      value: resource ? resource.active !== false : true
    }
  ];
}

export const list = {
  async render(outlet) {
    outlet.append(
      pageHeader('Practitioners', 'Practitioner CRUD (collection 03B.02) plus their PractitionerRole.', [
        link('Add practitioner', '#/practitioners/new', { variant: 'primary' })
      ])
    );

    const bar = el('form', { class: 'searchbar' }, [
      el('input', { type: 'search', name: 'name', placeholder: 'Name contains…', 'aria-label': 'Name' }),
      button('Search', { type: 'submit', variant: 'primary' })
    ]);
    const scope = scopeToggle(() => load({ _count: 20, _sort: '-_lastUpdated' }));
    outlet.append(bar, scope);

    const results = el('section', { class: 'card' });
    outlet.append(results);

    bar.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(bar));
      load(data.name ? { _count: 20, name: data.name } : { _count: 20, _sort: '-_lastUpdated' });
    });

    async function load(params) {
      results.replaceChildren(spinner('Searching practitioners…'));
      try {
        const bundle = await fhir.search('Practitioner', params, { includeAll: scope.checked });
        const rows = fhir.entries(bundle);
        replace(
          results,
          scope.checked ? scopeWarning() : null,
          el('p', { class: 'muted', text: `${bundle.total ?? rows.length} match(es)` }),
          table(
            [
              { key: 'name', label: 'Name', render: humanName },
              {
                key: 'identifier',
                label: 'Training ID',
                render: (r) => el('code', { text: identifierOf(r, SYSTEMS.practitioner) || '—' })
              },
              { key: 'id', label: 'Logical ID', render: (r) => el('code', { text: r.id }) },
              { key: 'updated', label: 'Updated', render: (r) => shortDate(r.meta?.lastUpdated) },
              { key: 'actions', label: '', render: (r) => link('Open', `#/practitioners/${r.id}`) }
            ],
            rows,
            {
              emptyText: scope.checked
                ? 'No practitioners matched.'
                : 'No practitioners your team created. Tick the box above to see the whole shared server.'
            }
          )
        );
      } catch (err) {
        results.replaceChildren(errorBox(err));
      }
    }

    load({ _count: 20, _sort: '-_lastUpdated' });
  }
};

export const create = {
  async render(outlet) {
    const s = state.all;
    // A Practitioner alone cannot be a ServiceRequest requester — that has to be a
    // PractitionerRole. Creating one without the other produces a resource the referral
    // form cannot use, so both are created here.
    const hasFacility = Boolean(s.myFacilityId);

    outlet.append(
      pageHeader(
        'Add practitioner',
        'Creates the Practitioner (03B.02) and their PractitionerRole (03B.05), so they can be picked as a referral requester.',
        [link('Back to list', '#/practitioners')]
      )
    );

    const messages = el('div');
    const preview = el('section', { class: 'card' });

    if (!hasFacility) {
      outlet.append(
        el('div', { class: 'alert alert--warn' }, [
          el('strong', { text: 'No facility set, so no role can be created.' }),
          el('p', {
            text: 'A PractitionerRole has to belong to an Organization. Choose My facility first, or create the practitioner now and add their role later from their detail page.'
          }),
          el('div', { class: 'row-actions' }, [link('Choose My facility', '#/settings')])
        ])
      );
    }

    const roleFields = hasFacility
      ? [
          { type: 'section', label: 'Role at my facility' },
          {
            name: 'roleCode',
            label: 'SNOMED role code',
            value: '158965000',
            hint: `Role is attached to ${s.myFacilityName || `Organization/${s.myFacilityId}`}.`
          },
          { name: 'roleDisplay', label: 'Role display', value: 'Medical practitioner' }
        ]
      : [];

    const node = form([...fields(null), ...roleFields], {
      submitLabel: hasFacility ? 'Create practitioner and role' : 'Create practitioner only',
      onSubmit: async (data, formNode) => {
        messages.replaceChildren();
        setBusy(formNode, true);
        try {
          const { id } = await fhir.create('Practitioner', tpl.practitioner(data));
          state.set('refPractitionerId', id);

          if (hasFacility) {
            const role = await fhir.create(
              'PractitionerRole',
              tpl.practitionerRole({
                identifierValue: `${s.teamCode}-${data.family || 'REFERRER'}-ROLE`.toUpperCase(),
                practitionerId: id,
                organizationId: s.myFacilityId,
                roleCode: data.roleCode,
                roleDisplay: data.roleDisplay
              })
            );
            state.set('refRoleId', role.id);
            toast(`Practitioner ${id} and role ${role.id} created`, 'ok');
          } else {
            toast(`Practitioner ${id} created — no role yet`, 'warn');
          }

          go(`/practitioners/${id}`);
        } catch (err) {
          messages.append(errorBox(err));
          setBusy(formNode, false);
        }
      }
    });

    const refresh = () => {
      preview.replaceChildren(
        el('h2', { text: 'Request preview' }),
        jsonView(tpl.practitioner(Object.fromEntries(new FormData(node))), 'POST /Practitioner body')
      );
    };
    node.addEventListener('input', refresh);
    node.addEventListener('change', refresh);

    outlet.append(el('section', { class: 'card' }, [node]), messages, preview);
    refresh();
  }
};

// ---- PractitionerRole panel (collection 03B.05) ----

async function rolePanel(practitionerId) {
  const card = el('section', { class: 'card' }, [
    el('h2', { text: 'PractitionerRole' }),
    spinner('Loading roles…')
  ]);

  async function refresh() {
    card.replaceChildren(el('h2', { text: 'PractitionerRole' }), spinner('Loading roles…'));
    let roles = [];
    try {
      const bundle = await fhir.search('PractitionerRole', {
        practitioner: `Practitioner/${practitionerId}`,
        _count: 20
      });
      roles = fhir.entries(bundle);
    } catch (err) {
      card.replaceChildren(el('h2', { text: 'PractitionerRole' }), errorBox(err));
      return;
    }

    const s = state.all;
    const messages = el('div');

    // Same search-and-pick component the referral form uses, seeded with My facility,
    // so nobody has to type an Organization logical ID by hand.
    let chosenOrg = s.myFacilityId
      ? { id: s.myFacilityId, name: s.myFacilityName, identifier: [] }
      : null;
    const orgPicker = facilityPicker({
      label: 'Organization for this role',
      search: (text) => wf.searchFacilities(text),
      selected: chosenOrg,
      onPick: (org) => {
        chosenOrg = org;
      }
    });

    const node = form(
      [
        {
          name: 'identifierValue',
          label: 'Role identifier',
          value: `${s.teamCode}-REFERRER-ROLE`,
          required: true
        },
        { name: 'roleCode', label: 'SNOMED role code', value: '158965000' },
        { name: 'roleDisplay', label: 'Role display', value: 'Medical practitioner' }
      ],
      {
        submitLabel: 'Create PractitionerRole',
        extra: orgPicker,
        onSubmit: async (data, formNode) => {
          messages.replaceChildren();
          if (!orgPicker.selected) {
            messages.append(
              errorBox(new Error('Choose the Organization this role belongs to.'))
            );
            return;
          }
          setBusy(formNode, true);
          try {
            const { id } = await fhir.create(
              'PractitionerRole',
              tpl.practitionerRole({
                ...data,
                practitionerId,
                organizationId: orgPicker.selected.id
              })
            );
            state.set('refRoleId', id);
            toast(`PractitionerRole ${id} created`, 'ok');
            refresh();
          } catch (err) {
            messages.append(errorBox(err));
            setBusy(formNode, false);
          }
        }
      }
    );

    card.replaceChildren(
      el('h2', { text: 'PractitionerRole' }),
      table(
        [
          { key: 'id', label: 'Logical ID', render: (r) => el('code', { text: r.id }) },
          {
            key: 'org',
            label: 'Organization',
            render: (r) => el('code', { text: r.organization?.reference || '—' })
          },
          {
            key: 'code',
            label: 'Role',
            render: (r) => r.code?.[0]?.coding?.[0]?.display || '—'
          },
          {
            key: 'actions',
            label: '',
            render: (r) =>
              el('div', { class: 'row-actions' }, [
                button('Use in demo', {
                  onClick: () => {
                    state.set('refRoleId', r.id);
                    toast('Role selected for the demo path', 'ok');
                  }
                }),
                button('Delete', {
                  variant: 'danger',
                  onClick: async () => {
                    if (!confirmDialog(`Delete PractitionerRole/${r.id}?`)) return;
                    try {
                      await fhir.remove('PractitionerRole', r.id);
                      if (state.get('refRoleId') === r.id) state.set('refRoleId', '');
                      toast('Role deleted', 'ok');
                      refresh();
                    } catch (err) {
                      card.append(errorBox(err));
                    }
                  }
                })
              ])
          }
        ],
        roles,
        { emptyText: 'This practitioner has no role yet.' }
      ),
      el('details', { class: 'json' }, [el('summary', { text: 'Create a role' }), node]),
      messages
    );
  }

  refresh();
  return card;
}

export const detail = {
  async render(outlet, params) {
    const { id } = params;
    const host = el('div');
    outlet.append(host);
    await draw();

    // Saving keeps the same hash, so the router never re-runs — redraw in place.
    // `known` is the resource a PUT just returned — no need to read it back.
    async function draw(known) {
      host.replaceChildren(spinner('Loading practitioner…'));

      let resource;
      try {
        resource = known || (await fhir.read('Practitioner', id));
      } catch (err) {
        host.replaceChildren(
          pageHeader('Practitioner', id, [link('Back', '#/practitioners')]),
          errorBox(err)
        );
        return;
      }

      host.replaceChildren(
        pageHeader(humanName(resource), `Practitioner/${id}`, [
        button('Use in demo', {
          onClick: () => {
            state.set('refPractitionerId', id);
            toast('Practitioner selected for the demo path', 'ok');
          }
        }),
        button('Delete', {
          variant: 'danger',
          onClick: async () => {
            if (!confirmDialog(`Delete Practitioner/${id}?`)) return;
            try {
              await fhir.remove('Practitioner', id);
              if (state.get('refPractitionerId') === id) state.set('refPractitionerId', '');
              toast('Practitioner deleted', 'ok');
              go('/practitioners');
            } catch (err) {
              host.append(errorBox(err));
            }
          }
        }),
          link('Back', '#/practitioners')
        ])
      );

      const messages = el('div');
      const node = form(fields(resource), {
        submitLabel: 'Save changes (PUT)',
        onSubmit: async (data, formNode) => {
          messages.replaceChildren();
          setBusy(formNode, true);
          try {
            const updated = await fhir.update('Practitioner', id, tpl.practitioner(data));
            toast(`Saved — version ${updated?.meta?.versionId || '?'}`, 'ok');
            await draw(updated);
          } catch (err) {
            messages.append(errorBox(err));
            setBusy(formNode, false);
          }
        }
      });

      host.append(
        el('section', { class: 'card' }, [el('h2', { text: 'Edit' }), node]),
        messages,
        await rolePanel(id),
        el('section', { class: 'card' }, [
          el('h2', { text: 'Stored resource' }),
          jsonView(resource, `GET /Practitioner/${id}`)
        ])
      );
    }
  }
};
