// Engine tests: runs the simulator, exports Verilog, and checks the result against Icarus Verilog.
// Usage: node test/run.js   (needs iverilog/vvp on PATH for the cross-checks)
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

for (const f of ['expr', 'model', 'sim', 'verilog', 'examples']) require(path.join(__dirname, '..', 'src', f + '.js'));
const GV = globalThis.GV;

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.log('FAIL', msg); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gvtest-'));
const hasIverilog = (() => { try { execFileSync('iverilog', ['-V'], { stdio: 'ignore' }); return true; } catch { return false; } })();

function iv(files, top) {
  const out = path.join(tmp, top + '.vvp');
  execFileSync('iverilog', ['-g2005', '-Wall', '-o', out, '-s', top, ...files], { stdio: 'pipe' });
  return execFileSync('vvp', ['-n', out], { cwd: tmp }).toString();
}

// 1. Expression evaluator vs Icarus on random expressions.
function randomExprTest(count) {
  const vars = { a: 4, b: 4, c: 1, d: 8 };
  const ops = ['+', '-', '*', '&', '|', '^', '~^', '==', '!=', '<', '>=', '&&', '||', '<<', '>>'];
  const un = ['~', '!', '-', '&', '|', '^', '~&'];
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const gen = (d) => {
    const k = rnd(d > 2 ? 3 : 9);
    if (k === 0 || d > 3) return Object.keys(vars)[rnd(4)];
    if (k === 1) return `${1 + rnd(6)}'d${rnd(16)}`;
    if (k === 2) return `(${gen(d + 1)} ${ops[rnd(ops.length)]} ${gen(d + 1)})`;
    if (k === 3) return `${un[rnd(un.length)]}(${gen(d + 1)})`;
    if (k === 4) return `(${gen(d + 1)} ? ${gen(d + 1)} : ${gen(d + 1)})`;
    if (k === 5) return `{${gen(d + 1)}, ${gen(d + 1)}}`;
    if (k === 6) return `d[${rnd(8)}]`;
    if (k === 7) return `d[${4 + rnd(4)}:${rnd(4)}]`;
    return `(${gen(d + 1)} ${ops[rnd(ops.length)]} ${gen(d + 1)})`;
  };
  const cases = [];
  for (let i = 0; i < count; i++) {
    const e = gen(0);
    const env = { a: BigInt(rnd(16)), b: BigInt(rnd(16)), c: BigInt(rnd(2)), d: BigInt(rnd(256)) };
    const w = 1 + rnd(12);
    const got = GV.evaluate(GV.parseExpr(e), { val: (n) => env[n], w: (n) => vars[n] }, w) & GV.mask(w);
    cases.push({ e, env, w, got });
  }
  if (!hasIverilog) return;
  const L = ['module t;', 'reg [3:0] a, b; reg c; reg [7:0] d;'];
  cases.forEach((c, i) => L.push(`wire [${c.w - 1}:0] r${i} = ${c.e};`));
  L.push('initial begin');
  cases.forEach((c, i) => {
    L.push(`a=${c.env.a}; b=${c.env.b}; c=${c.env.c}; d=${c.env.d}; #1;`);
    L.push(`if (r${i} !== ${c.w}'d${c.got}) $display("MISMATCH ${i} %d", r${i});`);
  });
  L.push('$display("done"); end endmodule');
  const f = path.join(tmp, 'expr.v');
  fs.writeFileSync(f, L.join('\n'));
  const out = iv([f], 't');
  const mism = out.split('\n').filter((l) => l.startsWith('MISMATCH'));
  mism.slice(0, 5).forEach((l) => { const i = +l.split(' ')[1]; console.log(l, cases[i].e, cases[i].env, 'w', cases[i].w, 'got', cases[i].got); });
  ok(mism.length === 0 && out.includes('done'), `expression evaluator matches iverilog (${count} random cases, ${mism.length} mismatches)`);
}

// 2. Simulate an example, export, and run the recorded testbench in Icarus.
function exampleTest(name, drive, settings) {
  const p = GV.EXAMPLES[name]();
  if (settings) Object.assign(p.settings.verilog, settings);
  const sim = new GV.Simulator(p, p.top);
  drive(sim);
  const gen = GV.generateProject(p);
  ok(gen.errors.length === 0, `${name}: generation errors ${gen.errors.join('; ')}`);
  if (gen.warnings.length) console.log('  warnings:', gen.warnings.join(' | '));
  const tb = GV.generateTestbench(p, p.top, sim.history);
  const df = path.join(tmp, 'design.v'), tf = path.join(tmp, 'tb.v');
  fs.writeFileSync(df, gen.text);
  fs.writeFileSync(tf, tb);
  if (!hasIverilog) return sim;
  let out;
  try { out = iv([df, tf], 'tb_' + p.top); } catch (e) { out = String(e.stderr || e.message); }
  ok(out.includes('PASS'), `${name} ${JSON.stringify(settings || {})}: testbench result: ${out.trim().split('\n').slice(-6).join(' / ')}`);
  return sim;
}

function driveTour(sim) {
  let s = 1;
  const r = (n) => { s = (s * 48271) % 2147483647; return BigInt(s % n); };
  for (let i = 0; i < 60; i++) {
    sim.setInput('a', r(16)); sim.setInput('b', r(16)); sim.setInput('en', r(2));
    sim.setInput('car', r(2)); sim.setInput('x', r(2)); sim.setInput('y', r(2));
    if (i === 30) sim.reset();
    sim.step();
  }
}

randomExprTest(400);
const tourSim = exampleTest('Getting started tour', driveTour);
ok(tourSim.root.outputs.sum !== undefined, 'tour has sum output');
exampleTest('Getting started tour', driveTour, { resetStyle: 'async', resetActiveLow: true, clock: 'clock', reset: 'rst_n', indent: 4 });
const det = exampleTest('Sequence detector (1011)', (sim) => {
  const bits = [1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 0, 1, 0, 1, 1];
  bits.forEach((b) => { sim.setInput('bit_in', b); sim.step(); });
});
ok(det.root.outputs.hit_count === 4n, `sequence detector counted ${det.root.outputs.hit_count} hits (expected 4 overlapping)`);

// 3. Every component type at once, with odd widths, through Icarus.
(function allComponents() {
  const p = GV.newProject();
  const C = (id, type, props, x = 0, y = 0) => ({ id, type, x, y, label: '', props: { ...JSON.parse(JSON.stringify(GV.TYPES[type].defaults)), ...props } });
  const W = (n, fc, fp, tc, tp) => ({ id: 'w' + n, from: { c: fc, p: fp }, to: { c: tc, p: tp } });
  p.library.mixer = { name: 'mixer', inputs: 'x:6, y:6', outputs: 'z:6', code: 't = x ^ {y[2:0], y[5:3]};\nz = t + 1;' };
  p.circuits.main = {
    name: 'main',
    components: [
      C('a', 'input', { name: 'a', width: 6 }, 0, 0), C('b', 'input', { name: 'b', width: 6 }, 0, 50), C('s', 'input', { name: 's', width: 2 }, 0, 100),
      C('k', 'const', { value: "6'h2A", width: 6 }), C('n1', 'nand', { inputs: 3, width: 6 }), C('x1', 'xnor', { width: 6 }), C('no', 'nor', { width: 6 }),
      C('m', 'mux', { selBits: 2, width: 6 }), C('dec', 'decoder', { bits: 2 }), C('sl', 'slice', { width: 6, hi: 4, lo: 1 }),
      C('cc', 'concat', { widths: '4,2,1' }), C('ex', 'extend', { from: 4, to: 9, sign: true }), C('ad', 'adder', { width: 6 }),
      C('mul', 'op', { op: '*', width: 6, outWidth: 12 }), C('lt', 'op', { op: '<', width: 6 }), C('sh', 'op', { op: '>>', width: 6 }),
      C('rg', 'register', { width: 6, reset: '5', enable: true }), C('ct', 'counter', { width: 3, step: 3, down: true, clear: true, reset: '7' }),
      C('lb', 'lib', { lib: 'mixer' }), C('ns', 'not', { width: 1 }),
      ...['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7', 'o8', 'o9', 'o10', 'o11', 'o12', 'o13', 'o14'].map((id, i) => C(id, 'output', { name: id, width: [6, 6, 4, 4, 7, 9, 6, 12, 1, 6, 6, 3, 6, 1][i] })),
    ],
    wires: [
      W(1, 'a', 'out', 'n1', 'in0'), W(2, 'b', 'out', 'n1', 'in1'), W(3, 'k', 'y', 'n1', 'in2'), W(4, 'n1', 'y', 'o1', 'in'),
      W(5, 'a', 'out', 'x1', 'in0'), W(6, 'k', 'y', 'x1', 'in1'), W(7, 'x1', 'y', 'm', 'd0'), W(8, 'a', 'out', 'm', 'd1'), W(9, 'b', 'out', 'm', 'd2'),
      W(10, 'n1', 'y', 'm', 'd3'), W(11, 's', 'out', 'm', 'sel'), W(12, 'm', 'y', 'o2', 'in'),
      W(13, 's', 'out', 'dec', 'a'), W(14, 'dec', 'y', 'o3', 'in'), W(15, 'a', 'out', 'sl', 'a'), W(16, 'sl', 'y', 'o4', 'in'),
      W(17, 'sl', 'y', 'cc', 'in0'), W(18, 's', 'out', 'cc', 'in1'), W(19, 'ns', 'y', 'cc', 'in2'), W(20, 's', 'out', 'ns', 'a'), W(21, 'cc', 'y', 'o5', 'in'),
      W(22, 'sl', 'y', 'ex', 'a'), W(23, 'ex', 'y', 'o6', 'in'), W(24, 'a', 'out', 'ad', 'a'), W(25, 'b', 'out', 'ad', 'b'), W(26, 'ns', 'y', 'ad', 'cin'),
      W(27, 'ad', 'sum', 'o7', 'in'), W(28, 'a', 'out', 'mul', 'a'), W(29, 'b', 'out', 'mul', 'b'), W(30, 'mul', 'y', 'o8', 'in'),
      W(31, 'a', 'out', 'lt', 'a'), W(32, 'b', 'out', 'lt', 'b'), W(33, 'lt', 'y', 'o9', 'in'),
      W(34, 'ad', 'sum', 'rg', 'd'), W(35, 'lt', 'y', 'rg', 'en'), W(36, 'rg', 'q', 'o10', 'in'),
      W(37, 'a', 'out', 'sh', 'a'), W(38, 's', 'out', 'sh', 'b'), W(39, 'sh', 'y', 'o11', 'in'),
      W(40, 'ad', 'cout', 'ct', 'en'), W(41, 'lt', 'y', 'ct', 'clr'), W(42, 'ct', 'q', 'o12', 'in'),
      W(43, 'rg', 'q', 'lb', 'x'), W(44, 'b', 'out', 'lb', 'y'), W(45, 'lb', 'z', 'o13', 'in'),
      W(46, 'x1', 'y', 'no', 'in0'), W(47, 'rg', 'q', 'no', 'in1'), W(48, 'no', 'y', 'o14', 'in'),
    ],
  };
  const sim = new GV.Simulator(p, 'main');
  let s = 3;
  const r = (n) => { s = (s * 48271) % 2147483647; return BigInt(s % n); };
  for (let i = 0; i < 80; i++) { sim.setInput('a', r(64)); sim.setInput('b', r(64)); sim.setInput('s', r(4)); sim.step(); }
  const gen = GV.generateProject(p);
  ok(gen.errors.length === 0, 'all components: ' + gen.errors.join('; '));
  console.log('  warnings:', gen.warnings.join(' | '));
  const df = path.join(tmp, 'all.v'), tf = path.join(tmp, 'alltb.v');
  fs.writeFileSync(df, gen.text);
  fs.writeFileSync(tf, GV.generateTestbench(p, 'main', sim.history));
  if (!hasIverilog) return;
  let out;
  try { out = iv([df, tf], 'tb_main'); } catch (e) { out = String(e.stderr || e.message); }
  ok(out.includes('PASS'), 'all components testbench: ' + out.trim().split('\n').slice(-8).join(' / '));
})();

// 4. Error handling.
(function errors() {
  const p = GV.newProject();
  const a = GV.newComponent('not', 0, 0);
  p.circuits.main.components.push(a);
  p.circuits.main.wires.push({ id: 'x', from: { c: a.id, p: 'y' }, to: { c: a.id, p: 'a' } });
  let msg = '';
  try { new GV.Simulator(p, 'main'); } catch (e) { msg = e.message; }
  ok(/combinational loop/.test(msg), 'detects combinational loop: ' + msg);
  const q = GV.newProject();
  q.circuits.main.components.push(GV.newComponent('sub', 0, 0, { circuit: 'main' }));
  msg = '';
  try { new GV.Simulator(q, 'main'); } catch (e) { msg = e.message; }
  ok(/includes itself/.test(msg), 'detects recursive subcircuit: ' + msg);
})();

console.log(hasIverilog ? '' : '(iverilog not found: cross-checks skipped)');
console.log(failures ? `${failures} FAILURE(S)` : 'All tests passed');
if (process.argv.includes('--keep')) console.log('Output in', tmp);
process.exit(failures ? 1 : 0);
