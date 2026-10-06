// Built-in example projects.
(function () {
  const GV = (globalThis.GV = globalThis.GV || {});

  function comp(id, type, x, y, props, label = '') {
    return { id, type, x, y, label, props: { ...JSON.parse(JSON.stringify(GV.TYPES[type].defaults)), ...props } };
  }
  const wire = (id, fc, fp, tc, tp) => ({ id, from: { c: fc, p: fp }, to: { c: tc, p: tp } });

  function tour() {
    const p = GV.newProject();
    p.name = 'Getting started tour';
    p.circuits.main = {
      name: 'main',
      components: [
        comp('n1', 'note', 40, -60, { text: 'Click Simulate, then click inputs to change them and press Step to clock the design. Double-click a block to open it.', width: 520 }),
        comp('ia', 'input', 40, 40, { name: 'a', width: 4 }),
        comp('ib', 'input', 40, 120, { name: 'b', width: 4 }),
        comp('add', 'op', 220, 40, { op: '+', width: 4, outWidth: 5 }, 'sum5'),
        comp('cmp', 'expr', 220, 140, { title: 'compare', inputs: 'a:4, b:4', outputs: 'gt:1, eq:1', code: 'gt = a > b;\neq = a == b;' }),
        comp('osum', 'output', 420, 50, { name: 'sum', width: 5 }),
        comp('ogt', 'output', 420, 140, { name: 'gt', width: 1 }),
        comp('oeq', 'output', 420, 200, { name: 'eq', width: 1 }),
        comp('ien', 'input', 40, 300, { name: 'en', width: 1 }),
        comp('cnt', 'counter', 220, 280, { width: 4 }, 'count_reg'),
        comp('ocnt', 'output', 420, 300, { name: 'count', width: 4 }),
        comp('icar', 'input', 40, 420, { name: 'car', width: 1 }),
        comp('tl', 'fsm', 220, 400, { fsm: 'traffic' }, 'lights'),
        comp('olight', 'output', 420, 400, { name: 'light', width: 2 }),
        comp('owalk', 'output', 420, 460, { name: 'walk', width: 1 }),
        comp('ix', 'input', 40, 560, { name: 'x', width: 1 }),
        comp('iy', 'input', 40, 620, { name: 'y', width: 1 }),
        comp('ha', 'sub', 220, 560, { circuit: 'half_adder' }, 'ha0'),
        comp('os', 'output', 420, 560, { name: 's', width: 1 }),
        comp('oc', 'output', 420, 620, { name: 'c', width: 1 }),
      ],
      wires: [
        wire('w1', 'ia', 'out', 'add', 'a'), wire('w2', 'ib', 'out', 'add', 'b'), wire('w3', 'add', 'y', 'osum', 'in'),
        wire('w4', 'ia', 'out', 'cmp', 'a'), wire('w5', 'ib', 'out', 'cmp', 'b'),
        wire('w6', 'cmp', 'gt', 'ogt', 'in'), wire('w7', 'cmp', 'eq', 'oeq', 'in'),
        wire('w8', 'ien', 'out', 'cnt', 'en'), wire('w9', 'cnt', 'q', 'ocnt', 'in'),
        wire('w10', 'icar', 'out', 'tl', 'car'), wire('w11', 'tl', 'light', 'olight', 'in'), wire('w12', 'tl', 'walk', 'owalk', 'in'),
        wire('w13', 'ix', 'out', 'ha', 'x'), wire('w14', 'iy', 'out', 'ha', 'y'), wire('w15', 'ha', 's', 'os', 'in'), wire('w16', 'ha', 'c', 'oc', 'in'),
      ],
    };
    p.circuits.half_adder = {
      name: 'half_adder',
      components: [
        comp('hx', 'input', 40, 40, { name: 'x' }), comp('hy', 'input', 40, 120, { name: 'y' }),
        comp('hxor', 'xor', 200, 40, {}), comp('hand', 'and', 200, 140, {}),
        comp('hs', 'output', 340, 60, { name: 's' }), comp('hc', 'output', 340, 160, { name: 'c' }),
      ],
      wires: [
        wire('h1', 'hx', 'out', 'hxor', 'in0'), wire('h2', 'hy', 'out', 'hxor', 'in1'),
        wire('h3', 'hx', 'out', 'hand', 'in0'), wire('h4', 'hy', 'out', 'hand', 'in1'),
        wire('h5', 'hxor', 'y', 'hs', 'in'), wire('h6', 'hand', 'y', 'hc', 'in'),
      ],
    };
    p.fsms.traffic = {
      name: 'traffic', inputs: 'car:1', outputs: 'light:2, walk:1', encoding: 'binary', exposeState: false,
      states: [
        { id: 'sg', name: 'GREEN', x: 160, y: 160, outputs: "light = 2'd0;", color: '#2f9e6e' },
        { id: 'sy', name: 'YELLOW', x: 420, y: 160, outputs: "light = 2'd1;", color: '#e5a13a' },
        { id: 'sr', name: 'RED', x: 290, y: 360, outputs: "light = 2'd2;\nwalk = 1;", color: '#e0566b' },
      ],
      transitions: [
        { id: 't1', from: 'sg', to: 'sy', cond: 'car', actions: '' },
        { id: 't2', from: 'sy', to: 'sr', cond: '', actions: '' },
        { id: 't3', from: 'sr', to: 'sg', cond: '!car', actions: '' },
      ],
      reset: 'sg',
    };
    p.library.popcount4 = { name: 'popcount4', inputs: 'v:4', outputs: 'n:3', code: 'n = v[0] + v[1] + v[2] + v[3];', color: '' };
    return p;
  }

  function sequenceDetector() {
    const p = GV.newProject();
    p.name = 'Sequence detector (1011)';
    p.fsms.detect1011 = {
      name: 'detect1011', inputs: 'bit_in:1', outputs: 'found:1', encoding: 'onehot', exposeState: true,
      states: [
        { id: 'a', name: 'S0', x: 120, y: 200, outputs: '', color: '' },
        { id: 'b', name: 'S1', x: 300, y: 200, outputs: '', color: '' },
        { id: 'c', name: 'S10', x: 480, y: 200, outputs: '', color: '' },
        { id: 'd', name: 'S101', x: 660, y: 200, outputs: '', color: '' },
      ],
      transitions: [
        { id: 'x1', from: 'a', to: 'b', cond: 'bit_in', actions: '' },
        { id: 'x2', from: 'b', to: 'c', cond: '!bit_in', actions: '' },
        { id: 'x3', from: 'c', to: 'd', cond: 'bit_in', actions: '' },
        { id: 'x4', from: 'c', to: 'a', cond: '!bit_in', actions: '' },
        { id: 'x5', from: 'd', to: 'b', cond: 'bit_in', actions: 'found = 1;' },
        { id: 'x6', from: 'd', to: 'c', cond: '!bit_in', actions: '' },
      ],
      reset: 'a',
    };
    p.circuits.main = {
      name: 'main',
      components: [
        comp('i', 'input', 40, 60, { name: 'bit_in' }),
        comp('f', 'fsm', 220, 40, { fsm: 'detect1011' }, 'det'),
        comp('o', 'output', 440, 40, { name: 'found' }),
        comp('o2', 'output', 440, 100, { name: 'state', width: 4 }),
        comp('c', 'counter', 220, 180, { width: 8 }, 'hits'),
        comp('o3', 'output', 440, 200, { name: 'hit_count', width: 8 }),
      ],
      wires: [wire('a', 'i', 'out', 'f', 'bit_in'), wire('b', 'f', 'found', 'o', 'in'), wire('c', 'f', 'state', 'o2', 'in'), wire('d', 'f', 'found', 'c', 'en'), wire('e', 'c', 'q', 'o3', 'in')],
    };
    return p;
  }

  GV.EXAMPLES = { 'Getting started tour': tour, 'Sequence detector (1011)': sequenceDetector, 'Blank project': () => GV.newProject() };
})();
