import * as fhir from '../fhir.js';
import { state, ID_KEYS } from '../state.js';
import { el, pageHeader, link, spinner, jsonView, table, button, toast } from '../ui.js';

const LABELS = {
  patientId: 'Patient',
  refPractitionerId: 'Practitioner',
  destinationOrgId: 'Referral destination',
  refRoleId: 'PractitionerRole',
  conditionId: 'Condition',
  bpObservationId: 'BP Observation',
  serviceRequestId: 'ServiceRequest',
  taskId: 'Task',
  receivingEncounterId: 'Encounter'
};

async function serverCard() {
  const card = el('section', { class: 'card' }, [
    el('h2', { text: 'Server' }),
    spinner('Checking CapabilityStatement…')
  ]);
  try {
    const cs = await fhir.capability();
    card.replaceChildren(
      el('h2', { text: 'Server' }),
      el('dl', { class: 'kv' }, [
        el('dt', { text: 'Base URL' }),
        el('dd', { text: state.get('fhirBase') }),
        el('dt', { text: 'Software' }),
        el('dd', { text: `${cs.software?.name || '—'} ${cs.software?.version || ''}`.trim() }),
        el('dt', { text: 'FHIR version' }),
        el('dd', { text: cs.fhirVersion || '—' }),
        el('dt', { text: 'Status' }),
        el('dd', {}, [el('span', { class: 'pill pill--ok', text: 'reachable' })])
      ]),
      jsonView(cs, 'CapabilityStatement (00.01)')
    );
  } catch (err) {
    card.replaceChildren(
      el('h2', { text: 'Server' }),
      el('div', { class: 'alert alert--error' }, [
        el('strong', { text: 'Cannot reach the FHIR server.' }),
        el('p', { text: err.message })
      ]),
      link('Change server URL', '#/settings')
    );
  }
  return card;
}

export default {
  async render(outlet) {
    const s = state.all;

    outlet.append(
      pageHeader(
        'R12 eReferral Console',
        'A browser front end for the PH eReferral Connectathon labs. Every call goes straight to the live CDR.',
        [link('Run the guided demo', '#/demo', { variant: 'primary' })]
      )
    );

    const grid = el('div', { class: 'grid grid--2' });
    outlet.append(grid);

    const placeholder = el('section', { class: 'card' }, [
      el('h2', { text: 'Server' }),
      spinner()
    ]);
    grid.append(placeholder);

    grid.append(
      el('section', { class: 'card' }, [
        el('h2', { text: 'This run' }),
        el('dl', { class: 'kv' }, [
          el('dt', { text: 'Team code' }),
          el('dd', { text: s.teamCode }),
          el('dt', { text: 'Run ID' }),
          el('dd', { text: s.runId }),
          el('dt', { text: 'My facility' }),
          el('dd', {}, [
            s.myFacilityId
              ? el('span', {}, [s.myFacilityName || '(unnamed)', ' ', el('code', { text: s.myFacilityId })])
              : el('span', { class: 'pill pill--warn', text: 'not set' })
          ]),
          el('dt', { text: 'My NHFR' }),
          el('dd', { text: s.referringFacilityNhfr })
        ]),
        el('div', { class: 'row-actions' }, [
          link('Settings', '#/settings'),
          button('New run ID', {
            onClick: () => {
              if (!confirm('Start a fresh run? Cached resource IDs will be cleared.')) return;
              state.clearIds();
              toast('New run started', 'ok');
              location.reload();
            }
          })
        ])
      ])
    );

    const cached = ID_KEYS.map((k) => ({ key: k, id: s[k] })).filter((r) => r.id);
    outlet.append(
      el('section', { class: 'card' }, [
        el('h2', { text: 'Cached resource IDs' }),
        el('p', {
          class: 'muted',
          text: 'Captured as resources are created, the same way the Postman collection stores collection variables.'
        }),
        table(
          [
            { key: 'key', label: 'Resource', render: (r) => LABELS[r.key] || r.key },
            { key: 'id', label: 'Logical ID', render: (r) => el('code', { text: r.id }) }
          ],
          cached,
          { emptyText: 'Nothing created yet in this run.' }
        )
      ])
    );

    outlet.append(
      el('section', { class: 'card' }, [
        el('h2', { text: 'Workflow' }),
        el('div', { class: 'tiles' }, [
          tile('Facilities', 'Organization CRUD, searched by NHFR code.', '#/facilities'),
          tile('Practitioners', 'Practitioner and PractitionerRole CRUD.', '#/practitioners'),
          tile('Patients', 'Register, edit and delete patients.', '#/patients'),
          tile('Referrals', 'ServiceRequest + Task, full lifecycle.', '#/referrals')
        ])
      ])
    );

    placeholder.replaceWith(await serverCard());
  }
};

function tile(title, text, href) {
  return el('a', { class: 'tile', href }, [
    el('strong', { text: title }),
    el('span', { class: 'muted', text })
  ]);
}
