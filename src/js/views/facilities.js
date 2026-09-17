import * as fhir from '../fhir.js';
import * as tpl from '../templates.js';
import { SYSTEMS } from '../config.js';
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
  form,
  setBusy,
  toast,
  errorBox,
  jsonView,
  identifierOf,
  shortDate,
  confirmDialog
} from '../ui.js';

// Only facilities we own are created here. Referral destinations are picked from the
// facilities already on the shared server, so they need no form.
function fields(resource) {
  const s = state.all;
  return [
    { type: 'section', label: 'Facility' },
    {
      name: 'nhfr',
      label: 'DOH NHFR code',
      value: identifierOf(resource, SYSTEMS.nhfr) || s.referringFacilityNhfr,
      required: true,
      hint: SYSTEMS.nhfr
    },
    {
      name: 'name',
      label: 'Facility name',
      value: resource?.name || s.referringFacilityName,
      required: true,
      span: 'full'
    },
    {
      name: 'phone',
      label: 'Work phone',
      value: resource?.telecom?.find((t) => t.system === 'phone')?.value || '+639000000001'
    },
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
      pageHeader(
        'Facilities',
        'Organization CRUD. Search by NHFR code mirrors collection 01.02.',
        [link('Add facility', '#/facilities/new', { variant: 'primary' })]
      )
    );

    const bar = el('form', { class: 'searchbar' }, [
      el('input', { type: 'search', name: 'name', placeholder: 'Name contains…', 'aria-label': 'Name' }),
      el('input', {
        type: 'search',
        name: 'nhfr',
        placeholder: 'NHFR code…',
        'aria-label': 'NHFR code'
      }),
      button('Search', { type: 'submit', variant: 'primary' }),
      button('My facility', {
        title: 'Look up the NHFR code configured in Settings',
        onClick: () => loadMine()
      })
    ]);
    const scope = scopeToggle(() => load({ _count: 20, _sort: '-_lastUpdated' }));
    outlet.append(bar, scope);

    const results = el('section', { class: 'card' });
    outlet.append(results);

    bar.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(bar));
      const params = { _count: 20, _sort: '-_lastUpdated' };
      if (data.name) params.name = data.name;
      if (data.nhfr) params.identifier = `${SYSTEMS.nhfr}|${data.nhfr}`;
      load(params);
    });

    function render(rows, total) {
      replace(
        results,
        scope.checked ? scopeWarning() : null,
        el('p', { class: 'muted', text: `${total ?? rows.length} match(es)` }),
        table(
          [
            { key: 'name', label: 'Name' },
            {
              key: 'nhfr',
              label: 'NHFR',
              render: (r) => el('code', { text: identifierOf(r, SYSTEMS.nhfr) || '—' })
            },
            { key: 'id', label: 'Logical ID', render: (r) => el('code', { text: r.id }) },
            { key: 'updated', label: 'Updated', render: (r) => shortDate(r.meta?.lastUpdated) },
            { key: 'actions', label: '', render: (r) => link('Open', `#/facilities/${r.id}`) }
          ],
          rows,
          {
            emptyText: scope.checked
              ? 'No organizations matched.'
              : 'No facilities your team created. Tick the box above to see the whole shared server.'
          }
        )
      );
    }

    async function load(params) {
      results.replaceChildren(spinner('Searching organizations…'));
      try {
        const bundle = await fhir.search('Organization', params, { includeAll: scope.checked });
        render(fhir.entries(bundle), bundle.total);
      } catch (err) {
        results.replaceChildren(errorBox(err));
      }
    }

    async function loadMine() {
      results.replaceChildren(spinner('Looking up your facility…'));
      const s = state.all;
      try {
        const bundle = await fhir.search(
          'Organization',
          { identifier: `${SYSTEMS.nhfr}|${s.referringFacilityNhfr}` },
          { includeAll: scope.checked }
        );
        render(fhir.entries(bundle), bundle.total);
      } catch (err) {
        results.replaceChildren(errorBox(err));
      }
    }

    load({ _count: 20, _sort: '-_lastUpdated' });
  }
};

export const create = {
  async render(outlet) {
    outlet.append(
      pageHeader('Add facility', 'Creates a facility your team owns (collection 03B.03).', [
        link('Back to list', '#/facilities')
      ])
    );

    const messages = el('div');
    const preview = el('section', { class: 'card' });

    const node = form(fields(null), {
      submitLabel: 'Create facility',
      onSubmit: async (data, formNode) => {
        messages.replaceChildren();
        setBusy(formNode, true);
        try {
          const { id } = await fhir.create('Organization', tpl.organization(data));
          // First facility a team creates becomes their identity.
          if (!state.get('myFacilityId')) {
            state.merge({ myFacilityId: id, myFacilityName: data.name || '' });
          }
          toast(`Organization ${id} created`, 'ok');
          go(`/facilities/${id}`);
        } catch (err) {
          messages.append(errorBox(err));
          setBusy(formNode, false);
        }
      }
    });

    const refresh = () => {
      preview.replaceChildren(
        el('h2', { text: 'Request preview' }),
        jsonView(tpl.organization(Object.fromEntries(new FormData(node))), 'POST /Organization body')
      );
    };
    node.addEventListener('input', refresh);
    node.addEventListener('change', refresh);

    outlet.append(el('section', { class: 'card' }, [node]), messages, preview);
    refresh();
  }
};

export const detail = {
  async render(outlet, params) {
    const { id } = params;
    const host = el('div');
    outlet.append(host);
    await draw();

    // Saving keeps the same hash, so the router never re-runs — redraw in place.
    // `known` is the resource a PUT just returned — no need to read it back.
    async function draw(known) {
      host.replaceChildren(spinner('Loading organization…'));

      let resource;
      try {
        resource = known || (await fhir.read('Organization', id));
      } catch (err) {
        host.replaceChildren(
          pageHeader('Facility', id, [link('Back', '#/facilities')]),
          errorBox(err)
        );
        return;
      }

      const nhfr = identifierOf(resource, SYSTEMS.nhfr);
      const isMine = state.get('myFacilityId') === id;

      host.replaceChildren(
        pageHeader(resource.name || `Organization/${id}`, `Organization/${id} · NHFR ${nhfr || '—'}`, [
        isMine
          ? el('span', { class: 'pill pill--ok', text: 'my facility' })
          : button('Use as my facility', {
              onClick: () => {
                state.merge({ myFacilityId: id, myFacilityName: resource.name || '' });
                toast('This is now my facility', 'ok');
                draw();
              }
            }),
        button('Delete', {
          variant: 'danger',
          onClick: async () => {
            if (!confirmDialog(`Delete Organization/${id}?`)) return;
            try {
              await fhir.remove('Organization', id);
              if (state.get('myFacilityId') === id) {
                state.merge({ myFacilityId: '', myFacilityName: '' });
              }
              toast('Organization deleted', 'ok');
              go('/facilities');
            } catch (err) {
              host.append(errorBox(err));
            }
          }
        }),
          link('Back', '#/facilities')
        ])
      );

      const messages = el('div');
      const node = form(fields(resource), {
        submitLabel: 'Save changes (PUT)',
        onSubmit: async (data, formNode) => {
          messages.replaceChildren();
          setBusy(formNode, true);
          try {
            const updated = await fhir.update('Organization', id, tpl.organization(data));
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
        el('section', { class: 'card' }, [
          el('h2', { text: 'Stored resource' }),
          jsonView(resource, `GET /Organization/${id}`)
        ])
      );
    }
  }
};
