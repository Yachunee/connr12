// DOM helpers: element factory, toasts, tables, forms, JSON viewer, confirm dialog.

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  (Array.isArray(children) ? children : [children])
    .filter((c) => c !== null && c !== undefined && c !== false)
    .forEach((c) => node.append(c.nodeType ? c : document.createTextNode(String(c))));
  return node;
}

export function clear(node) {
  node.innerHTML = '';
  return node;
}

function usable(children) {
  return children.flat().filter((c) => c !== null && c !== undefined && c !== false);
}

/** Like `node.append`, but drops null/undefined/false so conditional children work. */
export function append(node, ...children) {
  node.append(...usable(children));
  return node;
}

/** Like `node.replaceChildren`, but drops null/undefined/false. */
export function replace(node, ...children) {
  node.replaceChildren(...usable(children));
  return node;
}

// ---- toasts ----

function toastHost() {
  let host = document.getElementById('toasts');
  if (!host) {
    host = el('div', { id: 'toasts', class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  return host;
}

export function toast(message, kind = 'info') {
  const node = el('div', { class: `toast toast--${kind}`, text: message });
  toastHost().append(node);
  setTimeout(() => node.classList.add('is-leaving'), 4200);
  setTimeout(() => node.remove(), 4800);
  return node;
}

// ---- shared blocks ----

export function pageHeader(title, subtitle, actions = []) {
  return el('header', { class: 'page-head' }, [
    el('div', {}, [
      el('h1', { text: title }),
      subtitle ? el('p', { class: 'muted', text: subtitle }) : null
    ]),
    actions.length ? el('div', { class: 'page-head__actions' }, actions) : null
  ]);
}

export function button(label, opts = {}) {
  return el(
    'button',
    {
      class: `btn ${opts.variant ? `btn--${opts.variant}` : ''}`.trim(),
      type: opts.type || 'button',
      onclick: opts.onClick,
      disabled: opts.disabled,
      title: opts.title
    },
    label
  );
}

export function link(label, href, opts = {}) {
  return el('a', { class: `btn ${opts.variant ? `btn--${opts.variant}` : ''}`.trim(), href }, label);
}

/**
 * The "include all server data" opt-out for list views. Off on every page load: the CDR is
 * shared, so an unscoped search returns the server's reference data and other teams' work.
 * Returns the label element with a `.checked` getter.
 */
export function scopeToggle(onChange) {
  const input = el('input', { type: 'checkbox', onchange: onChange });
  const node = el('label', { class: 'toggle toggle--scope' }, [
    input,
    ' Include all server data (other teams and reference records)'
  ]);
  Object.defineProperty(node, 'checked', { get: () => input.checked });
  return node;
}

/** Banner shown while a list is displaying data this team did not create. */
export function scopeWarning() {
  return el('div', { class: 'alert alert--warn' }, [
    el('strong', { text: 'Showing the whole shared server.' }),
    el('p', {
      text: 'These records include other teams’ work and the server’s reference data. Only rows your team created can be safely edited or deleted.'
    })
  ]);
}

/**
 * Search-and-pick for a referral destination. `search(text)` returns Organizations;
 * `onPick(org)` fires when one is chosen. Returns the node with a `.selected` getter.
 *
 * A dropdown is wrong here: the destination is any of the 200+ facilities on the shared
 * server, most of them other teams'.
 */
export function facilityPicker({ search, onPick, selected = null, label = 'Destination facility' }) {
  let current = selected;

  const input = el('input', {
    type: 'search',
    placeholder: 'Facility name or NHFR code…',
    'aria-label': label
  });
  const results = el('div', { class: 'picker__results' });
  const chosen = el('div', { class: 'picker__chosen' });

  const nhfrOf = (org) =>
    (org.identifier || []).find((i) => i.system?.includes('doh-nhfr-code'))?.value ||
    org.identifier?.[0]?.value ||
    '';

  function renderChosen() {
    if (!current) {
      chosen.replaceChildren(el('span', { class: 'muted', text: 'No facility selected yet.' }));
      return;
    }
    chosen.replaceChildren(
      el('span', { class: 'chip' }, [
        el('strong', { text: current.name || `Organization/${current.id}` }),
        el('code', { text: nhfrOf(current) || current.id }),
        el('button', {
          type: 'button',
          class: 'chip__clear',
          'aria-label': 'Clear selected facility',
          text: '×',
          onclick: () => {
            current = null;
            renderChosen();
            onPick?.(null);
          }
        })
      ])
    );
  }

  async function run() {
    results.replaceChildren(el('p', { class: 'muted', text: 'Searching…' }));
    try {
      const rows = await search(input.value);
      results.replaceChildren(
        ...(rows.length
          ? rows.map((org) =>
              el('button', {
                type: 'button',
                class: 'picker__hit',
                onclick: () => {
                  current = org;
                  results.replaceChildren();
                  input.value = '';
                  renderChosen();
                  onPick?.(org);
                },
                html: `<strong>${org.name || 'Unnamed facility'}</strong><code>${
                  nhfrOf(org) || org.id
                }</code>`
              })
            )
          : [el('p', { class: 'muted', text: 'No facility matched.' })])
      );
    } catch (err) {
      results.replaceChildren(el('p', { class: 'alert alert--error', text: err.message }));
    }
  }

  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, 300);
  });
  // Enter inside a form would submit it; search instead.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(timer);
      run();
    }
  });

  const node = el('div', { class: 'field field--full picker' }, [
    el('label', { text: label }),
    input,
    chosen,
    results
  ]);
  Object.defineProperty(node, 'selected', { get: () => current });
  renderChosen();
  return node;
}

export function spinner(text = 'Loading…') {
  return el('div', { class: 'loading' }, [el('span', { class: 'spinner' }), text]);
}

export function empty(text, action) {
  return el('div', { class: 'empty' }, [el('p', { text }), action || null]);
}

export function errorBox(err) {
  const issues = err?.outcome?.issue || [];
  return el('div', { class: 'alert alert--error' }, [
    el('strong', { text: err?.message || String(err) }),
    issues.length
      ? el(
          'ul',
          { class: 'alert__issues' },
          issues.map((i) =>
            el('li', { text: `${i.severity}/${i.code}: ${i.diagnostics || i.details?.text || ''}` })
          )
        )
      : null
  ]);
}

export function statusPill(status, flow = []) {
  const index = flow.indexOf(status);
  const tone =
    status === 'completed' || status === 'accepted'
      ? 'ok'
      : status === 'cancelled' || status === 'rejected' || status === 'entered-in-error'
        ? 'bad'
        : index >= 0
          ? 'warn'
          : 'neutral';
  return el('span', { class: `pill pill--${tone}`, text: status || 'unknown' });
}

export function progressStrip(flow, current) {
  const idx = flow.indexOf(current);
  return el(
    'ol',
    { class: 'strip' },
    flow.map((step, i) =>
      el('li', {
        class: `strip__step ${i < idx ? 'is-done' : ''} ${i === idx ? 'is-current' : ''}`.trim(),
        text: step
      })
    )
  );
}

/**
 * @param {{key:string,label:string,render?:(row:any)=>any}[]} columns
 */
export function table(columns, rows, opts = {}) {
  if (!rows.length) return empty(opts.emptyText || 'Nothing here yet.', opts.emptyAction);
  return el('div', { class: 'table-wrap' }, [
    el('table', { class: 'table' }, [
      el('thead', {}, [el('tr', {}, columns.map((c) => el('th', { text: c.label })))]),
      el(
        'tbody',
        {},
        rows.map((row) =>
          el(
            'tr',
            { class: opts.onRowClick ? 'is-clickable' : '', onclick: opts.onRowClick ? () => opts.onRowClick(row) : undefined },
            columns.map((c) => {
              const value = c.render ? c.render(row) : row[c.key];
              return el('td', { 'data-label': c.label }, value === undefined || value === null ? '—' : value);
            })
          )
        )
      )
    ])
  ]);
}

export function jsonView(value, label = 'JSON') {
  return el('details', { class: 'json' }, [
    el('summary', { text: label }),
    el('pre', { text: JSON.stringify(value, null, 2) })
  ]);
}

// ---- forms ----

/**
 * Build a form from a field spec.
 * Field: {name, label, type, value, options, required, hint, span}
 */
export function form(fields, { submitLabel = 'Save', onSubmit, extra } = {}) {
  const node = el('form', { class: 'form' });
  const grid = el('div', { class: 'form__grid' });

  fields.forEach((f) => {
    if (f.type === 'section') {
      grid.append(el('h3', { class: 'form__section', text: f.label }));
      return;
    }
    const id = `f-${f.name}`;
    let input;
    if (f.type === 'select') {
      input = el(
        'select',
        { id, name: f.name, required: f.required },
        (f.options || []).map((o) => {
          const value = typeof o === 'string' ? o : o.value;
          const text = typeof o === 'string' ? o : o.label;
          return el('option', { value, selected: String(value) === String(f.value ?? '') }, text);
        })
      );
    } else if (f.type === 'textarea') {
      input = el('textarea', { id, name: f.name, rows: f.rows || 3, required: f.required }, f.value || '');
    } else if (f.type === 'checkbox') {
      input = el('input', { id, name: f.name, type: 'checkbox', checked: !!f.value });
    } else {
      input = el('input', {
        id,
        name: f.name,
        type: f.type || 'text',
        value: f.value ?? '',
        required: f.required,
        placeholder: f.placeholder,
        step: f.step,
        min: f.min,
        max: f.max
      });
    }
    grid.append(
      el('div', { class: `field ${f.span === 'full' ? 'field--full' : ''} ${f.type === 'checkbox' ? 'field--inline' : ''}`.trim() }, [
        el('label', { for: id, text: f.label }),
        input,
        f.hint ? el('small', { class: 'muted', text: f.hint }) : null
      ])
    );
  });

  node.append(grid);
  if (extra) node.append(extra);
  node.append(
    el('div', { class: 'form__actions' }, [button(submitLabel, { type: 'submit', variant: 'primary' })])
  );

  node.addEventListener('submit', (e) => {
    e.preventDefault();
    onSubmit?.(readForm(node), node);
  });
  return node;
}

export function readForm(formNode) {
  const out = {};
  new FormData(formNode).forEach((v, k) => {
    out[k] = v;
  });
  formNode.querySelectorAll('input[type=checkbox]').forEach((c) => {
    out[c.name] = c.checked;
  });
  return out;
}

export function setBusy(formNode, busy) {
  formNode.querySelectorAll('button, input, select, textarea').forEach((n) => {
    n.disabled = busy;
  });
}

export function confirmDialog(message) {
  return window.confirm(message);
}

// ---- resource display helpers ----

export function humanName(resource) {
  const n = resource?.name?.[0];
  if (!n) return resource?.name || '(no name)';
  return [n.prefix?.join(' '), n.given?.join(' '), n.family].filter(Boolean).join(' ');
}

export function identifierOf(resource, system) {
  const list = resource?.identifier || [];
  const hit = system ? list.find((i) => i.system === system) : list[0];
  return hit?.value || '';
}

export function shortDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}
