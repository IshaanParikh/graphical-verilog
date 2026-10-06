// Cycle-based simulator. Combinational logic settles by fixed-point iteration;
// sequential elements (registers, counters, FSMs) update together on each clock step.
(function () {
  const GV = (globalThis.GV = globalThis.GV || {});
  const { mask } = GV;

  class SimError extends Error {}

  // Compile "y = expr; t = expr" against known inputs/outputs; unknown lhs become internal wires.
  function compileAssigns(code, inPorts, outPorts, where) {
    let assigns;
    try { assigns = GV.parseAssignments(code); } catch (e) { throw new SimError(`${where}: ${e.message}`); }
    const widths = new Map();
    inPorts.forEach((p) => widths.set(p.name, p.w ?? p.width));
    const outW = new Map(outPorts.map((p) => [p.name, p.w ?? p.width]));
    const W = (n) => widths.get(n);
    const compiled = [];
    for (const a of assigns) {
      if (widths.has(a.lhs) && !outW.has(a.lhs)) throw new SimError(`${where}: cannot assign to input '${a.lhs}'`);
      let selfW;
      try { selfW = GV.selfWidth(a.ast, W); } catch (e) { throw new SimError(`${where}: ${e.message}`); }
      const w = outW.has(a.lhs) ? outW.get(a.lhs) : selfW;
      widths.set(a.lhs, w);
      compiled.push({ lhs: a.lhs, ast: a.ast, w, internal: !outW.has(a.lhs), src: a.src });
    }
    return { compiled, widths };
  }

  function runAssigns(prog, values) {
    const E = { val: (n) => values.get(n) ?? 0n, w: (n) => prog.widths.get(n) };
    for (const a of prog.compiled) values.set(a.lhs, GV.evaluate(a.ast, E, a.w) & mask(a.w));
    return values;
  }

  const OP_AST = {};
  function opAst(op) {
    return OP_AST[op] || (OP_AST[op] = GV.parseExpr('a ' + op + ' b'));
  }

  class CircuitSim {
    constructor(project, name, path = []) {
      if (path.includes(name)) throw new SimError('Subcircuit includes itself: ' + [...path, name].join(' → '));
      const circ = project.circuits[name];
      if (!circ) throw new SimError(`Circuit '${name}' does not exist`);
      this.project = project;
      this.name = name;
      this.comps = [...circ.components].filter((c) => GV.TYPES[c.type] && c.type !== 'note').sort((a, b) => a.x - b.x || a.y - b.y);
      this.ports = new Map();
      this.drivers = new Map();
      this.nets = new Map();
      this.state = new Map();
      this.children = new Map();
      this.programs = new Map();
      this.consts = new Map();
      this.inputs = {};
      this.outputs = {};
      this.probes = {};
      for (const c of this.comps) this.ports.set(c.id, GV.getPorts(c, project));
      for (const wire of circ.wires) {
        const key = wire.to.c + ':' + wire.to.p;
        if (this.drivers.has(key)) throw new SimError(`Input pin ${wire.to.p} has more than one driver`);
        this.drivers.set(key, wire.from.c + ':' + wire.from.p);
      }
      for (const c of this.comps) this.prepareComp(c, path);
      this.reset();
    }

    label(c) { return c.label || GV.blockTitle(c, this.project); }

    prepareComp(c, path) {
      const P = this.ports.get(c.id);
      const where = `${this.name}/${this.label(c)}`;
      switch (c.type) {
        case 'const':
        case 'register':
        case 'counter': {
          const key = c.type === 'const' ? 'value' : 'reset';
          try { this.consts.set(c.id, GV.evalConst(c.props[key] || '0', GV.clampW(c.props.width))); } catch (e) { throw new SimError(`${where}: ${e.message}`); }
          break;
        }
        case 'expr':
          this.programs.set(c.id, compileAssigns(c.props.code, P.ins, P.outs, where));
          break;
        case 'lib': {
          const def = this.project.library[c.props.lib];
          if (!def) throw new SimError(`${where}: library block '${c.props.lib}' not found`);
          this.programs.set(c.id, compileAssigns(def.code, P.ins, P.outs, where));
          break;
        }
        case 'sub':
          this.children.set(c.id, new CircuitSim(this.project, c.props.circuit, [...path, this.name]));
          break;
        case 'fsm':
          if (!this.project.fsms[c.props.fsm]) throw new SimError(`${where}: state machine '${c.props.fsm}' not found`);
          this.children.set(c.id, new FsmSim(this.project, c.props.fsm));
          break;
      }
    }

    reset() {
      for (const c of this.comps) {
        if (c.type === 'register' || c.type === 'counter') this.state.set(c.id, this.consts.get(c.id));
      }
      for (const ch of this.children.values()) ch.reset();
      this.nets.clear();
    }

    pin(c, i) {
      const p = this.ports.get(c.id).ins[i];
      const src = this.drivers.get(c.id + ':' + p.name);
      if (!src) return 0n;
      return (this.nets.get(src) ?? 0n) & mask(p.w);
    }

    evalComp(c) {
      const P = this.ports.get(c.id);
      const ins = P.ins.map((_, i) => this.pin(c, i));
      const out = {};
      const t = c.type;
      switch (t) {
        case 'input': out.out = BigInt(this.inputs[GV.sanitize(c.props.name)] ?? 0n) & mask(P.outs[0].w); break;
        case 'output': this.outputs[GV.sanitize(c.props.name)] = ins[0]; break;
        case 'probe': this.probes[c.id] = ins[0]; break;
        case 'const': out.y = this.consts.get(c.id); break;
        case 'and': case 'nand': case 'or': case 'nor': case 'xor': case 'xnor': {
          const m = mask(P.outs[0].w);
          let v = ins[0];
          for (let i = 1; i < ins.length; i++) {
            if (t === 'and' || t === 'nand') v &= ins[i];
            else if (t === 'or' || t === 'nor') v |= ins[i];
            else v ^= ins[i];
          }
          if (t === 'nand' || t === 'nor' || t === 'xnor') v = ~v & m;
          out.y = v & m;
          break;
        }
        case 'not': out.y = ~ins[0] & mask(P.outs[0].w); break;
        case 'mux': { const sel = Number(ins[ins.length - 1]); out.y = ins[sel] ?? 0n; break; }
        case 'decoder': out.y = (1n << ins[0]) & mask(P.outs[0].w); break;
        case 'slice': out.y = (ins[0] >> BigInt(c.props.lo | 0)) & mask(P.outs[0].w); break;
        case 'concat': {
          let v = 0n;
          P.ins.forEach((p, i) => { v = (v << BigInt(p.w)) | ins[i]; });
          out.y = v;
          break;
        }
        case 'extend': {
          const fw = P.ins[0].w, tw = P.outs[0].w;
          let v = ins[0];
          if (c.props.sign && (v >> BigInt(fw - 1)) & 1n) v |= mask(tw) ^ mask(fw);
          out.y = v;
          break;
        }
        case 'op': {
          const widths = { a: P.ins[0].w, b: P.ins[1].w };
          const E = { val: (n) => (n === 'a' ? ins[0] : ins[1]), w: (n) => widths[n] };
          out.y = GV.evaluate(opAst(c.props.op), E, P.outs[0].w) & mask(P.outs[0].w);
          break;
        }
        case 'adder': {
          const w = P.outs[0].w;
          const s = ins[0] + ins[1] + ins[2];
          out.sum = s & mask(w);
          out.cout = (s >> BigInt(w)) & 1n;
          break;
        }
        case 'register':
        case 'counter':
          out.q = this.state.get(c.id);
          break;
        case 'expr':
        case 'lib': {
          const prog = this.programs.get(c.id);
          const vals = new Map(P.ins.map((p, i) => [p.name, ins[i]]));
          runAssigns(prog, vals);
          for (const p of P.outs) out[p.name] = (vals.get(p.name) ?? 0n) & mask(p.w);
          break;
        }
        case 'sub': {
          const child = this.children.get(c.id);
          const inObj = {};
          P.ins.forEach((p, i) => { inObj[p.name] = ins[i]; });
          const res = child.settle(inObj);
          for (const p of P.outs) out[p.name] = (res[p.name] ?? 0n) & mask(p.w);
          break;
        }
        case 'fsm': {
          const child = this.children.get(c.id);
          const inObj = {};
          P.ins.forEach((p, i) => { inObj[p.name] = ins[i]; });
          const res = child.settle(inObj);
          for (const p of P.outs) out[p.name] = (res[p.name] ?? 0n) & mask(p.w);
          break;
        }
      }
      return out;
    }

    settle(inputs) {
      if (inputs) this.inputs = { ...inputs };
      const limit = this.comps.length * 2 + 10;
      for (let iter = 0; iter < limit; iter++) {
        let changed = false;
        for (const c of this.comps) {
          const out = this.evalComp(c);
          for (const k in out) {
            const key = c.id + ':' + k;
            if (this.nets.get(key) !== out[k]) { this.nets.set(key, out[k]); changed = true; }
          }
        }
        if (!changed) return this.outputs;
      }
      throw new SimError(`Circuit '${this.name}' does not settle: there is a combinational loop. Put a register in the loop.`);
    }

    // Phase 1 of a clock edge: compute next state from the settled values.
    prepare() {
      this.next = new Map();
      for (const c of this.comps) {
        if (c.type === 'register') {
          const d = this.pin(c, 0);
          const en = c.props.enable ? this.pin(c, 1) : 1n;
          this.next.set(c.id, en ? d : this.state.get(c.id));
        } else if (c.type === 'counter') {
          const w = GV.clampW(c.props.width);
          const en = this.pin(c, 0);
          const clr = c.props.clear ? this.pin(c, 1) : 0n;
          const cur = this.state.get(c.id);
          const step = BigInt(Math.max(1, c.props.step | 0));
          let nv = cur;
          if (clr) nv = this.consts.get(c.id);
          else if (en) nv = (c.props.down ? cur - step : cur + step) & mask(w);
          this.next.set(c.id, nv);
        }
      }
      for (const ch of this.children.values()) ch.prepare();
    }

    // Phase 2: commit.
    commit() {
      for (const [id, v] of this.next) this.state.set(id, v);
      for (const ch of this.children.values()) ch.commit();
    }

    // Read-only view of FSM instances for the UI (current state names).
    fsmStates() {
      const res = {};
      for (const [id, ch] of this.children) if (ch instanceof FsmSim) res[id] = ch.currentName();
      return res;
    }
  }

  class FsmSim {
    constructor(project, name) {
      const f = project.fsms[name];
      if (!f) throw new SimError(`State machine '${name}' does not exist`);
      if (!f.states.length) throw new SimError(`State machine '${name}' has no states`);
      this.f = f;
      this.name = name;
      this.ins = safe(() => GV.parsePortSpec(f.inputs), `${name} inputs`).map((p) => ({ name: p.name, w: p.width }));
      this.outs = safe(() => GV.parsePortSpec(f.outputs), `${name} outputs`).map((p) => ({ name: p.name, w: p.width, def: p.def }));
      this.defaults = new Map();
      for (const o of this.outs) {
        this.defaults.set(o.name, o.def ? safe(() => GV.evalConst(o.def, o.w), `${name}: default of ${o.name}`) : 0n);
      }
      this.widths = new Map([...this.ins, ...this.outs].map((p) => [p.name, p.w]));
      this.stateIndex = new Map(f.states.map((s, i) => [s.id, i]));
      this.moore = new Map();
      for (const s of f.states) this.moore.set(s.id, compileAssigns(s.outputs || '', this.ins, this.outs, `${name}/${s.name} outputs`));
      this.trans = new Map(f.states.map((s) => [s.id, []]));
      for (const t of f.transitions) {
        if (!this.trans.has(t.from) || !this.stateIndex.has(t.to)) continue;
        const where = `${name}: transition ${stateName(f, t.from)} → ${stateName(f, t.to)}`;
        let cond = null;
        if (t.cond && t.cond.trim() && t.cond.trim() !== '1') {
          cond = safe(() => GV.parseExpr(t.cond), where);
          safe(() => GV.selfWidth(cond, (n) => this.widths.get(n)), where);
        }
        this.trans.get(t.from).push({ t, cond, actions: compileAssigns(t.actions || '', this.ins, this.outs, where + ' actions') });
      }
      this.reset();
    }
    reset() { this.cur = this.f.reset; this.nextState = this.cur; this.activeTransition = null; }
    currentName() { return stateName(this.f, this.cur); }
    encode(id) {
      const i = this.stateIndex.get(id) ?? 0;
      if (this.f.encoding === 'onehot') return 1n << BigInt(i);
      if (this.f.encoding === 'gray') return BigInt(i ^ (i >> 1));
      return BigInt(i);
    }
    settle(inputs) {
      const vals = new Map();
      for (const p of this.ins) vals.set(p.name, BigInt(inputs[p.name] ?? 0n) & mask(p.w));
      for (const [k, v] of this.defaults) vals.set(k, v);
      runAssigns(this.moore.get(this.cur), vals);
      const E = { val: (n) => vals.get(n) ?? 0n, w: (n) => this.widths.get(n) };
      this.activeTransition = null;
      this.nextState = this.cur;
      for (const tr of this.trans.get(this.cur) || []) {
        if (!tr.cond || GV.evaluate(tr.cond, E, 0) !== 0n) {
          this.activeTransition = tr.t.id;
          this.nextState = tr.t.to;
          runAssigns(tr.actions, vals);
          break;
        }
      }
      const res = {};
      for (const p of this.outs) res[p.name] = vals.get(p.name) ?? 0n;
      res.state = this.encode(this.cur);
      return res;
    }
    prepare() { this.pending = this.nextState; }
    commit() { this.cur = this.pending; }
  }

  function stateName(f, id) { const s = f.states.find((x) => x.id === id); return s ? s.name : '?'; }
  function safe(fn, where) { try { return fn(); } catch (e) { throw new SimError(`${where}: ${e.message}`); } }

  // Top-level driver used by the UI: owns input values and records history for waveforms/testbenches.
  class Simulator {
    constructor(project, circuitName) {
      this.project = project;
      this.circuitName = circuitName;
      this.root = new CircuitSim(project, circuitName);
      const ports = GV.circuitPorts(project, circuitName);
      this.inPorts = ports.ins;
      this.outPorts = ports.outs;
      this.inputs = {};
      for (const p of this.inPorts) this.inputs[p.name] = 0n;
      this.history = [];
      this.cycle = 0;
      this.settle();
    }
    settle() { this.root.settle(this.inputs); }
    setInput(name, v) { this.inputs[name] = BigInt(v); this.settle(); }
    sample() {
      return { cycle: this.cycle, inputs: { ...this.inputs }, outputs: { ...this.root.outputs }, probes: { ...this.root.probes } };
    }
    step() {
      this.settle();
      this.history.push(this.sample());
      if (this.history.length > 5000) this.history.shift();
      this.root.prepare();
      this.root.commit();
      this.cycle++;
      this.settle();
    }
    reset() {
      this.history.push({ reset: true, cycle: this.cycle });
      this.root.reset();
      this.settle();
    }
  }

  class FsmSimulator {
    constructor(project, name) {
      this.fsm = new FsmSim(project, name);
      this.inputs = {};
      for (const p of this.fsm.ins) this.inputs[p.name] = 0n;
      this.history = [];
      this.cycle = 0;
      this.settle();
    }
    settle() { this.outputs = this.fsm.settle(this.inputs); }
    setInput(name, v) { this.inputs[name] = BigInt(v); this.settle(); }
    step() {
      this.settle();
      this.history.push({ cycle: this.cycle, inputs: { ...this.inputs }, outputs: { ...this.outputs }, state: this.fsm.currentName() });
      this.fsm.prepare();
      this.fsm.commit();
      this.cycle++;
      this.settle();
    }
    reset() { this.history.push({ reset: true }); this.fsm.reset(); this.settle(); }
  }

  Object.assign(GV, { SimError, CircuitSim, FsmSim, Simulator, FsmSimulator, compileAssigns });
})();
