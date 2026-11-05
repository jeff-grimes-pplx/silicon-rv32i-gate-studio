// Silicon — simulation session: the behavioural core, its memory, a bounded
// history for stepping backwards, breakpoints, and the per-cycle log of memory
// port values that lets the gate-level netlist be replayed independently.

import { SiliconCore, Memory } from './core.js';

const HISTORY = 4096;        // cycles of step-back
export const CYCLE_CAP = 3_000_000;
const LOG_WORDS = 5;         // imem_addr, imem_rdata, dmem_addr, dmem_rdata, flags
// flags: bit0 dmem_we, bits1-4 dmem_be, bit5 halted, bit6 redirect, bit7 stall, bit8 fwd_a, bit9 fwd_b, bit10 wb_we

export class Session extends EventTarget {
  constructor(memBytes = 64 * 1024) {
    super();
    this.mem = new Memory(memBytes);
    this.core = new SiliconCore(this.mem);
    this.program = null;
    this.breakpoints = new Set();
    this.history = [];           // ring of {snapshot, undo}
    this.histStart = 0;          // cycle index of history[0]
    this.log = new Uint32Array(LOG_WORDS * 65536);
    this.wlog = [];              // [cycle, wdata] for cycles with dmem_we
    this.logLen = 0;             // cycles logged (always core.cycle + 1 after sync())
    this.lastWrite = null;       // {addr, be, cycle}
    this.running = false;
    this.stopReason = 'reset';
    this.signals = this.core.comb();
    this.sync();
  }

  load(program) {
    // program: {name, image: Uint8Array, ...}
    this.program = program;
    this.breakpoints = new Set();
    this.reset();
  }

  reset() {
    this.pause();
    this.mem.clear();
    if (this.program) this.mem.loadBytes(this.program.image, 0);
    this.core.reset();
    this.history.length = 0; this.histStart = 0;
    this.logLen = 0; this.wlog.length = 0;
    this.lastWrite = null;
    this.stopReason = 'reset';
    this.sync();
    this.emit('reset');
    this.emit('cycle');
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  // recompute combinational signals for the current state and log them
  sync() {
    const s = this.core.comb();
    this.signals = s;
    const c = this.core.cycle;
    if (c < CYCLE_CAP) {
      if ((c + 1) * LOG_WORDS > this.log.length) {
        const n = new Uint32Array(Math.min(this.log.length * 2, (CYCLE_CAP + 1) * LOG_WORDS));
        n.set(this.log); this.log = n;
      }
      const o = c * LOG_WORDS;
      this.log[o] = s.imem_addr; this.log[o + 1] = s.imem_rdata; this.log[o + 2] = s.dmem_addr; this.log[o + 3] = s.dmem_rdata;
      this.log[o + 4] = s.dmem_we | (s.dmem_be << 1) | (s.halted << 5) | (s.redirect << 6) | (s.stall << 7) |
        (s.fwd_a_used << 8) | (s.fwd_b_used << 9) | (s.wb_we << 10);
      // sparse write log, kept sorted by cycle (truncate anything from a future we stepped back over)
      while (this.wlog.length && this.wlog[this.wlog.length - 1][0] >= c) this.wlog.pop();
      if (s.dmem_we) this.wlog.push([c, s.dmem_wdata]);
      this.logLen = c + 1;
    }
    return s;
  }

  get cycle() { return this.core.cycle; }
  get halted() { return this.core.halted === 1; }

  // one clock edge
  step() {
    if (this.core.cycle >= CYCLE_CAP) { this.stopReason = 'cycle cap'; return false; }
    const s = this.signals;
    const snapshot = this.core.snapshot();
    const undo = this.core.clock(s);
    if (this.history.length === HISTORY) { this.history.shift(); this.histStart++; }
    else if (this.history.length === 0) this.histStart = snapshot.cycle;
    this.history.push({ snapshot, undo });
    if (undo) this.lastWrite = { addr: s.dmem_addr, be: s.dmem_be, cycle: snapshot.cycle, data: s.dmem_wdata };
    this.sync();
    return true;
  }

  stepOnce() {
    if (this.halted) return;
    this.step();
    this.stopReason = 'step';
    this.emit('cycle');
  }

  canStepBack() { return this.history.length > 0; }

  stepBack() {
    if (!this.history.length) return;
    const { snapshot, undo } = this.history.pop();
    if (undo) this.mem.words[undo.addr >>> 2] = undo.old;
    this.core.restore(snapshot);
    // last write marker: find the most recent write still in effect
    this.lastWrite = null;
    for (let i = this.history.length - 1; i >= 0; i--) {
      const h = this.history[i];
      if (h.undo) { const sg = this.log.subarray(h.snapshot.cycle * LOG_WORDS, h.snapshot.cycle * LOG_WORDS + LOG_WORDS); this.lastWrite = { addr: sg[2], be: (sg[4] >>> 1) & 15, cycle: h.snapshot.cycle, data: this.mem.read32(sg[2]) }; break; }
    }
    this.sync();
    this.stopReason = 'step back';
    this.emit('cycle');
  }

  // Jump to an absolute cycle: via history when possible, otherwise replay from reset.
  seekCycle(target, onProgress) {
    target = Math.max(0, Math.min(target, CYCLE_CAP));
    this.pause();
    if (target < this.core.cycle && target >= this.histStart) {
      while (this.core.cycle > target && this.history.length) {
        const { snapshot, undo } = this.history.pop();
        if (undo) this.mem.words[undo.addr >>> 2] = undo.old;
        this.core.restore(snapshot);
      }
      this.lastWrite = null;
      this.sync();
      this.stopReason = 'seek';
      this.emit('cycle');
      return Promise.resolve();
    }
    if (target < this.core.cycle) {
      // replay from reset
      this.mem.clear(); if (this.program) this.mem.loadBytes(this.program.image, 0);
      this.core.reset(); this.history.length = 0; this.histStart = 0; this.wlog.length = 0; this.lastWrite = null;
      this.sync();
    }
    return this.runChunked(() => this.core.cycle >= target, onProgress, 'seek');
  }

  toggleBreakpoint(addr) {
    if (this.breakpoints.has(addr)) this.breakpoints.delete(addr); else this.breakpoints.add(addr);
    this.emit('breakpoints');
  }

  atBreakpoint() {
    // A breakpoint fires when the instruction reaches EX: at that point it is
    // certain to execute (a wrong-path fetch of the address never triggers it).
    const x = this.core.idex;
    return x.valid && this.breakpoints.has(x.pc);
  }

  // Run at `cps` cycles per second (Infinity = as fast as possible).
  run(cps = Infinity) {
    if (this.running || this.halted) return;
    this.running = true;
    this.stopReason = null;
    this.emit('run');
    let last = performance.now();
    let carry = 0;
    const tick = (now) => {
      if (!this.running) return;
      const dt = Math.min(now - last, 100); last = now;
      let budget;
      if (cps === Infinity) budget = Infinity;
      else { carry += dt * cps / 1000; budget = Math.floor(carry); carry -= budget; }
      const deadline = now + 12;
      let n = 0;
      while (n < budget && !this.halted) {
        if (!this.step()) { this.stopReason = 'cycle cap'; break; }
        n++;
        if (this.atBreakpoint()) { this.stopReason = 'breakpoint'; break; }
        if ((cps === Infinity || cps >= 50000) && (n & 1023) === 0 && performance.now() > deadline) break;
      }
      if (this.halted) this.stopReason = 'halt';
      this.emit('cycle');
      if (this.halted || this.stopReason) { this.running = false; this.emit('stop'); return; }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause() {
    if (!this.running) return;
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.stopReason = 'paused';
    this.emit('stop');
  }

  // run until pred() in chunks, keeping the UI responsive; resolves when done
  runChunked(pred, onProgress, reason = 'run', honorBreakpoints = true) {
    this.running = true; this.stopReason = null; this.emit('run');
    return new Promise((resolve) => {
      const tick = () => {
        if (!this.running) { resolve(); return; }
        const deadline = performance.now() + 14;
        let n = 0;
        while (!pred() && !this.halted) {
          if (!this.step()) { this.stopReason = 'cycle cap'; break; }
          if (honorBreakpoints && this.atBreakpoint()) { this.stopReason = 'breakpoint'; break; }
          if ((++n & 1023) === 0 && performance.now() > deadline) break;
        }
        if (pred() || this.halted || this.stopReason) {
          this.running = false;
          if (!this.stopReason) this.stopReason = this.halted ? 'halt' : reason;
          this.emit('cycle'); this.emit('stop'); resolve(); return;
        }
        onProgress?.(this.core.cycle);
        this.emit('cycle');
        this.raf = requestAnimationFrame(tick);
      };
      tick();
    });
  }

  runToHalt() { return this.runChunked(() => false, null, 'run'); }

  // log accessors for the gate tracker
  logEntry(c) { const o = c * LOG_WORDS; return this.log.subarray(o, o + LOG_WORDS); }
  logFlags(c) { return this.log[c * LOG_WORDS + 4]; }
  writeDataAt(c) {
    // binary search the sparse write log
    let lo = 0, hi = this.wlog.length - 1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; const v = this.wlog[mid][0]; if (v === c) return this.wlog[mid][1]; if (v < c) lo = mid + 1; else hi = mid - 1; }
    return 0;
  }
}
