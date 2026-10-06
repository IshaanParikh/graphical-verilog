// Project data model and the component registry (ports, properties, appearance).
(function () {
  const GV = (globalThis.GV = globalThis.GV || {});

  let idCounter = Date.now() % 100000;
  const uid = (p = 'c') => p + (idCounter++).toString(36) + Math.floor(Math.random() * 36).toString(36);

  const VERILOG_KEYWORDS = new Set(('always and assign automatic begin buf bufif0 bufif1 case casex casez cell cmos config deassign default defparam design disable edge else end endcase endconfig endfunction endgenerate endmodule endprimitive endspecify endtable endtask event for force forever fork function generate genvar highz0 highz1 if ifnone incdir include initial inout input instance integer join large liblist library localparam logic macromodule medium module nand negedge nmos nor noshowcancelled not notif0 notif1 or output parameter pmos posedge primitive pull0 pull1 pulldown pullup pulsestyle_onevent pulsestyle_ondetect rcmos real realtime reg release repeat rnmos rpmos rtran rtranif0 rtranif1 scalared showcancelled signed small specify specparam strong0 strong1 supply0 supply1 table task time tran tranif0 tranif1 tri tri0 tri1 triand trior trireg unsigned use uwire vectored wait wand weak0 weak1 while wire wor xnor xor').split(' '));

  function sanitize(name, fallback = 'n') {
    let s = String(name || '').trim().replace(/[^A-Za-z0-9_]/g, '_');
    if (!s) s = fallback;
    if (/^[0-9]/.test(s)) s = '_' + s;
    if (VERILOG_KEYWORDS.has(s)) s = s + '_';
    return s;
  }

  const clampW = (w) => Math.max(1, Math.min(256, parseInt(w, 10) || 1));
  const safeSpec = (spec) => { try { return GV.parsePortSpec(spec); } catch (e) { return []; } };
  const P = (name, w) => ({ name, w: clampW(w) });

  const GATE_OPS = { and: '&', or: '|', xor: '^', nand: '&', nor: '|', xnor: '^' };

  const OPERATORS = ['+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>', '==', '!=', '<', '<=', '>', '>='];
  const isCmp = (op) => ['==', '!=', '<', '<=', '>', '>='].includes(op);

  const widthField = { key: 'width', label: 'Bit width', type: 'int', min: 1, max: 256 };

  function gateDef(kind, label) {
    return {
      cat: 'Logic gates', label, shape: kind,
      defaults: { inputs: 2, width: 1 },
      schema: [{ key: 'inputs', label: 'Inputs', type: 'int', min: 2, max: 16 }, widthField],
      ports: (c) => ({
        ins: Array.from({ length: Math.max(2, Math.min(16, c.props.inputs | 0)) }, (_, i) => P('in' + i, c.props.width)),
        outs: [P('y', c.props.width)],
      }),
    };
  }

  const TYPES = {
    input: {
      cat: 'Inputs / outputs', label: 'Input', shape: 'input',
      defaults: { name: 'a', width: 1 },
      schema: [{ key: 'name', label: 'Port name', type: 'text' }, widthField],
      ports: (c) => ({ ins: [], outs: [P('out', c.props.width)] }),
      size: () => ({ w: 90, h: 40 }),
    },
    output: {
      cat: 'Inputs / outputs', label: 'Output', shape: 'output',
      defaults: { name: 'y', width: 1 },
      schema: [{ key: 'name', label: 'Port name', type: 'text' }, widthField],
      ports: (c) => ({ ins: [P('in', c.props.width)], outs: [] }),
      size: () => ({ w: 90, h: 40 }),
    },
    const: {
      cat: 'Inputs / outputs', label: 'Constant', shape: 'const',
      defaults: { value: '0', width: 1 },
      schema: [{ key: 'value', label: 'Value (e.g. 5, 4\'b1010, 8\'hFF)', type: 'text' }, widthField],
      ports: (c) => ({ ins: [], outs: [P('y', c.props.width)] }),
      size: () => ({ w: 70, h: 40 }),
    },
    probe: {
      cat: 'Inputs / outputs', label: 'Probe', shape: 'probe',
      defaults: { width: 1 },
      schema: [widthField],
      help: 'Shows a value while simulating and adds it to the waveform. Not exported to Verilog.',
      ports: (c) => ({ ins: [P('in', c.props.width)], outs: [] }),
      size: () => ({ w: 70, h: 40 }),
    },
    and: gateDef('and', 'AND'),
    or: gateDef('or', 'OR'),
    xor: gateDef('xor', 'XOR'),
    nand: gateDef('nand', 'NAND'),
    nor: gateDef('nor', 'NOR'),
    xnor: gateDef('xnor', 'XNOR'),
    not: {
      cat: 'Logic gates', label: 'NOT', shape: 'not',
      defaults: { width: 1 }, schema: [widthField],
      ports: (c) => ({ ins: [P('a', c.props.width)], outs: [P('y', c.props.width)] }),
    },
    mux: {
      cat: 'Routing', label: 'Multiplexer', shape: 'mux',
      defaults: { selBits: 1, width: 1 },
      schema: [{ key: 'selBits', label: 'Select bits', type: 'int', min: 1, max: 5 }, widthField],
      ports: (c) => {
        const n = 1 << Math.max(1, Math.min(5, c.props.selBits | 0));
        return { ins: [...Array.from({ length: n }, (_, i) => P('d' + i, c.props.width)), P('sel', c.props.selBits)], outs: [P('y', c.props.width)] };
      },
    },
    decoder: {
      cat: 'Routing', label: 'Decoder', shape: 'box',
      defaults: { bits: 2 },
      schema: [{ key: 'bits', label: 'Input bits', type: 'int', min: 1, max: 6 }],
      help: 'One-hot decoder: y[i] = (a == i).',
      ports: (c) => ({ ins: [P('a', c.props.bits)], outs: [P('y', 1 << Math.max(1, Math.min(6, c.props.bits | 0)))] }),
    },
    slice: {
      cat: 'Routing', label: 'Bit slice', shape: 'box',
      defaults: { width: 8, hi: 3, lo: 0 },
      schema: [{ key: 'width', label: 'Input width', type: 'int', min: 1, max: 256 }, { key: 'hi', label: 'High bit', type: 'int', min: 0, max: 255 }, { key: 'lo', label: 'Low bit', type: 'int', min: 0, max: 255 }],
      ports: (c) => {
        const hi = Math.min(c.props.hi | 0, clampW(c.props.width) - 1), lo = Math.min(c.props.lo | 0, hi);
        return { ins: [P('a', c.props.width)], outs: [P('y', hi - lo + 1)] };
      },
    },
    concat: {
      cat: 'Routing', label: 'Concatenate', shape: 'box',
      defaults: { widths: '4,4' },
      schema: [{ key: 'widths', label: 'Input widths, MSB first (e.g. 4,4)', type: 'text' }],
      ports: (c) => {
        const ws = String(c.props.widths).split(/[,\s]+/).filter(Boolean).map(clampW);
        const list = ws.length ? ws : [1, 1];
        return { ins: list.map((w, i) => P('in' + i, w)), outs: [P('y', list.reduce((a, b) => a + b, 0))] };
      },
    },
    extend: {
      cat: 'Routing', label: 'Extend', shape: 'box',
      defaults: { from: 4, to: 8, sign: false },
      schema: [{ key: 'from', label: 'Input width', type: 'int', min: 1, max: 256 }, { key: 'to', label: 'Output width', type: 'int', min: 1, max: 256 }, { key: 'sign', label: 'Sign-extend', type: 'bool' }],
      ports: (c) => ({ ins: [P('a', c.props.from)], outs: [P('y', Math.max(clampW(c.props.from), clampW(c.props.to)))] }),
    },
    op: {
      cat: 'Arithmetic', label: 'Operator', shape: 'box',
      defaults: { op: '+', width: 4, outWidth: 0 },
      schema: [{ key: 'op', label: 'Operation', type: 'select', options: OPERATORS }, widthField, { key: 'outWidth', label: 'Output width (0 = same as inputs)', type: 'int', min: 0, max: 256 }],
      ports: (c) => ({
        ins: [P('a', c.props.width), P('b', c.props.op === '<<' || c.props.op === '>>' ? Math.max(1, Math.ceil(Math.log2(clampW(c.props.width) + 1))) : c.props.width)],
        outs: [P('y', isCmp(c.props.op) ? 1 : (c.props.outWidth | 0) || c.props.width)],
      }),
    },
    adder: {
      cat: 'Arithmetic', label: 'Full adder', shape: 'box',
      defaults: { width: 4 }, schema: [widthField],
      ports: (c) => ({ ins: [P('a', c.props.width), P('b', c.props.width), P('cin', 1)], outs: [P('sum', c.props.width), P('cout', 1)] }),
    },
    register: {
      cat: 'Sequential', label: 'Register', shape: 'reg', seq: true,
      defaults: { width: 4, reset: '0', enable: false },
      schema: [widthField, { key: 'reset', label: 'Reset value', type: 'text' }, { key: 'enable', label: 'Has enable input', type: 'bool' }],
      ports: (c) => ({ ins: [P('d', c.props.width), ...(c.props.enable ? [P('en', 1)] : [])], outs: [P('q', c.props.width)] }),
    },
    counter: {
      cat: 'Sequential', label: 'Counter', shape: 'reg', seq: true,
      defaults: { width: 4, reset: '0', step: 1, down: false, clear: false },
      schema: [widthField, { key: 'reset', label: 'Reset value', type: 'text' }, { key: 'step', label: 'Step', type: 'int', min: 1, max: 1 << 30 }, { key: 'down', label: 'Count down', type: 'bool' }, { key: 'clear', label: 'Has synchronous clear input', type: 'bool' }],
      ports: (c) => ({ ins: [P('en', 1), ...(c.props.clear ? [P('clr', 1)] : [])], outs: [P('q', c.props.width)] }),
    },
    expr: {
      cat: 'Custom', label: 'Expression block', shape: 'custom',
      defaults: { title: 'logic', inputs: 'a:4, b:4', outputs: 'y:4, eq:1', code: 'y = a + b;\neq = a == b;' },
      schema: [
        { key: 'title', label: 'Block title', type: 'text' },
        { key: 'inputs', label: 'Inputs (name:width, ...)', type: 'text' },
        { key: 'outputs', label: 'Outputs (name:width, ...)', type: 'text' },
        { key: 'code', label: 'Verilog assignments', type: 'code' },
      ],
      help: 'Write any combinational logic as Verilog expressions: & | ^ ~ ! + - * / % << >> == != < > ?: {a,b} {n{a}} a[3:0] and reductions like &a.',
      ports: (c) => ({ ins: safeSpec(c.props.inputs).map((p) => P(p.name, p.width)), outs: safeSpec(c.props.outputs).map((p) => P(p.name, p.width)) }),
    },
    lib: {
      cat: 'Library', label: 'Library block', shape: 'custom',
      defaults: { lib: '' },
      schema: [{ key: 'lib', label: 'Library block', type: 'lib' }],
      ports: (c, project) => {
        const d = project && project.library[c.props.lib];
        if (!d) return { ins: [], outs: [] };
        return { ins: safeSpec(d.inputs).map((p) => P(p.name, p.width)), outs: safeSpec(d.outputs).map((p) => P(p.name, p.width)) };
      },
    },
    sub: {
      cat: 'Subcircuits', label: 'Subcircuit', shape: 'module',
      defaults: { circuit: '' },
      schema: [{ key: 'circuit', label: 'Circuit', type: 'circuit' }],
      ports: (c, project) => circuitPorts(project, c.props.circuit),
    },
    fsm: {
      cat: 'State machines', label: 'State machine', shape: 'fsmblock',
      defaults: { fsm: '' },
      schema: [{ key: 'fsm', label: 'State machine', type: 'fsm' }],
      ports: (c, project) => {
        const f = project && project.fsms[c.props.fsm];
        if (!f) return { ins: [], outs: [] };
        return { ins: safeSpec(f.inputs).map((p) => P(p.name, p.width)), outs: [...safeSpec(f.outputs).map((p) => P(p.name, p.width)), ...(f.exposeState ? [P('state', fsmStateBits(f))] : [])] };
      },
    },
    note: {
      cat: 'Annotations', label: 'Note', shape: 'note',
      defaults: { text: 'Double-click to edit this note', width: 180 },
      schema: [{ key: 'text', label: 'Text', type: 'code' }, { key: 'width', label: 'Box width', type: 'int', min: 60, max: 800 }],
      ports: () => ({ ins: [], outs: [] }),
      size: (c) => {
        const w = Math.max(60, c.props.width | 0 || 180);
        const lines = wrapText(c.props.text || '', Math.floor((w - 16) / 7)).length;
        return { w, h: Math.max(30, lines * 16 + 14) };
      },
    },
  };

  function wrapText(text, cols) {
    const out = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        if (line && (line + ' ' + word).length > cols) { out.push(line); line = word; } else line = line ? line + ' ' + word : word;
      }
      out.push(line);
    }
    return out;
  }

  function fsmStateBits(f) {
    const n = Math.max(1, f.states.length);
    if (f.encoding === 'onehot') return n;
    return Math.max(1, Math.ceil(Math.log2(n)));
  }

  function circuitPorts(project, name) {
    const circ = project && project.circuits[name];
    if (!circ) return { ins: [], outs: [] };
    const ins = [], outs = [];
    const sorted = [...circ.components].sort((a, b) => a.y - b.y || a.x - b.x);
    for (const c of sorted) {
      if (c.type === 'input') ins.push(P(sanitize(c.props.name), c.props.width));
      if (c.type === 'output') outs.push(P(sanitize(c.props.name), c.props.width));
    }
    return { ins, outs };
  }

  function getPorts(c, project) {
    const t = TYPES[c.type];
    if (!t) return { ins: [], outs: [] };
    return t.ports(c, project);
  }

  const GRID = 20;
  function getSize(c, project, ports) {
    const t = TYPES[c.type];
    if (t && t.size) return t.size(c);
    ports = ports || getPorts(c, project);
    const rows = Math.max(ports.ins.length, ports.outs.length, 2);
    let w = 60;
    if (['custom', 'module', 'fsmblock', 'box'].includes(t.shape)) {
      const longest = (arr) => arr.reduce((m, p) => Math.max(m, p.name.length), 0);
      w = Math.max(80, Math.ceil(((longest(ports.ins) + longest(ports.outs)) * 7 + 40) / GRID) * GRID);
      const title = blockTitle(c, project);
      w = Math.max(w, Math.ceil((title.length * 8 + 20) / GRID) * GRID);
    }
    if (t.shape === 'mux') w = 40;
    if (t.shape === 'reg') w = 80;
    return { w, h: (rows + 1) * GRID };
  }

  // Port positions relative to component origin.
  function portLayout(c, project) {
    const ports = getPorts(c, project);
    const size = getSize(c, project, ports);
    const place = (list, x) => {
      const n = list.length;
      const top = Math.round((size.h - (n - 1) * GRID) / 2 / 10) * 10;
      return list.map((p, i) => ({ ...p, x, y: top + i * GRID }));
    };
    let ins = place(ports.ins, 0);
    if (c.type === 'mux') {
      // Data inputs on the left, select on the bottom edge.
      const data = place(ports.ins.slice(0, -1), 0);
      const sel = { ...ports.ins[ports.ins.length - 1], x: size.w / 2, y: size.h - 8, bottom: true };
      ins = [...data, sel];
    }
    return { ins, outs: place(ports.outs, size.w), size };
  }

  function blockTitle(c, project) {
    const t = TYPES[c.type];
    switch (c.type) {
      case 'expr': return c.props.title || 'expr';
      case 'lib': return c.props.lib || '(library)';
      case 'sub': return c.props.circuit || '(circuit)';
      case 'fsm': return c.props.fsm || '(FSM)';
      case 'op': return c.props.op;
      case 'adder': return 'ADD';
      case 'decoder': return 'DEC';
      case 'slice': return `[${c.props.hi}:${c.props.lo}]`;
      case 'concat': return '{ , }';
      case 'extend': return c.props.sign ? 'SEXT' : 'ZEXT';
      case 'register': return 'REG';
      case 'counter': return c.props.down ? 'CNT ↓' : 'CNT';
      default: return t ? t.label : c.type;
    }
  }

  function defaultProps(type) {
    return JSON.parse(JSON.stringify(TYPES[type].defaults));
  }

  function newComponent(type, x, y, extraProps) {
    return { id: uid('c'), type, x, y, label: '', props: { ...defaultProps(type), ...(extraProps || {}) } };
  }

  function newCircuit(name) { return { name, components: [], wires: [] }; }

  function newFsm(name) {
    const s0 = { id: uid('s'), name: 'IDLE', x: 200, y: 200, outputs: '', color: '' };
    return {
      name, inputs: 'go:1', outputs: 'busy:1', encoding: 'binary', exposeState: false,
      states: [s0], transitions: [], reset: s0.id,
    };
  }

  function defaultSettings() {
    return {
      theme: 'system', accent: '#4f9cff', gateStyle: 'ansi', wireStyle: 'orthogonal', grid: true, snap: true,
      showWidths: true, radix: 'auto', simSpeed: 4, animateWires: true,
      catColors: {
        'Inputs / outputs': '#2f9e6e', 'Logic gates': '#4f9cff', Routing: '#a072ff', Arithmetic: '#e5a13a',
        Sequential: '#e0566b', Custom: '#1fb5c0', Library: '#1fb5c0', Subcircuits: '#8d99ae', 'State machines': '#f06fb5', Annotations: '#b8a34a',
      },
      verilog: { clock: 'clk', reset: 'rst', resetStyle: 'sync', resetActiveLow: false, indent: 2, header: true, outputReg: false },
    };
  }

  function newProject() {
    return { version: 1, name: 'Untitled design', top: 'main', circuits: { main: newCircuit('main') }, fsms: {}, library: {}, settings: defaultSettings() };
  }

  // Fill in fields that older/hand-written project files may lack.
  function normalizeProject(p) {
    const d = defaultSettings();
    p.settings = { ...d, ...(p.settings || {}) };
    p.settings.verilog = { ...d.verilog, ...(p.settings.verilog || {}) };
    p.settings.catColors = { ...d.catColors, ...(p.settings.catColors || {}) };
    p.circuits = p.circuits || {};
    p.fsms = p.fsms || {};
    p.library = p.library || {};
    if (!Object.keys(p.circuits).length) p.circuits.main = newCircuit('main');
    if (!p.circuits[p.top]) p.top = Object.keys(p.circuits)[0];
    for (const c of Object.values(p.circuits)) {
      c.components = c.components || [];
      c.wires = c.wires || [];
      for (const comp of c.components) comp.props = { ...(TYPES[comp.type] ? defaultProps(comp.type) : {}), ...(comp.props || {}) };
    }
    for (const f of Object.values(p.fsms)) {
      f.states = f.states || []; f.transitions = f.transitions || [];
      f.encoding = f.encoding || 'binary';
      if (!f.states.find((s) => s.id === f.reset) && f.states[0]) f.reset = f.states[0].id;
    }
    return p;
  }

  Object.assign(GV, {
    uid, sanitize, TYPES, OPERATORS, isCmp, GATE_OPS, getPorts, getSize, portLayout, blockTitle, newComponent, newCircuit,
    newFsm, newProject, normalizeProject, defaultSettings, circuitPorts, fsmStateBits, wrapText, GRID, clampW, safeSpec, VERILOG_KEYWORDS,
  });
})();
