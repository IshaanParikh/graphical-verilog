// Application shell: state, undo/redo, persistence, top bar, menus, settings and simulation control.
(function () {
  const GV = globalThis.GV;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  GV.$ = $;
  GV.esc = esc;
  const STORE = 'graphical-verilog.project.v1';

  const App = (GV.App = {
    project: null,
    tab: 'circuit',
    circuit: 'main',
    fsm: null,
    sel: new Set(),
    fsmSel: null,
    views: {},
    sim: null,
    simOn: false,
    simError: null,
    runTimer: null,
    undoStack: [],
    redoStack: [],
    lastSaved: null,

    init() {
      let p = null;
      try { const raw = localStorage.getItem(STORE); if (raw) p = JSON.parse(raw); } catch (e) { p = null; }
      if (!p) p = GV.EXAMPLES['Getting started tour']();
      this.load(p, true);
      bindTopbar();
      document.addEventListener('keydown', onKey);
      window.addEventListener('resize', () => this.renderCanvas());
    },

    load(p, keepHistory) {
      this.stopSim();
      this.project = GV.normalizeProject(p);
      this.circuit = this.project.circuits[this.project.top] ? this.project.top : Object.keys(this.project.circuits)[0];
      this.fsm = Object.keys(this.project.fsms)[0] || null;
      this.sel.clear();
      this.fsmSel = null;
      this.views = {};
      if (!keepHistory) { this.undoStack = []; this.redoStack = []; }
      this.applyTheme();
      this.render();
      this.save();
    },

    // Call before mutating the project so the change can be undone.
    checkpoint() {
      this.undoStack.push(JSON.stringify(this.project));
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack = [];
    },

    // Call after mutating the project.
    changed(opts = {}) {
      GV.pruneWires(this.project);
      if (this.simOn) this.rebuildSim();
      this.scheduleSave();
      if (opts.canvasOnly) this.renderCanvas();
      else this.render();
    },

    undo() { this.swapHistory(this.undoStack, this.redoStack); },
    redo() { this.swapHistory(this.redoStack, this.undoStack); },
    swapHistory(from, to) {
      if (!from.length) return;
      to.push(JSON.stringify(this.project));
      this.project = GV.normalizeProject(JSON.parse(from.pop()));
      if (!this.project.circuits[this.circuit]) this.circuit = this.project.top;
      if (this.fsm && !this.project.fsms[this.fsm]) this.fsm = Object.keys(this.project.fsms)[0] || null;
      this.sel.clear();
      this.fsmSel = null;
      this.applyTheme();
      this.changed();
    },

    scheduleSave() {
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.save(), 400);
    },
    save() {
      try { localStorage.setItem(STORE, JSON.stringify(this.project)); this.lastSaved = new Date(); } catch (e) { this.lastSaved = null; }
      this.renderStatus();
    },

    get settings() { return this.project.settings; },
    get circ() { return this.project.circuits[this.circuit]; },

    applyTheme() {
      const s = this.settings;
      if (s.theme === 'light' || s.theme === 'dark') { document.documentElement.dataset.theme = s.theme; this.themeSet = true; }
      else if (this.themeSet) { delete document.documentElement.dataset.theme; this.themeSet = false; }
      document.documentElement.style.setProperty('--accent', s.accent);
    },

    // ---------- rendering ----------
    render() {
      this.renderTop();
      this.renderLeft();
      this.renderRight();
      this.renderCanvas();
      this.renderStatus();
    },
    ui() { return this.tab === 'circuit' ? GV.CircuitUI : this.tab === 'fsm' ? GV.FsmUI : GV.VerilogUI; },
    renderLeft() { this.ui().renderLeft($('#left')); },
    renderRight() { this.ui().renderRight($('#right')); },
    renderCanvas() {
      $('#circuitCanvas').style.display = this.tab === 'circuit' ? '' : 'none';
      $('#fsmCanvas').style.display = this.tab === 'fsm' ? '' : 'none';
      $('#verilogView').style.display = this.tab === 'verilog' ? 'block' : 'none';
      this.ui().renderCanvas();
      GV.Wave.render();
    },
    renderTop() {
      $('#projName').value = this.project.name;
      document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === this.tab));
      const canSim = this.tab !== 'verilog' && (this.tab === 'circuit' || this.fsm);
      $('#simToggle').disabled = !canSim;
      $('#simToggle').classList.toggle('on', this.simOn);
      $('#simToggle').textContent = this.simOn ? '■ Stop' : '▶ Simulate';
      for (const id of ['simReset', 'simStep', 'simRun']) $('#' + id).disabled = !this.simOn || !this.sim;
      $('#simRun').textContent = this.runTimer ? '⏸ Pause' : '⏵ Run';
      $('#simRun').classList.toggle('on', !!this.runTimer);
      $('#cycle').textContent = this.sim ? `cycle ${this.sim.cycle}` : '';
      $('#undoBtn').disabled = !this.undoStack.length;
      $('#redoBtn').disabled = !this.redoStack.length;
    },
    renderStatus() {
      const el = $('#status');
      if (!el || !this.project) return;
      const parts = [];
      if (this.tab === 'circuit') {
        const c = this.circ;
        parts.push(`<span>Circuit <b>${esc(this.circuit)}</b>${this.circuit === this.project.top ? ' (top)' : ''} · ${c.components.length} blocks · ${c.wires.length} wires</span>`);
      } else if (this.tab === 'fsm' && this.fsm) {
        const f = this.project.fsms[this.fsm];
        parts.push(`<span>State machine <b>${esc(this.fsm)}</b> · ${f.states.length} states · ${f.transitions.length} transitions</span>`);
      }
      if (this.simError) parts.push(`<span class="err">⚠ ${esc(this.simError)}</span>`);
      else if (this.simOn) parts.push(`<span class="ok">● Simulating${this.runTimer ? ` at ${this.settings.simSpeed} Hz` : ''}</span>`);
      parts.push('<span class="spacer"></span>');
      parts.push(`<span>${this.lastSaved ? 'Saved in this browser' : 'Not saved (browser storage unavailable): use File → Save project'}</span>`);
      el.innerHTML = parts.join('');
    },

    setTab(t) {
      if (t === this.tab) return;
      const wasSim = this.simOn;
      this.stopSim();
      this.tab = t;
      if (wasSim && t !== 'verilog') this.startSim();
      this.render();
    },
    openCircuit(n) {
      const wasSim = this.simOn;
      this.stopSim();
      this.circuit = n;
      this.sel.clear();
      this.tab = 'circuit';
      if (wasSim) this.startSim();
      this.render();
    },
    openFsm(n) {
      const wasSim = this.simOn;
      this.stopSim();
      this.fsm = n;
      this.fsmSel = null;
      this.tab = 'fsm';
      if (wasSim) this.startSim();
      this.render();
    },

    // ---------- simulation ----------
    startSim() {
      this.simOn = true;
      this.rebuildSim();
      $('#wave').classList.add('show');
      this.render();
    },
    stopSim() {
      this.pauseRun();
      this.simOn = false;
      this.sim = null;
      this.simError = null;
      $('#wave').classList.remove('show');
    },
    rebuildSim() {
      const prev = this.sim;
      this.sim = null;
      this.simError = null;
      try {
        if (this.tab === 'circuit') this.sim = new GV.Simulator(this.project, this.circuit);
        else if (this.tab === 'fsm' && this.fsm) this.sim = new GV.FsmSimulator(this.project, this.fsm);
        if (prev && this.sim && prev.constructor === this.sim.constructor) {
          for (const k in this.sim.inputs) if (k in prev.inputs) this.sim.inputs[k] = prev.inputs[k];
          this.sim.settle();
        }
      } catch (e) {
        this.sim = null;
        this.simError = e.message;
        this.pauseRun();
      }
    },
    simAction(fn) {
      if (!this.sim) return;
      try { fn(this.sim); this.simError = null; } catch (e) { this.simError = e.message; this.pauseRun(); }
      this.renderTop();
      this.renderCanvas();
      this.ui().renderSimPanel?.();
      this.renderStatus();
    },
    step() { this.simAction((s) => s.step()); },
    resetSim() { this.simAction((s) => s.reset()); },
    setInput(name, v) { this.simAction((s) => s.setInput(name, v)); },
    toggleRun() {
      if (this.runTimer) this.pauseRun();
      else if (this.sim) this.runTimer = setInterval(() => this.step(), 1000 / Math.max(0.5, this.settings.simSpeed));
      this.renderTop();
      this.renderStatus();
    },
    pauseRun() { clearInterval(this.runTimer); this.runTimer = null; },

    // ---------- names ----------
    nameTaken(n, except) {
      const p = this.project;
      const s = GV.sanitize(n);
      return [...Object.keys(p.circuits), ...Object.keys(p.fsms), ...Object.keys(p.library)].some((k) => k !== except && GV.sanitize(k) === s);
    },
    freshName(base) {
      let n = base, k = 2;
      while (this.nameTaken(n)) n = base + '_' + k++;
      return n;
    },
    validModuleName(n, except) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) return 'Use letters, digits and _ (not starting with a digit)';
      if (GV.VERILOG_KEYWORDS.has(n)) return `'${n}' is a Verilog keyword`;
      if (this.nameTaken(n, except)) return `'${n}' is already used`;
      return null;
    },
    renameModule(kind, oldName, newName) {
      const err = this.validModuleName(newName, oldName);
      if (err) { GV.alert(err); return false; }
      this.checkpoint();
      const p = this.project;
      const key = { circuits: 'circuit', fsms: 'fsm', library: 'lib' }[kind];
      const obj = p[kind][oldName];
      delete p[kind][oldName];
      obj.name = newName;
      p[kind][newName] = obj;
      for (const c of Object.values(p.circuits)) for (const comp of c.components) if (comp.props[key] === oldName) comp.props[key] = newName;
      if (kind === 'circuits') { if (p.top === oldName) p.top = newName; if (this.circuit === oldName) this.circuit = newName; }
      if (kind === 'fsms' && this.fsm === oldName) this.fsm = newName;
      this.changed();
      return true;
    },
    usages(key, name) {
      const res = [];
      for (const c of Object.values(this.project.circuits)) for (const comp of c.components) if (comp.props[key] === name) res.push(c.name);
      return [...new Set(res)];
    },
  });

  // ---------- dialogs ----------
  // Inside an embedded viewer (iframe) downloads are blocked, so offer copying instead.
  const embedded = (() => { try { return window.self !== window.top; } catch { return true; } })();
  function textDialog(title, filename, text, note) {
    const dlg = $('#settingsDlg');
    dlg.innerHTML = `<div class="head">${esc(title)}<span class="spacer"></span><button data-x>✕</button></div>
      <div class="body">${note ? `<p class="help">${note}</p>` : ''}<textarea class="mono" style="height:50vh" readonly>${esc(text)}</textarea></div>
      <div class="foot">${embedded ? `<span class="help" style="margin-right:auto">Copy, then save as ${esc(filename)}</span>` : ''}<button data-copy ${embedded ? 'class="primary"' : ''}>Copy</button>${embedded ? '' : `<button class="primary" data-dl>Download ${esc(filename)}</button>`}</div>`;
    dlg.querySelector('[data-x]').onclick = () => dlg.close();
    dlg.querySelector('[data-copy]').onclick = async (e) => {
      const ta = dlg.querySelector('textarea');
      try { await navigator.clipboard.writeText(text); } catch { ta.select(); document.execCommand('copy'); }
      e.target.textContent = 'Copied';
    };
    if (!embedded) dlg.querySelector('[data-dl]').onclick = () => download(filename, text);
    dlg.showModal();
  }
  GV.textDialog = textDialog;

  // In-page replacements for alert/confirm/prompt (native ones are unavailable in embedded viewers).
  GV.ask = function (message, opts = {}) {
    return new Promise((resolve) => {
      const dlg = $('#askDlg');
      const hasInput = opts.input != null;
      dlg.innerHTML = `<form method="dialog"><div class="body"><p style="margin:0 0 10px;white-space:pre-wrap">${esc(message)}</p>
        ${hasInput ? `<input type="text" id="askInput" value="${esc(opts.input)}" spellcheck="false">` : ''}</div>
        <div class="foot">${opts.alert ? '' : '<button type="button" data-no>Cancel</button>'}<button type="submit" class="${opts.danger ? 'primary danger-fill' : 'primary'}">${esc(opts.ok || 'OK')}</button></div></form>`;
      let done = false;
      const finish = (v) => { if (done) return; done = true; dlg.close(); resolve(v); };
      dlg.querySelector('form').onsubmit = (e) => { e.preventDefault(); finish(hasInput ? dlg.querySelector('#askInput').value.trim() || null : true); };
      const no = dlg.querySelector('[data-no]');
      if (no) no.onclick = () => finish(hasInput ? null : false);
      dlg.onclose = () => finish(hasInput ? null : !!opts.alert);
      dlg.showModal();
      const inp = dlg.querySelector('#askInput');
      if (inp) { inp.focus(); inp.select(); }
    });
  };
  GV.alert = (message) => GV.ask(message, { alert: true, ok: 'OK' });

  function download(filename, text) {
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  GV.download = download;

  function exportVerilog() {
    const g = GV.generateProject(App.project);
    if (g.errors.length) { GV.alert('Fix these first:\n\n' + g.errors.join('\n')); return; }
    textDialog('Export Verilog', GV.sanitize(App.project.name, 'design') + '.v', g.text,
      g.warnings.length ? `${g.warnings.length} warning(s); see the Verilog tab.` : 'All modules for the project, children first. The top module is <b>' + esc(App.project.top) + '</b>.');
  }
  function exportTestbench() {
    const sim = App.sim;
    if (!(sim instanceof GV.Simulator) || !sim.history.some((h) => !h.reset)) {
      GV.alert('Simulate a circuit and press Step a few times first. Each step is recorded and becomes a check in the testbench.');
      return;
    }
    textDialog('Testbench from simulation', `tb_${GV.sanitize(sim.circuitName)}.v`, GV.generateTestbench(App.project, sim.circuitName, sim.history),
      `Replays the ${sim.history.filter((h) => !h.reset).length} recorded cycles and checks every output. Run with: <code>iverilog -o sim design.v tb_${esc(GV.sanitize(sim.circuitName))}.v &amp;&amp; vvp sim</code>`);
  }

  function shortcuts() {
    const dlg = $('#settingsDlg');
    const rows = [
      ['Drag palette item', 'Add a block (or click it)'], ['Drag from a pin', 'Draw a wire to another pin'], ['Drag empty canvas', 'Pan'],
      ['Shift + drag canvas', 'Box select'], ['Mouse wheel', 'Zoom'], ['Double-click block', 'Open subcircuit / state machine'],
      ['Delete / Backspace', 'Delete selection'], ['Ctrl+C / Ctrl+V / Ctrl+D', 'Copy / paste / duplicate'], ['Ctrl+A', 'Select all'],
      ['Arrow keys', 'Nudge selection'], ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'], ['F', 'Fit design to window'], ['Ctrl+E', 'Start / stop simulation'],
      ['Space', 'Clock step (while simulating)'], ['R', 'Reset (while simulating)'], ['1–9 on a selected input', 'While simulating: set its value'],
      ['FSM: double-click canvas', 'Add a state'], ['FSM: Shift + drag from state', 'Draw a transition'],
    ];
    dlg.innerHTML = `<div class="head">Keyboard and mouse<span class="spacer"></span><button data-x>✕</button></div>
      <div class="body"><div class="shortcuts">${rows.map(([k, v]) => `<kbd>${esc(k)}</kbd><span>${esc(v)}</span>`).join('')}</div></div>`;
    dlg.querySelector('[data-x]').onclick = () => dlg.close();
    dlg.showModal();
  }

  function settingsDialog() {
    const s = App.settings;
    const dlg = $('#settingsDlg');
    const sel = (key, opts, val) => `<select data-k="${key}">${opts.map(([v, l]) => `<option value="${v}" ${String(val) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const chk = (key, label, val) => `<label class="check"><input type="checkbox" data-k="${key}" ${val ? 'checked' : ''}> ${label}</label>`;
    dlg.innerHTML = `<div class="head">Settings<span class="spacer"></span><button data-x>✕</button></div>
      <div class="body">
        <h4>Appearance</h4>
        <div class="grid2">
          <div class="field"><label>Theme</label>${sel('theme', [['system', 'Match system'], ['dark', 'Dark'], ['light', 'Light']], s.theme)}</div>
          <div class="field"><label>Accent colour</label><input type="color" data-k="accent" value="${esc(s.accent)}"></div>
          <div class="field"><label>Gate symbols</label>${sel('gateStyle', [['ansi', 'Distinctive (ANSI/IEEE)'], ['iec', 'Rectangular (IEC)']], s.gateStyle)}</div>
          <div class="field"><label>Wire style</label>${sel('wireStyle', [['orthogonal', 'Right angles'], ['curved', 'Curved'], ['straight', 'Straight']], s.wireStyle)}</div>
          <div class="field"><label>Value display</label>${sel('radix', [['auto', 'Auto (bin ≤ 4 bits, else hex)'], ['hex', 'Hexadecimal'], ['bin', 'Binary'], ['dec', 'Decimal']], s.radix)}</div>
          <div class="field"><label>Run speed (clock steps per second)</label><input type="number" min="0.5" max="60" step="0.5" data-k="simSpeed" value="${s.simSpeed}"></div>
        </div>
        ${chk('grid', 'Show grid', s.grid)}${chk('snap', 'Snap blocks to grid', s.snap)}${chk('showWidths', 'Label bus widths on wires', s.showWidths)}
        <h4>Block colours</h4>
        <div class="colors">${Object.entries(s.catColors).map(([k, v]) => `<label>${esc(k)}<input type="color" data-cat="${esc(k)}" value="${esc(v)}"></label>`).join('')}</div>
        <h4>Verilog output</h4>
        <div class="grid2">
          <div class="field"><label>Clock port name</label><input type="text" data-v="clock" value="${esc(s.verilog.clock)}"></div>
          <div class="field"><label>Reset port name</label><input type="text" data-v="reset" value="${esc(s.verilog.reset)}"></div>
          <div class="field"><label>Reset style</label>${sel('v:resetStyle', [['sync', 'Synchronous'], ['async', 'Asynchronous']], s.verilog.resetStyle)}</div>
          <div class="field"><label>Indentation</label>${sel('v:indent', [[2, '2 spaces'], [4, '4 spaces'], [3, '3 spaces']], s.verilog.indent)}</div>
        </div>
        ${chk('v:resetActiveLow', 'Reset is active-low', s.verilog.resetActiveLow)}${chk('v:header', 'Add header comments', s.verilog.header)}
        <p class="help">Registers, counters and state machines share one implicit clock and reset, added as ports to every module that needs them.</p>
      </div>
      <div class="foot"><button data-reset>Restore defaults</button><button class="primary" data-x>Done</button></div>`;
    dlg.querySelectorAll('[data-x]').forEach((b) => (b.onclick = () => dlg.close()));
    const apply = (fn) => { App.checkpoint(); fn(); App.applyTheme(); App.changed(); };
    dlg.querySelectorAll('[data-k]').forEach((el) => {
      el.onchange = () => apply(() => {
        let key = el.dataset.k, target = s;
        if (key.startsWith('v:')) { key = key.slice(2); target = s.verilog; }
        let v = el.type === 'checkbox' ? el.checked : el.value;
        if (key === 'simSpeed' || key === 'indent') v = Math.max(0.5, parseFloat(v) || 1);
        target[key] = v;
        if (key === 'simSpeed' && App.runTimer) { App.pauseRun(); App.toggleRun(); }
      });
    });
    dlg.querySelectorAll('[data-v]').forEach((el) => {
      el.onchange = () => {
        const n = el.value.trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) || GV.VERILOG_KEYWORDS.has(n)) { GV.alert('Not a valid Verilog name'); el.value = s.verilog[el.dataset.v]; return; }
        apply(() => { s.verilog[el.dataset.v] = n; });
      };
    });
    dlg.querySelectorAll('[data-cat]').forEach((el) => { el.oninput = () => { s.catColors[el.dataset.cat] = el.value; App.renderCanvas(); App.renderLeft(); }; el.onchange = () => App.changed(); });
    dlg.querySelector('[data-reset]').onclick = () => GV.ask('Restore all settings to defaults?', { ok: 'Restore' }).then((ok) => { if (ok) { apply(() => { App.project.settings = GV.defaultSettings(); }); settingsDialog(); } });
    if (!dlg.open) dlg.showModal();
  }

  function buildFileMenu() {
    const items = [
      ['new', 'New blank project'],
      ['-'], ['#', 'Examples'],
      ...Object.keys(GV.EXAMPLES).filter((k) => k !== 'Blank project').map((k) => ['ex:' + k, k]),
      ['-'],
      ['open', 'Open project file (.json)…'],
      ['save', 'Save project file (.json)'],
      ['-'],
      ['verilog', 'Export Verilog (.v)'],
      ['tb', 'Export testbench from simulation'],
      ['-'],
      ['keys', 'Keyboard shortcuts'],
    ];
    $('#fileList').innerHTML = items.map(([k, l]) => (k === '-' ? '<hr>' : k === '#' ? `<div class="label">${esc(l)}</div>` : `<button data-a="${esc(k)}">${esc(l)}</button>`)).join('');
  }

  function fileAction(a) {
    $('#fileMenu').classList.remove('open');
    if (a === 'new') GV.ask('Start a new blank project? It replaces the current one in this browser, so save a project file first if you want to keep it.', { ok: 'Start new', danger: true }).then((ok) => ok && App.load(GV.newProject()));
    else if (a.startsWith('ex:')) GV.ask(`Open the example "${a.slice(3)}"? It replaces the current project in this browser.`, { ok: 'Open example' }).then((ok) => ok && App.load(GV.EXAMPLES[a.slice(3)]()));
    else if (a === 'open') $('#fileInput').click();
    else if (a === 'save') { const t = JSON.stringify(App.project, null, 1); textDialog('Save project', GV.sanitize(App.project.name, 'project') + '.gv.json', t, 'The whole project: circuits, state machines, library blocks and settings.'); }
    else if (a === 'verilog') exportVerilog();
    else if (a === 'tb') exportTestbench();
    else if (a === 'keys') shortcuts();
  }

  function bindTopbar() {
    buildFileMenu();
    $('#tabs').onclick = (e) => { const t = e.target.closest('button'); if (t) App.setTab(t.dataset.tab); };
    $('#projName').onchange = (e) => { App.checkpoint(); App.project.name = e.target.value || 'Untitled design'; App.changed(); };
    $('#simToggle').onclick = () => { if (App.simOn) { App.stopSim(); App.render(); } else App.startSim(); };
    $('#simStep').onclick = () => App.step();
    $('#simReset').onclick = () => App.resetSim();
    $('#simRun').onclick = () => App.toggleRun();
    $('#undoBtn').onclick = () => App.undo();
    $('#redoBtn').onclick = () => App.redo();
    $('#settingsBtn').onclick = settingsDialog;
    $('#fileBtn').onclick = (e) => { e.stopPropagation(); $('#fileMenu').classList.toggle('open'); };
    $('#fileList').onclick = (e) => { const b = e.target.closest('button'); if (b) fileAction(b.dataset.a); };
    document.addEventListener('click', (e) => { if (!e.target.closest('#fileMenu')) $('#fileMenu').classList.remove('open'); });
    $('#fileInput').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try { App.load(JSON.parse(await f.text())); } catch (err) { GV.alert('Could not open that file: ' + err.message); }
      e.target.value = '';
    };
    $('#toggleLeft').onclick = () => $('#left').classList.toggle('open');
    $('#toggleRight').onclick = () => $('#right').classList.toggle('open');
  }

  function onKey(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || $('#settingsDlg').open || $('#askDlg').open) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? App.redo() : App.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); App.redo(); return; }
    if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); $('#simToggle').click(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); fileAction('save'); return; }
    if (App.simOn && App.sim && !mod) {
      if (e.key === ' ') { e.preventDefault(); App.step(); return; }
      if (e.key === 'r' || e.key === 'R') { App.resetSim(); return; }
    }
    App.ui().onKey?.(e);
  }

  window.addEventListener('DOMContentLoaded', () => App.init());
})();
