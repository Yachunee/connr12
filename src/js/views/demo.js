// The main demo path: Patient registration -> eReferral -> receive -> accept -> complete.
// Every step is a thin wrapper over workflow.js so it behaves identically to the
// individual CRUD pages.

import * as fhir from '../fhir.js';
import * as tpl from '../templates.js';
import * as wf from '../workflow.js';
import { GENDERS, TASK_FLOW, PSGC_FALLBACK } from '../config.js';
import { state } from '../state.js';
import {
  el,
  append,
  facilityPicker,
  pageHeader,
  link,
  button,
  form,
  setBusy,
  toast,
  errorBox,
  jsonView,
  statusPill,
  progressStrip,
  humanName
} from '../ui.js';

const STEPS = [
  { key: 'setup', title: 'My facility & referrer', blurb: 'My Organization, Practitioner, PractitionerRole' },
  { key: 'patient', title: 'Register patient', blurb: 'ereferral-patient (03B.01)' },
  { key: 'referral', title: 'Refer out', blurb: 'Choose a destination, then send' },
  { key: 'track', title: 'Track', blurb: 'The receiving facility acts' }
];

function stepNav(activeIndex, reached) {
  return el(
    'ol',
    { class: 'wizard' },
    STEPS.map((s, i) =>
      el(
        'li',
        {
          class: `wizard__step ${i === activeIndex ? 'is-current' : ''} ${
            i < reached ? 'is-done' : ''
          }`.trim()
        },
        [el('strong', { text: `${i + 1}. ${s.title}` }), el('small', { text: s.blurb })]
      )
    )
  );
}

export default {
  async render(outlet) {
    const stage = el('div');
    const head = el('div');
    outlet.append(
      pageHeader(
        'Guided demo',
        'The full PH eReferral happy path, one step at a time, against the live CDR.',
        [
          button('Restart run', {
            onClick: () => {
              if (!confirm('Clear the cached IDs and start a new run?')) return;
              state.clearIds();
              draw();
            }
          }),
          link('Settings', '#/settings')
        ]
      ),
      head,
      stage
    );

    draw();

    function currentIndex() {
      const s = state.all;
      if (!s.myFacilityId || !s.refRoleId) return 0;
      if (!s.patientId) return 1;
      if (!s.serviceRequestId || !s.taskId) return 2;
      return 3;
    }

    function draw() {
      const idx = currentIndex();
      head.replaceChildren(stepNav(idx, idx));
      stage.replaceChildren();
      [drawSetup, drawPatient, drawReferral, drawTrack][idx](stage);
    }

    // --- step 1 ---
    function drawSetup(host) {
      const s = state.all;
      const messages = el('div');
      const progress = el('div', { class: 'card', hidden: true });

      const node = form(
        [
          { type: 'section', label: 'My facility' },
          { name: 'referringFacilityNhfr', label: 'NHFR code', value: s.referringFacilityNhfr, required: true },
          { name: 'referringFacilityName', label: 'Name', value: s.referringFacilityName, required: true },
          { type: 'section', label: 'Referring practitioner' },
          { name: 'prefix', label: 'Prefix', value: 'Dr.' },
          { name: 'given', label: 'Given name', value: 'Rosa', required: true },
          { name: 'family', label: 'Family name', value: 'Demo', required: true }
        ],
        {
          submitLabel: 'Find or create my facility, practitioner and role',
          onSubmit: async (data, formNode) => {
            messages.replaceChildren();
            setBusy(formNode, true);
            progress.hidden = false;
            progress.replaceChildren(el('h2', { text: 'Result' }));
            state.merge({
              referringFacilityNhfr: data.referringFacilityNhfr,
              referringFacilityName: data.referringFacilityName
            });
            try {
              const out = await wf.ensureSetup({
                practitioner: { prefix: data.prefix, given: data.given, family: data.family }
              });
              Object.entries(out).forEach(([k, v]) => {
                progress.append(
                  el('div', { class: 'step-line' }, [
                    el('span', { class: `pill pill--${v.created ? 'ok' : 'neutral'}`, text: v.created ? 'created' : 'reused' }),
                    el('strong', { text: k }),
                    el('code', { text: v.id })
                  ])
                );
              });
              toast('Setup complete', 'ok');
              setTimeout(draw, 700);
            } catch (err) {
              messages.append(errorBox(err));
              setBusy(formNode, false);
            }
          }
        }
      );

      host.append(
        el('section', { class: 'card' }, [
          el('h2', { text: 'Step 1 — My facility & referrer' }),
          el('p', {
            class: 'muted',
            text: 'Sets up your own side only. Each resource is searched by identifier first and created only when missing, so re-running the demo is safe. The facility you refer to is chosen in step 3.'
          }),
          node
        ]),
        messages,
        progress
      );
    }

    // --- step 2 ---
    function drawPatient(host) {
      const s = state.all;
      const messages = el('div');
      const preview = el('section', { class: 'card' });

      const buildResource = (data) =>
        tpl.patient({
          ...data,
          address: {
            region: PSGC_FALLBACK.region[0],
            province: PSGC_FALLBACK.province[0],
            cityMunicipality: PSGC_FALLBACK.cityMunicipality[0],
            barangay: PSGC_FALLBACK.barangay[0]
          }
        });

      const node = form(
        [
          { name: 'family', label: 'Family name', value: 'Santos', required: true },
          { name: 'given', label: 'Given name(s)', value: 'Maria Test', required: true },
          { name: 'gender', label: 'Gender', type: 'select', options: GENDERS, value: 'female' },
          { name: 'birthDate', label: 'Birth date', type: 'date', value: '1988-03-12' },
          { name: 'phone', label: 'Mobile', value: '+639000000000' },
          { name: 'addressLine', label: 'Street address', value: 'R12 Connectathon Training Address', span: 'full' },
          {
            name: 'identifierValue',
            label: 'Training identifier',
            value: `${s.teamCode}-PATIENT-${s.runId}`,
            required: true
          }
        ],
        {
          submitLabel: 'Register patient',
          onSubmit: async (data, formNode) => {
            messages.replaceChildren();
            setBusy(formNode, true);
            try {
              const { id } = await fhir.create('Patient', buildResource(data));
              state.set('patientId', id);
              toast(`Patient ${id} registered`, 'ok');
              draw();
            } catch (err) {
              messages.append(errorBox(err));
              setBusy(formNode, false);
            }
          }
        }
      );

      const refresh = () =>
        preview.replaceChildren(
          el('h2', { text: 'Request preview' }),
          jsonView(buildResource(Object.fromEntries(new FormData(node))), 'POST /Patient body')
        );
      node.addEventListener('input', refresh);
      node.addEventListener('change', refresh);

      host.append(
        el('section', { class: 'card' }, [
          el('h2', { text: 'Step 2 — Register patient' }),
          el('p', { class: 'muted' }, [
            'My facility ',
            el('code', { text: s.myFacilityId }),
            ' · requester role ',
            el('code', { text: s.refRoleId })
          ]),
          node
        ]),
        messages,
        preview
      );
      refresh();
    }

    // --- step 3 ---
    function drawReferral(host) {
      const s = state.all;
      const messages = el('div');
      const progress = el('section', { class: 'card', hidden: true });

      const modeBar = el('div', { class: 'segmented' }, [
        el('label', { class: 'segmented__item' }, [
          el('input', { type: 'radio', name: 'mode', value: 'steps', checked: true }),
          el('span', {}, [el('strong', { text: 'Step by step' }), el('small', { text: '03B.06 → 03B.09' })])
        ]),
        el('label', { class: 'segmented__item' }, [
          el('input', { type: 'radio', name: 'mode', value: 'bundle' }),
          el('span', {}, [el('strong', { text: 'Transaction bundle' }), el('small', { text: '04.01' })])
        ])
      ]);

      const picker = facilityPicker({
        label: 'Refer to which facility?',
        search: (text) => wf.searchFacilities(text)
      });

      const node = form(
        [
          { name: 'systolic', label: 'Systolic BP', type: 'number', value: 180 },
          { name: 'diastolic', label: 'Diastolic BP', type: 'number', value: 110 },
          {
            name: 'conditionText',
            label: 'Working diagnosis',
            value: 'Severe pre-eclampsia requiring urgent referral',
            span: 'full'
          },
          {
            name: 'priority',
            label: 'Priority',
            type: 'select',
            options: ['routine', 'urgent', 'asap', 'stat'],
            value: 'urgent'
          },
          { name: 'categoryText', label: 'Category', value: 'Emergency' },
          {
            name: 'note',
            label: 'Note to receiving facility',
            type: 'textarea',
            value: 'IG-inspired lightweight training case: BP 180/110 mmHg with severe pre-eclampsia.',
            span: 'full'
          }
        ],
        {
          submitLabel: 'Send referral',
          extra: el('div', {}, [picker, modeBar]),
          onSubmit: async (data, formNode) => {
            messages.replaceChildren();
            setBusy(formNode, true);
            progress.hidden = false;
            progress.replaceChildren(el('h2', { text: 'Progress' }));

            const onStep = (label, payload) =>
              progress.append(
                el('div', { class: 'step-line' }, [
                  el('span', { class: 'pill pill--ok', text: '✓' }),
                  el('strong', { text: label }),
                  payload ? jsonView(payload, 'detail') : null
                ])
              );

            if (!picker.selected) {
              messages.append(
                errorBox(new Error('Choose a destination facility before sending the referral.'))
              );
              setBusy(formNode, false);
              return;
            }
            state.merge({ destinationOrgId: picker.selected.id });

            const parts = {
              condition: { patientId: s.patientId, text: data.conditionText },
              observation: {
                patientId: s.patientId,
                systolic: data.systolic,
                diastolic: data.diastolic
              },
              serviceRequest: {
                patientId: s.patientId,
                roleId: s.refRoleId,
                receivingOrgId: picker.selected.id,
                priority: data.priority,
                categoryText: data.categoryText,
                note: data.note
              },
              task: { patientId: s.patientId, roleId: s.refRoleId }
            };

            const mode = modeBar.querySelector('input[name=mode]:checked').value;
            try {
              if (mode === 'bundle') await wf.createReferralBundle(parts, { onStep });
              else await wf.createReferralStepwise(parts, { onStep });
              toast('Referral sent', 'ok');
              setTimeout(draw, 700);
            } catch (err) {
              messages.append(errorBox(err));
              setBusy(formNode, false);
            }
          }
        }
      );

      host.append(
        el('section', { class: 'card' }, [
          el('h2', { text: 'Step 3 — Refer out' }),
          el('p', { class: 'muted' }, [
            'Patient ',
            el('code', { text: s.patientId }),
            ' · search the whole server and pick any facility, including one another team owns.'
          ]),
          node
        ]),
        messages,
        progress
      );
    }

    // --- step 4 ---
    async function drawTrack(host) {
      const s = state.all;
      const card = el('section', { class: 'card lifecycle' }, [
        el('h2', { text: 'Step 4 — Track' })
      ]);
      host.append(card);

      // The patient does not change while the referral is tracked, so read it once.
      let patient = null;

      async function refresh(known = {}) {
        card.replaceChildren(el('h2', { text: 'Step 4 — Track' }));
        let task;
        let sr;
        try {
          // The PATCH helpers already re-read what they changed; don't fetch it twice.
          task = known.task || (await fhir.read('Task', s.taskId));
          sr = known.serviceRequest || (await fhir.read('ServiceRequest', s.serviceRequestId));
          if (!patient) patient = await fhir.read('Patient', s.patientId);
        } catch (err) {
          card.append(
            errorBox(err),
            button('Start a new run', {
              onClick: () => {
                state.clearIds();
                draw();
              }
            })
          );
          return;
        }

        const status = task.status;
        const performer = sr.performer?.[0]?.reference || '';
        const myFacilityId = state.get('myFacilityId');
        // We only drive the lifecycle when the referral was aimed at us.
        const mineToAct = Boolean(myFacilityId) && performer === `Organization/${myFacilityId}`;

        const act = async (label, fn) => {
          card.querySelectorAll('button').forEach((b) => (b.disabled = true));
          try {
            const known = await fn();
            toast(`${label} done`, 'ok');
            await refresh(known);
          } catch (err) {
            card.append(errorBox(err));
          }
        };

        append(
          card,
          el('p', { class: 'muted' }, [
            humanName(patient),
            ' · ',
            el('code', { text: `ServiceRequest/${sr.id}` }),
            ' · ',
            el('code', { text: `Task/${task.id}` })
          ]),
          progressStrip(TASK_FLOW, status),
          el('p', { class: 'muted' }, ['Task ', statusPill(status, TASK_FLOW), ' · ServiceRequest ', statusPill(sr.status)]),
          el('div', { class: 'row-actions' }, [
            button('Receive (06.01)', {
              variant: 'primary',
              disabled: !mineToAct || status !== 'requested',
              onClick: () =>
                act('Receive', async () => ({
                  task: await wf.receiveTask(task.id),
                  serviceRequest: sr
                }))
            }),
            button('Accept (06.02)', {
              variant: 'primary',
              disabled: !mineToAct || status !== 'received',
              onClick: () =>
                act('Accept', async () => ({
                  task: await wf.acceptTask(task.id),
                  serviceRequest: sr
                }))
            }),
            button('Complete (07.01–07.03)', {
              variant: 'primary',
              disabled: !mineToAct || status !== 'accepted',
              onClick: () => act('Complete', () => wf.completeReferral(task.id, sr.id))
            }),
            button('Refresh', { onClick: () => refresh() })
          ]),
          !mineToAct
            ? el('div', { class: 'alert alert--warn' }, [
                el('strong', { text: 'Waiting on the receiving facility.' }),
                el('p', {}, [
                  'You referred to ',
                  el('code', { text: performer || 'no facility' }),
                  ', so they receive, accept and complete it. Refresh to see their progress.'
                ]),
                el('p', { class: 'muted' }, [
                  'Referrals sent to you appear under ',
                  link('Referrals → Incoming', '#/referrals'),
                  '.'
                ])
              ])
            : null,
          status === 'completed'
            ? el('div', { class: 'alert alert--ok' }, [
                el('strong', { text: 'Referral closed.' }),
                el('p', {
                  text: 'Task is completed with the receiving Encounter recorded as its output, and the ServiceRequest is marked completed.'
                }),
                el('div', { class: 'row-actions' }, [
                  link('Open in referrals view', `#/referrals/${sr.id}`),
                  button('Run the demo again', {
                    onClick: () => {
                      state.clearIds();
                      draw();
                    }
                  })
                ])
              ])
            : null,
          jsonView(task, `GET /Task/${task.id}`),
          jsonView(sr, `GET /ServiceRequest/${sr.id}`)
        );
      }

      refresh();
    }
  }
};
