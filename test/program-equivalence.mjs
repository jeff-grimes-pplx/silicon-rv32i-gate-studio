// JS twin vs Verilator on a curated program: trace prefix, final registers, final memory.
// usage: node test/program-equivalence.mjs <name>
import fs from 'node:fs';
import { SiliconCore, Memory } from '../app/src/core.js';
const name = process.argv[2];
const dir = new URL('../programs/build/', import.meta.url);
const mem = new Memory(64 * 1024);
mem.loadBytes(new Uint8Array(fs.readFileSync(new URL(name + '.bin', dir))), 0);
const core = new SiliconCore(mem);
const ref = fs.readFileSync(new URL(name + '.trace', dir), 'utf8').split('\n').filter(Boolean);
let mismatches = 0, compared = 0;
for (let i = 0; i < 50_000_000; i++) {
  const s = core.comb();
  if (i < ref.length) { compared++; if (core.traceLine(s) !== ref[i]) { mismatches++; if (mismatches <= 3) console.log(`trace mismatch cycle ${i}\n js: ${core.traceLine(s)}\n rtl: ${ref[i]}`); } }
  if (core.halted) break;
  core.clock(s);
}
const run = fs.readFileSync(new URL(name + '.run', dir), 'utf8');
const regsRef = run.match(/^regs (.*)$/m)[1].split(' ');
let regMism = 0;
for (let r = 1; r < 32; r++) if (core.regs[r].toString(16).padStart(8, '0') !== regsRef[r - 1]) regMism++;
const cyc = parseInt(run.match(/cycles=(\d+)/)[1]), ins = parseInt(run.match(/instret=(\d+)/)[1]);
let memMism = 0;
for (const line of fs.readFileSync(new URL(name + '.mem', dir), 'utf8').split('\n')) {
  if (!line) continue; const [a, v] = line.split(' ');
  if (mem.read32(parseInt(a, 16)) !== parseInt(v, 16) >>> 0) memMism++;
}
const ok = !mismatches && !regMism && !memMism && cyc === core.cycle && ins === core.instret;
console.log(`${name}: ${ok ? 'OK' : 'FAIL'} trace ${compared} lines (${mismatches} mism), regs ${regMism} mism, mem ${memMism} mism, cycles js=${core.cycle} rtl=${cyc}, instret js=${core.instret} rtl=${ins}`);
process.exit(ok ? 0 : 1);
