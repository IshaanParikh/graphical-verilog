// Verilog-style expression engine: tokenizer, parser, width rules and BigInt evaluator.
// Used by custom expression blocks, constants and FSM conditions/actions.
(function () {
  const GV = (globalThis.GV = globalThis.GV || {});

  const mask = (w) => (w <= 0 ? 0n : (1n << BigInt(w)) - 1n);
  const CMP = new Set(['==', '!=', '===', '!==', '<', '<=', '>', '>=']);
  const REDUCE = new Set(['&', '~&', '|', '~|', '^', '~^']);

  class ExprError extends Error {}

  const TOKEN_RE =
    /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|(\d*\s*'[sS]?[bBoOdDhH]\s*[0-9a-fA-FxXzZ_?]+)|(\d[\d_]*)|([A-Za-z_][A-Za-z0-9_$]*)|(===|!==|==|!=|<=|>=|&&|\|\||<<|>>|~&|~\||~\^|\^~|[-+*\/%&|^~!<>?:()\[\]{},=;])/y;

  function tokenize(src) {
    const toks = [];
    TOKEN_RE.lastIndex = 0;
    let pos = 0;
    while (pos < src.length) {
      TOKEN_RE.lastIndex = pos;
      const m = TOKEN_RE.exec(src);
      if (!m) throw new ExprError(`Unexpected character '${src[pos]}' at ${pos + 1}`);
      pos = TOKEN_RE.lastIndex;
      if (m[1]) toks.push({ k: 'num', ...parseLiteral(m[1]) });
      else if (m[2]) toks.push({ k: 'num', v: BigInt(m[2].replace(/_/g, '')), w: 32, unsized: true });
      else if (m[3]) toks.push({ k: 'id', s: m[3] });
      else if (m[4]) toks.push({ k: 'op', s: m[4] === '^~' ? '~^' : m[4] });
    }
    toks.push({ k: 'eof' });
    return toks;
  }

  function parseLiteral(text) {
    const t = text.replace(/\s+/g, '');
    const m = /^(\d*)'[sS]?([bBoOdDhH])([0-9a-fA-FxXzZ_?]+)$/.exec(t);
    if (!m) throw new ExprError('Bad literal ' + text);
    const base = { b: 2, o: 8, d: 10, h: 16 }[m[2].toLowerCase()];
    const digits = m[3].replace(/_/g, '').replace(/[xXzZ?]/g, '0');
    let v = 0n;
    for (const ch of digits) {
      const d = parseInt(ch, 16);
      if (isNaN(d) || d >= base) throw new ExprError('Bad digit in ' + text);
      v = v * BigInt(base) + BigInt(d);
    }
    const w = m[1] ? parseInt(m[1], 10) : 32;
    if (w < 1) throw new ExprError('Bad width in ' + text);
    return { v: v & mask(w), w, unsized: !m[1] };
  }

  // Binary precedence, low to high (Verilog order).
  const BIN_LEVELS = [
    ['||'],
    ['&&'],
    ['|'],
    ['^', '~^'],
    ['&'],
    ['==', '!=', '===', '!=='],
    ['<', '<=', '>', '>='],
    ['<<', '>>'],
    ['+', '-'],
    ['*', '/', '%'],
  ];

  class Parser {
    constructor(src) {
      this.src = src;
      this.toks = tokenize(src);
      this.i = 0;
    }
    peek() { return this.toks[this.i]; }
    next() { return this.toks[this.i++]; }
    isOp(s) { const t = this.peek(); return t.k === 'op' && t.s === s; }
    expect(s) {
      const t = this.next();
      if (t.k !== 'op' || t.s !== s) throw new ExprError(`Expected '${s}' but found ${describe(t)}`);
    }
    expr() {
      const c = this.bin(0);
      if (this.isOp('?')) {
        this.next();
        const a = this.expr();
        this.expect(':');
        const b = this.expr();
        return { t: 'tern', c, a, b };
      }
      return c;
    }
    bin(level) {
      if (level >= BIN_LEVELS.length) return this.unary();
      let left = this.bin(level + 1);
      for (;;) {
        const t = this.peek();
        if (t.k === 'op' && BIN_LEVELS[level].includes(t.s)) {
          this.next();
          const right = this.bin(level + 1);
          left = { t: 'bin', op: t.s, a: left, b: right };
        } else return left;
      }
    }
    unary() {
      const t = this.peek();
      if (t.k === 'op' && ['!', '~', '-', '+', '&', '|', '^', '~&', '~|', '~^'].includes(t.s)) {
        this.next();
        return { t: 'un', op: t.s, a: this.unary() };
      }
      return this.primary();
    }
    primary() {
      const t = this.next();
      if (t.k === 'num') return { t: 'num', v: t.v, w: t.w };
      if (t.k === 'id') {
        let node = { t: 'id', name: t.s };
        if (this.isOp('[')) {
          this.next();
          const hi = this.expr();
          if (this.isOp(':')) {
            this.next();
            const lo = this.expr();
            this.expect(']');
            node = { t: 'rng', name: t.s, hi: constEval(hi), lo: constEval(lo) };
            if (node.hi < node.lo) throw new ExprError(`Range [${node.hi}:${node.lo}] must be [high:low]`);
          } else {
            this.expect(']');
            node = { t: 'idx', name: t.s, i: hi };
          }
        }
        return node;
      }
      if (t.k === 'op' && t.s === '(') {
        const e = this.expr();
        this.expect(')');
        return e;
      }
      if (t.k === 'op' && t.s === '{') {
        const first = this.expr();
        if (this.isOp('{')) {
          // replication {n{a,b}}
          this.next();
          const parts = this.list('}');
          this.expect('}');
          return { t: 'rep', n: constEval(first), parts };
        }
        const parts = [first];
        while (this.isOp(',')) { this.next(); parts.push(this.expr()); }
        this.expect('}');
        return { t: 'cat', parts };
      }
      throw new ExprError(`Unexpected ${describe(t)}`);
    }
    list(end) {
      const parts = [this.expr()];
      while (this.isOp(',')) { this.next(); parts.push(this.expr()); }
      return parts;
    }
  }

  function describe(t) {
    if (t.k === 'eof') return 'end of expression';
    if (t.k === 'num') return 'number';
    return `'${t.s}'`;
  }

  function constEval(node) {
    const v = evaluate(node, { val: () => { throw new ExprError('Range bounds must be constants'); }, w: () => null }, 0);
    return Number(v);
  }

  function parseExpr(src) {
    if (!src || !String(src).trim()) throw new ExprError('Empty expression');
    const p = new Parser(String(src));
    const e = p.expr();
    if (p.peek().k !== 'eof') throw new ExprError(`Unexpected ${describe(p.peek())}`);
    return e;
  }

  // Parse "y = a & b; z = a ^ b" (also accepts 'assign' keyword and newlines as separators).
  function parseAssignments(src) {
    const out = [];
    const text = String(src || '').replace(/\/\/[^\n]*/g, '');
    const parts = text.split(/;|\n(?=\s*(?:assign\s+)?[A-Za-z_][A-Za-z0-9_$]*\s*<?=(?!=))/).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      const m = /^(?:assign\s+)?([A-Za-z_][A-Za-z0-9_$]*)\s*(?:<)?=(?!=)\s*([\s\S]+)$/.exec(part);
      if (!m) throw new ExprError(`Expected 'name = expression' in "${part}"`);
      out.push({ lhs: m[1], src: m[2].trim(), ast: parseExpr(m[2]) });
    }
    return out;
  }

  // "a:4, b, c:8" -> [{name:'a',width:4},...]; optional "=default" for outputs.
  function parsePortSpec(spec) {
    const res = [];
    for (const raw of String(spec || '').split(/[,\n]/)) {
      const s = raw.trim();
      if (!s) continue;
      const m = /^([A-Za-z_][A-Za-z0-9_$]*)\s*(?::\s*(\d+))?\s*(?:=\s*(.+))?$/.exec(s);
      if (!m) throw new ExprError(`Bad port "${s}" (use name or name:width)`);
      const width = m[2] ? parseInt(m[2], 10) : 1;
      if (width < 1 || width > 1024) throw new ExprError(`Width of ${m[1]} must be 1..1024`);
      res.push({ name: m[1], width, def: m[3] ? m[3].trim() : null });
    }
    return res;
  }

  function selfWidth(n, W) {
    switch (n.t) {
      case 'num': return n.w;
      case 'id': {
        const w = W(n.name);
        if (w == null) throw new ExprError(`Unknown signal '${n.name}'`);
        return w;
      }
      case 'un': return REDUCE.has(n.op) || n.op === '!' ? 1 : selfWidth(n.a, W);
      case 'bin':
        if (CMP.has(n.op) || n.op === '&&' || n.op === '||') return 1;
        if (n.op === '<<' || n.op === '>>') return selfWidth(n.a, W);
        return Math.max(selfWidth(n.a, W), selfWidth(n.b, W));
      case 'tern': return Math.max(selfWidth(n.a, W), selfWidth(n.b, W));
      case 'cat': return n.parts.reduce((s, p) => s + selfWidth(p, W), 0);
      case 'rep': return n.n * n.parts.reduce((s, p) => s + selfWidth(p, W), 0);
      case 'idx': if (W(n.name) == null) throw new ExprError(`Unknown signal '${n.name}'`); return 1;
      case 'rng': if (W(n.name) == null) throw new ExprError(`Unknown signal '${n.name}'`); return n.hi - n.lo + 1;
    }
    throw new ExprError('Bad node');
  }

  // E = { val(name) -> BigInt, w(name) -> width }. ctx = context width (Verilog sizing).
  function evaluate(n, E, ctx) {
    const w = Math.max(selfWidth(n, E.w), ctx || 0);
    const m = mask(w);
    switch (n.t) {
      case 'num': return n.v & m;
      case 'id': return E.val(n.name) & m;
      case 'un': {
        if (n.op === '!') return evaluate(n.a, E, 0) === 0n ? 1n : 0n;
        if (REDUCE.has(n.op)) {
          const aw = selfWidth(n.a, E.w);
          const v = evaluate(n.a, E, 0);
          let r;
          if (n.op === '&' || n.op === '~&') r = v === mask(aw);
          else if (n.op === '|' || n.op === '~|') r = v !== 0n;
          else r = popcount(v) % 2 === 1;
          if (n.op[0] === '~') r = !r;
          return r ? 1n : 0n;
        }
        const a = evaluate(n.a, E, w);
        if (n.op === '~') return ~a & m;
        if (n.op === '-') return -a & m;
        return a;
      }
      case 'bin': {
        const op = n.op;
        if (CMP.has(op)) {
          const ow = Math.max(selfWidth(n.a, E.w), selfWidth(n.b, E.w));
          const a = evaluate(n.a, E, ow), b = evaluate(n.b, E, ow);
          let r;
          switch (op) {
            case '==': case '===': r = a === b; break;
            case '!=': case '!==': r = a !== b; break;
            case '<': r = a < b; break;
            case '<=': r = a <= b; break;
            case '>': r = a > b; break;
            case '>=': r = a >= b; break;
          }
          return r ? 1n : 0n;
        }
        if (op === '&&') return evaluate(n.a, E, 0) !== 0n && evaluate(n.b, E, 0) !== 0n ? 1n : 0n;
        if (op === '||') return evaluate(n.a, E, 0) !== 0n || evaluate(n.b, E, 0) !== 0n ? 1n : 0n;
        if (op === '<<' || op === '>>') {
          const a = evaluate(n.a, E, w);
          const s = evaluate(n.b, E, 0);
          if (s >= BigInt(w)) return 0n;
          return (op === '<<' ? a << s : a >> s) & m;
        }
        const a = evaluate(n.a, E, w), b = evaluate(n.b, E, w);
        switch (op) {
          case '+': return (a + b) & m;
          case '-': return (a - b) & m;
          case '*': return (a * b) & m;
          case '/': return b === 0n ? m : (a / b) & m;
          case '%': return b === 0n ? m : (a % b) & m;
          case '&': return a & b;
          case '|': return a | b;
          case '^': return a ^ b;
          case '~^': return ~(a ^ b) & m;
        }
        throw new ExprError('Unknown operator ' + op);
      }
      case 'tern':
        return evaluate(n.c, E, 0) !== 0n ? evaluate(n.a, E, w) : evaluate(n.b, E, w);
      case 'cat': {
        let r = 0n;
        for (const p of n.parts) r = (r << BigInt(selfWidth(p, E.w))) | evaluate(p, E, 0);
        return r & m;
      }
      case 'rep': {
        let unit = 0n, uw = 0;
        for (const p of n.parts) { const pw = selfWidth(p, E.w); unit = (unit << BigInt(pw)) | evaluate(p, E, 0); uw += pw; }
        let r = 0n;
        for (let i = 0; i < n.n; i++) r = (r << BigInt(uw)) | unit;
        return r & m;
      }
      case 'idx': {
        const i = evaluate(n.i, E, 0);
        if (i >= BigInt(E.w(n.name))) return 0n;
        return (E.val(n.name) >> i) & 1n;
      }
      case 'rng':
        return (E.val(n.name) >> BigInt(n.lo)) & mask(n.hi - n.lo + 1);
    }
    throw new ExprError('Bad node');
  }

  function popcount(v) { let c = 0; while (v) { c += Number(v & 1n); v >>= 1n; } return c; }

  function identifiers(n, set = new Set()) {
    if (!n) return set;
    if (n.t === 'id' || n.t === 'idx' || n.t === 'rng') set.add(n.name);
    for (const k of ['a', 'b', 'c', 'i']) if (n[k]) identifiers(n[k], set);
    if (n.parts) n.parts.forEach((p) => identifiers(p, set));
    return set;
  }

  // Evaluate a constant expression like "8'hFF" or "12" (no identifiers).
  function evalConst(src, width) {
    const ast = parseExpr(String(src));
    return evaluate(ast, { val: () => { throw new ExprError('Constants cannot reference signals'); }, w: () => null }, width) & mask(width);
  }

  function formatValue(v, w, radix) {
    v = BigInt(v);
    if (radix === 'dec') return v.toString(10);
    if (radix === 'bin' || (radix === 'auto' && w <= 4)) return w === 1 ? v.toString(2) : v.toString(2).padStart(w, '0');
    return '0x' + v.toString(16).toUpperCase().padStart(Math.ceil(w / 4), '0');
  }

  // Parse a user-typed value: "13", "0xD", "0b1101", "4'hd".
  function parseUserValue(text, width) {
    const s = String(text).trim();
    let v;
    if (/^0x[0-9a-f_]+$/i.test(s)) v = BigInt('0x' + s.slice(2).replace(/_/g, ''));
    else if (/^0b[01_]+$/i.test(s)) v = BigInt('0b' + s.slice(2).replace(/_/g, ''));
    else if (/^-?\d+$/.test(s)) v = BigInt(s);
    else v = evalConst(s, width);
    return v & mask(width);
  }

  Object.assign(GV, {
    mask, ExprError, tokenize, parseExpr, parseAssignments, parsePortSpec, selfWidth, evaluate,
    identifiers, evalConst, formatValue, parseUserValue, parseLiteral,
  });
})();
