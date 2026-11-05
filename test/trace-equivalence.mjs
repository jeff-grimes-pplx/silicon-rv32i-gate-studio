// Compare the JS twin's per-cycle trace with the Verilator RTL trace.
// usage: node test/trace-equivalence.mjs prog.bin verilator.trace [memKB] [maxCycles] [tohostHex]
import fs from 'node:fs';
import { SiliconCore, Memory } from '../app/src/core.js';

const [,, binPath, tracePath, memKB = '64', maxCycles = '5000000', tohostHex] = process.argv;
const mem = new Memory(parseInt(memKB) * 1024);
mem.loadBytes(new Uint8Array(fs.readFileSync(binPath)), 0);
const core = new SiliconCore(mem);
const ref = fs.readFileSync(tracePath, 'utf8').split('\n').filter(Boolean);
const tohost = tohostHex ? parseInt(tohostHex, 16) >>> 0 : null;
let i = 0, mismatches = 0;
for (; i < ref.length && i < parseInt(maxCycles); i++) {
  const s = core.comb();
  const line = core.traceLine(s);
  if (line !== ref[i]) {
    mismatches++;
    if (mismatches <= 5) { console.log(`MISMATCH at cycle ${i}\n  js : ${line}\n  rtl: ${ref[i]}`); }
  }
  if (core.halted) break;
  const we = s.dmem_we, addr = s.dmem_addr, data = s.dmem_wdata;
  core.clock(s);
  if (tohost !== null && we && (addr & ~3) === (tohost & ~3) && (data & 0xff) !== 0) { i++; break; }
}
console.log(`${binPath}: compared ${i + (core.halted ? 1 : 0)} of ${ref.length} trace lines, ${mismatches} mismatches, cycles=${core.cycle} instret=${core.instret}`);
process.exit(mismatches ? 1 : 0);
