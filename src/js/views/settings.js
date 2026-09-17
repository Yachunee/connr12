import { DEFAULTS } from '../config.js';
import { state } from '../state.js';
import * as fhir from '../fhir.js';
import * as wf from '../workflow.js';
import { getLog, onLog } from '../fhir.js';
import {
  el,
  facilityPicker,
  pageHeader,
  form,
  toast,
  button,
  link,
  spinner,
  errorBox,
  jsonView,
  table,
  shortDate
} from '../ui.js';

let unsubscribe = null;

export default {
  destroy() {
    unsubscribe?.();
    unsubscribe = null;
  },

  async render(outlet) {
    const s = state.all;

    outlet.append(
      pageHeader('Settings', 'Connection details and collection variables, saved to this browser.', [
        button('Restore defaults', {
          onClick: () => {
            if (!confirm('Reset every setting and cached ID?')) return;
            state.resetAll();
            toast('Settings restored', 'ok');
            location.reload();
          }
        })
      ])
    );

    outlet.append(
      el('section', { class: 'card' }, [
        form(
          [
            { type: 'section', label: 'Servers' },
            { name: 'fhirBase', label: 'FHIR base URL', value: s.fhirBase, required: true, span: 'full' },
            { name: 'txBase', label: 'Terminology base URL', value: s.txBase, required: true, span: 'full' },
            { type: 'section', label: 'Team' },
            { name: 'teamCode', label: 'Team code', value: s.teamCode, required: true },
            { name: 'runId', label: 'Run ID', value: s.runId, required: true, hint: 'Suffix for every training identifier.' },
            { type: 'section', label: 'My facility' },
            {
              name: 'referringFacilityNhfr',
              label: 'My NHFR code',
              value: s.referringFacilityNhfr,
              hint: 'Used when creating my Organization.'
            },
            { name: 'referringFacilityName', label: 'My facility name', value: s.referringFacilityName }
          ],
          {
            submitLabel: 'Save settings',
            onSubmit: (data) => {
              state.merge(data);
              toast('Settings saved', 'ok');
            }
          }
        ),
        el('p', {
          class: 'muted',
          text: `Defaults: ${DEFAULTS.fhirBase} and ${DEFAULTS.txBase}, taken from the Postman environment file.`
        })
      ])
    );

    // Which Organization am I? This drives the Incoming referrals tab and decides which
    // referrals this app may receive, accept and complete.
    const facilityCard = el('section', { class: 'card' }, [
      el('h2', { text: 'My facility' }),
      spinner('Loading your facilities…')
    ]);
    outlet.append(facilityCard);

    (async () => {
      let mine = [];
      try {
        mine = fhir.entries(await fhir.search('Organization', { _count: 50, _sort: 'name' }));
      } catch (err) {
        facilityCard.replaceChildren(el('h2', { text: 'My facility' }), errorBox(err));
        return;
      }

      const current = state.get('myFacilityId');
      facilityCard.replaceChildren(
        el('h2', { text: 'My facility' }),
        el('p', {
          class: 'muted',
          text: 'The Organization that represents you. Referrals whose performer is this facility show up under Incoming, and only those can be received, accepted and completed here.'
        }),
        mine.length
          ? table(
              [
                { key: 'name', label: 'Facility', render: (r) => r.name || `Organization/${r.id}` },
                { key: 'id', label: 'Logical ID', render: (r) => el('code', { text: r.id }) },
                {
                  key: 'actions',
                  label: '',
                  render: (r) =>
                    r.id === current
                      ? el('span', { class: 'pill pill--ok', text: 'this is me' })
                      : button('Use as my facility', {
                          onClick: () => {
                            state.merge({ myFacilityId: r.id, myFacilityName: r.name || '' });
                            toast(`My facility is now ${r.name || r.id}`, 'ok');
                            location.reload();
                          }
                        })
                }
              ],
              mine
            )
          : el('div', { class: 'empty' }, [
              el('p', { text: 'Your team has not created a facility yet.' }),
              link('Create one', '#/facilities/new', { variant: 'primary' })
            ]),
        // A team's facility may already exist on the server without their tag — for
        // instance one registered before this app, or one being used to act as the
        // receiving side. Let any facility be claimed.
        el('details', { class: 'json' }, [
          el('summary', { text: 'Claim a facility my team did not create' }),
          facilityPicker({
            label: 'Search all facilities on the server',
            search: (text) => wf.searchFacilities(text),
            onPick: (org) => {
              if (!org) return;
              state.merge({ myFacilityId: org.id, myFacilityName: org.name || '' });
              toast(`My facility is now ${org.name || org.id}`, 'ok');
              location.reload();
            }
          })
        ])
      );
    })();

    // Live request log — the closest thing to Postman's console.
    const logCard = el('section', { class: 'card' }, [el('h2', { text: 'Request log' })]);
    outlet.append(logCard);

    const renderLog = () => {
      const rows = getLog();
      logCard.replaceChildren(
        el('h2', { text: 'Request log' }),
        el('p', { class: 'muted', text: 'Most recent 60 calls made by this tab.' }),
        table(
          [
            { key: 'at', label: 'Time', render: (r) => shortDate(r.at) },
            { key: 'method', label: 'Method' },
            { key: 'label', label: 'Call' },
            {
              key: 'status',
              label: 'Status',
              render: (r) =>
                el('span', {
                  class: `pill pill--${r.error ? 'bad' : 'ok'}`,
                  text: r.error ? String(r.status || 'error') : String(r.status)
                })
            },
            {
              key: 'detail',
              label: '',
              render: (r) => jsonView({ url: r.url, request: r.request, response: r.response }, 'detail')
            }
          ],
          rows,
          { emptyText: 'No calls yet in this tab.' }
        )
      );
    };

    renderLog();
    unsubscribe = onLog(renderLog);
  }
};
