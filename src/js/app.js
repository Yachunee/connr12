// Entry point: wire the route table and boot the router.

import { register, start } from './router.js';
import dashboard from './views/dashboard.js';
import demo from './views/demo.js';
import settings from './views/settings.js';
import * as patients from './views/patients.js';
import * as facilities from './views/facilities.js';
import * as practitioners from './views/practitioners.js';
import * as referrals from './views/referrals.js';

register('/', dashboard);
register('/demo', demo);
register('/settings', settings);

// `new` is registered before `:id` so it never falls through to the detail view.
register('/patients', patients.list);
register('/patients/new', patients.create);
register('/patients/:id', patients.detail);

register('/facilities', facilities.list);
register('/facilities/new', facilities.create);
register('/facilities/:id', facilities.detail);

register('/practitioners', practitioners.list);
register('/practitioners/new', practitioners.create);
register('/practitioners/:id', practitioners.detail);

register('/referrals', referrals.list);
register('/referrals/new', referrals.create);
register('/referrals/:id', referrals.detail);

start(document.getElementById('outlet'));
