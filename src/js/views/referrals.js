import * as fhir from '../fhir.js';
import * as tpl from '../templates.js';
import * as wf from '../workflow.js';
import { SYSTEMS, TASK_FLOW } from '../config.js';
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
  statusPill,
  progressStrip,
  identifierOf,
  shortDate,
  confirmDialog,
  kvList
} from '../ui.js';
import { demographics, patientLine, vitalsCard } from '../patientCard.js';

// ---- list ----

export const list = {
  async render(outlet, _params, query) {
    const patientFilter = query?.patient || '';
    const myFacilityId = state.get('myFacilityId');
    // Incoming is the point of a referral network, so it leads.
    let tab = query?.tab === 'outgoing' || !myFacilityId ? 'outgoing' : 'incoming';

    outlet.append(
      pageHeader(
        'Referrals',
        'Incoming referrals are sent to your facility by anyone; outgoing ones are the referrals your team created.',
        [link('New referral', '#/referrals/new', { variant: 'primary' })]
      )
    );

    const tabs = el('div', { class: 'tabs', role: 'tablist' }, [
      tabButton('incoming', 'Incoming', 'Sent to my facility'),
      tabButton('outgoing', 'Outgoing', 'Created by my team')
    ]);
    outlet.append(tabs);

    const bar = el('form', { class: 'searchbar' }, [
      el('input', {
        type: 'search',
        name: 'patient',
        placeholder: 'Patient logical ID…',
        value: patientFilter,
        'aria-label': 'Patient logical ID'
      }),
      el('input', {
        type: 'search',
        name: 'status',
        placeholder: 'ServiceRequest status…',
        'aria-label': 'Status'
      }),
      button('Search', { type: 'submit', variant: 'primary' })
    ]);
    const scope = scopeToggle(() => load());
    outlet.append(bar, scope);

    const results = el('section', { class: 'card' });
    outlet.append(results);

    bar.addEventListener('submit', (e) => {
      e.preventDefault();
      load();
    });

    function tabButton(key, label, hint) {
      return el('button', {
        type: 'button',
        role: 'tab',
        class: `tab ${tab === key ? 'is-active' : ''}`.trim(),
        'aria-selected': tab === key ? 'true' : 'false',
        onclick: () => {
          tab = key;
          tabs.querySelectorAll('.tab').forEach((b) => {
            const active = b.textContent.startsWith(label);
            b.classList.toggle('is-active', active);
            b.setAttribute('aria-selected', String(active));
          });
          load();
        },
        html: `${label}<small>${hint}</small>`
      });
    }

    function filters() {
      const data = Object.fromEntries(new FormData(bar));
      const params = {};
      if (data.patient) params.subject = `Patient/${data.patient}`;
      if (data.status) params.status = data.status;
      return params;
    }

    async function load() {
      if (tab === 'incoming' && !myFacilityId) {
        replace(
          results,
          el('div', { class: 'empty' }, [
            el('p', { text: 'No facility set, so there is nothing to receive referrals.' }),
            link('Choose My facility in Settings', '#/settings', { variant: 'primary' })
          ])
        );
        return;
      }

      results.replaceChildren(spinner('Searching referrals…'));
      const incoming = tab === 'incoming';
      try {
        const bundle = incoming
          ? await wf.incomingReferrals(myFacilityId, filters())
          : await fhir.search(
              'ServiceRequest',
              {
                _count: 20,
                _sort: '-_lastUpdated',
                _include: wf.REFERRAL_INCLUDES,
                ...filters()
              },
              { includeAll: scope.checked }
            );
        // `_include` puts Patients and Organizations in the same Bundle, so the rows come
        // from the matches only and the rest becomes a lookup table.
        const rows = fhir.matches(bundle);
        const byRef = fhir.byReference(fhir.included(bundle));
        // Names, never `Organization/24729` — the reference stays in the raw JSON views.
        const orgCell = (reference) =>
          el('span', { text: wf.describe(byRef.get(reference)) || 'Unknown facility' });
        replace(
          results,
          !incoming && scope.checked ? scopeWarning() : null,
          el('p', {
            class: 'muted',
            text: incoming
              ? `${bundle.total ?? rows.length} referral(s) sent to ${state.get('myFacilityName') || 'my facility'}`
              : `${bundle.total ?? rows.length} match(es)`
          }),
          table(
            [
              {
                key: 'requisition',
                label: 'Requisition',
                render: (r) =>
                  el('code', { text: r.requisition?.value || identifierOf(r, SYSTEMS.referral) || '—' })
              },
              { key: 'status', label: 'Status', render: (r) => statusPill(r.status) },
              { key: 'priority', label: 'Priority' },
              {
                key: 'subject',
                label: 'Patient',
                render: (r) => {
                  const patient = byRef.get(r.subject?.reference || '');
                  const line = patientLine(patient);
                  return line ? el('strong', { text: line }) : el('span', { text: 'Unknown patient' });
                }
              },
              incoming
                ? {
                    key: 'from',
                    label: 'From',
                    render: (r) => orgCell(r.requester?.reference)
                  }
                : {
                    key: 'to',
                    label: 'To',
                    render: (r) => orgCell(r.performer?.[0]?.reference)
                  },
              { key: 'authoredOn', label: 'Authored', render: (r) => shortDate(r.authoredOn) },
              { key: 'actions', label: '', render: (r) => link('Open', `#/referrals/${r.id}`) }
            ],
            rows,
            {
              emptyText: incoming
                ? 'No referrals have been sent to your facility yet.'
                : scope.checked
                  ? 'No referrals matched.'
                  : 'No referrals your team created. Tick the box above to see the whole shared server.'
            }
          )
        );
      } catch (err) {
        results.replaceChildren(errorBox(err));
      }
    }

    load();
  }
};

// ---- create ----

function referralFields(options) {
  const s = state.all;
  // Pick people by name; the logical ID stays the option value. Both lists are known to
  // be non-empty here — the caller shows a prerequisites card instead when they are not.
  return [
    { type: 'section', label: 'Context' },
    {
      name: 'patientId',
      label: 'Patient',
      type: 'select',
      options: options.patients,
      value: s.patientId,
      required: true,
      hint: 'Your team’s patients, newest first.'
    },
    {
      name: 'roleId',
      label: 'Referring practitioner',
      type: 'select',
      options: options.roles,
      value: s.refRoleId,
      required: true,
      hint: 'Sent as the ServiceRequest requester (a PractitionerRole).'
    },
    // The destination is chosen with the facility picker below the grid, not here:
    // it can be any of the facilities on the shared server.
    { type: 'section', label: 'Clinical detail' },
    { name: 'conditionCode', label: 'Condition SNOMED code', value: '398254007' },
    { name: 'conditionDisplay', label: 'Condition display', value: 'Pre-eclampsia' },
    {
      name: 'conditionText',
      label: 'Condition summary',
      value: 'Severe pre-eclampsia requiring urgent referral',
      span: 'full'
    },
    { name: 'systolic', label: 'Systolic BP (mmHg)', type: 'number', value: 180 },
    { name: 'diastolic', label: 'Diastolic BP (mmHg)', type: 'number', value: 110 },
    { type: 'section', label: 'Referral' },
    {
      name: 'priority',
      label: 'Priority',
      type: 'select',
      options: ['routine', 'urgent', 'asap', 'stat'],
      value: 'urgent'
    },
    { name: 'categoryText', label: 'Category', value: 'Emergency' },
    {
      name: 'reasonText',
      label: 'Reason for referral',
      value: 'Urgent referral for management',
      span: 'full'
    },
    {
      name: 'note',
      label: 'Note to receiving facility',
      type: 'textarea',
      value: 'IG-inspired lightweight training case: BP 180/110 mmHg with severe pre-eclampsia.',
      span: 'full'
    }
  ];
}

function splitForm(data, destinationId) {
  return {
    condition: {
      patientId: data.patientId,
      code: data.conditionCode,
      display: data.conditionDisplay,
      text: data.conditionText
    },
    observation: {
      patientId: data.patientId,
      systolic: data.systolic,
      diastolic: data.diastolic
    },
    serviceRequest: {
      patientId: data.patientId,
      roleId: data.roleId,
      receivingOrgId: destinationId,
      priority: data.priority,
      categoryText: data.categoryText,
      reasonText: data.reasonText,
      note: data.note
    },
    task: { patientId: data.patientId, roleId: data.roleId }
  };
}

export const create = {
  async render(outlet) {
    outlet.append(
      pageHeader(
        'New referral',
        'Step-by-step follows collection 03B.06–03B.09. Bundle mode posts collection 04.01 in one call.',
        [link('Back to list', '#/referrals')]
      )
    );

    const modeBar = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Creation mode' }, [
      el('label', { class: 'segmented__item' }, [
        el('input', { type: 'radio', name: 'mode', value: 'steps', checked: true }),
        el('span', {}, [el('strong', { text: 'Step by step' }), el('small', { text: '4 separate POSTs, each response shown' })])
      ]),
      el('label', { class: 'segmented__item' }, [
        el('input', { type: 'radio', name: 'mode', value: 'bundle' }),
        el('span', {}, [
          el('strong', { text: 'Transaction bundle' }),
          el('small', { text: 'One atomic POST, conditional PUT per entry' })
        ])
      ])
    ]);

    const validateToggle = el('label', { class: 'toggle' }, [
      el('input', { type: 'checkbox', id: 'validateFirst' }),
      ' Run $validate before each create (collection folder 03). Step-by-step only.'
    ]);

    const steps = el('section', { class: 'card', hidden: true });
    const messages = el('div');

    const loading = el('section', { class: 'card' }, [spinner('Loading patients and facilities…')]);
    outlet.append(loading);
    let options;
    try {
      options = await wf.referralOptions();
    } catch (err) {
      loading.replaceChildren(errorBox(err));
      return;
    }
    loading.remove();

    // Without a patient and a requester role there is nothing to build a referral from,
    // so send people to the screen that fixes it rather than rendering a form that
    // cannot be submitted.
    const missing = [
      !options.patients.length && { what: 'a patient', href: '#/patients/new', cta: 'Register a patient' },
      !options.roles.length && {
        what: 'a referring practitioner',
        href: '#/practitioners/new',
        cta: 'Add a practitioner'
      }
    ].filter(Boolean);

    if (missing.length) {
      outlet.append(
        el('section', { class: 'card' }, [
          el('h2', { text: `First you need ${missing.map((m) => m.what).join(' and ')}.` }),
          el('p', {
            class: 'muted',
            text:
              missing.length === 2
                ? 'A referral needs a patient to refer and a practitioner role to send it. Both belong to your team.'
                : missing[0].href.includes('practitioners')
                  ? 'A referral’s requester is a PractitionerRole. Adding a practitioner creates one at your facility.'
                  : 'A referral needs one of your team’s patients as its subject.'
          }),
          el('div', { class: 'row-actions' }, [
            ...missing.map((m) => link(m.cta, m.href, { variant: 'primary' })),
            // The server's _tag index lags a write by a second or two, so something
            // created moments ago can still be missing here.
            button('Check again', { onClick: () => location.reload() })
          ]),
          el('p', {
            class: 'muted',
            text: 'Just created one? The server takes a moment to index it — check again.'
          })
        ])
      );
      return;
    }

    const picker = facilityPicker({
      label: 'Refer to which facility?',
      search: (text) => wf.searchFacilities(text),
      onPick: (org) => {
        state.set('destinationOrgId', org?.id || '');
        refresh();
      }
    });

    const node = form(referralFields(options), {
      submitLabel: 'Create referral',
      extra: el('div', {}, [picker, modeBar, validateToggle]),
      onSubmit: async (data, formNode) => {
        const mode = modeBar.querySelector('input[name=mode]:checked').value;
        messages.replaceChildren();
        steps.hidden = false;
        steps.replaceChildren(el('h2', { text: 'Progress' }));
        setBusy(formNode, true);

        const onStep = (label, payload) => {
          steps.append(
            el('div', { class: 'step-line' }, [
              el('span', { class: 'pill pill--ok', text: '✓' }),
              el('strong', { text: label }),
              payload ? jsonView(payload, 'detail') : null
            ])
          );
        };

        try {
          if (!picker.selected) {
            throw new Error('Choose a destination facility before sending the referral.');
          }
          const parts = splitForm(data, picker.selected.id);
          const result =
            mode === 'bundle'
              ? await wf.createReferralBundle(parts, { onStep })
              : await wf.createReferralStepwise(parts, {
                  validate: document.getElementById('validateFirst').checked,
                  onStep
                });

          if (!result.serviceRequestId) {
            throw new Error('Server accepted the request but returned no ServiceRequest ID.');
          }
          toast('Referral created', 'ok');
          go(`/referrals/${result.serviceRequestId}`);
        } catch (err) {
          messages.append(errorBox(err));
          setBusy(formNode, false);
        }
      }
    });

    const preview = el('section', { class: 'card' });
    const refresh = () => {
      const data = Object.fromEntries(new FormData(node));
      const mode = modeBar.querySelector('input[name=mode]:checked').value;
      const parts = splitForm(data, picker.selected?.id || '');
      preview.replaceChildren(
        el('h2', { text: 'Request preview' }),
        mode === 'bundle'
          ? jsonView(tpl.referralBundle(parts), 'POST / (transaction Bundle)')
          : el('div', {}, [
              jsonView(tpl.condition(parts.condition), 'POST /Condition'),
              jsonView(tpl.bpObservation(parts.observation), 'POST /Observation'),
              jsonView(tpl.serviceRequest(parts.serviceRequest), 'POST /ServiceRequest'),
              jsonView(tpl.task(parts.task), 'POST /Task')
            ])
      );
    };
    node.addEventListener('input', refresh);
    node.addEventListener('change', refresh);
    modeBar.addEventListener('change', refresh);

    outlet.append(el('section', { class: 'card' }, [node]), messages, steps, preview);
    refresh();
  }
};

// ---- detail + lifecycle ----

export const detail = {
  async render(outlet, params) {
    const { id } = params;
    const host = el('div');
    outlet.append(host);
    await draw();

    /**
     * `known` carries whatever a lifecycle action already fetched. The PATCH helpers
     * re-read the Task themselves (the Prefer header is blocked), so redrawing must not
     * read it a second time — and receive/accept leave the ServiceRequest untouched.
     */
    async function draw(known = {}) {
      host.replaceChildren(spinner('Loading referral…'));

      let sr;
      let task;
      let patient;
      let byRef = new Map();
      try {
        // A lifecycle action hands back the ServiceRequest it already holds; only the
        // Patient still has to be fetched in that case.
        if (known.serviceRequest) {
          sr = known.serviceRequest;
          patient = known.patient !== undefined ? known.patient : await wf.patientOf(sr);
        } else {
          ({ serviceRequest: sr, patient, byRef } = await wf.referralWithPatient(id));
        }
        task = known.task !== undefined ? known.task : await wf.taskForServiceRequest(id);
      } catch (err) {
        host.replaceChildren(
          pageHeader('Referral', id, [link('Back', '#/referrals')]),
          errorBox(err)
        );
        return;
      }

      const status = task?.status || 'requested';
      // Only the receiving facility drives the lifecycle. If this referral is aimed at
      // somebody else, show the status but leave the buttons to them.
      const performer = sr.performer?.[0]?.reference || '';
      const myFacilityId = state.get('myFacilityId');
      const mineToAct = Boolean(myFacilityId) && performer === `Organization/${myFacilityId}`;

      /**
       * A reference rendered as words. Anything the search already included resolves
       * instantly; the rest is read and swapped in, so the card never shows `Type/id`.
       */
      const nameCell = (reference) => {
        if (!reference) return '';
        const node = el('span', { text: 'Loading…' });
        wf.labelFor(reference, byRef).then((label) => {
          node.textContent = label || 'Not available';
        });
        return node;
      };

      const busy = (on) =>
        host.querySelectorAll('.lifecycle button').forEach((b) => {
          b.disabled = on;
        });

      const act = async (label, fn) => {
        busy(true);
        try {
          const result = await fn();
          toast(`${label} done`, 'ok');
          // Carry the Patient we already have, so a lifecycle step costs no extra read.
          await draw({ patient, ...result });
        } catch (err) {
          host.append(errorBox(err));
          busy(false);
        }
      };

      replace(
        host,
        pageHeader(
          sr.requisition?.value || 'Referral',
          [
            patient ? `For ${patientLine(patient)}` : 'Patient unknown',
            sr.authoredOn ? `referred ${shortDate(sr.authoredOn)}` : '',
            task ? '' : 'no lifecycle Task found'
          ]
            .filter(Boolean)
            .join(' · '),
          [
            link('Open patient record', `#/patients/${(sr.subject?.reference || '').split('/')[1] || ''}`),
            button('Delete referral', {
              variant: 'danger',
              onClick: async () => {
                if (
                  !confirmDialog(
                    `Delete ServiceRequest/${id}${task ? `, Task/${task.id}` : ''} and any completion Encounter? This cannot be undone.`
                  )
                )
                  return;
                try {
                  await wf.deleteReferral(id, task);
                  if (state.get('serviceRequestId') === id) {
                    state.merge({ serviceRequestId: '', taskId: '' });
                  }
                  toast('Referral deleted', 'ok');
                  go('/referrals');
                } catch (err) {
                  host.append(errorBox(err));
                }
              }
            }),
            link('Back', '#/referrals')
          ]
        ),

        el('section', { class: 'card lifecycle' }, [
          el('h2', { text: 'Lifecycle' }),
          progressStrip(TASK_FLOW, status),
          el('p', { class: 'muted' }, [
            'Handling: ',
            statusPill(status, TASK_FLOW),
            ' · Referral: ',
            statusPill(sr.status)
          ]),
          !task
            ? el('div', { class: 'alert alert--warn' }, [
                el('strong', { text: 'No Task tracks this ServiceRequest.' }),
                el('p', {
                  text: 'Search 05.04 returned nothing, so the lifecycle actions are unavailable.'
                })
              ])
            : !mineToAct
              ? el('div', { class: 'alert alert--warn' }, [
                  el('strong', { text: 'This referral is not yours to action.' }),
                  el('p', {}, [
                    'It was sent to ',
                    performer ? nameCell(performer) : el('span', { text: 'no facility' }),
                    myFacilityId
                      ? ', not to your facility. That facility receives, accepts and completes it.'
                      : '. Set My facility in Settings to action the referrals sent to you.'
                  ]),
                  el('div', { class: 'row-actions' }, [button('Refresh', { onClick: () => draw() })])
                ])
              : el('div', { class: 'row-actions' }, [
                button('Receive (06.01)', {
                  variant: 'primary',
                  disabled: status !== 'requested',
                  onClick: () =>
                    act('Receive', async () => ({
                      task: await wf.receiveTask(task.id),
                      serviceRequest: sr
                    }))
                }),
                button('Accept (06.02)', {
                  variant: 'primary',
                  disabled: status !== 'received',
                  onClick: () =>
                    act('Accept', async () => ({
                      task: await wf.acceptTask(task.id),
                      serviceRequest: sr
                    }))
                }),
                button('Complete (07.01–07.03)', {
                  variant: 'primary',
                  disabled: status !== 'accepted',
                  onClick: () => act('Complete', () => wf.completeReferral(task.id, id))
                }),
                button('Refresh', { onClick: () => draw() })
              ]),
          el('p', {
            class: 'muted',
            text: 'Each action sends a JSON Patch, then re-reads the Task — the Prefer header is blocked by CORS on this server.'
          })
        ]),

        el('section', { class: 'card' }, [
          el('h2', { text: 'Referral detail' }),
          kvList([
            ['Priority', sr.priority],
            ['Category', sr.category?.[0]?.text || sr.category?.[0]?.coding?.[0]?.display],
            ['Reason', sr.reasonCode?.[0]?.text || sr.reasonCode?.[0]?.coding?.[0]?.display],
            ['Referred by', nameCell(sr.requester?.reference)],
            ['Referred to', nameCell(sr.performer?.[0]?.reference)],
            ['Condition', nameCell(sr.reasonReference?.[0]?.reference)],
            ['Supporting observation', nameCell(sr.supportingInfo?.[0]?.reference)],
            ['Authored', sr.authoredOn ? shortDate(sr.authoredOn) : '']
          ]),
          sr.note?.length
            ? el('blockquote', { class: 'note', text: sr.note.map((n) => n.text).join('\n') })
            : null
        ]),

        // The whole Patient, so triage does not need a second page to know who this is.
        patient
          ? demographics(patient, { title: `Patient — ${patientLine(patient)}` })
          : el('section', { class: 'card' }, [
              el('h2', { text: 'Patient' }),
              el('p', { class: 'muted' }, [
                'Could not read ',
                el('code', { text: sr.subject?.reference || 'the subject' }),
                '.'
              ])
            ]),

        // Loads on its own, so a slow Observation search does not delay the lifecycle card.
        patient ? vitalsCard(patient.id) : null,

        task
          ? el('section', { class: 'card' }, [
              el('h2', { text: 'Task notes' }),
              el(
                'ol',
                { class: 'notes' },
                (task.note || []).map((n) => el('li', { text: n.text }))
              ),
              task.owner
                ? el('p', { class: 'muted' }, ['Handled by: ', nameCell(task.owner.reference)])
                : null,
              task.output?.length
                ? el('p', { class: 'muted' }, [
                    'Completion record: ',
                    nameCell(task.output[0].valueReference?.reference) ||
                      el('span', { text: 'none' })
                  ])
                : null
            ])
          : null,

        el('section', { class: 'card' }, [
          el('h2', { text: 'Stored resources' }),
          jsonView(sr, `GET /ServiceRequest/${id}`),
          task ? jsonView(task, `GET /Task/${task.id}`) : null,
          patient ? jsonView(patient, `GET /Patient/${patient.id}`) : null
        ])
      );
    }
  }
};
