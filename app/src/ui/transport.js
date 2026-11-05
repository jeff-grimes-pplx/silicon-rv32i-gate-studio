// Transport bar: reset / step back / step / run / run to end, speed, counters,
// a 160-cycle event timeline, and the status line (including the gate-level
// shadow check).
import { el, hex8, fmtInt } from './format.js';

const SPEEDS = [[1, '1 Hz (1 c/s)'], [4, '4 Hz'], [10, '10 Hz'], [30, '30 Hz'], [100, '100 Hz'], [1000, '1 kHz'], [10000, '10 kHz'], [100000, '100 kHz'], [Infinity, 'max speed']];

export class Transport {
  constructor(root, session, tracker, opts) {
    this.session = session; this.tracker = tracker; this.opts = opts;
    this.speed = 10;
    const b = (label, title, onclick, cls = '', kbd = null) => el('button', { class: 'btn ' + cls, title, onclick }, label, kbd ? el('kbd', {}, kbd) : null);
    this.btnReset = b('Reset', 'Reset the core and memory to the loaded program', () => { session.reset(); }, '', 'R');
    this.btnBack = b('◀ Back', 'Step back one cycle', () => { session.stepBack(); }, '', '←');
    this.btnStep = b('Step ▶', 'Advance one clock cycle', () => { session.stepOnce(); }, 'primary', 'Space');
    this.btnRun = b('Run', 'Run at the selected speed', () => this.toggleRun(), '', 'Enter');
    this.btnEnd = b('⏭ To end', 'Run at full speed until halt, breakpoint or the cycle cap', () => { if (session.running) session.pause(); else session.runToHalt(); }, '');
    this.speedSel = el('select', { 'aria-label': 'Run speed', onchange: () => { this.speed = Number(this.speedSel.value); if (session.running && this.speed !== this.runningSpeed) { session.pause(); session.run(this.speed); this.runningSpeed = this.speed; } } });
    for (const [v, l] of SPEEDS) this.speedSel.append(el('option', { value: String(v), selected: v === this.speed }, l));
    this.counters = {};
    const TITLES = {
      cycle: 'clock edges since reset (mcycle)', instret: 'instructions retired, counted at the clock edge that ends the cycle (minstret): the instruction in WB is added when you step',
      cpi: 'cycle ÷ instret', stalls: 'load-use stalls, including the displayed cycle', flushes: 'taken branches and jumps (two fetched instructions discarded each), including the displayed cycle', fwd: 'operands forwarded into EX from EX/MEM or MEM/WB, including the displayed cycle',
    };
    const counter = (k, key, cls = '') => { const v = el('span', { class: 'v ' + cls }, '0'); this.counters[key] = v; return el('div', { class: 'counter', title: TITLES[key] }, el('span', { class: 'k' }, k), v); };
    this.timeline = el('canvas', { class: 'timeline', width: 440, height: 40, title: 'last 160 cycles: stalls (magenta), flushes (red), forwards (amber), writes (green). Click to revisit.' });
    this.timeline.addEventListener('click', (e) => {
      const r = this.timeline.getBoundingClientRect();
      const i = Math.floor((e.clientX - r.left) / r.width * 160);
      const c = this.session.core.cycle - 159 + i;
      if (c >= 0 && c < this.session.core.cycle) this.opts.onSeek(c);
    });
    this.msg = el('span', { class: 'msg' });
    this.gateChip = el('span', { class: 'chip', title: 'The synthesized gate-level netlist is simulated alongside; its memory-port outputs are compared with the behavioural model every cycle.' }, el('span', { class: 'dot' }), el('span', { class: 'gt' }, 'gate-level'));
    root.append(el('div', { class: 'transport-inner' },
      el('div', { class: 'group' }, this.btnReset, this.btnBack, this.btnStep, this.btnRun, this.btnEnd),
      el('div', { class: 'speed' }, this.speedSel),
      el('div', { class: 'sep' }),
      el('div', { class: 'counters' }, counter('cycle', 'cycle'), counter('instret', 'instret'), counter('CPI', 'cpi', 'amber'), counter('stalls', 'stalls', 'mag'), counter('flushes', 'flushes', 'red'), counter('forwards', 'fwd')),
      el('div', { class: 'sep' }),
      this.timeline,
      el('div', { class: 'status' }, this.msg, this.gateChip),
    ));
    this.fwdCount = 0;
    this.lastCycleCounted = -1;
  }

  toggleRun() {
    if (this.session.running) this.session.pause();
    else { this.runningSpeed = this.speed; this.session.run(this.speed); }
  }

  update(program) {
    const s = this.session, c = s.core;
    // Only rewrite the button labels when they change: update() runs on every cycle while
    // running, and replacing the label nodes under a pressed pointer loses the click
    // (mousedown target removed before mouseup), so Pause/Stop would not register.
    const runLabel = s.running ? 'Pause' : 'Run';
    if (this.btnRun.firstChild?.nodeValue !== runLabel) { this.btnRun.textContent = runLabel; this.btnRun.append(el('kbd', {}, 'Enter')); }
    this.btnRun.className = 'btn' + (s.running ? ' active' : '');
    const endLabel = s.running ? '■ Stop' : '⏭ To end';
    if (this.btnEnd.textContent !== endLabel) this.btnEnd.textContent = endLabel;
    this.btnStep.disabled = s.running || s.halted;
    this.btnBack.disabled = s.running || !s.canStepBack();
    this.btnRun.disabled = s.halted && !s.running;
    this.btnEnd.disabled = s.halted && !s.running;
    this.counters.cycle.textContent = fmtInt(c.cycle);
    this.counters.instret.textContent = fmtInt(c.instret);
    this.counters.cpi.textContent = c.instret ? (c.cycle / c.instret).toFixed(3) : '—';
    // stalls / flushes / forwards include the displayed cycle, so they agree with
    // the STALL, REDIRECT and FORWARD tags in the diagram; cycle and instret keep
    // the mcycle/minstret convention (counted at the clock edge that ends a cycle).
    const sig = s.signals;
    this.counters.stalls.textContent = fmtInt(c.stalls + (sig.stall ? 1 : 0));
    this.counters.flushes.textContent = fmtInt(c.flushes + ((sig.redirect && !c.idex.halt) ? 1 : 0));
    this.counters.fwd.textContent = fmtInt(this.opts.forwards() + sig.fwd_a_used + sig.fwd_b_used);
    // status message
    let msg;
    if (s.running) msg = el('span', {}, 'running…');
    else if (s.halted) {
      const a0 = c.regs[10];
      msg = el('span', {}, 'halted · a0 = ', el('b', {}, `${hex8(a0)} (${a0 | 0})`),
        program?.expected ? (a0 === program.expected.a0 ? ' · same as the Verilator run' : ` · DIFFERS from the Verilator run (${hex8(program.expected.a0)})`) : '');
    } else if (s.stopReason === 'breakpoint') msg = el('span', {}, `breakpoint at ${hex8(c.idex.pc)} (in EX)`);
    else if (s.stopReason === 'cycle cap') msg = el('span', {}, `stopped at the ${fmtInt(c.cycle)}-cycle cap`);
    else if (c.cycle === 0) msg = el('span', {}, 'reset · pipeline empty · Space steps one cycle');
    else if (s.stopReason === 'initial') msg = el('span', {}, `cycle ${c.cycle} · Space steps, ← steps back, R resets`);
    else msg = el('span', {}, s.stopReason === 'paused' ? 'paused' : s.stopReason === 'seek' ? `jumped to cycle ${fmtInt(c.cycle)}` : s.stopReason === 'step back' ? 'stepped back' : '');
    this.msg.replaceChildren(msg);
    this.msg.title = this.msg.textContent;   // full text when the status is ellipsised
    // gate chip
    const t = this.tracker;
    if (!t) { this.gateChip.className = 'chip'; this.gateChip.querySelector('.gt').textContent = 'gate-level: loading netlist'; }
    else if (t.progress) { this.gateChip.className = 'chip busy'; this.gateChip.querySelector('.gt').textContent = `gate-level replay ${Math.round(100 * (t.progress.at - t.progress.from) / Math.max(1, t.progress.to - t.progress.from))}%`; }
    else if (t.mismatches) { this.gateChip.className = 'chip bad'; this.gateChip.querySelector('.gt').textContent = `gate-level: ${t.mismatches} port mismatches`; }
    else if (t.cycle === c.cycle) { this.gateChip.className = 'chip ok'; this.gateChip.querySelector('.gt').textContent = `gate-level ≡ RTL · ${fmtInt(t.checked)} cycles`; }
    else { this.gateChip.className = 'chip warn'; this.gateChip.querySelector('.gt').textContent = `gate-level at cycle ${fmtInt(Math.max(0, t.cycle))}`; }
    this.drawTimeline();
  }

  drawTimeline() {
    const ctx = this.timeline.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cw0 = this.timeline.clientWidth || 440, ch0 = this.timeline.clientHeight || 40;
    if (this.timeline.width !== Math.round(cw0 * dpr) || this.timeline.height !== Math.round(ch0 * dpr)) { this.timeline.width = Math.round(cw0 * dpr); this.timeline.height = Math.round(ch0 * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = cw0, H = ch0;
    ctx.clearRect(0, 0, W, H);
    const s = this.session, cur = s.core.cycle;
    const x0 = 30;                                     // label column; the bars start to its right so text never sits on them
    const n = 160, cw = (W - x0) / n;
    const colors = { stall: '#e05fa4', flush: '#ef6b6b', fwd: '#f2b544', wb: '#7cd992' };
    for (let i = 0; i < n; i++) {
      const c = cur - (n - 1) + i;
      if (c < 0 || c >= s.logLen) continue;
      const f = s.logFlags(c);
      const x = x0 + Math.floor(i * cw);
      const w = Math.max(1, Math.ceil(cw) - 1);
      const lh = (H - 4) / 4;
      if (f & (1 << 7)) { ctx.fillStyle = colors.stall; ctx.fillRect(x, 2, w, lh - 1); }
      if (f & (1 << 6)) { ctx.fillStyle = colors.flush; ctx.fillRect(x, 2 + lh, w, lh - 1); }
      if (f & (3 << 8)) { ctx.fillStyle = colors.fwd; ctx.fillRect(x, 2 + 2 * lh, w, lh - 1); }
      if (f & (1 << 10)) { ctx.fillStyle = colors.wb; ctx.fillRect(x, 2 + 3 * lh, w, lh - 1); }
    }
    ctx.fillStyle = 'rgba(231,229,223,0.6)';
    ctx.fillRect(W - Math.ceil(cw), 0, 1, H);
    ctx.font = '9px "Geist Variable", system-ui, sans-serif'; ctx.fillStyle = '#9a978f'; ctx.textBaseline = 'middle';
    const lh2 = (H - 4) / 4;
    ['stall', 'flush', 'fwd', 'wb'].forEach((l, i) => ctx.fillText(l, 3, 2 + lh2 * (i + 0.5)));
    ctx.textBaseline = 'alphabetic';
  }
}
