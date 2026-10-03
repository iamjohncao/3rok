/* @ds-bundle: {"format":4,"namespace":"Rok","components":[{"name":"Button"},{"name":"NavBar"},{"name":"Hero"},{"name":"Panel"},{"name":"Stat"},{"name":"StatusBadge"},{"name":"Field"},{"name":"Tabs"},{"name":"DataTable"},{"name":"ProgressBar"},{"name":"PlacementMap"}]} */
(function () {
  var React = window.React;
  var h = React.createElement;

  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]);
    return out.join(' ');
  }

  var Arrow = function () {
    return h('svg', { viewBox: '0 0 14 14', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 },
      h('path', { d: 'M1 7h12M8 2l5 5-5 5' }));
  };

  function Button(props) {
    var variant = props.variant || 'ghost';
    var cls = cx('rok-btn', 'button', variant === 'solid' && 'rok-btn--solid', variant === 'quiet' && 'rok-btn--quiet', props.size === 'sm' && 'rok-btn--sm', props.className);
    var rest = {};
    for (var k in props) if (k !== 'variant' && k !== 'size' && k !== 'className' && k !== 'children' && k !== 'arrow' && k !== 'href') rest[k] = props[k];
    rest.className = cls;
    var kids = [props.children];
    if (props.arrow || variant === 'quiet') kids.push(h(Arrow, { key: 'a' }));
    if (props.href) { rest.href = props.href; return h('a', rest, kids); }
    rest.type = rest.type || 'button';
    return h('button', rest, kids);
  }

  function NavBar(props) {
    var links = props.links || [];
    return h('header', { className: cx('rok-nav', props.className) },
      h('a', { className: 'rok-nav__mark', href: props.homeHref || '#' }, props.brand || '3rok'),
      h('nav', { 'aria-label': 'Primary' },
        h('ul', { className: 'rok-nav__links' }, links.map(function (l) {
          return h('li', { key: l.label },
            h('a', { className: 'rok-nav__link eyebrow', href: l.href || '#', 'aria-current': l.label === props.active ? 'page' : undefined }, l.label));
        }))),
      props.action || null);
  }

  function Hero(props) {
    return h('section', { className: cx('rok-hero', props.className) },
      h('div', { className: 'rok-hero__grid', 'aria-hidden': 'true' }),
      h('div', { className: 'rok-hero__body' },
        props.eyebrow ? h('p', { className: 'rok-hero__eyebrow eyebrow' }, props.eyebrow) : null,
        h('h1', { className: 'rok-hero__title display-xl' }, props.title),
        props.text ? h('p', { className: 'rok-hero__text body-lg' }, props.text) : null,
        props.children ? h('div', { className: 'rok-hero__actions' }, props.children) : null));
  }

  function Panel(props) {
    return h('section', { className: cx('rok-panel', props.className) },
      props.eyebrow ? h('p', { className: 'rok-panel__eyebrow eyebrow' }, props.eyebrow) : null,
      props.title ? h('h2', { className: 'rok-panel__title heading-md' }, props.title) : null,
      props.children);
  }

  var SHAPES = {
    nominal: h('svg', { viewBox: '0 0 10 10', 'aria-hidden': 'true' }, h('circle', { cx: 5, cy: 5, r: 5, fill: 'currentColor' })),
    caution: h('svg', { viewBox: '0 0 10 10', 'aria-hidden': 'true' }, h('path', { d: 'M5 0l5 10H0z', fill: 'currentColor' })),
    critical: h('svg', { viewBox: '0 0 10 10', 'aria-hidden': 'true' }, h('rect', { width: 10, height: 10, fill: 'currentColor' }))
  };
  var WORDS = { nominal: 'Nominal', caution: 'Caution', critical: 'Critical' };

  function StatusBadge(props) {
    var s = props.status || 'nominal';
    return h('span', { className: cx('rok-badge', 'rok-badge--' + s, 'eyebrow', props.className) }, SHAPES[s], props.children || WORDS[s]);
  }

  function Stat(props) {
    return h('div', { className: cx('rok-stat', props.className) },
      h('p', { className: 'rok-stat__label eyebrow' }, props.label),
      h('div', { className: 'rok-stat__row' },
        h('span', { className: 'rok-stat__value data-xl' }, props.value),
        props.unit ? h('span', { className: 'rok-stat__unit data-md' }, props.unit) : null),
      (props.delta || props.status) ? h('div', { className: 'rok-stat__meta data-sm' }, props.delta, props.status ? h(StatusBadge, { status: props.status }) : null) : null);
  }

  var fieldId = 0;
  function Field(props) {
    var id = props.id || ('rok-field-' + (++fieldId));
    var rest = {};
    for (var k in props) if (k !== 'label' && k !== 'hint' && k !== 'error' && k !== 'mono' && k !== 'className') rest[k] = props[k];
    rest.id = id;
    rest.className = cx('rok-field__input', 'body', props.mono && 'rok-mono');
    if (props.error) rest['aria-invalid'] = 'true';
    rest['aria-describedby'] = (props.hint || props.error) ? id + '-hint' : undefined;
    return h('div', { className: cx('rok-field', props.error && 'rok-field--error', props.className) },
      h('label', { className: 'rok-field__label eyebrow', htmlFor: id }, props.label),
      h('input', rest),
      (props.error || props.hint) ? h('p', { id: id + '-hint', className: 'rok-field__hint body-sm' }, props.error || props.hint) : null);
  }

  function Tabs(props) {
    var tabs = props.tabs || [];
    return h('div', { className: cx('rok-tabs', props.className), role: 'tablist' }, tabs.map(function (t) {
      var sel = t.value === props.value;
      return h('button', { key: t.value, type: 'button', role: 'tab', 'aria-selected': sel ? 'true' : 'false', className: 'rok-tab button', onClick: function () { if (props.onChange) props.onChange(t.value); } }, t.label);
    }));
  }

  function DataTable(props) {
    var cols = props.columns || [];
    var rows = props.rows || [];
    return h('table', { className: cx('rok-table', props.className) },
      h('thead', null, h('tr', null, cols.map(function (c) {
        return h('th', { key: c.key, scope: 'col', className: cx('eyebrow', c.numeric && 'rok-num') }, c.label);
      }))),
      h('tbody', null, rows.map(function (r, i) {
        return h('tr', { key: r.id != null ? r.id : i }, cols.map(function (c) {
          return h('td', { key: c.key, className: c.numeric ? 'rok-num' : undefined }, c.render ? c.render(r[c.key], r) : r[c.key]);
        }));
      })));
  }

  function ProgressBar(props) {
    var v = Math.max(0, Math.min(100, props.value));
    return h('div', { className: cx('rok-progress', props.tone && 'rok-progress--' + props.tone, props.className) },
      h('div', { className: 'rok-progress__head' },
        h('span', { className: 'rok-progress__label eyebrow' }, props.label),
        h('span', { className: 'rok-progress__value data-md' }, props.display || (Math.round(v) + '%'))),
      h('div', { className: 'rok-progress__track', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(v), 'aria-label': props.label },
        h('div', { className: 'rok-progress__fill', style: { width: v + '%' } })));
  }

  function bin(heat) {
    var b = Math.floor(Math.max(0, Math.min(0.999, heat)) * 5) + 1;
    return b;
  }

  function PlacementMap(props) {
    var cols = props.cols || 8, rows = props.rows || 5, cell = props.cell || 72, pad = 8;
    var chips = props.chips || [];
    var w = cols * cell, ht = rows * cell;
    var slots = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      slots.push(h('rect', { key: 's' + c + '-' + r, className: 'rok-map__slot', x: c * cell, y: r * cell, width: cell, height: cell }));
    }
    var items = chips.map(function (ch) {
      var x = ch.col * cell, y = ch.row * cell, sel = ch.id === props.selected;
      return h('g', { key: ch.id, onClick: function () { if (props.onSelect) props.onSelect(ch.id); } },
        h('title', null, ch.id + ' · stress ' + Math.round(ch.heat * 100) + '%'),
        h('rect', { className: cx('rok-map__chip', 'rok-heat-' + bin(ch.heat), sel && 'rok-map__chip--selected'), x: x + pad, y: y + pad, width: cell - 2 * pad, height: cell - 2 * pad - 14 }),
        h('text', { className: 'rok-map__label', x: x + cell / 2, y: y + cell - 8 }, ch.id));
    });
    return h('figure', { className: cx('rok-map', props.className), style: { margin: 0 } },
      h('svg', { width: w, height: ht, viewBox: '0 0 ' + w + ' ' + ht, role: 'img', 'aria-label': props.label || 'Chip placement map' }, slots, items),
      h('figcaption', { className: 'rok-map__legend eyebrow' }, 'Low stress',
        [1, 2, 3, 4, 5].map(function (n) { return h('span', { key: n, className: 'rok-map__swatch rok-heat-' + n, 'aria-hidden': 'true' }); }),
        'High stress'));
  }

  window.Rok = { Button: Button, NavBar: NavBar, Hero: Hero, Panel: Panel, Stat: Stat, StatusBadge: StatusBadge, Field: Field, Tabs: Tabs, DataTable: DataTable, ProgressBar: ProgressBar, PlacementMap: PlacementMap };
})();
