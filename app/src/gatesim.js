// Silicon — gate-level evaluator for the Yosys-synthesized netlist.
//
// Evaluates the real synthesized cells (NAND/AND/OR/NOR/XOR/XNOR/NOT/MUX and
// the four flop types) in topological order every cycle. Memory lives outside
// the netlist exactly as in the RTL and the Verilator harness. Used in the
// browser as the netlist explorer's activity source and as a live shadow
// check against the behavioural model; in Node (test/gate-equivalence.mjs)
// it is checked against the behavioural model over whole programs.

const T = { NAND: 0, MUX: 1, AND: 2, OR: 3, NOT: 4, XOR: 5, XNOR: 6, NOR: 7, DFFE: 8, SDFFE: 9, SDFF: 10, DFF: 11 };
const TYPE_MAP = {
  NAND: T.NAND, MUX: T.MUX, AND: T.AND, OR: T.OR, NOT: T.NOT, XOR: T.XOR, XNOR: T.XNOR, NOR: T.NOR,
  DFFE_PP: T.DFFE, SDFFE_PP0P: T.SDFFE, SDFF_PP0: T.SDFF, DFF_P: T.DFF,
};

// Straight-line JavaScript for the whole combinational netlist, in chunks
// small enough for the JIT (measured ~1.4x faster than the interpreting loop).
function compileEval(nl) {
  const ops = {
    NAND: (a, b) => `(v[${a}]&v[${b}])^1`, AND: (a, b) => `v[${a}]&v[${b}]`, OR: (a, b) => `v[${a}]|v[${b}]`,
    NOR: (a, b) => `(v[${a}]|v[${b}])^1`, XOR: (a, b) => `v[${a}]^v[${b}]`, XNOR: (a, b) => `(v[${a}]^v[${b}])^1`,
    NOT: (a) => `v[${a}]^1`, MUX: (a, b, s) => `v[${s}]?v[${b}]:v[${a}]`,
  };
  try {
    const lines = [];
    for (const i of nl.order) { const c = nl.cells[i]; const t = nl.types[c[0]]; if (!ops[t]) continue; lines.push(`v[${c[4]}]=${ops[t](c[1], c[2], c[3])};`); }
    const CH = 256, fns = [];
    for (let k = 0; k < lines.length; k += CH) fns.push(new Function('v', lines.slice(k, k + CH).join('\n')));
    return (v) => { for (let k = 0; k < fns.length; k++) fns[k](v); };
  } catch { return null; }
}

export class GateSim {
  constructor(nl) {
    this.nl = nl;
    const NC = nl.cells.length;
    this.n = nl.nNets;
    this.val = new Uint8Array(this.n);
    this.prev = new Uint8Array(this.n);
    this.toggled = new Uint8Array(NC);   // per cell: output changed since last settled cycle
    this.ctype = new Int8Array(NC);
    this.in0 = new Int32Array(NC); this.in1 = new Int32Array(NC); this.in2 = new Int32Array(NC);
    this.out = new Int32Array(NC);
    for (let i = 0; i < NC; i++) {
      const c = nl.cells[i];
      const t = TYPE_MAP[nl.types[c[0]]];
      if (t === undefined) throw new Error('unsupported cell type ' + nl.types[c[0]]);
      this.ctype[i] = t;
      this.in0[i] = c[1]; this.in1[i] = c[2]; this.in2[i] = c[3]; this.out[i] = c[4];
    }
    this.order = Int32Array.from(nl.order);
    this.flops = Int32Array.from(nl.flops);
    this.nextQ = new Uint8Array(this.flops.length);
    this.const1 = nl.const1;
    this.ports = nl.ports;
    // if every address bit comes straight from a flop, the addresses are
    // already valid before the first evaluation of the cycle
    const flopOuts = new Set(nl.flops.map(i => nl.cells[i][4]));
    this.addrDirect = [...nl.ports.imem_addr, ...nl.ports.dmem_addr].every(b => flopOuts.has(b) || b === nl.const0 || b === nl.const1);
    this.compiled = compileEval(nl);   // null when code generation is unavailable (CSP)
    this.reset();
  }

  reset() {
    this.val.fill(0); this.prev.fill(0); this.toggled.fill(0);
    this.val[this.const1] = 1;
    // two reset cycles, as in the harness
    this.setPort('rst', 1);
    for (let i = 0; i < 2; i++) { this.eval(); this.clock(); }
    this.setPort('rst', 0);
    this.eval();
    this.prev.set(this.val);
    this.toggled.fill(0);
  }

  setPort(name, value) {
    const bits = this.ports[name];
    for (let i = 0; i < bits.length; i++) this.val[bits[i]] = (value >>> i) & 1;
  }
  getPort(name) {
    const bits = this.ports[name];
    let v = 0;
    for (let i = 0; i < bits.length; i++) v |= this.val[bits[i]] << i;
    return v >>> 0;
  }
  getNets(bits) {
    let v = 0;
    for (let i = 0; i < bits.length; i++) v |= this.val[bits[i]] << i;
    return v >>> 0;
  }

  // settle combinational logic
  eval() {
    if (this.compiled) { this.compiled(this.val); return; }
    const { val, order, ctype, in0, in1, in2, out } = this;
    for (let k = 0; k < order.length; k++) {
      const i = order[k];
      let y;
      switch (ctype[i]) {
        case T.NAND: y = (val[in0[i]] & val[in1[i]]) ^ 1; break;
        case T.MUX:  y = val[in2[i]] ? val[in1[i]] : val[in0[i]]; break;
        case T.AND:  y = val[in0[i]] & val[in1[i]]; break;
        case T.OR:   y = val[in0[i]] | val[in1[i]]; break;
        case T.NOT:  y = val[in0[i]] ^ 1; break;
        case T.XOR:  y = val[in0[i]] ^ val[in1[i]]; break;
        case T.XNOR: y = (val[in0[i]] ^ val[in1[i]]) ^ 1; break;
        case T.NOR:  y = (val[in0[i]] | val[in1[i]]) ^ 1; break;
        default: continue;
      }
      val[out[i]] = y;
    }
  }

  // rising clock edge: all flops sample their D/E/R simultaneously
  clock() {
    const { val, flops, ctype, in0, in1, in2, out, nextQ } = this;
    for (let k = 0; k < flops.length; k++) {
      const i = flops[k];
      const q = val[out[i]];
      let nq;
      switch (ctype[i]) {
        case T.DFF:   nq = val[in0[i]]; break;
        case T.DFFE:  nq = val[in1[i]] ? val[in0[i]] : q; break;
        case T.SDFF:  nq = val[in2[i]] ? 0 : val[in0[i]]; break;
        case T.SDFFE: nq = val[in2[i]] ? 0 : (val[in1[i]] ? val[in0[i]] : q); break;
        default: nq = q;
      }
      nextQ[k] = nq;
    }
    for (let k = 0; k < flops.length; k++) val[out[flops[k]]] = nextQ[k];
  }

  // One full cycle against an external memory (read-only use of memory: the
  // behavioural model owns the writes; we report what the gates would write).
  // Returns the settled port values for this cycle.
  cycle(mem) {
    if (!this.addrDirect) this.eval();
    return this.cycleWith(mem.read32(this.getPort('imem_addr')), mem.read32(this.getPort('dmem_addr')));
  }

  // Same, with the read data supplied (from the behavioural model's log).
  cycleWith(imem_rdata, dmem_rdata) {
    this.setPort('imem_rdata', imem_rdata);
    this.setPort('dmem_rdata', dmem_rdata);
    this.eval();
    const p = {
      imem_addr: this.getPort('imem_addr'), dmem_addr: this.getPort('dmem_addr'),
      dmem_wdata: this.getPort('dmem_wdata'), dmem_be: this.getPort('dmem_be'),
      dmem_we: this.getPort('dmem_we'), dmem_re: this.getPort('dmem_re'), halted: this.getPort('halted'),
    };
    // activity: nets that changed vs the previous settled cycle
    const { val, prev, toggled, out } = this;
    let count = 0;
    for (let i = 0; i < out.length; i++) {
      const o = out[i];
      const t = val[o] !== prev[o] ? 1 : 0;
      toggled[i] = t; count += t;
    }
    this.toggleCount = count;
    prev.set(val);
    return p;
  }

  // edge after cycle(): advance flops
  tick() { this.clock(); }

  snapshotFlops() {
    const a = new Uint8Array(this.flops.length);
    for (let k = 0; k < this.flops.length; k++) a[k] = this.val[this.out[this.flops[k]]];
    return a;
  }
  restoreFlops(a) {
    for (let k = 0; k < this.flops.length; k++) this.val[this.out[this.flops[k]]] = a[k];
  }
}
