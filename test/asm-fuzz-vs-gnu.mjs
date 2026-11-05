// Differential fuzz: random RV32I programs assembled by the in-browser
// assembler and by GNU as/ld (same linker script, relaxation on). Byte-identical or fail.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { assemble } from '../app/src/asm.js';
import { ABI } from '../app/src/isa.js';

let seed = Number(process.argv[2] ?? 1);
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const ri = (n) => Math.floor(rnd() * n);
const pick = (a) => a[ri(a.length)];
const reg = () => pick(ABI.concat(ABI.map((_, i) => 'x' + i)));
const nzreg = () => { for (;;) { const r = reg(); if (r !== 'zero' && r !== 'x0') return r; } };
const imm12 = () => ri(4096) - 2048;
const imm32 = () => pick([ri(4096) - 2048, (ri(0x100000) << 12) | ri(4096), -(ri(0x7fffffff)), ri(0x7fffffff), 0x80000000 | ri(0xffff), 0x7ffff800 + ri(2048)]) | 0;
const R = ['add', 'sub', 'sll', 'slt', 'sltu', 'xor', 'srl', 'sra', 'or', 'and'];
const I = ['addi', 'slti', 'sltiu', 'xori', 'ori', 'andi'];
const SH = ['slli', 'srli', 'srai'];
const L = ['lb', 'lh', 'lw', 'lbu', 'lhu'];
const S = ['sb', 'sh', 'sw'];
const B = ['beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu', 'bgt', 'ble', 'bgtu', 'bleu'];
const BZ = ['beqz', 'bnez', 'blez', 'bgez', 'bltz', 'bgtz'];
const dir = process.argv[3] ?? '/tmp/asmfuzz';
fs.mkdirSync(dir, { recursive: true });
let fails = 0;
const N = Number(process.argv[4] ?? 20);
for (let t = 0; t < N; t++) {
  const nIns = 20 + ri(60);
  const labels = Array.from({ length: 6 }, (_, i) => `L${i}`);
  const lines = ['    .text', '    .globl _start', '_start:'];
  for (let i = 0; i < nIns; i++) {
    if (ri(6) === 0) lines.push(`${pick(labels)}_${i}:`);
    const k = ri(16);
    if (k === 0) lines.push(`    ${pick(R)} ${reg()}, ${reg()}, ${reg()}`);
    else if (k === 1) lines.push(`    ${pick(I)} ${reg()}, ${reg()}, ${imm12()}`);
    else if (k === 2) lines.push(`    ${pick(SH)} ${reg()}, ${reg()}, ${ri(32)}`);
    else if (k === 3) lines.push(`    ${pick(L)} ${reg()}, ${imm12()}(${reg()})`);
    else if (k === 4) lines.push(`    ${pick(S)} ${reg()}, ${imm12()}(${reg()})`);
    else if (k === 5) lines.push(`    li ${reg()}, ${imm32()}`);
    else if (k === 6) lines.push(`    lui ${reg()}, 0x${ri(0x100000).toString(16)}`);
    else if (k === 7) lines.push(`    auipc ${reg()}, ${ri(0x100000)}`);
    else if (k === 8) lines.push(`    ${pick(B)} ${reg()}, ${reg()}, target${ri(4)}`);
    else if (k === 9) lines.push(`    ${pick(BZ)} ${reg()}, target${ri(4)}`);
    else if (k === 10) lines.push(`    la ${nzreg()}, ${pick(['d0', 'd1', 'd2', 'bigbuf_end'])}`);
    else if (k === 11) lines.push(`    ${pick(['mv', 'not', 'neg', 'seqz', 'snez', 'sltz', 'sgtz'])} ${reg()}, ${reg()}`);
    else if (k === 12) lines.push(`    ${pick(['j target1', 'jal target2', 'jal ' + reg() + ', target3', 'jr ' + reg(), 'jalr ' + reg(), 'ret', 'call target0', 'tail target2'])}`);
    else if (k === 13) lines.push(`    jalr ${reg()}, ${imm12()}(${reg()})`);
    else if (k === 14) lines.push(`    ${pick(['nop', 'ecall', 'ebreak', 'fence', 'fence rw,rw', 'fence iorw,iorw'])}`);
    else if (k === 15 && ri(2)) lines.push(`    ${pick(S)} ${reg()}, ${pick(['d0', 'd1', 'd2'])}, ${nzreg()}`);
    else lines.push(`    ${pick(L)} ${nzreg()}, ${pick(['d0', 'd1', 'd2', 'bigbuf_end'])}`);
    if (i % 12 === 5 && !lines.some(l => l.startsWith(`target${(i / 12 | 0) % 4}:`))) lines.push(`target${(i / 12 | 0) % 4}:`);
  }
  for (let q = 0; q < 4; q++) if (!lines.some(l => l.startsWith(`target${q}:`))) lines.push(`target${q}:`);
  lines.push('    ebreak', '    .data', 'd0: .word 1, 2, -3, 0x12345678', `d1: .byte 1, 2, 3`, '    .align 2', 'd2: .asciz "fuzz"', `    .space ${pick([0, 100, 3000])}`, 'bigbuf_end: .half 7');
  const src = lines.join('\n') + '\n';
  fs.writeFileSync(`${dir}/t.S`, src);
  let gnu;
  try {
    execSync(`riscv64-unknown-elf-gcc -march=rv32i -mabi=ilp32 -nostdlib -nostartfiles -T programs/link.ld -o ${dir}/t.elf ${dir}/t.S 2>${dir}/gnu.err && riscv64-unknown-elf-objcopy -O binary ${dir}/t.elf ${dir}/t.bin`, { stdio: 'pipe' });
    gnu = new Uint8Array(fs.readFileSync(`${dir}/t.bin`));
  } catch (e) { console.log(`case ${t}: GNU rejected the program: ${fs.readFileSync(`${dir}/gnu.err`, 'utf8').split('\n')[0]}`); fs.copyFileSync(`${dir}/t.S`, `${dir}/rejected${t}.S`); continue; }
  const r = assemble(src);
  let diff = -1;
  const n = Math.max(gnu.length, r.image.length);
  for (let i = 0; i < n; i++) if ((gnu[i] ?? 0) !== (r.image[i] ?? 0)) { diff = i; break; }
  if (!r.ok || diff >= 0) {
    fails++;
    fs.copyFileSync(`${dir}/t.S`, `${dir}/fail${t}.S`);
    console.log(`FAIL case ${t}: ${r.ok ? `first diff at 0x${diff.toString(16)} (mine ${r.image.length} B, gnu ${gnu.length} B)` : r.errors.map(e => `L${e.line} ${e.message}: ${lines[e.line - 1]}`).join('; ')}`);
    if (r.ok) { const a = diff & ~3; console.log(`   mine ${Array.from(r.image.slice(a, a + 8)).map(b => b.toString(16).padStart(2, '0')).join(' ')}  gnu ${Array.from(gnu.slice(a, a + 8)).map(b => b.toString(16).padStart(2, '0')).join(' ')}  ${lines.find((l, i) => i >= 0 && r.listing.find(x => x.addr === a && x.ln === i + 1))}`); }
  }
}
console.log(`fuzz: ${N - fails}/${N} random programs byte-identical to GNU (seed ${process.argv[2] ?? 1})`);
process.exit(fails ? 1 : 0);
