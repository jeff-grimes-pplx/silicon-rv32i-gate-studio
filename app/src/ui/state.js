// Register file, memory window and the hazard/event log.
import { el, hex8, hex, fmtInt } from './format.js';
import { ABI } from '../isa.js';
import { disasm } from '../disasm.js';
import { FWD, SiliconCore } from '../core.js';

export class RegsPanel {
  constructor(root, session) {
    this.session = session;
    root.append(el('div', { class: 'panel-head' }, el('span', { class: 'label' }, 'Registers'), el('span', { class: 'spacer' }), el('span', { class: 'hint' }, 'ABI name · hex')));
    this.grid = el('div', { class: 'regs-grid' });
    this.cells = [];
    for (let i = 0; i < 32; i++) {
      // column-major so x0..x7 are the first column
      const c = el('div', { class: 'reg' + (i === 0 ? ' zero' : ''), title: `x${i}` }, el('span', { class: 'rn' }, `x${i}`), el('span', { class: 'ra' }, ABI[i]), el('span', { class: 'rv' }, '00000000'));
      this.cells.push(c);
    }
    this.grid.append(...this.cells);  // column-major placement is done by the CSS grid (grid-auto-flow: column)
    this.foot = el('div', { class: 'regs-foot' });
    root.append(el('div', { class: 'panel-body' }, this.grid), this.foot);
    this.prev = new Uint32Array(32);
  }
  update() {
    const { core, signals: s } = this.session;
    const rs1 = core.ifid.valid && s.id.uses_rs1 ? s.id.rs1 : -1;
    const rs2 = core.ifid.valid && s.id.uses_rs2 ? s.id.rs2 : -1;
    const pending = new Set();
    if (core.idex.valid && core.idex.reg_write && core.idex.rd) pending.add(core.idex.rd);
    if (core.exmem.valid && core.exmem.reg_write && core.exmem.rd) pending.add(core.exmem.rd);
    for (let i = 0; i < 32; i++) {
      const v = core.regs[i];
      const c = this.cells[i];
      c.children[2].textContent = hex8(v);
      c.title = `x${i} ${ABI[i]} = ${hex8(v)} = ${v} (signed ${v | 0})`;
      let cls = 'reg' + (i === 0 ? ' zero' : '');
      if (s.wb_we && s.wb_rd === i) cls += ' wrote';
      else if (v !== this.prev[i]) cls += ' changed';
      if (i === rs1) cls += ' read-rs1';
      if (i === rs2) cls += ' read-rs2';
      if (pending.has(i)) cls += ' pending-wb';
      if (i === 10 && core.halted) cls += ' result';   // a0 holds the program's return value once the core has halted
      c.className = cls;
    }
    this.prev.set(core.regs);
    this.foot.replaceChildren(
      el('span', {}, 'pc ', el('b', {}, hex8(core.pc))),
      el('span', {}, core.halted ? `halted · a0 = ${core.regs[10]} (result)` : s.wb_we ? `writing ${ABI[s.wb_rd]} this cycle` : 'no write this cycle'),
      el('span', {}, pending.size ? `pending: ${[...pending].map(i => ABI[i]).join(' ')}` : ''),
    );
  }
}

export class MemoryPanel {
  constructor(root, session) {
    this.session = session;
    this.base = 0;
    this.bytesPerRow = 16;
    this.rows = 10;
    this.follow = true;
    this.input = el('input', { type: 'text', 'aria-label': 'Memory address (hex)', value: '0000', onchange: () => { this.follow = false; this.goto(parseInt(this.input.value, 16) || 0); } });
    this.symSel = el('select', { 'aria-label': 'Jump to symbol', onchange: () => { if (this.symSel.value !== '') { this.follow = false; this.goto(parseInt(this.symSel.value)); } } });
    this.followBtn = el('button', { class: 'btn active', title: 'Follow the most recent access', onclick: () => { this.follow = !this.follow; this.followBtn.className = 'btn' + (this.follow ? ' active' : ''); this.update(); } }, 'follow');
    root.append(el('div', { class: 'panel-head mem-head' }, el('span', { class: 'label' }, 'Memory'), this.input, this.symSel, el('span', { class: 'spacer' }), this.followBtn));
    this.dump = el('div', { class: 'mem-dump', 'aria-live': 'off' });
    this.dump.addEventListener('wheel', (e) => { e.preventDefault(); this.follow = false; this.followBtn.className = 'btn'; this.goto(this.base + Math.sign(e.deltaY) * this.bytesPerRow * 2); }, { passive: false });
    this.body = el('div', { class: 'panel-body' }, this.dump);
    this.foot = el('div', { class: 'mem-foot' });
    root.append(this.body, this.foot);
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this.body);
  }
  setProgram(p) {
    this.symSel.replaceChildren(el('option', { value: '' }, 'symbol…'));
    this.symSel.append(el('option', { value: 0 }, 'text (0x0)'));
    const dataSyms = p.symbols.filter(s => s.addr >= p.textSize || /^[dDbBrR]$/.test(s.type)).sort((a, b) => a.addr - b.addr);
    for (const s of dataSyms) this.symSel.append(el('option', { value: s.addr }, `${s.name} (0x${s.addr.toString(16)})`));
    this.symbols = p.symbols;
    this.follow = true; this.followBtn.className = 'btn active';
    this.goto(p.dataStart < p.dataEnd ? p.dataStart & ~15 : 0);
  }
  layout() {
    const w = this.body.clientWidth, h = this.body.clientHeight;
    this.bytesPerRow = w >= 520 ? 16 : 8;
    const lh = parseFloat(getComputedStyle(this.dump).lineHeight) || 20;
    this.rows = Math.max(4, Math.floor((h - 8) / lh));
    this.update();
  }
  goto(addr) {
    const max = this.session.mem.size - this.bytesPerRow * this.rows;
    this.base = Math.max(0, Math.min(addr & ~(this.bytesPerRow - 1), max & ~(this.bytesPerRow - 1)));
    this.input.value = hex(this.base, 4);
    this.update();
  }
  update() {
    const { mem, core, signals: s, lastWrite } = this.session;
    const access = core.exmem.valid && (core.exmem.mem_read || core.exmem.mem_write) ? (core.exmem.alu & ~3) >>> 0 : -1;
    if (this.follow) {
      const target = access >= 0 ? access : lastWrite ? lastWrite.addr : -1;
      if (target >= 0 && (target < this.base || target >= this.base + this.bytesPerRow * this.rows)) {
        const max = mem.size - this.bytesPerRow * this.rows;
        this.base = Math.max(0, Math.min((target - this.bytesPerRow * Math.floor(this.rows / 3)) & ~(this.bytesPerRow - 1), max));
        this.input.value = hex(this.base, 4);
      }
    }
    const symAt = new Map(); for (const sy of this.symbols || []) if (!symAt.has(sy.addr)) symAt.set(sy.addr, sy.name);
    const wBytes = new Set();
    if (lastWrite) for (let b = 0; b < 4; b++) if (lastWrite.be & (1 << b)) wBytes.add(lastWrite.addr + b);
    const rBytes = new Set();
    if (access >= 0) { const n = core.exmem.funct3 & 3; const off = core.exmem.alu & 3; const cnt = n === 2 ? 4 : n === 1 ? 2 : 1; for (let b = 0; b < cnt; b++) rBytes.add((n === 2 ? access : core.exmem.alu) + b); }
    let html = '';
    for (let r = 0; r < this.rows; r++) {
      const a = this.base + r * this.bytesPerRow;
      if (a >= mem.size) break;
      let hexs = '', asc = '';
      for (let i = 0; i < this.bytesPerRow; i++) {
        const addr = a + i;
        const byte = (mem.words[addr >>> 2] >>> ((addr & 3) * 8)) & 0xff;
        const cls = wBytes.has(addr) ? 'w' : rBytes.has(addr) ? 'r' : byte === 0 ? 'z' : '';
        const hx = byte.toString(16).padStart(2, '0');
        hexs += (i === 8 ? ' ' : '') + (cls ? `<span class="${cls}">${hx}</span>` : hx) + ' ';
        const ch = byte >= 32 && byte < 127 ? (byte === 60 ? '&lt;' : byte === 62 ? '&gt;' : byte === 38 ? '&amp;' : String.fromCharCode(byte)) : '·';
        asc += cls === 'w' || cls === 'r' ? `<span class="${cls}">${ch}</span>` : ch;
      }
      const labels = [];
      for (let i = 0; i < this.bytesPerRow; i++) if (symAt.has(a + i)) labels.push(symAt.get(a + i));
      html += `<span class="a">${hex(a, 5)}</span>  ${hexs} <span class="as">${asc}</span>${labels.length ? `  <span class="sym">${labels.join(' ')}</span>` : ''}\n`;
    }
    this.dump.innerHTML = html;
    this.foot.replaceChildren(
      el('span', {}, lastWrite ? ['last write ', el('b', {}, hex8(lastWrite.addr)), ` ← ${hex8(lastWrite.data)} · c${fmtInt(lastWrite.cycle)}`] : 'no writes yet'),
      el('span', {}, access >= 0 ? `${core.exmem.mem_write ? 'storing to' : 'loading from'} ${hex8(core.exmem.alu)} this cycle` : ''),
    );
  }
}

// Hazard / event log derived from each cycle's signals
export class EventsPanel {
  constructor(root, session, onSeek) {
    this.session = session;
    this.onSeek = onSeek;
    this.events = [];
    this.max = 400;
    root.append(el('div', { class: 'panel-head' }, el('span', { class: 'label' }, 'Hazards & events'), el('span', { class: 'spacer' }), el('span', { class: 'hint' }, 'click to revisit a cycle')));
    this.list = el('div', { class: 'events' });
    root.append(el('div', { class: 'panel-body' }, this.list));
    this.lastCycle = -1;
    this.symbols = new Map();
  }
  reset() { this.events = []; this.lastCycle = -1; this.list.replaceChildren(); }
  setSymbols(m) { this.symbols = m; }
  // record the events of the current cycle (called for every stepped cycle during slow runs/steps)
  record() {
    const c = this.session.core.cycle;
    if (c <= this.lastCycle) { this.events = this.events.filter(e => e.cycle < c); }
    this.lastCycle = c;
    this.pushEvents(this.session.core, this.session.signals, c);
  }
  // after a fast run the intermediate cycles were not recorded: rebuild the most
  // recent ones from the session's snapshot history (combinational signals are
  // re-derived from each snapshot; memory read data is not needed for events)
  rebuildRecent(n = 200) {
    const ses = this.session, cur = ses.core.cycle;
    if (!ses.history.length) return;
    const from = Math.max(ses.histStart, cur - n, this.lastCycle + 1);
    if (from >= cur) return;
    if (!this.scratch) this.scratch = new SiliconCore(ses.mem);
    this.events = this.events.filter(e => e.cycle < from);
    for (let c = from; c < cur; c++) {
      const h = ses.history[c - ses.histStart]; if (!h) continue;
      this.scratch.restore(h.snapshot);
      this.pushEvents(this.scratch, this.scratch.comb(), c);
    }
    this.lastCycle = cur - 1;
  }
  pushEvents(core, s, c) {
    const dis = (w, pc) => disasm(w, pc, this.symbols).text;
    const ev = [];
    if (s.fwd_a_used || s.fwd_b_used) {
      const parts = [];
      if (s.fwd_a_used) parts.push(`${ABI[core.idex.rs1]} ← ${s.fwd_a_sel === FWD.MEM ? 'EX/MEM' : 'MEM/WB'}`);
      if (s.fwd_b_used) parts.push(`${ABI[core.idex.rs2]} ← ${s.fwd_b_sel === FWD.MEM ? 'EX/MEM' : 'MEM/WB'}`);
      ev.push({ kind: 'fwd', label: 'FWD', text: `<b>${dis(core.idex.instr, core.idex.pc)}</b> ${parts.join(', ')}` });
    }
    if (s.stall) ev.push({ kind: 'stall', label: 'STALL', text: `<b>${dis(core.ifid.instr, core.ifid.pc)}</b> waits for load into ${ABI[core.idex.rd]}` });
    if (s.redirect && !core.idex.halt) {
      const killed = (core.ifid.valid ? 1 : 0) + 1;
      ev.push({ kind: 'flush', label: 'FLUSH', text: `<b>${dis(core.idex.instr, core.idex.pc)}</b> → ${hex8(s.redirect_target)}, ${killed} fetched instruction${killed > 1 ? 's' : ''} discarded` });
    }
    if (s.id_bypass_rs1 || s.id_bypass_rs2) ev.push({ kind: 'byp', label: 'BYPASS', text: `<b>${dis(core.ifid.instr, core.ifid.pc)}</b> reads ${ABI[s.wb_rd]} straight from WB` });
    if (s.dmem_we) ev.push({ kind: 'mem', label: 'STORE', text: `<b>${dis(core.exmem.instr, core.exmem.pc)}</b> [${hex8(s.dmem_addr)}] ← ${hex8(s.dmem_wdata)} be=${s.dmem_be.toString(2).padStart(4, '0')}` });
    if (core.memwb.valid && core.memwb.halt) ev.push({ kind: 'halt', label: 'HALT', text: `<b>${dis(core.memwb.instr, core.memwb.pc)}</b> retires; core halts` });
    for (const e of ev) this.events.push({ cycle: c, ...e });
    if (this.events.length > this.max) this.events.splice(0, this.events.length - this.max);
  }
  render() {
    const cur = this.session.core.cycle;
    const frag = document.createDocumentFragment();
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      const row = el('div', { class: `ev ${e.kind}` + (e.cycle === cur ? ' cur' : ''), onclick: () => this.onSeek(e.cycle) }, el('span', { class: 'c' }, `c${fmtInt(e.cycle)}`), el('span', { class: 'k' }, e.label), el('span', { class: 't', html: e.text }));
      frag.append(row);
    }
    this.list.replaceChildren(frag);
  }
}
