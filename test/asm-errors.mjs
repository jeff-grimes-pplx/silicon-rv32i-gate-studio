// Negative tests: the assembler must reject these with a line-numbered message.
import { assemble } from '../app/src/asm.js';
const cases = [
  ['addq a0, a1, a2', /unknown instruction/],
  ['add a0, a1', /expects 3 operands/],
  ['addi a0, a1, 4096', /does not fit in 12 bits/],
  ['addi a0, a1, -2049', /does not fit in 12 bits/],
  ['slli a0, a1, 32', /shift amount/],
  ['add a0, a1, a9', /unknown register/],
  ['lw a0, 8(a1', /expected lw rd, offset\(rs1\)/],
  ['beq a0, a1, nowhere', /undefined symbol/],
  ['x: nop\nx: nop', /defined twice/],
  ['j 3', /misaligned/],
  ['.word 1\n add a0,a0,a0', null],            // instruction in text after data is fine
  ['.data\nadd a0, a0, a0', /instructions must be in .text/],
  ['li a0, label\nlabel:', /constant immediate/],
  ['lui a0, 0x100000', /20 bits/],
  ['.byte 300', /out of range/],
  ['la zero, x\nx:', /cannot load into zero/],
  ['.space -4', /negative size/],
  ['.foo 1', /unknown directive/],
  ['sw a0, 4(a1), a2', /expects 2 operands/],
  ['%pcrel_lo(x)\nx:', /unknown instruction/],
  ['addi a0, a0, %pcrel_lo(x)\nx: nop', /%pcrel_lo must name/],
];
let fails = 0;
for (const [src, re] of cases) {
  const r = assemble(src);
  const ok = re ? (!r.ok && r.errors.some(e => re.test(e.message) && e.line >= 1)) : r.ok;
  if (!ok) { fails++; console.log(`FAIL ${JSON.stringify(src)} -> ${r.ok ? 'accepted' : r.errors.map(e => `L${e.line} ${e.message}`).join('; ')}`); }
}
// a branch exactly at the range limit
const far = '    beq a0, a1, far\n' + '    nop\n'.repeat(1022) + 'far: nop';
const rf = assemble(far); if (!rf.ok) { fails++; console.log('FAIL far branch should assemble', rf.errors[0]); }
const tooFar = '    beq a0, a1, far\n' + '    nop\n'.repeat(1024) + 'far: nop';
const rt = assemble(tooFar); if (rt.ok || !/out of range/.test(rt.errors[0].message)) { fails++; console.log('FAIL too-far branch should be rejected'); }
console.log(`assembler negative tests: ${cases.length + 2 - fails}/${cases.length + 2} passed`);
process.exit(fails ? 1 : 0);
