// Block-diagram editor: canvas rendering, mouse/keyboard editing, palette and inspector.
(function () {
  const GV = globalThis.GV;
  const { $, esc } = GV;
  const A = () => GV.App;
  const UI = (GV.CircuitUI = {});
  const snap = (v) => (A().settings.snap ? Math.round(v / 10) * 10 : Math.round(v));

  function view() {
    const a = A();
    return a.views['c:' + a.circuit] || (a.views['c:' + a.circuit] = { x: 60, y: 90, k: 1 });
  }
  function toWorld(e) {
    const r = $('#circuitCanvas').getBoundingClientRect();
    const v = view();
    return { x: (e.clientX - r.left - v.x) / v.k, y: (e.clientY - r.top - v.y) / v.k };
  }

  // Remove wires whose endpoints no longer exist and keep one driver per input pin.
  GV.pruneWires = function (project) {
    for (const circ of Object.values(project.circuits)) {
      const ports = new Map(circ.components.map((c) => [c.id, GV.getPorts(c, project)]));
      const seen = new Set();
      circ.wires = circ.wires.filter((w) => {
        const f = ports.get(w.from.c), t = ports.get(w.to.c);
        if (!f || !t || !f.outs.some((p) => p.name === w.from.p) || !t.ins.some((p) => p.name === w.to.p)) return false;
        const k = w.to.c + ':' + w.to.p;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
  };

  // ---------- drawing ----------
  function compColor(c) {
    const s = A().settings;
    if (c.color) return c.color;
    if (c.type === 'lib') { const d = A().project.library[c.props.lib]; if (d && d.color) return d.color; }
    return s.catColors[GV.TYPES[c.type].cat] || s.accent;
  }

  function orPath(x0, x1, h) {
    const w = x1 - x0;
    return `M${x0} 0 Q${x0 + w * 0.25} ${h / 2} ${x0} ${h} Q${x0 + w * 0.62} ${h} ${x1} ${h / 2} Q${x0 + w * 0.62} 0 ${x0} 0 Z`;
  }
  const rrect = (w, h, r = 6) => `M${r} 0 H${w - r} Q${w} 0 ${w} ${r} V${h - r} Q${w} ${h} ${w - r} ${h} H${r} Q0 ${h} 0 ${h - r} V${r} Q0 0 ${r} 0 Z`;

  function shapeFor(c, L) {
    const { w, h } = L.size;
    const t = GV.TYPES[c.type];
    const style = A().settings.gateStyle;
    const inv = ['nand', 'nor', 'xnor', 'not'].includes(c.type);
    const wb = inv ? w - 8 : w;
    const extra = [];
    let d;
    if (['and', 'or', 'xor', 'nand', 'nor', 'xnor', 'not'].includes(c.type)) {
      if (style === 'iec') {
        d = rrect(wb, h, 3);
        const sym = { and: '&', nand: '&', or: '≥1', nor: '≥1', xor: '=1', xnor: '=1', not: '1' }[c.type];
        extra.push(`<text x="${wb / 2}" y="${h / 2 + 5}" text-anchor="middle" class="title">${sym}</text>`);
      } else if (c.type === 'and' || c.type === 'nand') d = `M0 0 H${wb / 2} A${wb / 2} ${h / 2} 0 0 1 ${wb / 2} ${h} H0 Z`;
      else if (c.type === 'or' || c.type === 'nor') d = orPath(0, wb, h);
      else if (c.type === 'xor' || c.type === 'xnor') { d = orPath(7, wb, h); extra.push(`<path d="M0 0 Q${(wb - 7) * 0.25} ${h / 2} 0 ${h}" fill="none" class="comp-body"/>`); }
      else d = `M0 ${h / 2 - 18} L${wb} ${h / 2} L0 ${h / 2 + 18} Z`;
      if (inv) extra.push(`<circle cx="${w - 4}" cy="${h / 2}" r="4" fill="var(--body)" class="comp-body"/>`);
      if (c.props.width > 1) extra.push(`<text x="${wb * 0.35}" y="${h - 5}" text-anchor="middle" class="lbl">${c.props.width}b</text>`);
      return { d, extra };
    }
    switch (t.shape) {
      case 'input': d = `M0 0 H${w - 14} L${w} ${h / 2} L${w - 14} ${h} H0 Z`; break;
      case 'output': d = `M14 0 H${w} V${h} H14 L0 ${h / 2} Z`; break;
      case 'mux': d = `M0 0 L${w} 16 L${w} ${h - 16} L0 ${h} Z`; break;
      case 'note': d = `M0 0 H${w - 12} L${w} 12 V${h} H0 Z`; break;
      case 'fsmblock': d = rrect(w, h, 14); break;
      case 'probe': d = rrect(w, h, h / 2); break;
      default: d = rrect(w, h, t.shape === 'module' ? 2 : 6);
    }
    return { d, extra };
  }

  function fmt(v, w) { return GV.formatValue(v, w, A().settings.radix); }

  function drawComp(c, L, sim, selected) {
    const project = A().project;
    const { w, h } = L.size;
    const color = compColor(c);
    const t = GV.TYPES[c.type];
    const { d, extra } = shapeFor(c, L);
    const parts = [];
    const isNote = c.type === 'note';
    // Input stubs under gate bodies.
    if (['or', 'nor', 'xor', 'xnor'].includes(c.type) && A().settings.gateStyle !== 'iec') for (const p of L.ins) parts.push(`<line x1="0" y1="${p.y}" x2="14" y2="${p.y}" class="comp-body"/>`);
    parts.push(`<path d="${d}" fill="var(--body)" class="comp-body" style="stroke:${color}"/>`);
    parts.push(`<path d="${d}" fill="${color}" fill-opacity="${isNote ? 0.22 : 0.16}" stroke="none"/>`);
    parts.push(...extra.map((x) => x.replace('class="comp-body"', `class="comp-body" style="stroke:${color}"`)));
    const title = GV.blockTitle(c, project);
    const sv = sim ? (k) => sim.root.nets.get(c.id + ':' + k) : null;

    switch (c.type) {
      case 'input': {
        const wd = L.outs[0].w;
        parts.push(`<text x="8" y="${h / 2 + 4}" class="title">${esc(c.props.name)}</text>`);
        if (sim) {
          const v = sim.inputs[GV.sanitize(c.props.name)] ?? 0n;
          if (wd === 1) parts.push(`<rect x="${w - 40}" y="${h / 2 - 8}" width="20" height="16" rx="4" fill="${v ? 'var(--hi)' : 'var(--lo)'}"/><text x="${w - 30}" y="${h / 2 + 4}" text-anchor="middle" style="fill:#fff">${v}</text>`);
          else parts.push(`<text x="${w - 18}" y="${h / 2 + 4}" text-anchor="end" class="val" style="fill:var(--bus)">${esc(fmt(v, wd))}</text>`);
        } else if (wd > 1) parts.push(`<text x="${w - 18}" y="${h / 2 + 4}" text-anchor="end" class="lbl">[${wd - 1}:0]</text>`);
        break;
      }
      case 'output': {
        const wd = L.ins[0].w;
        parts.push(`<text x="20" y="${h / 2 + 4}" class="title">${esc(c.props.name)}</text>`);
        if (sim) {
          const v = sim.root.outputs[GV.sanitize(c.props.name)] ?? 0n;
          parts.push(wd === 1 ? `<circle cx="${w - 14}" cy="${h / 2}" r="7" fill="${v ? 'var(--hi)' : 'var(--lo)'}"/>` : `<text x="${w - 6}" y="${h / 2 + 4}" text-anchor="end" style="fill:var(--bus);font-weight:600">${esc(fmt(v, wd))}</text>`);
        } else if (wd > 1) parts.push(`<text x="${w - 6}" y="${h / 2 + 4}" text-anchor="end" class="lbl">[${wd - 1}:0]</text>`);
        break;
      }
      case 'probe': {
        const v = sim ? sim.root.probes[c.id] ?? 0n : null;
        parts.push(`<text x="${w / 2 + 3}" y="${h / 2 + 4}" text-anchor="middle" style="fill:var(--bus);font-weight:600">${v == null ? '◉ probe' : esc(fmt(v, L.ins[0].w))}</text>`);
        break;
      }
      case 'const':
        parts.push(`<text x="${w / 2 - 2}" y="${h / 2 + 4}" text-anchor="middle" class="title">${esc(c.props.value)}</text>`);
        break;
      case 'note': {
        const lines = GV.wrapText(c.props.text || '', Math.floor((w - 16) / 7));
        lines.forEach((ln, i) => parts.push(`<text x="8" y="${18 + i * 16}" style="font:12px system-ui,sans-serif">${esc(ln)}</text>`));
        break;
      }
      case 'mux':
        L.ins.slice(0, -1).forEach((p, i) => parts.push(`<text x="5" y="${p.y + 4}" class="lbl">${i}</text>`));
        break;
      default:
        if (['and', 'or', 'xor', 'nand', 'nor', 'xnor', 'not'].includes(c.type)) break;
        parts.push(`<text x="${w / 2}" y="14" text-anchor="middle" class="title">${esc(title)}</text>`);
        for (const p of L.ins) parts.push(`<text x="6" y="${p.y + 4}" class="lbl">${esc(p.name)}</text>`);
        for (const p of L.outs) parts.push(`<text x="${w - 6}" y="${p.y + 4}" text-anchor="end" class="lbl">${esc(p.name)}</text>`);
        if (t.shape === 'reg') parts.push(`<path d="M0 ${h - 16} L9 ${h - 10} L0 ${h - 4}" fill="none" class="comp-body" style="stroke:${color}"/>`);
        if (sim && (c.type === 'register' || c.type === 'counter')) {
          parts.push(`<text x="${w / 2}" y="${h - 6}" text-anchor="middle" style="fill:var(--bus);font-weight:600">${esc(fmt(sim.root.state.get(c.id) ?? 0n, L.outs[0].w))}</text>`);
        }
        if (sim && c.type === 'fsm') {
          const st = sim.root.fsmStates()[c.id];
          if (st) parts.push(`<text x="${w / 2}" y="${h - 6}" text-anchor="middle" style="fill:var(--hi);font-weight:600">● ${esc(st)}</text>`);
        }
    }
    if (c.label && c.type !== 'note') parts.push(`<text x="0" y="-6" class="lbl">${esc(c.label)}</text>`);
    for (const p of L.ins) parts.push(`<circle class="port" data-port="${c.id}|in|${esc(p.name)}" cx="${p.x}" cy="${p.y}" r="4"><title>${esc(p.name)} [${p.w} bit${p.w > 1 ? 's' : ''}] input</title></circle>`);
    for (const p of L.outs) parts.push(`<circle class="port" data-port="${c.id}|out|${esc(p.name)}" cx="${p.x}" cy="${p.y}" r="4"><title>${esc(p.name)} [${p.w} bit${p.w > 1 ? 's' : ''}] output</title></circle>`);
    void sv;
    return `<g class="comp${selected ? ' selected' : ''}" data-comp="${c.id}" transform="translate(${c.x},${c.y})">${parts.join('')}</g>`;
  }

  function wirePath(a, b, bottom) {
    const style = A().settings.wireStyle;
    if (style === 'straight') return `M${a.x} ${a.y} L${b.x} ${b.y}`;
    if (style === 'curved') {
      const dx = Math.max(30, Math.abs(b.x - a.x) / 2);
      if (bottom) return `M${a.x} ${a.y} C${a.x + dx} ${a.y}, ${b.x} ${b.y + dx}, ${b.x} ${b.y}`;
      return `M${a.x} ${a.y} C${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
    }
    if (bottom) {
      if (b.x > a.x + 20 && a.y > b.y) return `M${a.x} ${a.y} H${b.x} V${b.y}`;
      return `M${a.x} ${a.y} H${a.x + 15} V${b.y + 20} H${b.x} V${b.y}`;
    }
    if (b.x >= a.x + 20) {
      const mx = Math.round((a.x + b.x) / 2 / 10) * 10;
      return `M${a.x} ${a.y} H${mx} V${b.y} H${b.x}`;
    }
    const ym = Math.abs(a.y - b.y) > 50 ? (a.y + b.y) / 2 : Math.max(a.y, b.y) + 50;
    return `M${a.x} ${a.y} H${a.x + 15} V${ym} H${b.x - 15} V${b.y} H${b.x}`;
  }

  UI.portAbs = function (cid, dir, name) {
    const c = A().circ.components.find((x) => x.id === cid);
    const L = UI.layouts && UI.layouts.get(cid);
    if (!c || !L) return null;
    const p = (dir === 'in' ? L.ins : L.outs).find((q) => q.name === name);
    return p ? { x: c.x + p.x, y: c.y + p.y, w: p.w, bottom: p.bottom } : null;
  };

  UI.renderCanvas = function () {
    const a = A();
    const svg = $('#circuitCanvas');
    if (a.tab !== 'circuit') return;
    const circ = a.circ;
    const s = a.settings;
    const v = view();
    const sim = a.sim instanceof GV.Simulator ? a.sim : null;
    UI.layouts = new Map(circ.components.map((c) => [c.id, GV.portLayout(c, a.project)]));
    const g = 20 * v.k;
    const grid = s.grid
      ? `<defs><pattern id="gridp" width="${g}" height="${g}" patternUnits="userSpaceOnUse" x="${v.x % g}" y="${v.y % g}"><circle cx="${g / 2}" cy="${g / 2}" r="${Math.max(0.8, v.k)}" fill="var(--grid)"/></pattern></defs><rect width="100%" height="100%" fill="url(#gridp)"/>`
      : '';
    const wires = [];
    const labels = [];
    const labeled = new Set();
    for (const w of circ.wires) {
      const pa = UI.portAbs(w.from.c, 'out', w.from.p);
      const pb = UI.portAbs(w.to.c, 'in', w.to.p);
      if (!pa || !pb) continue;
      const d = wirePath(pa, pb, pb.bottom);
      const cls = ['wire'];
      if (pa.w > 1) cls.push('bus');
      const key = w.from.c + ':' + w.from.p;
      if (sim) {
        const val = sim.root.nets.get(key) ?? 0n;
        cls.push(pa.w === 1 ? (val ? 'hi' : 'lo') : 'busv');
        if (pa.w > 1 && !labeled.has(key)) labels.push(`<text class="wval" x="${pa.x + 8}" y="${pa.y - 6}">${esc(fmt(val, pa.w))}</text>`);
      } else if (s.showWidths && pa.w > 1 && !labeled.has(key)) {
        labels.push(`<text class="wlabel" x="${pa.x + 8}" y="${pa.y - 6}">${pa.w}</text>`);
      }
      labeled.add(key);
      if (a.sel.has(w.id)) cls.push('selected');
      const mismatch = pa.w !== pb.w;
      const style = [w.color ? `stroke:${w.color}` : '', mismatch ? 'stroke-dasharray:6 4' : ''].filter(Boolean).join(';');
      wires.push(`<g data-wire="${w.id}"><path class="wire-hit" d="${d}"/><path class="${cls.join(' ')}" d="${d}" style="${style}">${mismatch ? `<title>Width mismatch: ${pa.w} → ${pb.w} bits</title>` : ''}</path></g>`);
    }
    const comps = circ.components.map((c) => drawComp(c, UI.layouts.get(c.id), sim, a.sel.has(c.id)));
    svg.innerHTML = `${grid}<g id="world" transform="translate(${v.x},${v.y}) scale(${v.k})">${wires.join('')}${labels.join('')}${comps.join('')}<g id="cOverlay"></g></g>`;
    renderOverlay();
  };

  function renderOverlay() {
    const a = A();
    const ov = $('#overlay');
    const empty = !a.circ.components.length;
    ov.innerHTML = `
      ${a.simError ? `<div class="banner">⚠ ${esc(a.simError)}</div>` : ''}
      ${empty ? `<div class="empty-hint">Drag blocks from the left onto this canvas, then drag from a pin to another pin to wire them.<br>Start with an Input, a gate and an Output.</div>` : ''}
      <div class="zoombar"><button data-z="out" title="Zoom out">−</button><button data-z="fit" title="Fit (F)">Fit</button><button data-z="in" title="Zoom in">+</button></div>`;
    ov.querySelectorAll('[data-z]').forEach((b) => (b.onclick = () => { const z = b.dataset.z; if (z === 'fit') UI.fit(); else zoomAt(z === 'in' ? 1.2 : 1 / 1.2); }));
  }

  function zoomAt(f, cx, cy) {
    const v = view();
    const r = $('#circuitCanvas').getBoundingClientRect();
    if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
    const k = Math.max(0.2, Math.min(3, v.k * f));
    v.x = cx - ((cx - v.x) * k) / v.k;
    v.y = cy - ((cy - v.y) * k) / v.k;
    v.k = k;
    UI.renderCanvas();
  }

  UI.fit = function () {
    const a = A();
    const comps = a.circ.components;
    const r = $('#circuitCanvas').getBoundingClientRect();
    const v = view();
    if (!comps.length || !r.width) { Object.assign(v, { x: 60, y: 90, k: 1 }); UI.renderCanvas(); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of comps) {
      const s = GV.getSize(c, a.project);
      x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y - 14); x1 = Math.max(x1, c.x + s.w); y1 = Math.max(y1, c.y + s.h);
    }
    const k = Math.max(0.2, Math.min(1.6, Math.min((r.width - 80) / (x1 - x0), (r.height - 80) / (y1 - y0))));
    v.k = k;
    v.x = (r.width - (x1 - x0) * k) / 2 - x0 * k;
    v.y = (r.height - (y1 - y0) * k) / 2 - y0 * k;
    UI.renderCanvas();
  };

  // ---------- editing helpers ----------
  function uniquePortName(type) {
    const used = new Set(A().circ.components.filter((c) => c.type === 'input' || c.type === 'output').map((c) => GV.sanitize(c.props.name)));
    const cands = type === 'input' ? 'abcdefghjkmnpqstuvw'.split('') : ['y', 'z', ...Array.from({ length: 50 }, (_, i) => 'out' + (i + 1))];
    for (const n of cands) if (!used.has(n)) return n;
    let i = 1;
    while (used.has((type === 'input' ? 'in' : 'out') + i)) i++;
    return (type === 'input' ? 'in' : 'out') + i;
  }

  // Nearest position to (x, y) where a w×h block does not overlap existing blocks.
  function freeSpot(x, y, w, h) {
    const a = A();
    const boxes = a.circ.components.map((c) => { const s = GV.getSize(c, a.project); return { x: c.x - 20, y: c.y - 30, w: s.w + 40, h: s.h + 50 }; });
    const free = (px, py) => !boxes.some((b) => px < b.x + b.w && px + w > b.x && py < b.y + b.h && py + h > b.y);
    for (let ring = 0; ring < 30; ring++) {
      for (let i = -ring; i <= ring; i++) {
        for (const [dx, dy] of [[i, -ring], [i, ring], [-ring, i], [ring, i]]) {
          const px = x + dx * 40, py = y + dy * 40;
          if (free(px, py)) return { x: px, y: py };
        }
      }
    }
    return { x, y };
  }

  UI.addComponent = function (type, props, x, y) {
    const a = A();
    const c = GV.newComponent(type, 0, 0, props);
    if (type === 'input' || type === 'output') c.props.name = uniquePortName(type);
    const s = GV.getSize(c, a.project);
    if (x == null) {
      const r = $('#circuitCanvas').getBoundingClientRect();
      const v = view();
      const w = r.width || 800, h = r.height || 600;
      ({ x, y } = freeSpot((w / 2 - v.x) / v.k - s.w / 2, (h / 2 - v.y) / v.k - s.h / 2, s.w, s.h));
    } else { x -= s.w / 2; y -= s.h / 2; }
    c.x = snap(x);
    c.y = snap(y);
    a.checkpoint();
    a.circ.components.push(c);
    a.sel = new Set([c.id]);
    a.changed();
    return c;
  };

  function deleteSelection() {
    const a = A();
    if (!a.sel.size) return;
    a.checkpoint();
    const circ = a.circ;
    circ.components = circ.components.filter((c) => !a.sel.has(c.id));
    const ids = new Set(circ.components.map((c) => c.id));
    circ.wires = circ.wires.filter((w) => !a.sel.has(w.id) && ids.has(w.from.c) && ids.has(w.to.c));
    a.sel.clear();
    a.changed();
  }
  UI.deleteSelection = deleteSelection;

  let clipboard = null;
  function copySelection() {
    const a = A();
    const comps = a.circ.components.filter((c) => a.sel.has(c.id));
    if (!comps.length) return false;
    const ids = new Set(comps.map((c) => c.id));
    clipboard = JSON.parse(JSON.stringify({ comps, wires: a.circ.wires.filter((w) => ids.has(w.from.c) && ids.has(w.to.c)) }));
    return true;
  }
  function paste() {
    const a = A();
    if (!clipboard) return;
    a.checkpoint();
    const map = new Map();
    const fresh = [];
    for (const c of clipboard.comps) {
      const n = JSON.parse(JSON.stringify(c));
      n.id = GV.uid('c');
      n.x += 40; n.y += 40;
      if (n.type === 'input' || n.type === 'output') n.props.name = uniquePortName(n.type);
      map.set(c.id, n.id);
      fresh.push(n);
      a.circ.components.push(n);
    }
    for (const w of clipboard.wires) a.circ.wires.push({ id: GV.uid('w'), from: { c: map.get(w.from.c), p: w.from.p }, to: { c: map.get(w.to.c), p: w.to.p } });
    clipboard.comps.forEach((c) => { c.x += 40; c.y += 40; });
    a.sel = new Set(fresh.map((c) => c.id));
    a.changed();
  }

  function connect(p, q) {
    if (p.dir === q.dir || p.cid === q.cid && p.dir === q.dir) return;
    const from = p.dir === 'out' ? p : q, to = p.dir === 'out' ? q : p;
    const a = A();
    a.checkpoint();
    a.circ.wires = a.circ.wires.filter((w) => !(w.to.c === to.cid && w.to.p === to.pname));
    const w = { id: GV.uid('w'), from: { c: from.cid, p: from.pname }, to: { c: to.cid, p: to.pname } };
    a.circ.wires.push(w);
    a.changed();
  }

  // ---------- pointer interaction ----------
  let drag = null;
  let spaceDown = false;
  function bindCanvas() {
    const svg = $('#circuitCanvas');
    svg.addEventListener('pointerdown', (e) => {
      const a = A();
      $('#left').classList.remove('open');
      removeFloating();
      const pt = toWorld(e);
      const portEl = e.target.closest('[data-port]');
      const compEl = e.target.closest('[data-comp]');
      const wireEl = e.target.closest('[data-wire]');
      svg.setPointerCapture(e.pointerId);
      if (e.button === 1 || spaceDown) { drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view().x, vy: view().y, moved: true }; return; }
      if (e.button !== 0) return;
      if (portEl) {
        const [cid, dir, pname] = portEl.dataset.port.split('|');
        const start = UI.portAbs(cid, dir, pname);
        drag = { kind: 'wire', cid, dir, pname, start, cur: pt };
        return;
      }
      if (compEl) {
        const id = compEl.dataset.comp;
        if (e.shiftKey || e.ctrlKey || e.metaKey) { a.sel.has(id) ? a.sel.delete(id) : a.sel.add(id); }
        else if (!a.sel.has(id)) a.sel = new Set([id]);
        const orig = new Map(a.circ.components.filter((c) => a.sel.has(c.id)).map((c) => [c.id, { x: c.x, y: c.y }]));
        drag = { kind: 'move', start: pt, orig, moved: false, id };
        UI.renderCanvas();
        a.renderRight();
        return;
      }
      if (wireEl) {
        const id = wireEl.dataset.wire;
        if (e.shiftKey) a.sel.add(id); else a.sel = new Set([id]);
        drag = null;
        UI.renderCanvas();
        a.renderRight();
        return;
      }
      if (e.shiftKey) drag = { kind: 'box', start: pt, cur: pt };
      else drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view().x, vy: view().y, moved: false };
    });
    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const a = A();
      const pt = toWorld(e);
      if (drag.kind === 'pan') {
        const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
        if (!drag.moved && Math.hypot(dx, dy) < 4) return;
        drag.moved = true;
        const v = view();
        v.x = drag.vx + dx;
        v.y = drag.vy + dy;
        UI.renderCanvas();
      } else if (drag.kind === 'move') {
        const dx = pt.x - drag.start.x, dy = pt.y - drag.start.y;
        if (!drag.moved && Math.hypot(dx, dy) * view().k < 4) return;
        if (!drag.moved) { a.checkpoint(); drag.moved = true; }
        for (const c of a.circ.components) {
          const o = drag.orig.get(c.id);
          if (o) { c.x = snap(o.x + dx); c.y = snap(o.y + dy); }
        }
        UI.renderCanvas();
      } else if (drag.kind === 'wire') {
        drag.cur = pt;
        const hover = document.elementFromPoint(e.clientX, e.clientY);
        const target = hover && hover.closest && hover.closest('[data-port]');
        let end = pt;
        if (target) {
          const [cid, dir, pname] = target.dataset.port.split('|');
          if (dir !== drag.dir) { end = UI.portAbs(cid, dir, pname) || pt; target.classList.add('hot'); }
        }
        const s = drag.start;
        const d = drag.dir === 'out' ? wirePath(s, end) : wirePath(end, s, s.bottom);
        $('#cOverlay').innerHTML = `<path class="ghost" d="${d}"/>`;
      } else if (drag.kind === 'box') {
        drag.cur = pt;
        const x = Math.min(drag.start.x, pt.x), y = Math.min(drag.start.y, pt.y);
        $('#cOverlay').innerHTML = `<rect class="selbox" x="${x}" y="${y}" width="${Math.abs(pt.x - drag.start.x)}" height="${Math.abs(pt.y - drag.start.y)}"/>`;
      }
    });
    const end = (e) => {
      if (!drag) return;
      const a = A();
      const d = drag;
      drag = null;
      if (d.kind === 'wire') {
        const hover = document.elementFromPoint(e.clientX, e.clientY);
        const target = hover && hover.closest && hover.closest('[data-port]');
        if (target) {
          const [cid, dir, pname] = target.dataset.port.split('|');
          connect({ cid: d.cid, dir: d.dir, pname: d.pname }, { cid, dir, pname });
          return;
        }
        // Dragging off a connected input pin disconnects it.
        const existing = d.dir === 'in' && a.circ.wires.find((w) => w.to.c === d.cid && w.to.p === d.pname);
        if (existing && Math.hypot(d.cur.x - d.start.x, d.cur.y - d.start.y) > 15) {
          a.checkpoint();
          a.circ.wires = a.circ.wires.filter((w) => w !== existing);
          a.changed();
          return;
        }
        UI.renderCanvas();
      } else if (d.kind === 'move') {
        if (d.moved) a.changed();
        else {
          const c = a.circ.components.find((x) => x.id === d.id);
          if (c && a.simOn && a.sim && c.type === 'input') simClickInput(c);
          else a.renderRight();
        }
      } else if (d.kind === 'box') {
        const x0 = Math.min(d.start.x, d.cur.x), x1 = Math.max(d.start.x, d.cur.x);
        const y0 = Math.min(d.start.y, d.cur.y), y1 = Math.max(d.start.y, d.cur.y);
        for (const c of a.circ.components) {
          const s = GV.getSize(c, a.project);
          if (c.x < x1 && c.x + s.w > x0 && c.y < y1 && c.y + s.h > y0) a.sel.add(c.id);
        }
        UI.renderCanvas();
        a.renderRight();
      } else if (d.kind === 'pan' && !d.moved) {
        a.sel.clear();
        UI.renderCanvas();
        a.renderRight();
      }
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', () => { drag = null; UI.renderCanvas(); });
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const zoom = e.ctrlKey || (e.deltaX === 0 && (e.deltaMode !== 0 || Math.abs(e.deltaY) >= 40));
      if (zoom) {
        zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
      } else {
        const v = view();
        v.x -= e.deltaX;
        v.y -= e.deltaY;
        UI.renderCanvas();
      }
    }, { passive: false });
    svg.addEventListener('dblclick', (e) => {
      const el = e.target.closest('[data-comp]');
      if (!el) return;
      const a = A();
      const c = a.circ.components.find((x) => x.id === el.dataset.comp);
      if (!c) return;
      if (c.type === 'sub' && a.project.circuits[c.props.circuit]) a.openCircuit(c.props.circuit);
      else if (c.type === 'fsm' && a.project.fsms[c.props.fsm]) a.openFsm(c.props.fsm);
      else { a.sel = new Set([c.id]); a.renderRight(); const f = $('#right textarea, #right input[type=text]'); if (f) f.focus(); }
    });
    svg.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    svg.addEventListener('drop', (e) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData('text/plain');
      if (!raw || !raw.startsWith('gv:')) return;
      const { type, props } = JSON.parse(raw.slice(3));
      const pt = toWorld(e);
      UI.addComponent(type, props, pt.x, pt.y);
    });
    window.addEventListener('keydown', (e) => { if (e.key === ' ' && e.target === document.body && !A().simOn) spaceDown = true; });
    window.addEventListener('keyup', (e) => { if (e.key === ' ') spaceDown = false; });
  }

  function removeFloating() { const f = $('#overlay .floating-input'); if (f) f.remove(); }

  function simClickInput(c) {
    const a = A();
    const name = GV.sanitize(c.props.name);
    const w = GV.clampW(c.props.width);
    if (w === 1) { a.setInput(name, a.sim.inputs[name] ? 0n : 1n); return; }
    const v = view();
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'floating-input mono';
    inp.value = GV.formatValue(a.sim.inputs[name] ?? 0n, w, a.settings.radix === 'auto' ? 'hex' : a.settings.radix);
    inp.style.left = v.x + c.x * v.k + 'px';
    inp.style.top = v.y + (c.y + 44) * v.k + 'px';
    inp.title = 'Type a value (13, 0xD, 0b1101, 4\'hd) and press Enter';
    $('#overlay').appendChild(inp);
    inp.focus();
    inp.select();
    const apply = () => {
      try { a.setInput(name, GV.parseUserValue(inp.value, w)); } catch (err) { a.simError = 'Bad value: ' + err.message; a.renderStatus(); }
      removeFloating();
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); if (e.key === 'Escape') removeFloating(); e.stopPropagation(); });
    inp.addEventListener('blur', () => setTimeout(removeFloating, 100));
  }

  UI.onKey = function (e) {
    const a = A();
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if ((e.key === 'Delete' || e.key === 'Backspace') && a.sel.size) { e.preventDefault(); deleteSelection(); }
    else if (mod && k === 'c') { copySelection(); }
    else if (mod && k === 'x') { if (copySelection()) deleteSelection(); }
    else if (mod && k === 'v') { e.preventDefault(); paste(); }
    else if (mod && k === 'd') { e.preventDefault(); if (copySelection()) paste(); }
    else if (mod && k === 'a') { e.preventDefault(); a.sel = new Set(a.circ.components.map((c) => c.id)); UI.renderCanvas(); a.renderRight(); }
    else if (!mod && k === 'f') UI.fit();
    else if (e.key === 'Escape') { a.sel.clear(); UI.renderCanvas(); a.renderRight(); }
    else if (e.key.startsWith('Arrow') && a.sel.size) {
      e.preventDefault();
      const step = e.shiftKey ? 20 : 10;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      a.checkpoint();
      for (const c of a.circ.components) if (a.sel.has(c.id)) { c.x += dx; c.y += dy; }
      a.changed({ canvasOnly: true });
    } else if (a.simOn && a.sim && (e.key === '0' || e.key === '1') && a.sel.size === 1) {
      const c = a.circ.components.find((x) => a.sel.has(x.id));
      if (c && c.type === 'input') a.setInput(GV.sanitize(c.props.name), BigInt(e.key));
    }
  };

  // ---------- left panel ----------
  UI.renderLeft = function (el) {
    const a = A();
    const p = a.project;
    const s = a.settings;
    const q = (UI.filter || '').toLowerCase();
    const cats = new Map();
    const add = (cat, label, type, props, color) => {
      if (q && !label.toLowerCase().includes(q) && !cat.toLowerCase().includes(q)) return;
      if (!cats.has(cat)) cats.set(cat, []);
      cats.get(cat).push({ label, type, props, color });
    };
    for (const [type, t] of Object.entries(GV.TYPES)) if (!['lib', 'sub', 'fsm'].includes(type)) add(t.cat, t.label, type, {});
    for (const [n, d] of Object.entries(p.library)) add('Library', n, 'lib', { lib: n }, d.color);
    for (const n of Object.keys(p.circuits)) if (n !== a.circuit) add('Subcircuits', n, 'sub', { circuit: n });
    for (const n of Object.keys(p.fsms)) add('State machines', n, 'fsm', { fsm: n });
    el.innerHTML = `
      <div class="section"><h3>Circuits <button data-act="newCircuit" title="New circuit">+</button></h3>
        ${Object.keys(p.circuits).map((n) => `<div class="list-item ${n === a.circuit ? 'active' : ''}" data-open="${esc(n)}">▦ ${esc(n)}${n === p.top ? '<span class="tag">top</span>' : ''}</div>`).join('')}
      </div>
      <div class="section"><h3>State machines <button data-act="newFsm" title="New state machine">+</button></h3>
        ${Object.keys(p.fsms).map((n) => `<div class="list-item" data-openfsm="${esc(n)}">◎ ${esc(n)}</div>`).join('') || '<div class="help">None yet.</div>'}
      </div>
      <div class="section"><h3>Blocks</h3>
        <input type="text" id="palFilter" placeholder="Search blocks…" value="${esc(UI.filter || '')}" style="margin-bottom:6px">
        ${[...cats].map(([cat, items]) => `<div class="palette-cat"><div><span class="dot" style="background:${esc(s.catColors[cat] || s.accent)}"></span>${esc(cat)}</div>
          <div class="palette-grid">${items.map((it) => `<div class="pal" draggable="true" data-pal='${esc(JSON.stringify({ type: it.type, props: it.props }))}' style="--c:${esc(it.color || s.catColors[cat] || s.accent)}" title="Drag onto the canvas or click to add">${esc(it.label)}</div>`).join('')}</div></div>`).join('')}
        ${!p.library || !Object.keys(p.library).length ? '<p class="help">Tip: select an Expression block and choose “Save to library” to make your own reusable block.</p>' : ''}
      </div>`;
    el.querySelectorAll('[data-open]').forEach((d) => (d.onclick = () => a.openCircuit(d.dataset.open)));
    el.querySelectorAll('[data-openfsm]').forEach((d) => (d.onclick = () => a.openFsm(d.dataset.openfsm)));
    el.querySelectorAll('.pal').forEach((d) => {
      d.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', 'gv:' + d.dataset.pal); e.dataTransfer.effectAllowed = 'copy'; });
      d.addEventListener('click', () => { const { type, props } = JSON.parse(d.dataset.pal); UI.addComponent(type, props); $('#left').classList.remove('open'); });
    });
    const f = el.querySelector('#palFilter');
    f.oninput = () => { UI.filter = f.value; UI.renderLeft(el); const g = el.querySelector('#palFilter'); g.focus(); g.setSelectionRange(g.value.length, g.value.length); };
    el.querySelector('[data-act=newCircuit]').onclick = async () => {
      const n = await GV.ask('Name for the new circuit (it becomes a Verilog module):', { input: a.freshName('circuit'), ok: 'Create' });
      if (!n) return;
      const err = a.validModuleName(n.trim());
      if (err) { GV.alert(err); return; }
      a.checkpoint();
      p.circuits[n.trim()] = GV.newCircuit(n.trim());
      a.changed();
      a.openCircuit(n.trim());
    };
    el.querySelector('[data-act=newFsm]').onclick = () => GV.FsmUI.newFsm();
  };

  // ---------- right panel (inspector) ----------
  function fieldHtml(f, val) {
    const id = 'f_' + f.key;
    const p = A().project;
    let input;
    switch (f.type) {
      case 'int': input = `<input type="number" id="${id}" data-prop="${f.key}" min="${f.min ?? ''}" max="${f.max ?? ''}" value="${esc(val)}">`; break;
      case 'bool': return `<label class="check"><input type="checkbox" data-prop="${f.key}" ${val ? 'checked' : ''}> ${esc(f.label)}</label>`;
      case 'select': input = `<select data-prop="${f.key}">${f.options.map((o) => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`; break;
      case 'code': input = `<textarea data-prop="${f.key}" spellcheck="false" rows="5">${esc(val)}</textarea>`; break;
      case 'circuit': input = `<select data-prop="${f.key}">${Object.keys(p.circuits).filter((n) => n !== A().circuit).map((n) => `<option ${n === val ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`; break;
      case 'fsm': input = `<select data-prop="${f.key}">${Object.keys(p.fsms).map((n) => `<option ${n === val ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`; break;
      case 'lib': input = `<select data-prop="${f.key}">${Object.keys(p.library).map((n) => `<option ${n === val ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`; break;
      default: input = `<input type="text" id="${id}" data-prop="${f.key}" value="${esc(val)}" spellcheck="false">`;
    }
    return `<div class="field"><label for="${id}">${esc(f.label)}</label>${input}</div>`;
  }

  function validateComp(c) {
    const a = A();
    try {
      const P = GV.getPorts(c, a.project);
      if (c.type === 'expr') GV.compileAssigns(c.props.code, P.ins, P.outs, 'Block');
      if (c.type === 'expr') { GV.parsePortSpec(c.props.inputs); GV.parsePortSpec(c.props.outputs); }
      if (c.type === 'const') GV.evalConst(c.props.value, GV.clampW(c.props.width));
      if (c.type === 'register' || c.type === 'counter') GV.evalConst(c.props.reset, GV.clampW(c.props.width));
      if (c.type === 'lib') { const d = a.project.library[c.props.lib]; if (!d) return 'Library block not found'; GV.compileAssigns(d.code, P.ins, P.outs, 'Block'); }
      if ((c.type === 'input' || c.type === 'output') && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.props.name)) return 'Port names may use letters, digits and _ only';
      if (c.type === 'input' || c.type === 'output') {
        const dup = a.circ.components.filter((x) => (x.type === 'input' || x.type === 'output') && GV.sanitize(x.props.name) === GV.sanitize(c.props.name));
        if (dup.length > 1) return `Another port is also named '${c.props.name}'`;
      }
    } catch (e) { return e.message.replace(/^Block: /, ''); }
    return null;
  }

  UI.renderRight = function (el) {
    const a = A();
    const sel = [...a.sel];
    const comps = a.circ.components.filter((c) => a.sel.has(c.id));
    const wires = a.circ.wires.filter((w) => a.sel.has(w.id));
    let html = '';
    if (a.simOn) html += `<div class="section" id="simPanel"></div>`;
    if (comps.length === 1 && sel.length === 1) html += compInspector(comps[0]);
    else if (wires.length === 1 && sel.length === 1) html += wireInspector(wires[0]);
    else if (sel.length > 1) html += `<div class="section"><h3>${sel.length} items selected</h3><div class="btnrow"><button data-act="dup">Duplicate</button><button class="danger" data-act="del">Delete</button></div><p class="help">Drag any selected block to move them together. Arrow keys nudge.</p></div>`;
    else html += circuitInspector();
    el.innerHTML = html;
    bindInspector(el, comps.length === 1 ? comps[0] : null, wires.length === 1 ? wires[0] : null);
    if (a.simOn) UI.renderSimPanel();
  };

  function compInspector(c) {
    const a = A();
    const t = GV.TYPES[c.type];
    const err = validateComp(c);
    const lib = c.type === 'lib' ? a.project.library[c.props.lib] : null;
    return `<div class="section"><h3>${esc(t.label)}<span class="tag" style="color:${compColor(c)}">${esc(t.cat)}</span></h3>
      ${c.type !== 'note' ? `<div class="field"><label>Instance name (optional, used in Verilog)</label><input type="text" data-label value="${esc(c.label)}" placeholder="${esc(GV.blockTitle(c, a.project))}" spellcheck="false"></div>` : ''}
      ${t.schema.map((f) => fieldHtml(f, c.props[f.key])).join('')}
      ${t.help ? `<p class="help">${esc(t.help)}</p>` : ''}
      ${err ? `<div class="msg err">${esc(err)}</div>` : ''}
      ${lib ? `<div class="field"><label>Inputs (shared by every ${esc(c.props.lib)} block)</label><input type="text" data-lib="inputs" value="${esc(lib.inputs)}"></div>
        <div class="field"><label>Outputs</label><input type="text" data-lib="outputs" value="${esc(lib.outputs)}"></div>
        <div class="field"><label>Verilog assignments</label><textarea data-lib="code" spellcheck="false" rows="5">${esc(lib.code)}</textarea></div>` : ''}
      <div class="field"><label>Colour</label><div class="row"><input type="color" data-color value="${esc(compColor(c))}"><button data-act="nocolor">Default</button></div></div>
      <div class="btnrow">
        ${c.type === 'expr' ? '<button data-act="tolib">Save to library</button>' : ''}
        ${c.type === 'lib' ? '<button data-act="detach">Detach copy</button><button class="danger" data-act="dellib">Delete from library</button>' : ''}
        ${c.type === 'sub' ? '<button data-act="opensub">Open circuit</button>' : ''}
        ${c.type === 'fsm' ? '<button data-act="openfsm">Open state machine</button>' : ''}
        <button data-act="dup">Duplicate</button><button class="danger" data-act="del">Delete</button>
      </div></div>`;
  }

  function wireInspector(w) {
    const a = A();
    const from = a.circ.components.find((c) => c.id === w.from.c), to = a.circ.components.find((c) => c.id === w.to.c);
    const pa = UI.portAbs(w.from.c, 'out', w.from.p), pb = UI.portAbs(w.to.c, 'in', w.to.p);
    const nm = (c) => (c ? c.label || GV.blockTitle(c, a.project) : '?');
    return `<div class="section"><h3>Wire</h3>
      <p><span class="mono">${esc(nm(from))}.${esc(w.from.p)}</span> → <span class="mono">${esc(nm(to))}.${esc(w.to.p)}</span></p>
      <p class="help">${pa ? pa.w : '?'} bit(s)${pa && pb && pa.w !== pb.w ? ` into a ${pb.w}-bit pin: the value is ${pa.w > pb.w ? 'truncated' : 'zero-extended'}.` : ''}</p>
      <div class="field"><label>Colour</label><div class="row"><input type="color" data-wcolor value="${esc(w.color || '#8b95ab')}"><button data-act="wnocolor">Default</button></div></div>
      <div class="btnrow"><button class="danger" data-act="del">Delete wire</button></div></div>`;
  }

  function circuitInspector() {
    const a = A();
    const p = a.project;
    const isTop = a.circuit === p.top;
    let problems = [];
    try {
      const g = GV.generateProject(p);
      problems = [...g.errors.map((m) => ({ m, err: true })), ...g.warnings.filter((m) => m.startsWith(a.circuit + ':')).map((m) => ({ m }))];
    } catch (e) { problems = [{ m: e.message, err: true }]; }
    const io = GV.circuitPorts(p, a.circuit);
    return `<div class="section"><h3>Circuit</h3>
      <div class="field"><label>Name (Verilog module)</label><input type="text" data-rename value="${esc(a.circuit)}" spellcheck="false"></div>
      <p class="help">${io.ins.length} input(s), ${io.outs.length} output(s)${GV.needsClock(p, a.circuit) ? ', clocked' : ', purely combinational'}. Use this circuit inside others from the <b>Subcircuits</b> palette.</p>
      <div class="btnrow">${isTop ? '<span class="help">★ Top module</span>' : '<button data-act="settop">Make top module</button>'}
        ${Object.keys(p.circuits).length > 1 ? '<button class="danger" data-act="delcirc">Delete circuit</button>' : ''}</div></div>
      <div class="section"><h3>Checks</h3>${problems.length ? problems.slice(0, 30).map((x) => `<div class="msg ${x.err ? 'err' : ''}">${esc(x.m)}</div>`).join('') : '<div class="help">✓ No problems found.</div>'}</div>
      <div class="section"><h3>How to</h3><div class="help">
        • Drag blocks in from the left, or click one to drop it in the middle.<br>
        • Drag from a pin to another pin to connect. Drag a wire off an input pin to disconnect.<br>
        • Press <b>Simulate</b>, click inputs to change them, <b>Step</b> to clock.<br>
        • Every block's size, width and colour can be changed here once it's selected.</div></div>`;
  }

  function bindInspector(el, c, w) {
    const a = A();
    const act = (name, fn) => el.querySelectorAll(`[data-act=${name}]`).forEach((b) => (b.onclick = fn));
    act('del', deleteSelection);
    act('dup', () => { if (copySelection()) paste(); });
    if (c) {
      const t = GV.TYPES[c.type];
      el.querySelectorAll('[data-prop]').forEach((inp) => {
        const f = t.schema.find((x) => x.key === inp.dataset.prop);
        inp.addEventListener('change', () => {
          let v = inp.type === 'checkbox' ? inp.checked : inp.value;
          if (f.type === 'int') { v = parseInt(v, 10); if (isNaN(v)) v = t.defaults[f.key]; v = Math.max(f.min ?? -Infinity, Math.min(f.max ?? Infinity, v)); }
          if ((c.type === 'input' || c.type === 'output') && f.key === 'name') v = GV.sanitize(v, c.type === 'input' ? 'in' : 'out');
          a.checkpoint();
          c.props[f.key] = v;
          a.changed();
        });
      });
      const lbl = el.querySelector('[data-label]');
      if (lbl) lbl.onchange = () => { a.checkpoint(); c.label = lbl.value.trim(); a.changed(); };
      const col = el.querySelector('[data-color]');
      col.oninput = () => { c.color = col.value; UI.renderCanvas(); };
      col.onchange = () => { a.checkpoint(); c.color = col.value; a.changed(); };
      act('nocolor', () => { a.checkpoint(); delete c.color; a.changed(); });
      el.querySelectorAll('[data-lib]').forEach((inp) => {
        inp.onchange = () => { a.checkpoint(); a.project.library[c.props.lib][inp.dataset.lib] = inp.value; a.changed(); };
      });
      act('opensub', () => a.openCircuit(c.props.circuit));
      act('openfsm', () => a.openFsm(c.props.fsm));
      act('tolib', async () => {
        const n = await GV.ask('Name for this library block (it becomes a reusable Verilog module):', { input: a.freshName(GV.sanitize(c.props.title || 'block')), ok: 'Save' });
        if (!n) return;
        const err = a.validModuleName(n.trim());
        if (err) { GV.alert(err); return; }
        a.checkpoint();
        a.project.library[n.trim()] = { name: n.trim(), inputs: c.props.inputs, outputs: c.props.outputs, code: c.props.code, color: c.color || '' };
        c.type = 'lib';
        c.props = { lib: n.trim() };
        a.changed();
      });
      act('detach', () => {
        const d = a.project.library[c.props.lib];
        if (!d) return;
        a.checkpoint();
        c.type = 'expr';
        c.props = { title: d.name, inputs: d.inputs, outputs: d.outputs, code: d.code };
        a.changed();
      });
      act('dellib', async () => {
        const n = c.props.lib;
        const used = a.usages('lib', n);
        if (!(await GV.ask(`Delete library block '${n}'? ${used.length ? `Instances in ${used.join(', ')} become editable copies.` : ''}`, { ok: 'Delete', danger: true }))) return;
        a.checkpoint();
        const d = a.project.library[n];
        for (const circ of Object.values(a.project.circuits)) for (const x of circ.components) if (x.type === 'lib' && x.props.lib === n) { x.type = 'expr'; x.props = { title: n, inputs: d.inputs, outputs: d.outputs, code: d.code }; }
        delete a.project.library[n];
        a.changed();
      });
    }
    if (w) {
      const col = el.querySelector('[data-wcolor]');
      col.oninput = () => { w.color = col.value; UI.renderCanvas(); };
      col.onchange = () => { a.checkpoint(); w.color = col.value; a.changed(); };
      act('wnocolor', () => { a.checkpoint(); delete w.color; a.changed(); });
    }
    const rn = el.querySelector('[data-rename]');
    if (rn) rn.onchange = () => { if (!a.renameModule('circuits', a.circuit, rn.value.trim())) rn.value = a.circuit; };
    act('settop', () => { a.checkpoint(); a.project.top = a.circuit; a.changed(); });
    act('delcirc', async () => {
      const used = a.usages('circuit', a.circuit).filter((n) => n !== a.circuit);
      if (!(await GV.ask(`Delete circuit '${a.circuit}'?${used.length ? ` It is used in ${used.join(', ')}; those blocks will be removed.` : ''}`, { ok: 'Delete', danger: true }))) return;
      a.checkpoint();
      const n = a.circuit;
      delete a.project.circuits[n];
      for (const circ of Object.values(a.project.circuits)) circ.components = circ.components.filter((x) => !(x.type === 'sub' && x.props.circuit === n));
      if (a.project.top === n) a.project.top = Object.keys(a.project.circuits)[0];
      a.circuit = a.project.top;
      a.sel.clear();
      a.changed();
    });
  }

  UI.renderSimPanel = function () {
    const a = A();
    const el = $('#simPanel');
    if (!el) return;
    const sim = a.sim;
    if (!(sim instanceof GV.Simulator)) { el.innerHTML = `<h3>Simulation</h3><div class="msg err">${esc(a.simError || 'Not running')}</div>`; return; }
    if (el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') {
      const out = el.querySelector('#simOut');
      if (out) out.innerHTML = simOutputs(sim);
      return;
    }
    el.innerHTML = `<h3>Simulation <span class="help" style="margin:0">cycle ${sim.cycle}</span></h3>
      ${sim.inPorts.map((p) => {
        const v = sim.inputs[p.name] ?? 0n;
        return `<div class="simrow"><span class="name">${esc(p.name)}${p.w > 1 ? `<span class="help"> [${p.w - 1}:0]</span>` : ''}</span>${p.w === 1
          ? `<button class="bit ${v ? 'one' : ''}" data-bit="${esc(p.name)}">${v}</button>`
          : `<input type="text" class="mono" data-in="${esc(p.name)}" data-w="${p.w}" value="${esc(GV.formatValue(v, p.w, a.settings.radix === 'auto' ? 'hex' : a.settings.radix))}">`}</div>`;
      }).join('') || '<div class="help">This circuit has no inputs.</div>'}
      <div id="simOut">${simOutputs(sim)}</div>
      <p class="help">Space = step, R = reset. Multi-bit values accept 13, 0xD, 0b1101 or 4'hd.</p>`;
    el.querySelectorAll('[data-bit]').forEach((b) => (b.onclick = () => a.setInput(b.dataset.bit, sim.inputs[b.dataset.bit] ? 0n : 1n)));
    el.querySelectorAll('[data-in]').forEach((inp) => {
      const apply = () => { try { a.setInput(inp.dataset.in, GV.parseUserValue(inp.value, +inp.dataset.w)); } catch (e) { inp.style.borderColor = 'var(--danger)'; } };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { apply(); inp.blur(); } });
      inp.addEventListener('change', apply);
    });
  };

  function simOutputs(sim) {
    const a = A();
    return sim.outPorts.map((p) => `<div class="simrow"><span class="name">${esc(p.name)}</span><span class="val">${esc(GV.formatValue(sim.root.outputs[p.name] ?? 0n, p.w, a.settings.radix))}</span></div>`).join('');
  }

  window.addEventListener('DOMContentLoaded', bindCanvas);
})();
