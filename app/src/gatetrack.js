// Silicon — keeps the gate-level netlist simulation aligned with the
// behavioural session. The gate simulator is fed the memory port values the
// behavioural model logged for each cycle, so any cycle can be reproduced
// without a copy of memory: keyframes of flop state every K cycles plus a
// short replay. Every settled cycle's output ports are compared with the
// behavioural model's; mismatches are counted (and expected to stay at zero).

import { GateSim } from './gatesim.js';

const K = 256;

export class GateTracker extends EventTarget {
  constructor(nl, session) {
    super();
    this.gs = new GateSim(nl);
    this.session = session;
    this.cycle = -1;             // settled cycle held by gs (-1: reset state, nothing settled)
    this.keyframes = new Map();  // cycle -> flop state entering that cycle
    this.mismatches = 0;
    this.checked = 0;            // distinct cycles whose netlist ports were verified against the log
    this.verified = new Uint8Array(4096);
    this.lastMismatch = null;
    this.busy = false;
    this.target = null;
    this.progress = null;        // {from, to, at} during a long replay
    this.ports = null;           // settled ports of `cycle`
    this.keyframes.set(0, this.gs.snapshotFlops());
    session.addEventListener('reset', () => this.reset());
  }

  reset() {
    this.gs.reset();
    this.cycle = -1; this.keyframes.clear(); this.keyframes.set(0, this.gs.snapshotFlops());
    this.mismatches = 0; this.checked = 0; this.verified = new Uint8Array(4096); this.lastMismatch = null; this.target = null; this.progress = null; this.ports = null;
    this.emit('update');
  }
  emit(type) { this.dispatchEvent(new CustomEvent(type)); }

  // settle one cycle from the log (gs holds state entering `c`)
  settle(c, check = true) {
    const e = this.session.logEntry(c);
    const p = this.gs.cycleWith(e[1], e[3]);
    this.cycle = c; this.ports = p;
    if (check) {
      const flags = e[4];
      const we = flags & 1, be = (flags >>> 1) & 15, halted = (flags >>> 5) & 1;
      let ok = p.imem_addr === e[0] && p.dmem_addr === e[2] && p.dmem_we === we && p.halted === halted;
      if (ok && we) ok = p.dmem_be === be && p.dmem_wdata === this.session.writeDataAt(c);
      if (c >= this.verified.length) { const g = new Uint8Array(Math.max(c + 1, this.verified.length * 2)); g.set(this.verified); this.verified = g; }
      if (!this.verified[c]) { this.verified[c] = 1; this.checked++; }
      if (!ok) { this.mismatches++; this.lastMismatch = { cycle: c, gate: p, rtl: { imem_addr: e[0], dmem_addr: e[2], we, be, halted } }; }
    }
    return p;
  }
  // clock edge after settle(c): state entering c+1
  advance() {
    this.gs.tick();
    const next = this.cycle + 1;
    if (next % K === 0 && !this.keyframes.has(next)) this.keyframes.set(next, this.gs.snapshotFlops());
  }

  // Make gs hold the settled state of cycle n (n < session.logLen). Short
  // distances are done synchronously; long ones in chunks with progress.
  // Invariant: between calls, gs holds the *settled* (not yet clocked) state of `cycle`.
  seek(n) {
    if (n >= this.session.logLen) n = this.session.logLen - 1;
    if (n < 0) return;
    this.target = n;
    if (this.busy) return;                       // the running chunked job retargets itself
    if (n === this.cycle) return;
    let from = -1, needAdvance = false;
    if (this.cycle >= 0 && n > this.cycle) { from = this.cycle + 1; needAdvance = true; }
    let kf = -1;
    for (const k of this.keyframes.keys()) if (k <= Math.max(n - 1, 0) && k > kf && k > from) kf = k;
    if (kf >= 0) {
      // Restoring flops leaves the combinational nets stale, so the toggle set of
      // the first settled cycle after a restore has no valid baseline. That cycle
      // is only ever displayed when it is cycle 0 (kf = 0, n = 0): there the reset
      // sequence rebuilds the exact baseline the first cycle is compared against.
      if (kf === 0) this.gs.reset();
      else { this.gs.restoreFlops(this.keyframes.get(kf)); this.gs.prev.set(this.gs.val); }
      this.cycle = kf - 1; from = kf; needAdvance = false;
    }
    if (from < 0) return;
    if (needAdvance) this.advance();
    if (n - from <= 2 * K) {
      for (let c = from; c <= n; c++) { this.settle(c); if (c < n) this.advance(); }
      this.progress = null;
      this.emit('update');
      return;
    }
    // long replay in chunks
    this.busy = true;
    this.progress = { from, to: n, at: from };
    let c = from;
    const chunk = () => {
      const deadline = performance.now() + 30;
      while (c <= this.target) {
        this.settle(c);
        c++;
        if (c <= this.target) this.advance();
        if (performance.now() > deadline) break;
      }
      this.progress.at = c; this.progress.to = this.target;
      if (c > this.target) {
        this.busy = false; this.progress = null;
        this.emit('update');
        if (this.target !== this.cycle) this.seek(this.target);  // retargeted meanwhile
        return;
      }
      this.emit('progress');
      requestAnimationFrame(chunk);
    };
    chunk();
  }

  // activity summary for the settled cycle
  toggleCount() { return this.gs.toggleCount; }
}
