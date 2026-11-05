// Session (history, log, step-back, seek) and GateTracker (keyframes + replay)
// against straightforward lockstep simulation.
import fs from 'node:fs';
globalThis.requestAnimationFrame = (f) => setTimeout(() => f(performance.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.CustomEvent ??= class CustomEvent extends Event { constructor(t, o) { super(t); this.detail = o?.detail; } };
const { Session } = await import('../app/src/session.js');
const { GateTracker } = await import('../app/src/gatetrack.js');
const { GateSim } = await import('../app/src/gatesim.js');
const { SiliconCore, Memory } = await import('../app/src/core.js');

const nl = JSON.parse(fs.readFileSync(new URL('../synth/netlist.compact.json', import.meta.url)));
const manifest = JSON.parse(fs.readFileSync(new URL('../app/public/data/programs.json', import.meta.url)));
const prog = manifest.programs.find(p => p.name === process.argv[2] ?? 'primes');
const image = Uint8Array.from(Buffer.from(prog.image, 'base64'));
let fails = 0;
const check = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } };

// reference lockstep run: behavioural + gate, recording flop snapshots at chosen cycles
const refMem = new Memory(65536); refMem.loadBytes(image, 0);
const refCore = new SiliconCore(refMem); const refGate = new GateSim(nl);
const probes = [0, 1, 2, 5, 17, 255, 256, 257, 300, 511, 512, 1000, 1337, 2047, 4096, 5000, 9999, 12345, 16000, prog.measured.cycles - 1];
const refFlops = new Map(), refToggles = new Map(), refRegs = new Map();
for (let c = 0; ; c++) {
  const s = refCore.comb();
  refGate.cycle(refMem);
  if (probes.includes(c)) { refFlops.set(c, refGate.snapshotFlops()); refToggles.set(c, refGate.toggleCount); refRegs.set(c, refCore.regs.slice()); }
  if (refCore.halted || c >= prog.measured.cycles) break;
  refCore.clock(s); refGate.tick();
}

const session = new Session(65536);
session.load({ name: prog.name, image });
const tracker = new GateTracker(nl, session);

// 1. step forward 120, back 50, compare with reference regs at cycle 70 (via a fresh core)
const F = Math.min(120, prog.measured.cycles), B = Math.min(50, F - 1), T = F - B;
for (let i = 0; i < F; i++) session.stepOnce();
for (let i = 0; i < B; i++) session.stepBack();
check(session.cycle === T, `step back cycle ${session.cycle}`);
{ const m = new Memory(65536); m.loadBytes(image, 0); const c = new SiliconCore(m); for (let i = 0; i < T; i++) c.clock(c.comb());
  check(c.regs.every((v, i) => v === session.core.regs[i]), 'regs after step back');
  check(m.words.every((v, i) => v === session.mem.words[i]), 'memory after step back (undo log)');
  check(c.traceLine(c.comb()) === session.core.traceLine(session.signals), 'trace line after step back'); }

// 2. run to halt (chunked, async)
await session.runToHalt();
check(session.halted && session.cycle === prog.measured.cycles, `run to halt: cycle ${session.cycle} expected ${prog.measured.cycles}`);
check(session.core.regs[10] === prog.expected.a0, 'a0 after run');
check(session.logLen === prog.measured.cycles + 1, `logLen ${session.logLen}`);

// 3. gate tracker seeks (sync and chunked) must reproduce the lockstep gate state and activity
const seekAsync = (n) => new Promise((res) => { tracker.seek(n); if (!tracker.busy) return res(); const h = () => { if (!tracker.busy) { tracker.removeEventListener('update', h); res(); } }; tracker.addEventListener('update', h); });
for (const n of [5, 300, 1337, 2047, 12345, 256, 0, 16000, 9999, 1, 257, 5000, prog.measured.cycles - 1, 511, 512].filter(n => n <= prog.measured.cycles - 1)) {
  await seekAsync(n);
  check(tracker.cycle === n, `tracker at ${tracker.cycle} wanted ${n}`);
  const f = tracker.gs.snapshotFlops(); const rf = refFlops.get(n);
  check(rf && f.every((v, i) => v === rf[i]), `flop state at cycle ${n}`);
  if (n > 0) check(tracker.gs.toggleCount === refToggles.get(n), `toggle count at ${n}: ${tracker.gs.toggleCount} vs ${refToggles.get(n)}`);
}
check(tracker.mismatches === 0, `port mismatches ${tracker.mismatches} ${JSON.stringify(tracker.lastMismatch)}`);
console.log(`checked ${tracker.checked} gate cycles against the log, ${tracker.mismatches} mismatches, ${tracker.keyframes.size} keyframes`);

// 4. seekCycle (session) backwards beyond history → replay from reset
for (const n of [300, 5000, 17, 2]) {
  if (n > prog.measured.cycles - 1) continue;
  await session.seekCycle(n);
  check(session.cycle === n && session.core.regs.every((v, i) => v === refRegs.get(n)[i]), `seekCycle ${n}`);
}
// breakpoints: stop when the instruction at main is fetched
const mainSym = prog.symbols.find(s => s.name === 'main');
if (mainSym) { session.reset(); session.toggleBreakpoint(mainSym.addr); await session.runToHalt(); check(session.stopReason === 'breakpoint' && session.core.idex.pc === mainSym.addr, `breakpoint stop ${session.stopReason} idex.pc=${session.core.idex.pc.toString(16)}`); }
console.log(fails ? `${fails} FAILURES` : 'session/gatetrack: all checks passed');
process.exit(fails ? 1 : 0);
