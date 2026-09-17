// Minimal hash router. Patterns use `:name` for a segment placeholder.

const routes = [];
let outlet = null;
let current = null;

export function register(pattern, view) {
  routes.push({ segments: pattern.split('/').filter(Boolean), view, pattern });
}

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, queryString] = raw.split('?');
  return {
    segments: path.split('/').filter(Boolean),
    query: Object.fromEntries(new URLSearchParams(queryString || ''))
  };
}

function match(segments) {
  for (const route of routes) {
    if (route.segments.length !== segments.length) continue;
    const params = {};
    const ok = route.segments.every((s, i) => {
      if (s.startsWith(':')) {
        params[s.slice(1)] = decodeURIComponent(segments[i]);
        return true;
      }
      return s === segments[i];
    });
    if (ok) return { route, params };
  }
  return null;
}

function highlightNav(hash) {
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const target = a.getAttribute('href').replace(/^#/, '');
    const active = hash === target || (target !== '/' && hash.startsWith(target));
    a.classList.toggle('is-active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

async function resolve() {
  const { segments, query } = parseHash();
  const found = match(segments);

  if (current?.destroy) {
    try {
      current.destroy();
    } catch {
      // A failing teardown must not block the next view.
    }
  }
  current = null;
  outlet.innerHTML = '';

  highlightNav('/' + segments.join('/'));

  if (!found) {
    outlet.innerHTML =
      '<section class="card"><h1>Not found</h1><p class="muted">No route matches this URL.</p>' +
      '<a class="btn" href="#/">Back to dashboard</a></section>';
    return;
  }

  current = found.route.view;
  try {
    await found.route.view.render(outlet, found.params, query);
  } catch (err) {
    outlet.innerHTML = `<section class="card error-card"><h1>View failed</h1><pre>${
      err.message
    }</pre></section>`;
  }
}

export function start(el) {
  outlet = el;
  window.addEventListener('hashchange', resolve);
  if (!location.hash) location.hash = '#/';
  resolve();
}

export function go(path) {
  location.hash = path.startsWith('#') ? path : `#${path}`;
}
