// RV32I encoding tables shared by the assembler and disassembler.

export const ABI = ['zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2', 's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7',
  's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6'];

export const REG_BY_NAME = (() => {
  const m = new Map();
  ABI.forEach((n, i) => m.set(n, i));
  for (let i = 0; i < 32; i++) m.set('x' + i, i);
  m.set('fp', 8);
  return m;
})();

// name -> { fmt, opcode, funct3, funct7 }
export const INSTR = {
  lui:   { fmt: 'U', opcode: 0x37 },
  auipc: { fmt: 'U', opcode: 0x17 },
  jal:   { fmt: 'J', opcode: 0x6f },
  jalr:  { fmt: 'I', opcode: 0x67, funct3: 0 },
  beq:   { fmt: 'B', opcode: 0x63, funct3: 0 },
  bne:   { fmt: 'B', opcode: 0x63, funct3: 1 },
  blt:   { fmt: 'B', opcode: 0x63, funct3: 4 },
  bge:   { fmt: 'B', opcode: 0x63, funct3: 5 },
  bltu:  { fmt: 'B', opcode: 0x63, funct3: 6 },
  bgeu:  { fmt: 'B', opcode: 0x63, funct3: 7 },
  lb:    { fmt: 'L', opcode: 0x03, funct3: 0 },
  lh:    { fmt: 'L', opcode: 0x03, funct3: 1 },
  lw:    { fmt: 'L', opcode: 0x03, funct3: 2 },
  lbu:   { fmt: 'L', opcode: 0x03, funct3: 4 },
  lhu:   { fmt: 'L', opcode: 0x03, funct3: 5 },
  sb:    { fmt: 'S', opcode: 0x23, funct3: 0 },
  sh:    { fmt: 'S', opcode: 0x23, funct3: 1 },
  sw:    { fmt: 'S', opcode: 0x23, funct3: 2 },
  addi:  { fmt: 'I', opcode: 0x13, funct3: 0 },
  slti:  { fmt: 'I', opcode: 0x13, funct3: 2 },
  sltiu: { fmt: 'I', opcode: 0x13, funct3: 3 },
  xori:  { fmt: 'I', opcode: 0x13, funct3: 4 },
  ori:   { fmt: 'I', opcode: 0x13, funct3: 6 },
  andi:  { fmt: 'I', opcode: 0x13, funct3: 7 },
  slli:  { fmt: 'SH', opcode: 0x13, funct3: 1, funct7: 0x00 },
  srli:  { fmt: 'SH', opcode: 0x13, funct3: 5, funct7: 0x00 },
  srai:  { fmt: 'SH', opcode: 0x13, funct3: 5, funct7: 0x20 },
  add:   { fmt: 'R', opcode: 0x33, funct3: 0, funct7: 0x00 },
  sub:   { fmt: 'R', opcode: 0x33, funct3: 0, funct7: 0x20 },
  sll:   { fmt: 'R', opcode: 0x33, funct3: 1, funct7: 0x00 },
  slt:   { fmt: 'R', opcode: 0x33, funct3: 2, funct7: 0x00 },
  sltu:  { fmt: 'R', opcode: 0x33, funct3: 3, funct7: 0x00 },
  xor:   { fmt: 'R', opcode: 0x33, funct3: 4, funct7: 0x00 },
  srl:   { fmt: 'R', opcode: 0x33, funct3: 5, funct7: 0x00 },
  sra:   { fmt: 'R', opcode: 0x33, funct3: 5, funct7: 0x20 },
  or:    { fmt: 'R', opcode: 0x33, funct3: 6, funct7: 0x00 },
  and:   { fmt: 'R', opcode: 0x33, funct3: 7, funct7: 0x00 },
  fence: { fmt: 'FENCE', opcode: 0x0f, funct3: 0 },
  'fence.i': { fmt: 'FIXED', opcode: 0x0f, word: 0x0000100f },
  ecall: { fmt: 'FIXED', opcode: 0x73, word: 0x00000073 },
  ebreak:{ fmt: 'FIXED', opcode: 0x73, word: 0x00100073 },
};

export function encR(op, rd, rs1, rs2) { return ((op.funct7 << 25) | (rs2 << 20) | (rs1 << 15) | (op.funct3 << 12) | (rd << 7) | op.opcode) >>> 0; }
export function encI(op, rd, rs1, imm) { return (((imm & 0xfff) << 20) | (rs1 << 15) | (op.funct3 << 12) | (rd << 7) | op.opcode) >>> 0; }
export function encSH(op, rd, rs1, sh) { return ((op.funct7 << 25) | ((sh & 31) << 20) | (rs1 << 15) | (op.funct3 << 12) | (rd << 7) | op.opcode) >>> 0; }
export function encS(op, rs1, rs2, imm) { return ((((imm >> 5) & 0x7f) << 25) | (rs2 << 20) | (rs1 << 15) | (op.funct3 << 12) | ((imm & 0x1f) << 7) | op.opcode) >>> 0; }
export function encB(op, rs1, rs2, imm) {
  return ((((imm >> 12) & 1) << 31) | (((imm >> 5) & 0x3f) << 25) | (rs2 << 20) | (rs1 << 15) | (op.funct3 << 12) |
    (((imm >> 1) & 0xf) << 8) | (((imm >> 11) & 1) << 7) | op.opcode) >>> 0;
}
export function encU(op, rd, imm20) { return (((imm20 & 0xfffff) << 12) | (rd << 7) | op.opcode) >>> 0; }
export function encJ(op, rd, imm) {
  return ((((imm >> 20) & 1) << 31) | (((imm >> 1) & 0x3ff) << 21) | (((imm >> 11) & 1) << 20) | (((imm >> 12) & 0xff) << 12) | (rd << 7) | op.opcode) >>> 0;
}

export const hex8 = (x) => (x >>> 0).toString(16).padStart(8, '0');
