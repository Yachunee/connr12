# R12 eReferral Console

A browser front end for the PH eReferral Connectathon labs. It replays the workflow in
`docs/api/collection/R12_PHeRef_Guided_Connectathon_v2.postman_collection.json` through a UI, so the
referral flow can be demonstrated to clinical staff instead of driven from Postman.

Vanilla HTML, CSS and ES modules. No framework, no dependencies, no build step.

## Running it

```sh
python serve.py            # serves src/ on http://localhost:8000
```

Then open <http://localhost:8000/views/index.html>.

Use `serve.py` rather than `python -m http.server`: the latter sends no cache headers, and browsers
then keep executing stale ES modules after an edit — a plain reload does not fix it, because each
module has its own cache entry. `serve.py` sends `Cache-Control: no-store`.

It must be served over HTTP. Opening the file directly does not work: ES modules and CORS both need
an origin.

## Deploying

The app is static, so there is nothing to build. On Vercel, import the GitHub repo and accept
`vercel.json`: framework preset **Other**, **no** build command, output directory `src`. The
root rewrite serves `views/index.html` at `/`, so the deployment URL works bare.

Everything runs in the browser and talks to the CDR directly — there is no server side and no
secret to configure. The one thing to check after the first deploy is that the CDR accepts the
new `*.vercel.app` origin; if it does not, that is a CORS allowlist matter on the CDR, not a
change to this app.

## What it talks to

`https://cdr.pheref.fhirlab.net/fhir` (HAPI FHIR 8.10.0, R4), with terminology from
`https://tx.fhirlab.net/fhir`. No authentication. Both are configurable under Settings.

The CDR allows cross-origin calls, but `Access-Control-Allow-Headers` is `content-type` only.
`Prefer: return=representation` would therefore fail preflight, so the app never sends it — every
PATCH is followed by a re-read instead. If you add a header, check it against that list first.

## Who you are

The server is **shared** with every other Connectathon team and carries the server's own reference
data — currently ~700 Patients and ~200 Organizations. Two settings separate your work from theirs:

- **Team code** — everything the app creates is stamped with
  `meta.tag = {system: https://r12-connectathon.example/team, code: <team code>}`, and your registry
  lists filter on it.
- **My facility** — the Organization that represents you. Referrals whose `performer` is this
  facility appear under **Incoming**, and only those can be received, accepted and completed here.

Set both under Settings before doing anything else. You can claim a facility your team did not
create — useful when your Organization already exists on the server.

### What is scoped and what is not

| Query | Scope |
|---|---|
| Patient / Practitioner / Facility lists | your team tag, with an "include all server data" opt-out |
| Facility search when choosing a referral destination | unscoped — the whole server |
| Outgoing referrals | your team tag |
| Incoming referrals | unscoped, filtered by `performer` = my facility |
| Resolving one referral's Task or Encounter | unscoped — asks "what points at this", not "what is mine" |

The unscoped cases are deliberate. A referral network only works if you can reach other teams'
facilities and act on the referrals they send you.

## The three paths

**Own your registry.** Full CRUD on your patients, practitioners (with their PractitionerRole) and
facilities.

A patient's detail page opens with the whole chart: a demographics summary of everything the
`Patient` resource states, the vital-signs Observations, and **Everything on file** — the rest of
the patient compartment grouped by resource type. That last card asks for `Patient/$everything`
first and falls back to one compartment search per type when the server does not implement the
operation. Both cards are deliberately unscoped: a patient's record may include resources another
team wrote, and hiding those would misrepresent the chart.

**Refer out.** `Referrals → New referral`: pick one of your patients and a requester, search the whole
server for any destination facility, then send — either step by step (one POST per resource, each
response shown) or as a single transaction Bundle. The lifecycle then belongs to the receiving
facility, and the detail view says so rather than offering buttons that would fail.

**Receive in.** `Referrals → Incoming` lists referrals other facilities sent to you. Open one and
drive it through `requested → received → accepted → completed`; completing it creates the Encounter
at your facility and records it as the Task's output.

`#/demo` walks the outbound path in four guided steps with every request and response visible.

## View to collection folder

| View | Collection |
|---|---|
| Dashboard | `00.01` CapabilityStatement |
| Patients | `01.01`, `01.03`, `03B.01`, `03.01` validate |
| Patient record card | `Patient/$everything`, `Observation?category=vital-signs` (beyond the collection) |
| Facilities | `01.02`, `03B.03` |
| Practitioners | `03B.02`, `03B.05` |
| New referral, step by step | `03B.06` – `03B.09`, `03` validate |
| New referral, bundle | `04.01` |
| Referral lists | `05.03`, `05.04` |
| Referral lifecycle | `06.01`, `06.02`, `07.01` – `07.03` |
| Settings request log | Postman console |

## Deliberate deviations from the collection

- **`Encounter.note` is dropped** from the `07.01` body. R4 `Encounter` has no `note` element and the
  CDR rejects it with `422 Unrecognized property 'note'`.
- **`_tag` is added to the `04.01` conditional PUT match URLs.** Those criteria key on NHFR codes,
  and the placeholder codes are shared between teams, so without the tag the server answers
  `412 HAPI-2207: Multiple resources match this search`.
- **The bundle no longer creates the receiving Organization.** The destination already exists and
  usually belongs to another team, so it is referenced by logical ID instead of being an entry.

## Layout

```
serve.py                  no-cache static server
vercel.json               static deploy config: output dir src/, / rewrites to the shell
src/views/index.html      app shell and nav
src/css/app.css           design tokens and components
src/js/config.js          base URLs, identifier systems, profiles, ValueSets
src/js/state.js           localStorage: settings, run ID, captured logical IDs
src/js/fhir.js            the only network layer, plus the request log
src/js/templates.js       resource builders ported from the collection bodies
src/js/workflow.js        referral steps shared by the Referrals view and the demo
src/js/router.js          hash router
src/js/ui.js              DOM helpers, forms, tables, pickers, toasts
src/js/views/             one module per route
docs/api/                 the original Postman collection and environment (reference only,
                          outside the served root so it is not shipped)
```

All network access goes through `src/js/fhir.js`, which is also where the team-tag filter and the
OperationOutcome parsing live. Add calls there rather than calling `fetch` from a view.
