// Gate-level netlist (JS evaluator) vs behavioural JS model, every cycle, whole program.
// usage: node test/gate-equivalence.mjs prog.bin [memKB] [maxCycles] [tohostHex]
import fs from 'node:fs';
import { SiliconCore, Memory } from '../app/src/core.js';
import { GateSim } from '../app/src/gatesim.js';

const [,, binPath, memKB = '64', maxCycles = '5000000', tohostHex] = process.argv;
const nl = JSON.parse(fs.readFileSync(new URL('../synth/netlist.compact.json', import.meta.url)));
const mem = new Memory(parseInt(memKB) * 1024);
mem.loadBytes(new Uint8Array(fs.readFileSync(binPath)), 0);
const core = new SiliconCore(mem);
const gates = new GateSim(nl);
const tohost = tohostHex ? parseInt(tohostHex, 16) >>> 0 : null;
let mismatches = 0, cycles = 0, toggles = 0;
const t0 = Date.now();
for (; cycles < parseInt(maxCycles); cycles++) {
  const s = core.comb();
  const p = gates.cycle(mem);
  const fields = [['imem_addr', s.imem_addr], ['dmem_addr', s.dmem_addr], ['dmem_wdata', s.dmem_wdata], ['dmem_be', s.dmem_be],
    ['dmem_we', s.dmem_we], ['dmem_re', s.dmem_re], ['halted', s.halted]];
  for (const [k, v] of fields) if (p[k] !== v) { mismatches++; if (mismatches <= 5) console.log(`cycle ${cycles} ${k}: gates=${p[k].toString(16)} rtl=${v.toString(16)}`); }
  toggles += gates.toggleCount;
  if (core.halted) break;
  const we = s.dmem_we, addr = s.dmem_addr, data = s.dmem_wdata;
  core.clock(s);
  gates.tick();
  if (tohost !== null && we && (addr & ~3) === (tohost & ~3) && (data & 0xff) !== 0) { cycles++; break; }
}
const dt = (Date.now() - t0) / 1000;
console.log(`${binPath}: ${cycles} cycles, ${mismatches} port mismatches, avg toggled cells/cycle ${(toggles / Math.max(1, cycles)).toFixed(0)}, ${(cycles / dt).toFixed(0)} cycles/s`);
process.exit(mismatches ? 1 : 0);
