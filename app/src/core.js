// Silicon — cycle-accurate JavaScript twin of rtl/silicon_core.sv.
//
// Every register and every combinational signal below corresponds one-to-one
// with the SystemVerilog. The Node test `test/trace-equivalence.mjs` runs this
// model and the Verilator build of the RTL on the same programs and demands
// identical per-cycle traces (pipeline registers, hazards, forwarding, ALU,
// writeback and memory port), so what the browser shows is what the RTL does.

export const ALU = { ADD: 0, SUB: 1, SLL: 2, SLT: 3, SLTU: 4, XOR: 5, SRL: 6, SRA: 7, OR: 8, AND: 9, PASSB: 10 };
export const WB = { ALU: 0, MEM: 1, PC4: 2 };
export const FWD = { NONE: 0, MEM: 1, WB: 2 };

const OP = {
  LUI: 0x37, AUIPC: 0x17, JAL: 0x6f, JALR: 0x67, BRANCH: 0x63, LOAD: 0x03,
  STORE: 0x23, OPIMM: 0x13, OP: 0x33, MISC: 0x0f, SYSTEM: 0x73,
};

const u32 = (x) => x >>> 0;
const s32 = (x) => x | 0;
const sext = (v, bits) => s32((v << (32 - bits)) >> (32 - bits));

export class Memory {
  constructor(bytes) {
    this.words = new Uint32Array(bytes >>> 2);
    this.size = bytes;
  }
  read32(addr) {
    const w = addr >>> 2;
    return w < this.words.length ? this.words[w] : 0;
  }
  // write with byte enables; returns the previous word for undo
  write(addr, data, be) {
    const w = addr >>> 2;
    if (w >= this.words.length) return 0;
    let m = 0;
    if (be & 1) m |= 0x000000ff;
    if (be & 2) m |= 0x0000ff00;
    if (be & 4) m |= 0x00ff0000;
    if (be & 8) m |= 0xff000000;
    const old = this.words[w];
    this.words[w] = u32((old & ~m) | (data & m));
    return old;
  }
  loadBytes(bytes, addr) {
    for (let i = 0; i < bytes.length; i++) {
      const a = addr + i;
      const w = a >>> 2;
      if (w >= this.words.length) break;
      const sh = (a & 3) * 8;
      this.words[w] = u32((this.words[w] & ~(0xff << sh)) | (bytes[i] << sh));
    }
  }
  clear() { this.words.fill(0); }
}

export function decode(instr) {
  const opcode = instr & 0x7f;
  const rd = (instr >>> 7) & 0x1f;
  const funct3 = (instr >>> 12) & 7;
  const rs1 = (instr >>> 15) & 0x1f;
  const rs2 = (instr >>> 20) & 0x1f;
  const funct7 = (instr >>> 25) & 0x7f;
  const imm_i = sext(instr >>> 20, 12);
  const imm_s = sext(((instr >>> 25) << 5) | ((instr >>> 7) & 0x1f), 12);
  const imm_b = sext((((instr >>> 31) & 1) << 12) | (((instr >>> 7) & 1) << 11) | (((instr >>> 25) & 0x3f) << 5) | (((instr >>> 8) & 0xf) << 1), 13);
  const imm_u = s32(instr & 0xfffff000);
  const imm_j = sext((((instr >>> 31) & 1) << 20) | (((instr >>> 12) & 0xff) << 12) | (((instr >>> 20) & 1) << 11) | (((instr >>> 21) & 0x3ff) << 1), 21);

  const c = {
    opcode, rd, funct3, rs1, rs2, funct7,
    imm: imm_i, uses_rs1: false, uses_rs2: false, alu_op: ALU.ADD, alu_a_pc: false, alu_b_imm: true,
    branch: false, jal: false, jalr: false, mem_read: false, mem_write: false, reg_write: false, wb_sel: WB.ALU, halt: false,
  };
  let aluFromFunct;
  switch (funct3) {
    case 0: aluFromFunct = (opcode === OP.OP && (funct7 & 0x20)) ? ALU.SUB : ALU.ADD; break;
    case 1: aluFromFunct = ALU.SLL; break;
    case 2: aluFromFunct = ALU.SLT; break;
    case 3: aluFromFunct = ALU.SLTU; break;
    case 4: aluFromFunct = ALU.XOR; break;
    case 5: aluFromFunct = (funct7 & 0x20) ? ALU.SRA : ALU.SRL; break;
    case 6: aluFromFunct = ALU.OR; break;
    default: aluFromFunct = ALU.AND;
  }
  switch (opcode) {
    case OP.LUI: c.imm = imm_u; c.alu_op = ALU.PASSB; c.reg_write = true; break;
    case OP.AUIPC: c.imm = imm_u; c.alu_a_pc = true; c.reg_write = true; break;
    case OP.JAL: c.imm = imm_j; c.jal = true; c.reg_write = true; c.wb_sel = WB.PC4; break;
    case OP.JALR: c.imm = imm_i; c.jalr = true; c.uses_rs1 = true; c.reg_write = true; c.wb_sel = WB.PC4; break;
    case OP.BRANCH: c.imm = imm_b; c.branch = true; c.uses_rs1 = true; c.uses_rs2 = true; c.alu_b_imm = false; c.alu_op = ALU.SUB; break;
    case OP.LOAD: c.imm = imm_i; c.uses_rs1 = true; c.mem_read = true; c.reg_write = true; c.wb_sel = WB.MEM; break;
    case OP.STORE: c.imm = imm_s; c.uses_rs1 = true; c.uses_rs2 = true; c.mem_write = true; break;
    case OP.OPIMM: c.imm = imm_i; c.uses_rs1 = true; c.reg_write = true; c.alu_op = aluFromFunct; break;
    case OP.OP: c.uses_rs1 = true; c.uses_rs2 = true; c.alu_b_imm = false; c.reg_write = true; c.alu_op = aluFromFunct; break;
    case OP.MISC: break;
    case OP.SYSTEM: if (funct3 === 0 && (instr >>> 21) === 0) c.halt = true; break;
    default: break;
  }
  return c;
}

export function aluCompute(op, a, b) {
  a = u32(a); b = u32(b);
  switch (op) {
    case ALU.ADD: return u32(a + b);
    case ALU.SUB: return u32(a - b);
    case ALU.SLL: return u32(a << (b & 31));
    case ALU.SLT: return (s32(a) < s32(b)) ? 1 : 0;
    case ALU.SLTU: return (a < b) ? 1 : 0;
    case ALU.XOR: return u32(a ^ b);
    case ALU.SRL: return u32(a >>> (b & 31));
    case ALU.SRA: return u32(s32(a) >> (b & 31));
    case ALU.OR: return u32(a | b);
    case ALU.AND: return u32(a & b);
    case ALU.PASSB: return b;
    default: return u32(a + b);
  }
}

export class SiliconCore {
  constructor(mem) {
    this.mem = mem;
    this.regs = new Uint32Array(32);
    this.reset();
  }

  reset() {
    this.regs.fill(0);
    this.pc = 0; this.fetch_stopped = 0;
    this.ifid = { valid: 0, pc: 0, instr: 0, why: 'pipeline fill' };
    this.idex = {
      valid: 0, pc: 0, instr: 0, rs1_data: 0, rs2_data: 0, imm: 0, rs1: 0, rs2: 0, rd: 0,
      uses_rs1: 0, uses_rs2: 0, alu_op: ALU.ADD, alu_a_pc: 0, alu_b_imm: 0, branch: 0, jal: 0, jalr: 0,
      funct3: 0, mem_read: 0, mem_write: 0, reg_write: 0, wb_sel: WB.ALU, halt: 0, why: 'pipeline fill',
    };
    this.exmem = {
      valid: 0, pc: 0, instr: 0x13, alu: 0, store_data: 0, rd: 0, funct3: 0,
      mem_read: 0, mem_write: 0, reg_write: 0, wb_sel: WB.ALU, halt: 0, why: 'pipeline fill',
    };
    this.memwb = { valid: 0, pc: 0, instr: 0x13, alu: 0, load: 0, rd: 0, reg_write: 0, wb_sel: WB.ALU, halt: 0, why: 'pipeline fill' };
    this.halted = 0;
    this.cycle = 0;
    this.instret = 0;
    this.stalls = 0;
    this.flushes = 0;
    this.fwds = 0;
  }

  // Combinational evaluation of the current state. Pure: does not modify state.
  comb() {
    const { ifid, idex, exmem, memwb, regs, mem } = this;
    const s = {};

    // ---- WB
    let wb_data;
    switch (memwb.wb_sel) {
      case WB.MEM: wb_data = memwb.load; break;
      case WB.PC4: wb_data = u32(memwb.pc + 4); break;
      default: wb_data = memwb.alu;
    }
    const wb_we = (memwb.valid && memwb.reg_write && memwb.rd !== 0) ? 1 : 0;
    const wb_rd = memwb.rd;
    s.wb_data = wb_data; s.wb_we = wb_we; s.wb_rd = wb_rd;

    // ---- IF
    s.imem_addr = this.pc;
    s.imem_rdata = mem.read32(this.pc);
    s.pc_plus4 = u32(this.pc + 4);

    // ---- ID
    const d = decode(ifid.instr);
    if (!ifid.valid) { d.uses_rs1 = false; d.uses_rs2 = false; }
    const rf1 = d.rs1 === 0 ? 0 : regs[d.rs1];
    const rf2 = d.rs2 === 0 ? 0 : regs[d.rs2];
    const id_rs1_data = (wb_we && wb_rd === d.rs1) ? wb_data : rf1;
    const id_rs2_data = (wb_we && wb_rd === d.rs2) ? wb_data : rf2;
    s.id = d; s.id_rs1_data = id_rs1_data; s.id_rs2_data = id_rs2_data;
    s.id_bypass_rs1 = (ifid.valid && d.uses_rs1 && wb_we && wb_rd === d.rs1) ? 1 : 0;
    s.id_bypass_rs2 = (ifid.valid && d.uses_rs2 && wb_we && wb_rd === d.rs2) ? 1 : 0;

    const stall = (idex.valid && idex.mem_read && idex.rd !== 0 && ifid.valid &&
      ((d.uses_rs1 && d.rs1 === idex.rd) || (d.uses_rs2 && d.rs2 === idex.rd))) ? 1 : 0;
    s.stall = stall;

    // ---- EX forwarding
    const exmem_fwd_value = exmem.wb_sel === WB.PC4 ? u32(exmem.pc + 4) : exmem.alu;
    const exmem_fwd_ok = exmem.valid && exmem.reg_write && exmem.rd !== 0;
    const memwb_fwd_ok = wb_we;
    let fwd_a = FWD.NONE, fwd_b = FWD.NONE;
    if (exmem_fwd_ok && exmem.rd === idex.rs1) fwd_a = FWD.MEM;
    else if (memwb_fwd_ok && wb_rd === idex.rs1) fwd_a = FWD.WB;
    if (exmem_fwd_ok && exmem.rd === idex.rs2) fwd_b = FWD.MEM;
    else if (memwb_fwd_ok && wb_rd === idex.rs2) fwd_b = FWD.WB;
    const ex_rs1 = fwd_a === FWD.MEM ? exmem_fwd_value : fwd_a === FWD.WB ? wb_data : idex.rs1_data;
    const ex_rs2 = fwd_b === FWD.MEM ? exmem_fwd_value : fwd_b === FWD.WB ? wb_data : idex.rs2_data;
    s.fwd_a_sel = fwd_a; s.fwd_b_sel = fwd_b;
    s.fwd_a_used = (idex.valid && idex.uses_rs1 && fwd_a !== FWD.NONE) ? 1 : 0;
    s.fwd_b_used = (idex.valid && idex.uses_rs2 && fwd_b !== FWD.NONE) ? 1 : 0;
    s.ex_rs1 = ex_rs1; s.ex_rs2 = ex_rs2;

    const alu_a = idex.alu_a_pc ? idex.pc : ex_rs1;
    const alu_b = idex.alu_b_imm ? u32(idex.imm) : ex_rs2;
    const alu_y = aluCompute(idex.alu_op, alu_a, alu_b);
    s.alu_a = alu_a; s.alu_b = alu_b; s.alu_y = alu_y;

    let br_cond;
    const eq = ex_rs1 === ex_rs2;
    switch (idex.funct3) {
      case 0: br_cond = eq; break;
      case 1: br_cond = !eq; break;
      case 4: br_cond = s32(ex_rs1) < s32(ex_rs2); break;
      case 5: br_cond = !(s32(ex_rs1) < s32(ex_rs2)); break;
      case 6: br_cond = ex_rs1 < ex_rs2; break;
      case 7: br_cond = !(ex_rs1 < ex_rs2); break;
      default: br_cond = false;
    }
    const br_taken = idex.branch && br_cond;
    const target_base = idex.jalr ? ex_rs1 : idex.pc;
    let jump_target = u32(target_base + idex.imm);
    if (idex.jalr) jump_target = u32(jump_target & ~1);
    const redirect = (idex.valid && (br_taken || idex.jal || idex.jalr || idex.halt)) ? 1 : 0;
    const redirect_target = idex.halt ? idex.pc : jump_target;
    s.br_cond = br_cond ? 1 : 0; s.br_taken = br_taken ? 1 : 0;
    s.jump_target = jump_target; s.redirect = redirect; s.redirect_target = redirect_target;
    s.branch_not_taken = (idex.valid && idex.branch && !br_cond) ? 1 : 0;

    // ---- MEM
    const dmem_addr = u32(exmem.alu & ~3);
    const dmem_re = (exmem.valid && exmem.mem_read) ? 1 : 0;
    const dmem_we = (exmem.valid && exmem.mem_write && !this.halted) ? 1 : 0;
    const off = exmem.alu & 3;
    let be, wdata;
    switch (exmem.funct3 & 3) {
      case 0: be = (1 << off) & 0xf; wdata = u32((exmem.store_data & 0xff) * 0x01010101); break;
      case 1: be = (off & 2) ? 0xc : 0x3; wdata = u32((exmem.store_data & 0xffff) * 0x00010001); break;
      default: be = 0xf; wdata = exmem.store_data;
    }
    const word = mem.read32(dmem_addr);
    const half = (off & 2) ? (word >>> 16) & 0xffff : word & 0xffff;
    const byte = (word >>> (off * 8)) & 0xff;
    let load_result;
    switch (exmem.funct3) {
      case 0: load_result = u32(sext(byte, 8)); break;
      case 1: load_result = u32(sext(half, 16)); break;
      case 4: load_result = byte; break;
      case 5: load_result = half; break;
      default: load_result = word;
    }
    s.dmem_addr = dmem_addr; s.dmem_re = dmem_re; s.dmem_we = dmem_we; s.dmem_be = be; s.dmem_wdata = wdata;
    s.dmem_rdata = word; s.load_result = load_result;
    s.halted = this.halted;
    return s;
  }

  // Advance one clock edge using the signals computed by comb().
  // Returns an undo record for the memory write (or null).
  clock(s) {
    const { ifid, idex, exmem, memwb } = this;
    let undo = null;
    if (this.halted) { this.cycle++; return undo; }

    // memory write at the edge
    if (s.dmem_we) {
      const old = this.mem.write(s.dmem_addr, s.dmem_wdata, s.dmem_be);
      undo = { addr: s.dmem_addr, old };
    }

    // halt flag (from the instruction retiring in WB this cycle)
    const nextHalted = (memwb.valid && memwb.halt) ? 1 : 0;
    if (memwb.valid) this.instret++;
    if (s.stall) this.stalls++;
    if (s.redirect && !idex.halt) this.flushes++;
    this.fwds += s.fwd_a_used + s.fwd_b_used;

    // WB -> regfile
    if (s.wb_we) this.regs[s.wb_rd] = s.wb_data;

    // MEM/WB
    const nMemwb = {
      valid: exmem.valid, pc: exmem.pc, instr: exmem.instr, alu: exmem.alu, load: s.load_result,
      rd: exmem.rd, reg_write: exmem.reg_write, wb_sel: exmem.wb_sel, halt: exmem.halt,
      why: exmem.valid ? undefined : exmem.why,   // UI annotation only: why this slot is a bubble
    };
    // EX/MEM
    const nExmem = {
      valid: idex.valid, pc: idex.pc, instr: idex.valid ? idex.instr : 0x13, alu: s.alu_y, store_data: s.ex_rs2,
      rd: idex.rd, funct3: idex.funct3, mem_read: idex.mem_read & idex.valid, mem_write: idex.mem_write & idex.valid,
      reg_write: idex.reg_write & idex.valid, wb_sel: idex.wb_sel, halt: idex.halt & idex.valid,
      why: idex.valid ? undefined : idex.why,
    };
    // ID/EX
    let nIdex;
    if (s.redirect || s.stall) {
      nIdex = { ...idex, valid: 0, mem_read: 0, mem_write: 0, reg_write: 0, branch: 0, jal: 0, jalr: 0, halt: 0,
        uses_rs1: 0, uses_rs2: 0, instr: 0x13, rd: 0, why: s.redirect ? 'flushed' : 'load-use stall' };
    } else {
      const d = s.id;
      const v = ifid.valid;
      nIdex = {
        valid: v, pc: ifid.pc, instr: ifid.instr, rs1_data: s.id_rs1_data, rs2_data: s.id_rs2_data, imm: d.imm,
        rs1: d.rs1, rs2: d.rs2, rd: d.rd, uses_rs1: d.uses_rs1 ? 1 : 0, uses_rs2: d.uses_rs2 ? 1 : 0,
        alu_op: d.alu_op, alu_a_pc: d.alu_a_pc ? 1 : 0, alu_b_imm: d.alu_b_imm ? 1 : 0,
        branch: (d.branch && v) ? 1 : 0, jal: (d.jal && v) ? 1 : 0, jalr: (d.jalr && v) ? 1 : 0, funct3: d.funct3,
        mem_read: (d.mem_read && v) ? 1 : 0, mem_write: (d.mem_write && v) ? 1 : 0, reg_write: (d.reg_write && v) ? 1 : 0,
        wb_sel: d.wb_sel, halt: (d.halt && v) ? 1 : 0,
        why: v ? undefined : ifid.why,
      };
    }
    // IF / IF-ID
    let nPc = this.pc, nFetchStopped = this.fetch_stopped;
    let nIfid = ifid;
    if (s.redirect) {
      nPc = s.redirect_target;
      nIfid = { ...ifid, valid: 0, why: 'flushed' };
      if (idex.halt && idex.valid) nFetchStopped = 1;
    } else if (s.stall) {
      // hold
    } else {
      if (!this.fetch_stopped) nPc = s.pc_plus4;
      nIfid = { valid: this.fetch_stopped ? 0 : 1, pc: this.pc, instr: s.imem_rdata, why: this.fetch_stopped ? 'fetch stopped' : undefined };
    }

    this.pc = nPc; this.fetch_stopped = nFetchStopped;
    this.ifid = nIfid; this.idex = nIdex; this.exmem = nExmem; this.memwb = nMemwb;
    this.halted = nextHalted;
    this.cycle++;
    return undo;
  }

  step() {
    const s = this.comb();
    const undo = this.clock(s);
    return { signals: s, undo };
  }

  // Snapshot / restore of the complete architectural + microarchitectural state
  snapshot() {
    return {
      regs: this.regs.slice(), pc: this.pc, fetch_stopped: this.fetch_stopped,
      ifid: { ...this.ifid }, idex: { ...this.idex }, exmem: { ...this.exmem }, memwb: { ...this.memwb },
      halted: this.halted, cycle: this.cycle, instret: this.instret, stalls: this.stalls, flushes: this.flushes, fwds: this.fwds,
    };
  }
  restore(sn) {
    this.regs.set(sn.regs); this.pc = sn.pc; this.fetch_stopped = sn.fetch_stopped;
    this.ifid = { ...sn.ifid }; this.idex = { ...sn.idex }; this.exmem = { ...sn.exmem }; this.memwb = { ...sn.memwb };
    this.halted = sn.halted; this.cycle = sn.cycle; this.instret = sn.instret; this.stalls = sn.stalls; this.flushes = sn.flushes; this.fwds = sn.fwds;
  }

  // Trace line in exactly the format of sim/tb.cpp (--trace)
  traceLine(s) {
    const h8 = (x) => u32(x).toString(16).padStart(8, '0');
    const { ifid, idex, exmem, memwb } = this;
    return [
      this.cycle, h8(this.pc),
      ifid.valid, h8(ifid.pc), h8(ifid.instr),
      idex.valid, h8(idex.pc), h8(idex.instr),
      exmem.valid, h8(exmem.pc), h8(exmem.instr),
      memwb.valid, h8(memwb.pc), h8(memwb.instr),
      s.stall, s.redirect, h8(s.redirect_target),
      s.fwd_a_used ? s.fwd_a_sel : 0, s.fwd_b_used ? s.fwd_b_sel : 0,
      h8(s.alu_y), h8(s.ex_rs1), h8(s.ex_rs2),
      s.wb_we, s.wb_rd, h8(s.wb_data),
      s.dmem_we, h8(s.dmem_addr), h8(s.dmem_wdata), s.dmem_be.toString(16), this.halted,
    ].join(' ');
  }
}
