// State machine editor: states, prioritized transitions, Moore/Mealy outputs, standalone simulation.
(function () {
  const GV = globalThis.GV;
  const { $, esc } = GV;
  const A = () => GV.App;
  const UI = (GV.FsmUI = { tool: 'select' });

  const fsm = () => A().project.fsms[A().fsm];
  function view() {
    const a = A();
    return a.views['f:' + a.fsm] || (a.views['f:' + a.fsm] = { x: 40, y: 20, k: 1 });
  }
  function toWorld(e) {
    const r = $('#fsmCanvas').getBoundingClientRect();
    const v = view();
    return { x: (e.clientX - r.left - v.x) / v.k, y: (e.clientY - r.top - v.y) / v.k };
  }
  const radius = (s) => {
    const outLen = (s.outputs || '').split(/;|\n/).reduce((m, x) => Math.max(m, Math.min(16, x.trim().length)), 0);
    return Math.max(34, s.name.length * 4.6 + 16, outLen * 3.2 + 12);
  };
  const snap = (v) => (A().settings.snap ? Math.round(v / 10) * 10 : Math.round(v));

  UI.newFsm = async function () {
    const a = A();
    const n = await GV.ask('Name for the new state machine (it becomes a Verilog module):', { input: a.freshName('fsm'), ok: 'Create' });
    if (!n) return;
    const err = a.validModuleName(n.trim());
    if (err) { GV.alert(err); return; }
    a.checkpoint();
    a.project.fsms[n.trim()] = GV.newFsm(n.trim());
    a.fsm = n.trim();
    a.changed();
    a.openFsm(n.trim());
  };

  function uniqueStateName(f, base) {
    const used = new Set(f.states.map((s) => s.name));
    let n = base, k = 1;
    while (used.has(n)) n = base + k++;
    return n;
  }

  function addState(x, y) {
    const a = A(), f = fsm();
    a.checkpoint();
    const s = { id: GV.uid('s'), name: uniqueStateName(f, 'S' + f.states.length), x: snap(x), y: snap(y), outputs: '', color: '' };
    f.states.push(s);
    if (!f.states.find((q) => q.id === f.reset)) f.reset = s.id;
    a.fsmSel = { kind: 'state', id: s.id };
    a.changed();
    return s;
  }

  // ---------- geometry ----------
  function transGeometry(f, t, states) {
    const A_ = states.get(t.from), B = states.get(t.to);
    if (!A_ || !B) return null;
    const ra = radius(A_), rb = radius(B);
    if (t.from === t.to) {
      const loops = f.transitions.filter((x) => x.from === t.from && x.to === t.to);
      const k = loops.indexOf(t);
      const hgt = 70 + k * 30;
      const a1 = (-115 * Math.PI) / 180, a2 = (-65 * Math.PI) / 180;
      const p1 = { x: A_.x + ra * Math.cos(a1), y: A_.y + ra * Math.sin(a1) };
      const p2 = { x: A_.x + ra * Math.cos(a2), y: A_.y + ra * Math.sin(a2) };
      const c1 = { x: p1.x - 30 - k * 10, y: p1.y - hgt }, c2 = { x: p2.x + 30 + k * 10, y: p2.y - hgt };
      return { d: `M${p1.x} ${p1.y} C${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`, end: p2, dir: { x: p2.x - c2.x, y: p2.y - c2.y }, label: { x: A_.x, y: A_.y - ra - hgt * 0.75 + 4 } };
    }
    const dx = B.x - A_.x, dy = B.y - A_.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dy / len, ny = -dx / len;
    const same = f.transitions.filter((x) => x.from === t.from && x.to === t.to);
    const reverse = f.transitions.some((x) => x.from === t.to && x.to === t.from);
    const k = same.indexOf(t);
    const bend = reverse ? 22 * (k + 1) : 26 * (k - (same.length - 1) / 2);
    const mx = (A_.x + B.x) / 2 + nx * bend * 2, my = (A_.y + B.y) / 2 + ny * bend * 2;
    const toward = (P, r, tx, ty) => { const l = Math.hypot(tx - P.x, ty - P.y) || 1; return { x: P.x + ((tx - P.x) / l) * r, y: P.y + ((ty - P.y) / l) * r }; };
    const s = toward(A_, ra, mx, my), e = toward(B, rb + 2, mx, my);
    const lab = { x: 0.25 * s.x + 0.5 * mx + 0.25 * e.x, y: 0.25 * s.y + 0.5 * my + 0.25 * e.y };
    return { d: `M${s.x} ${s.y} Q${mx} ${my} ${e.x} ${e.y}`, end: e, dir: { x: e.x - mx, y: e.y - my }, label: { x: lab.x + nx * 10 * Math.sign(bend || 1), y: lab.y + ny * 10 * Math.sign(bend || 1) + 4 } };
  }

  function arrowHead(end, dir) {
    const l = Math.hypot(dir.x, dir.y) || 1;
    const ux = dir.x / l, uy = dir.y / l;
    const b = { x: end.x - ux * 11, y: end.y - uy * 11 };
    return `M${end.x} ${end.y} L${b.x - uy * 5} ${b.y + ux * 5} L${b.x + uy * 5} ${b.y - ux * 5} Z`;
  }

  UI.renderCanvas = function () {
    const a = A();
    const svg = $('#fsmCanvas');
    const ov = $('#overlay');
    const f = fsm();
    if (!f) {
      svg.innerHTML = '';
      ov.innerHTML = `<div class="empty-hint" style="pointer-events:auto"><div>No state machines yet.<br><br><button class="primary" id="mkFsm">Create a state machine</button></div></div>`;
      $('#mkFsm').onclick = UI.newFsm;
      return;
    }
    const v = view();
    const s = a.settings;
    const sim = a.sim instanceof GV.FsmSimulator ? a.sim : null;
    const states = new Map(f.states.map((x) => [x.id, x]));
    const sel = a.fsmSel || {};
    const g = 20 * v.k;
    const grid = s.grid ? `<defs><pattern id="gridf" width="${g}" height="${g}" patternUnits="userSpaceOnUse" x="${v.x % g}" y="${v.y % g}"><circle cx="${g / 2}" cy="${g / 2}" r="${Math.max(0.8, v.k)}" fill="var(--grid)"/></pattern></defs><rect width="100%" height="100%" fill="url(#gridf)"/>` : '';
    const parts = [];
    const outCount = new Map();
    for (const t of f.transitions) outCount.set(t.from, (outCount.get(t.from) || 0) + 1);
    for (const t of f.transitions) {
      const geo = transGeometry(f, t, states);
      if (!geo) continue;
      const cls = ['trans'];
      if (sel.kind === 'trans' && sel.id === t.id) cls.push('selected');
      if (sim && sim.fsm.activeTransition === t.id) cls.push('active');
      const pr = outCount.get(t.from) > 1 ? f.transitions.filter((x) => x.from === t.from).indexOf(t) + 1 + '. ' : '';
      const cond = t.cond && t.cond.trim() ? t.cond.trim() : 'always';
      const act = t.actions && t.actions.trim() ? ' / ' + t.actions.trim().replace(/\s*\n\s*/g, '; ').replace(/;$/, '') : '';
      const color = cls.includes('active') ? 'var(--hi)' : cls.includes('selected') ? 'var(--sel)' : 'var(--wire)';
      parts.push(`<g class="${cls.join(' ')}" data-trans="${t.id}"><path class="hit" d="${geo.d}"/><path class="line" d="${geo.d}"/><path d="${arrowHead(geo.end, geo.dir)}" fill="${color}"/><text x="${geo.label.x}" y="${geo.label.y}">${esc(pr + cond + act)}</text></g>`);
    }
    for (const st of f.states) {
      const r = radius(st);
      const cls = ['state'];
      if (sel.kind === 'state' && sel.id === st.id) cls.push('selected');
      if (sim && sim.fsm.cur === st.id) cls.push('active');
      const color = st.color || s.catColors['State machines'];
      const outs = (st.outputs || '').split(/;|\n/).map((x) => x.trim()).filter(Boolean);
      const lines = outs.slice(0, 2).map((o, i) => `<text y="${14 + i * 12}" style="font:10px ui-monospace,monospace;fill:var(--muted)">${esc(o.length > 16 ? o.slice(0, 15) + '…' : o)}</text>`);
      if (outs.length > 2) lines[1] = `<text y="26" style="font:10px ui-monospace,monospace;fill:var(--muted)">+${outs.length - 1} more</text>`;
      const isReset = f.reset === st.id;
      parts.push(`<g class="${cls.join(' ')}" data-state="${st.id}" transform="translate(${st.x},${st.y})">
        ${isReset ? `<path d="M${-r - 42} 0 H${-r - 4}" stroke="var(--wire)" stroke-width="2"/><path d="${arrowHead({ x: -r - 1, y: 0 }, { x: 1, y: 0 })}" fill="var(--wire)"/><text x="${-r - 28}" y="-6" style="font:10px system-ui;fill:var(--muted)">reset</text>` : ''}
        <circle r="${r}" fill="var(--body)"/><circle r="${r}" fill="${esc(color)}" fill-opacity=".18" class="ring" style="stroke:${cls.includes('active') || cls.includes('selected') ? '' : esc(color)}"/>
        ${isReset ? `<circle r="${r - 5}" fill="none" stroke="${esc(color)}" stroke-width="1.2"/>` : ''}
        <text y="${outs.length ? -3 : 4}" style="font:600 13px system-ui,sans-serif">${esc(st.name)}</text>${lines.join('')}</g>`);
    }
    svg.innerHTML = `${grid}<g transform="translate(${v.x},${v.y}) scale(${v.k})">${parts.join('')}<g id="fOverlay"></g></g>`;
    const tools = [['select', '↖ Select'], ['state', '◯ Add state'], ['trans', '→ Add transition']];
    ov.innerHTML = `${a.simError ? `<div class="banner">⚠ ${esc(a.simError)}</div>` : ''}
      <div class="toolbar">${tools.map(([k, l]) => `<button data-tool="${k}" class="${UI.tool === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${!f.states.length ? '<div class="empty-hint">Double-click to add a state.</div>' : ''}
      <div class="zoombar"><button data-z="out">−</button><button data-z="fit">Fit</button><button data-z="in">+</button></div>`;
    ov.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => { UI.tool = b.dataset.tool; UI.renderCanvas(); }));
    ov.querySelectorAll('[data-z]').forEach((b) => (b.onclick = () => { const z = b.dataset.z; if (z === 'fit') UI.fit(); else zoomAt(z === 'in' ? 1.2 : 1 / 1.2); }));
  };

  function zoomAt(f, cx, cy) {
    const v = view();
    const r = $('#fsmCanvas').getBoundingClientRect();
    if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
    const k = Math.max(0.25, Math.min(3, v.k * f));
    v.x = cx - ((cx - v.x) * k) / v.k;
    v.y = cy - ((cy - v.y) * k) / v.k;
    v.k = k;
    UI.renderCanvas();
  }
  UI.fit = function () {
    const f = fsm();
    if (!f || !f.states.length) return;
    const r = $('#fsmCanvas').getBoundingClientRect();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of f.states) { const rr = radius(s); x0 = Math.min(x0, s.x - rr - 50); y0 = Math.min(y0, s.y - rr - 80); x1 = Math.max(x1, s.x + rr + 30); y1 = Math.max(y1, s.y + rr + 30); }
    const v = view();
    v.k = Math.max(0.25, Math.min(1.5, Math.min((r.width - 40) / (x1 - x0), (r.height - 40) / (y1 - y0))));
    v.x = (r.width - (x1 - x0) * v.k) / 2 - x0 * v.k;
    v.y = (r.height - (y1 - y0) * v.k) / 2 - y0 * v.k;
    UI.renderCanvas();
  };

  // ---------- pointer interaction ----------
  let drag = null;
  function bindCanvas() {
    const svg = $('#fsmCanvas');
    svg.addEventListener('pointerdown', (e) => {
      const a = A(), f = fsm();
      if (!f || e.button !== 0 && e.button !== 1) return;
      svg.setPointerCapture(e.pointerId);
      const pt = toWorld(e);
      const stEl = e.target.closest('[data-state]');
      const trEl = e.target.closest('[data-trans]');
      if (e.button === 1) { drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view().x, vy: view().y, moved: true }; return; }
      if (stEl) {
        const st = f.states.find((s) => s.id === stEl.dataset.state);
        if (UI.tool === 'trans' || e.shiftKey) { drag = { kind: 'trans', from: st, cur: pt }; return; }
        a.fsmSel = { kind: 'state', id: st.id };
        drag = { kind: 'move', st, start: pt, ox: st.x, oy: st.y, moved: false };
        UI.renderCanvas();
        a.renderRight();
        return;
      }
      if (trEl) { a.fsmSel = { kind: 'trans', id: trEl.dataset.trans }; drag = null; UI.renderCanvas(); a.renderRight(); return; }
      if (UI.tool === 'state') { addState(pt.x, pt.y); drag = null; return; }
      drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view().x, vy: view().y, moved: false };
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
        v.x = drag.vx + dx; v.y = drag.vy + dy;
        UI.renderCanvas();
      } else if (drag.kind === 'move') {
        const dx = pt.x - drag.start.x, dy = pt.y - drag.start.y;
        if (!drag.moved && Math.hypot(dx, dy) < 4) return;
        if (!drag.moved) { a.checkpoint(); drag.moved = true; }
        drag.st.x = snap(drag.ox + dx); drag.st.y = snap(drag.oy + dy);
        UI.renderCanvas();
      } else if (drag.kind === 'trans') {
        drag.cur = pt;
        const s = drag.from;
        $('#fOverlay').innerHTML = `<path class="ghost" d="M${s.x} ${s.y} L${pt.x} ${pt.y}"/>`;
      }
    });
    svg.addEventListener('pointerup', (e) => {
      if (!drag) return;
      const a = A(), f = fsm();
      const d = drag;
      drag = null;
      if (d.kind === 'move' && d.moved) a.changed();
      else if (d.kind === 'pan' && !d.moved) { a.fsmSel = null; UI.renderCanvas(); a.renderRight(); }
      else if (d.kind === 'trans') {
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        const stEl = hit && hit.closest && hit.closest('[data-state]');
        let to = stEl ? f.states.find((s) => s.id === stEl.dataset.state) : null;
        a.checkpoint();
        if (!to) {
          if (Math.hypot(d.cur.x - d.from.x, d.cur.y - d.from.y) < radius(d.from) + 10) { a.undoStack.pop(); UI.renderCanvas(); return; }
          to = { id: GV.uid('s'), name: uniqueStateName(f, 'S' + f.states.length), x: snap(d.cur.x), y: snap(d.cur.y), outputs: '', color: '' };
          f.states.push(to);
        }
        const t = { id: GV.uid('t'), from: d.from.id, to: to.id, cond: '', actions: '' };
        f.transitions.push(t);
        a.fsmSel = { kind: 'trans', id: t.id };
        a.changed();
        const c = $('#right [data-t=cond]');
        if (c) c.focus();
      }
    });
    svg.addEventListener('dblclick', (e) => {
      const f = fsm();
      if (!f) return;
      const stEl = e.target.closest('[data-state]');
      if (stEl) { const n = $('#right [data-s=name]'); if (n) { n.focus(); n.select(); } return; }
      if (e.target.closest('[data-trans]')) { const c = $('#right [data-t=cond]'); if (c) c.focus(); return; }
      const pt = toWorld(e);
      addState(pt.x, pt.y);
    });
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const zoom = e.ctrlKey || (e.deltaX === 0 && (e.deltaMode !== 0 || Math.abs(e.deltaY) >= 40));
      if (zoom) zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
      else { const v = view(); v.x -= e.deltaX; v.y -= e.deltaY; UI.renderCanvas(); }
    }, { passive: false });
  }

  function deleteSel() {
    const a = A(), f = fsm();
    const s = a.fsmSel;
    if (!f || !s) return;
    a.checkpoint();
    if (s.kind === 'state') {
      f.states = f.states.filter((x) => x.id !== s.id);
      f.transitions = f.transitions.filter((t) => t.from !== s.id && t.to !== s.id);
      if (f.reset === s.id) f.reset = f.states[0] ? f.states[0].id : null;
    } else f.transitions = f.transitions.filter((t) => t.id !== s.id);
    a.fsmSel = null;
    a.changed();
  }

  UI.onKey = function (e) {
    const a = A();
    if ((e.key === 'Delete' || e.key === 'Backspace') && a.fsmSel) { e.preventDefault(); deleteSel(); }
    else if (e.key === 'Escape') { a.fsmSel = null; UI.tool = 'select'; UI.renderCanvas(); a.renderRight(); }
    else if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) UI.fit();
    else if (e.key === 's' && !e.ctrlKey && !e.metaKey) { UI.tool = 'state'; UI.renderCanvas(); }
    else if (e.key === 't' && !e.ctrlKey && !e.metaKey) { UI.tool = 'trans'; UI.renderCanvas(); }
    else if (e.key === 'v' && !e.ctrlKey && !e.metaKey) { UI.tool = 'select'; UI.renderCanvas(); }
  };

  // ---------- panels ----------
  UI.renderLeft = function (el) {
    const a = A(), p = a.project;
    el.innerHTML = `
      <div class="section"><h3>State machines <button data-act="new" title="New state machine">+</button></h3>
        ${Object.keys(p.fsms).map((n) => `<div class="list-item ${n === a.fsm ? 'active' : ''}" data-open="${esc(n)}">◎ ${esc(n)}<span class="tag">${p.fsms[n].states.length} states</span></div>`).join('') || '<div class="help">None yet.</div>'}
      </div>
      <div class="section"><h3>Circuits</h3>
        ${Object.keys(p.circuits).map((n) => `<div class="list-item" data-circ="${esc(n)}">▦ ${esc(n)}${n === p.top ? '<span class="tag">top</span>' : ''}</div>`).join('')}
      </div>
      <div class="section"><h3>How it works</h3><div class="help">
        <b>Add a state:</b> double-click the canvas (or press S).<br>
        <b>Add a transition:</b> Shift-drag from one state to another (or press T). Drag into empty space to create a new state on the way.<br>
        <b>Conditions</b> are Verilog expressions on the inputs: <span class="mono">start && !stop</span>, <span class="mono">count == 4'd9</span>. Empty means always.<br>
        <b>Priority:</b> when several transitions leave a state, the first true one wins. Reorder them in the inspector.<br>
        <b>Moore outputs</b> go on states, <b>Mealy outputs</b> on transitions as actions: <span class="mono">done = 1</span>.<br>
        Outputs not assigned keep their default.</div></div>`;
    el.querySelectorAll('[data-open]').forEach((d) => (d.onclick = () => a.openFsm(d.dataset.open)));
    el.querySelectorAll('[data-circ]').forEach((d) => (d.onclick = () => a.openCircuit(d.dataset.circ)));
    el.querySelector('[data-act=new]').onclick = UI.newFsm;
  };

  function fsmError(name) {
    try { new GV.FsmSim(A().project, name); return null; } catch (e) { return e.message; }
  }

  UI.renderRight = function (el) {
    const a = A(), f = fsm();
    if (!f) { el.innerHTML = '<div class="section"><div class="help">Create a state machine to begin.</div></div>'; return; }
    const sel = a.fsmSel;
    let html = a.simOn ? '<div class="section" id="simPanel"></div>' : '';
    const st = sel && sel.kind === 'state' && f.states.find((s) => s.id === sel.id);
    const tr = sel && sel.kind === 'trans' && f.transitions.find((t) => t.id === sel.id);
    const err = fsmError(a.fsm);
    if (st) {
      html += `<div class="section"><h3>State</h3>
        <div class="field"><label>Name</label><input type="text" data-s="name" value="${esc(st.name)}" spellcheck="false"></div>
        <div class="field"><label>Outputs in this state (Moore), e.g. <span class="mono">busy = 1; led = 2'b10</span></label><textarea data-s="outputs" spellcheck="false" rows="4">${esc(st.outputs)}</textarea></div>
        <div class="field"><label>Colour</label><div class="row"><input type="color" data-s="color" value="${esc(st.color || a.settings.catColors['State machines'])}"><button data-act="nocolor">Default</button></div></div>
        ${err ? `<div class="msg err">${esc(err)}</div>` : ''}
        <div class="btnrow">${f.reset === st.id ? '<span class="help">⟲ Reset state</span>' : '<button data-act="reset">Make reset state</button>'}<button class="danger" data-act="del">Delete state</button></div>
        <p class="help">Leaving transitions (in priority order):<br>${f.transitions.filter((t) => t.from === st.id).map((t, i) => `${i + 1}. ${esc(t.cond || 'always')} → ${esc((f.states.find((s) => s.id === t.to) || {}).name)}`).join('<br>') || 'none: the machine stays here.'}</p></div>`;
    } else if (tr) {
      const opts = (v) => f.states.map((s) => `<option value="${s.id}" ${s.id === v ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
      const siblings = f.transitions.filter((t) => t.from === tr.from);
      html += `<div class="section"><h3>Transition</h3>
        <div class="field"><div class="row"><select data-t="from">${opts(tr.from)}</select>→<select data-t="to">${opts(tr.to)}</select></div></div>
        <div class="field"><label>Condition (empty = always)</label><input type="text" class="mono" data-t="cond" value="${esc(tr.cond)}" placeholder="e.g. go && !stop" spellcheck="false"></div>
        <div class="field"><label>Actions when taken (Mealy outputs)</label><textarea data-t="actions" spellcheck="false" rows="3" placeholder="e.g. done = 1">${esc(tr.actions)}</textarea></div>
        ${err ? `<div class="msg err">${esc(err)}</div>` : ''}
        ${siblings.length > 1 ? `<p class="help">Priority ${siblings.indexOf(tr) + 1} of ${siblings.length} leaving this state.</p><div class="btnrow"><button data-act="up">Higher priority</button><button data-act="down">Lower priority</button></div>` : ''}
        <div class="btnrow"><button class="danger" data-act="del">Delete transition</button></div></div>`;
    } else {
      const circ = a.circuit;
      html += `<div class="section"><h3>State machine</h3>
        <div class="field"><label>Name (Verilog module)</label><input type="text" data-f="name" value="${esc(a.fsm)}" spellcheck="false"></div>
        <div class="field"><label>Inputs, e.g. <span class="mono">go, mode:2</span></label><input type="text" class="mono" data-f="inputs" value="${esc(f.inputs)}" spellcheck="false"></div>
        <div class="field"><label>Outputs with optional default, e.g. <span class="mono">busy, led:2=3</span></label><input type="text" class="mono" data-f="outputs" value="${esc(f.outputs)}" spellcheck="false"></div>
        <div class="field"><label>State encoding</label><select data-f="encoding">${[['binary', 'Binary'], ['gray', 'Gray code'], ['onehot', 'One-hot']].map(([k, l]) => `<option value="${k}" ${f.encoding === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label>Reset state</label><select data-f="reset">${f.states.map((s) => `<option value="${s.id}" ${s.id === f.reset ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
        <label class="check"><input type="checkbox" data-f="exposeState" ${f.exposeState ? 'checked' : ''}> Add a <span class="mono">state</span> output port (${GV.fsmStateBits(f)} bits)</label>
        ${err ? `<div class="msg err">${esc(err)}</div>` : '<div class="help">✓ No problems found.</div>'}
        <div class="btnrow"><button class="primary" data-act="place">Use in circuit “${esc(circ)}”</button><button class="danger" data-act="delfsm">Delete</button></div></div>`;
    }
    el.innerHTML = html;
    bind(el, f, st, tr);
    if (a.simOn) UI.renderSimPanel();
  };

  function bind(el, f, st, tr) {
    const a = A();
    const act = (n, fn) => el.querySelectorAll(`[data-act=${n}]`).forEach((b) => (b.onclick = fn));
    act('del', deleteSel);
    if (st) {
      el.querySelectorAll('[data-s]').forEach((inp) => {
        const k = inp.dataset.s;
        if (k === 'color') inp.oninput = () => { st.color = inp.value; UI.renderCanvas(); };
        inp.onchange = () => {
          let v = inp.value;
          if (k === 'name') {
            v = GV.sanitize(v.trim(), 'S');
            if (f.states.some((s) => s !== st && s.name === v)) { GV.alert(`There is already a state named ${v}`); inp.value = st.name; return; }
          }
          a.checkpoint();
          st[k] = v;
          a.changed();
        };
      });
      act('nocolor', () => { a.checkpoint(); st.color = ''; a.changed(); });
      act('reset', () => { a.checkpoint(); f.reset = st.id; a.changed(); });
    }
    if (tr) {
      el.querySelectorAll('[data-t]').forEach((inp) => {
        inp.onchange = () => { a.checkpoint(); tr[inp.dataset.t] = inp.value; a.changed(); };
      });
      const move = (d) => {
        const sib = f.transitions.filter((t) => t.from === tr.from);
        const i = sib.indexOf(tr), j = i + d;
        if (j < 0 || j >= sib.length) return;
        a.checkpoint();
        const ia = f.transitions.indexOf(sib[i]), ib = f.transitions.indexOf(sib[j]);
        [f.transitions[ia], f.transitions[ib]] = [f.transitions[ib], f.transitions[ia]];
        a.changed();
      };
      act('up', () => move(-1));
      act('down', () => move(1));
    }
    el.querySelectorAll('[data-f]').forEach((inp) => {
      inp.onchange = () => {
        const k = inp.dataset.f;
        if (k === 'name') { if (!a.renameModule('fsms', a.fsm, inp.value.trim())) inp.value = a.fsm; return; }
        if (k === 'inputs' || k === 'outputs') { try { GV.parsePortSpec(inp.value); } catch (e) { GV.alert(e.message); inp.value = f[k]; return; } }
        a.checkpoint();
        f[k] = inp.type === 'checkbox' ? inp.checked : inp.value;
        a.changed();
      };
    });
    act('place', () => {
      const name = a.fsm;
      a.setTab('circuit');
      GV.CircuitUI.addComponent('fsm', { fsm: name });
    });
    act('delfsm', async () => {
      const used = a.usages('fsm', a.fsm);
      if (!(await GV.ask(`Delete state machine '${a.fsm}'?${used.length ? ` Its blocks in ${used.join(', ')} will be removed.` : ''}`, { ok: 'Delete', danger: true }))) return;
      a.checkpoint();
      const n = a.fsm;
      delete a.project.fsms[n];
      for (const c of Object.values(a.project.circuits)) c.components = c.components.filter((x) => !(x.type === 'fsm' && x.props.fsm === n));
      a.fsm = Object.keys(a.project.fsms)[0] || null;
      a.fsmSel = null;
      a.stopSim();
      a.changed();
    });
  }

  UI.renderSimPanel = function () {
    const a = A();
    const el = $('#simPanel');
    if (!el) return;
    const sim = a.sim;
    if (!(sim instanceof GV.FsmSimulator)) { el.innerHTML = `<h3>Simulation</h3><div class="msg err">${esc(a.simError || 'Not running')}</div>`; return; }
    if (el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    const f = sim.fsm;
    const nextName = (f.f.states.find((s) => s.id === f.nextState) || {}).name;
    el.innerHTML = `<h3>Simulation <span class="help" style="margin:0">cycle ${sim.cycle}</span></h3>
      <div class="simrow"><span>Current state</span><span class="val" style="color:var(--hi)">${esc(f.currentName())}</span></div>
      <div class="simrow"><span>Next on clock</span><span class="val">${esc(nextName)}</span></div>
      ${f.ins.map((p) => {
        const v = sim.inputs[p.name] ?? 0n;
        return `<div class="simrow"><span class="name">${esc(p.name)}</span>${p.w === 1 ? `<button class="bit ${v ? 'one' : ''}" data-bit="${esc(p.name)}">${v}</button>` : `<input type="text" class="mono" data-in="${esc(p.name)}" data-w="${p.w}" value="${esc(GV.formatValue(v, p.w, 'dec'))}">`}</div>`;
      }).join('')}
      ${f.outs.map((p) => `<div class="simrow"><span class="name">${esc(p.name)}</span><span class="val">${esc(GV.formatValue(sim.outputs[p.name] ?? 0n, p.w, a.settings.radix))}</span></div>`).join('')}
      <p class="help">Set inputs, then Step (Space) to take the highlighted transition.</p>`;
    el.querySelectorAll('[data-bit]').forEach((b) => (b.onclick = () => a.setInput(b.dataset.bit, sim.inputs[b.dataset.bit] ? 0n : 1n)));
    el.querySelectorAll('[data-in]').forEach((inp) => {
      const apply = () => { try { a.setInput(inp.dataset.in, GV.parseUserValue(inp.value, +inp.dataset.w)); } catch (e) { inp.style.borderColor = 'var(--danger)'; } };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { apply(); inp.blur(); } });
      inp.addEventListener('change', apply);
    });
  };

  window.addEventListener('DOMContentLoaded', bindCanvas);
})();
