// Waveform viewer for recorded simulation cycles, and the Verilog code view.
(function () {
  const GV = globalThis.GV;
  const { $, esc } = GV;
  const A = () => GV.App;
  const Wave = (GV.Wave = { cw: 46 });

  function signals(sim) {
    const a = A();
    if (sim instanceof GV.Simulator) {
      const rows = [
        ...sim.inPorts.map((p) => ({ name: p.name, w: p.w, get: (h) => h.inputs[p.name] })),
        ...sim.outPorts.map((p) => ({ name: p.name, w: p.w, get: (h) => h.outputs[p.name], out: true })),
      ];
      for (const c of a.circ.components) {
        if (c.type !== 'probe') continue;
        rows.push({ name: c.label || 'probe', w: GV.clampW(c.props.width), get: (h) => h.probes && h.probes[c.id], probe: true });
      }
      return { rows, live: sim.sample() };
    }
    const f = sim.fsm;
    return {
      rows: [
        { name: 'state', w: 0, get: (h) => h.state },
        ...f.ins.map((p) => ({ name: p.name, w: p.w, get: (h) => h.inputs[p.name] })),
        ...f.outs.map((p) => ({ name: p.name, w: p.w, get: (h) => h.outputs[p.name], out: true })),
      ],
      live: { cycle: sim.cycle, inputs: { ...sim.inputs }, outputs: { ...sim.outputs }, state: f.currentName() },
    };
  }

  Wave.render = function () {
    const a = A();
    const panel = $('#wave');
    if (!a.simOn || !a.sim) { $('#waveBody').innerHTML = a.simOn ? '<div class="help" style="padding:10px">Fix the problem shown above to simulate.</div>' : ''; $('#waveInfo').textContent = ''; return; }
    if (!panel.classList.contains('show')) return;
    const sim = a.sim;
    const { rows, live } = signals(sim);
    const cols = [...sim.history.slice(-400), { ...live, live: true }];
    const cw = Wave.cw, rh = 26, nameW = 120, top = 18;
    const samples = cols.filter((c) => !c.reset);
    const width = nameW + samples.length * cw + 20;
    const height = top + rows.length * rh + 6;
    const radix = a.settings.radix;
    const out = [];
    // cycle header
    let i = 0;
    const xs = [];
    for (const c of cols) {
      if (c.reset) { xs.push({ reset: true, x: nameW + i * cw }); continue; }
      const x = nameW + i * cw;
      xs.push({ x, c });
      out.push(`<text class="wv-val" x="${x + cw / 2}" y="12" text-anchor="middle" style="fill:var(--muted)">${c.live ? 'now' : c.cycle}</text>`);
      out.push(`<line class="wv-grid" x1="${x}" y1="${top - 2}" x2="${x}" y2="${height}"/>`);
      if (c.live) out.push(`<rect x="${x}" y="${top - 2}" width="${cw}" height="${height - top + 2}" fill="var(--accent)" fill-opacity=".07"/>`);
      i++;
    }
    rows.forEach((r, ri) => {
      const y0 = top + ri * rh + 4, y1 = y0 + rh - 8;
      out.push(`<text class="wv-name" x="8" y="${y0 + 13}" style="${r.out ? 'fill:var(--accent)' : r.probe ? 'fill:var(--warn)' : ''}">${esc(r.name)}${r.w > 1 ? `[${r.w - 1}:0]` : ''}</text>`);
      const pts = xs.filter((e) => !e.reset);
      if (r.w === 1) {
        let d = '';
        let prev = null;
        pts.forEach((e) => {
          const v = BigInt(r.get(e.c) ?? 0n);
          const y = v ? y0 : y1;
          d += prev === null ? `M${e.x} ${y}` : prev !== y ? ` V${y}` : '';
          d += ` H${e.x + cw}`;
          prev = y;
        });
        out.push(`<path d="${d}" fill="none" stroke="var(--hi)" stroke-width="1.6"/>`);
      } else {
        // runs of equal values
        let start = 0;
        for (let k = 1; k <= pts.length; k++) {
          const cur = k < pts.length ? String(r.get(pts[k].c) ?? '') : null;
          const prev = String(r.get(pts[start].c) ?? '');
          if (cur === prev) continue;
          const x0 = pts[start].x, x1 = pts[k - 1].x + cw, ym = (y0 + y1) / 2;
          out.push(`<path d="M${x0 + 3} ${y0} H${x1 - 3} L${x1} ${ym} L${x1 - 3} ${y1} H${x0 + 3} L${x0} ${ym} Z" fill="var(--bus)" fill-opacity=".12" stroke="var(--bus)" stroke-width="1.2"/>`);
          const raw = r.get(pts[start].c);
          const label = r.w === 0 ? String(raw ?? '') : GV.formatValue(raw ?? 0n, r.w, radix);
          if ((x1 - x0) > label.length * 6 + 6) out.push(`<text class="wv-val" x="${(x0 + x1) / 2}" y="${ym + 3.5}" text-anchor="middle">${esc(label)}</text>`);
          else out.push(`<title>${esc(label)}</title>`);
          start = k;
        }
      }
    });
    for (const e of xs) if (e.reset) out.push(`<line x1="${e.x}" y1="${top - 4}" x2="${e.x}" y2="${height}" stroke="var(--danger)" stroke-width="2" stroke-dasharray="4 3"><title>reset</title></line><text x="${e.x + 2}" y="${height - 2}" class="wv-val" style="fill:var(--danger)">rst</text>`);
    const body = $('#waveBody');
    const atEnd = body.scrollLeft + body.clientWidth >= body.scrollWidth - 30;
    body.innerHTML = `<svg width="${width}" height="${height}" style="display:block">${out.join('')}</svg>`;
    if (atEnd) body.scrollLeft = body.scrollWidth;
    $('#waveInfo').textContent = `${samples.length - 1} recorded cycle(s)${sim instanceof GV.Simulator ? ' · File → Export testbench turns these into a self-checking Verilog test' : ''}`;
  };

  window.addEventListener('DOMContentLoaded', () => {
    $('#waveZoomIn').onclick = () => { Wave.cw = Math.min(160, Wave.cw * 1.25); Wave.render(); };
    $('#waveZoomOut').onclick = () => { Wave.cw = Math.max(14, Wave.cw / 1.25); Wave.render(); };
    $('#waveClear').onclick = () => { const s = A().sim; if (s) { s.history = []; Wave.render(); } };
  });

  // ---------- Verilog view ----------
  const VUI = (GV.VerilogUI = {});
  const KW = new Set([...GV.VERILOG_KEYWORDS]);
  function highlight(code) {
    return code.split('\n').map((line) => {
      const ci = line.indexOf('//');
      const head = ci >= 0 ? line.slice(0, ci) : line;
      const tail = ci >= 0 ? `<span class="cm">${esc(line.slice(ci))}</span>` : '';
      const h = head.replace(/("[^"]*")|(\d+'[sS]?[bodhBODH][0-9a-fA-FxXzZ_]+|\b\d+\b)|([A-Za-z_][A-Za-z0-9_$]*)|([^"A-Za-z_0-9]+)/g, (m, str, num, id, other) => {
        if (str) return `<span class="s">${esc(str)}</span>`;
        if (num) return `<span class="n">${esc(num)}</span>`;
        if (id) return KW.has(id) ? `<span class="k">${id}</span>` : id;
        return esc(other);
      });
      return h + tail;
    }).join('\n');
  }

  VUI.renderCanvas = function () {
    const a = A();
    if (a.tab !== 'verilog') return;
    $('#overlay').innerHTML = '';
    const g = GV.generateProject(a.project);
    VUI.last = g;
    $('#verilogCode').innerHTML = g.modules.map((m) => `<span id="mod_${esc(m.name)}"></span>${highlight(m.code)}`).join('\n\n') || '// Nothing to generate yet';
  };

  VUI.renderLeft = function (el) {
    const a = A();
    const g = VUI.last || GV.generateProject(a.project);
    el.innerHTML = `<div class="section"><h3>Modules</h3>
      ${g.modules.map((m) => `<div class="list-item" data-mod="${esc(m.name)}"><span class="mono">${esc(m.name)}</span><span class="tag">${m.kind}${m.name === GV.sanitize(a.project.top) ? ' · top' : ''}</span></div>`).join('') || '<div class="help">No modules.</div>'}
      </div>
      <div class="section"><h3>Export</h3><div class="btnrow" style="flex-direction:column;align-items:stretch">
        <button class="primary" data-act="copy">Copy all Verilog</button>
        <button data-act="dl">Download .v file</button>
      </div><p class="help">Verilog-2001, synthesizable. Change clock/reset names, reset style and indentation in Settings ⚙.</p></div>`;
    el.querySelectorAll('[data-mod]').forEach((d) => (d.onclick = () => { const t = document.getElementById('mod_' + d.dataset.mod); if (t) t.scrollIntoView({ block: 'start' }); }));
    el.querySelector('[data-act=copy]').onclick = async (e) => {
      try { await navigator.clipboard.writeText(g.text); e.target.textContent = 'Copied ✓'; } catch { GV.textDialog('Verilog', 'design.v', g.text); }
    };
    el.querySelector('[data-act=dl]').onclick = () => GV.textDialog('Export Verilog', GV.sanitize(a.project.name, 'design') + '.v', g.text);
  };

  VUI.renderRight = function (el) {
    const g = VUI.last || GV.generateProject(A().project);
    el.innerHTML = `<div class="section"><h3>Checks</h3>
      ${g.errors.map((m) => `<div class="msg err">${esc(m)}</div>`).join('')}
      ${g.warnings.map((m) => `<div class="msg">${esc(m)}</div>`).join('')}
      ${!g.errors.length && !g.warnings.length ? '<div class="help">✓ No errors or warnings.</div>' : ''}</div>
      <div class="section"><h3>Simulate with other tools</h3><div class="help">Simulate a circuit here, press Step a few times, then use File → Export testbench. It replays your inputs and checks every output, e.g. with Icarus Verilog:<br><span class="mono">iverilog -o sim design.v tb_main.v &amp;&amp; vvp sim</span></div></div>`;
  };
  // Generate before the side panels read it.
  const origRenderLeft = VUI.renderLeft;
  VUI.renderLeft = function (el) { VUI.last = GV.generateProject(A().project); origRenderLeft(el); };
})();
