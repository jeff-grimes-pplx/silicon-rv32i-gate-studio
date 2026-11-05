// RV32I disassembler producing GNU objdump-style text (ABI names, aliases).
import { ABI } from './isa.js';

const sext = (v, bits) => (v << (32 - bits)) >> (32 - bits);
const sHex = (v) => (v < 0 ? '-0x' + (-v).toString(16) : '0x' + v.toString(16));

export function fields(instr) {
  return {
    opcode: instr & 0x7f, rd: (instr >>> 7) & 31, funct3: (instr >>> 12) & 7, rs1: (instr >>> 15) & 31,
    rs2: (instr >>> 20) & 31, funct7: (instr >>> 25) & 0x7f,
    immI: sext(instr >>> 20, 12),
    immS: sext(((instr >>> 25) << 5) | ((instr >>> 7) & 31), 12),
    immB: sext((((instr >>> 31) & 1) << 12) | (((instr >>> 7) & 1) << 11) | (((instr >>> 25) & 0x3f) << 5) | (((instr >>> 8) & 0xf) << 1), 13),
    immU: (instr >>> 12) & 0xfffff,
    immJ: sext((((instr >>> 31) & 1) << 20) | (((instr >>> 12) & 0xff) << 12) | (((instr >>> 20) & 1) << 11) | (((instr >>> 21) & 0x3ff) << 1), 21),
  };
}

// Returns { mnemonic, operands, target (for control flow), text, kind }
export function disasm(instr, pc = 0, symbols = null) {
  const f = fields(instr);
  const r = (i) => ABI[i];
  const sym = (addr) => {
    const a = addr >>> 0;
    let name = symbols && symbols.get ? symbols.get(a) : null;
    if (!name && symbols && symbols.size) {
      // objdump style: nearest preceding symbol + offset
      let best = -1;
      for (const k of symbols.keys()) if (k <= a && k > best) best = k;
      if (best >= 0) name = `${symbols.get(best)}+0x${(a - best).toString(16)}`;
    }
    return name ? `0x${a.toString(16)} <${name}>` : `0x${a.toString(16)}`;
  };
  let m, ops, target, kind = 'alu';
  switch (f.opcode) {
    case 0x37: m = 'lui'; ops = `${r(f.rd)},0x${f.immU.toString(16)}`; break;
    case 0x17: m = 'auipc'; ops = `${r(f.rd)},0x${f.immU.toString(16)}`; break;
    case 0x6f:
      target = (pc + f.immJ) >>> 0; kind = 'jump';
      if (f.rd === 0) { m = 'j'; ops = sym(target); }
      else if (f.rd === 1) { m = 'jal'; ops = sym(target); }
      else { m = 'jal'; ops = `${r(f.rd)},${sym(target)}`; }
      break;
    case 0x67:
      kind = 'jump';
      if (f.funct3 !== 0) { m = '.word'; ops = '0x' + (instr >>> 0).toString(16); kind = 'illegal'; break; }
      if (f.rd === 0 && f.rs1 === 1 && f.immI === 0) { m = 'ret'; ops = ''; }
      else if (f.rd === 0 && f.immI === 0) { m = 'jr'; ops = r(f.rs1); }
      else if (f.rd === 1 && f.immI === 0) { m = 'jalr'; ops = r(f.rs1); }
      else { m = 'jalr'; ops = `${r(f.rd)},${f.immI}(${r(f.rs1)})`; }
      break;
    case 0x63: {
      kind = 'branch'; target = (pc + f.immB) >>> 0;
      const names = { 0: 'beq', 1: 'bne', 4: 'blt', 5: 'bge', 6: 'bltu', 7: 'bgeu' };
      m = names[f.funct3];
      if (!m) { m = '.word'; ops = '0x' + (instr >>> 0).toString(16); kind = 'illegal'; break; }
      if (f.rs2 === 0 && (m === 'beq' || m === 'bne' || m === 'blt' || m === 'bge')) {
        m = { beq: 'beqz', bne: 'bnez', blt: 'bltz', bge: 'bgez' }[m]; ops = `${r(f.rs1)},${sym(target)}`;
      } else if (f.rs1 === 0 && (m === 'blt' || m === 'bge')) {
        m = m === 'blt' ? 'bgtz' : 'blez'; ops = `${r(f.rs2)},${sym(target)}`;
      } else ops = `${r(f.rs1)},${r(f.rs2)},${sym(target)}`;
      break;
    }
    case 0x03: {
      kind = 'load';
      const names = { 0: 'lb', 1: 'lh', 2: 'lw', 4: 'lbu', 5: 'lhu' };
      m = names[f.funct3];
      if (!m) { m = '.word'; ops = '0x' + (instr >>> 0).toString(16); kind = 'illegal'; break; }
      ops = `${r(f.rd)},${f.immI}(${r(f.rs1)})`; break;
    }
    case 0x23: {
      kind = 'store';
      const names = { 0: 'sb', 1: 'sh', 2: 'sw' };
      m = names[f.funct3];
      if (!m) { m = '.word'; ops = '0x' + (instr >>> 0).toString(16); kind = 'illegal'; break; }
      ops = `${r(f.rs2)},${f.immS}(${r(f.rs1)})`; break;
    }
    case 0x13: {
      const names = { 0: 'addi', 1: 'slli', 2: 'slti', 3: 'sltiu', 4: 'xori', 5: (f.funct7 & 0x20) ? 'srai' : 'srli', 6: 'ori', 7: 'andi' };
      m = names[f.funct3];
      if (f.funct3 === 1 || f.funct3 === 5) {
        if ((f.funct7 & ~0x20) !== 0 || (f.funct3 === 1 && f.funct7 !== 0)) { m = '.word'; ops = '0x' + (instr >>> 0).toString(16); kind = 'illegal'; break; }
        ops = `${r(f.rd)},${r(f.rs1)},0x${f.rs2.toString(16)}`;
      } else if (instr === 0x13) { m = 'nop'; ops = ''; }
      else if (m === 'addi' && f.rs1 === 0) { m = 'li'; ops = `${r(f.rd)},${f.immI}`; }
      else if (m === 'addi' && f.immI === 0) { m = 'mv'; ops = `${r(f.rd)},${r(f.rs1)}`; }
      else if (m === 'xori' && f.immI === -1) { m = 'not'; ops = `${r(f.rd)},${r(f.rs1)}`; }
      else if (m === 'sltiu' && f.immI === 1) { m = 'seqz'; ops = `${r(f.rd)},${r(f.rs1)}`; }
      else ops = `${r(f.rd)},${r(f.rs1)},${f.immI}`;
      break;
    }
    case 0x33: {
      const base = { 0: 'add', 1: 'sll', 2: 'slt', 3: 'sltu', 4: 'xor', 5: 'srl', 6: 'or', 7: 'and' };
      m = base[f.funct3];
      if (f.funct7 === 0x20 && f.funct3 === 0) m = 'sub';
      else if (f.funct7 === 0x20 && f.funct3 === 5) m = 'sra';
      else if (f.funct7 !== 0) { m = '.word'; ops = '0x' + (instr >>> 0).toString(16); kind = 'illegal'; break; }
      if (m === 'sub' && f.rs1 === 0) { m = 'neg'; ops = `${r(f.rd)},${r(f.rs2)}`; }
      else if (m === 'sltu' && f.rs1 === 0) { m = 'snez'; ops = `${r(f.rd)},${r(f.rs2)}`; }
      else if (m === 'slt' && f.rs2 === 0) { m = 'sltz'; ops = `${r(f.rd)},${r(f.rs1)}`; }
      else if (m === 'slt' && f.rs1 === 0) { m = 'sgtz'; ops = `${r(f.rd)},${r(f.rs2)}`; }
      else ops = `${r(f.rd)},${r(f.rs1)},${r(f.rs2)}`;
      break;
    }
    case 0x0f:
      kind = 'system';
      if (f.funct3 === 1) { m = 'fence.i'; ops = ''; }
      else if (instr === 0x0ff0000f) { m = 'fence'; ops = ''; }
      else { m = 'fence'; ops = fenceOps(f.rs2 >>> 0, instr); }
      break;
    case 0x73:
      kind = 'system';
      if (instr === 0x73) { m = 'ecall'; ops = ''; }
      else if (instr === 0x00100073) { m = 'ebreak'; ops = ''; }
      else if (f.funct3 !== 0) {
        const names = { 1: 'csrrw', 2: 'csrrs', 3: 'csrrc', 5: 'csrrwi', 6: 'csrrsi', 7: 'csrrci' };
        m = names[f.funct3]; const csr = (instr >>> 20) & 0xfff;
        ops = f.funct3 >= 5 ? `${r(f.rd)},0x${csr.toString(16)},${f.rs1}` : `${r(f.rd)},0x${csr.toString(16)},${r(f.rs1)}`;
      } else { m = '.word'; ops = '0x' + (instr >>> 0).toString(16); kind = 'illegal'; }
      break;
    default:
      m = '.word'; ops = '0x' + (instr >>> 0).toString(16); kind = 'illegal';
  }
  return { mnemonic: m, operands: ops, target, kind, text: ops ? `${m} ${ops}` : m };
}

function fenceOps(_, instr) {
  const pred = (instr >>> 24) & 0xf, succ = (instr >>> 20) & 0xf;
  const s = (v) => ((v & 8) ? 'i' : '') + ((v & 4) ? 'o' : '') + ((v & 2) ? 'r' : '') + ((v & 1) ? 'w' : '');
  return `${s(pred)},${s(succ)}`;
}
