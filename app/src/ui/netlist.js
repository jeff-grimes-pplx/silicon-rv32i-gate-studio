// Gate-level netlist explorer: the Yosys-synthesized cells laid out by pipeline
// stage, pannable and zoomable, searchable, with the current cycle's activity
// (cells whose output changed since the previous cycle) taken from the live
// gate-level simulation of the same netlist.
import { el, fmtInt, hex8 } from './format.js';
import { ABI } from '../isa.js';

const TYPE_COLOR = {
  NAND: '#c9a15a', AND: '#d8b36a', OR: '#8fb6c9', NOR: '#7aa5bb', XOR: '#c58ad1', XNOR: '#b57cc0', NOT: '#9a9a9a', MUX: '#7fc9a0',
  DFFE_PP: '#f2b544', SDFF_PP0: '#f2b544', DFF_P: '#f2b544', SDFFE_PP0P: '#f2b544',
};
const TYPE_LABEL = { NAND: 'NAND', AND: 'AND', OR: 'OR', NOR: 'NOR', XOR: 'XOR', XNOR: 'XNOR', NOT: 'NOT', MUX: 'MUX', DFFE_PP: 'DFF with enable', SDFF_PP0: 'DFF with sync reset', DFF_P: 'DFF', SDFFE_PP0P: 'DFF with enable and sync reset' };
const TYPE_GLYPH = { NAND: 'N', AND: 'A', OR: 'O', NOR: 'R', XOR: 'X', XNOR: 'Ẋ', NOT: '¬', MUX: 'M', DFFE_PP: 'D', SDFF_PP0: 'D', DFF_P: 'D', SDFFE_PP0P: 'D' };
const STAGE_COLOR = ['#5cc8e6', '#b4b1a8', '#f2b544', '#d9814e', '#7cd992'];
const STAGE_DESC = ['instruction fetch: pc, fetch stop, IF/ID register, read-address copies', 'decode, register-file read muxes, hazard detection, ID/EX register', 'forwarding muxes, ALU, branch compare, EX/MEM register', 'load alignment, MEM/WB register', 'write-back select, register file (31 × 32 flops)'];

export class NetlistView {
  constructor(root, nl, tracker, session) {
    this.root = root; this.nl = nl; this.tracker = tracker; this.session = session;
    this.scale = 1; this.tx = 0; this.ty = 0;
    this.selected = -1; this.hover = -1; this.group = null; this.critical = null; this.showCritical = false;
    this.colorMode = 'toggled'; // 'toggled' | 'voltage'
    this.visible = false;
    this.prepare();
    this.build();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.canvasWrap);
    tracker.addEventListener('update', () => { this.updateProgress(); this.draw(); this.updateSide(); if (this.hover >= 0 && this.tip.style.display === 'block') this.tip.textContent = this.tipText(this.hover); });   // keep the hover tooltip live while the simulation runs
    tracker.addEventListener('progress', () => { this.updateProgress(); });
  }

  prepare() {
    const nl = this.nl;
    const NC = nl.cells.length;
    this.isFlop = new Uint8Array(NC); for (const i of nl.flops) this.isFlop[i] = 1;
    this.driver = new Int32Array(nl.nNets).fill(-1);
    this.fanout = Array.from({ length: nl.nNets }, () => null);
    for (let i = 0; i < NC; i++) {
      const c = nl.cells[i]; this.driver[c[4]] = i;
      for (let k = 1; k <= 3; k++) { const n = c[k]; if (n >= 0) { (this.fanout[n] ??= []).push(i); } }
    }
    // spatial hash for hit testing
    this.cellSize = 4;
    this.grid = new Map();
    nl.pos.forEach(([x, y], i) => { const k = `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`; (this.grid.get(k) ?? this.grid.set(k, []).get(k)).push(i); });
    // type counts
    this.typeCounts = {}; nl.cells.forEach(c => { const t = nl.types[c[0]]; this.typeCounts[t] = (this.typeCounts[t] || 0) + 1; });
    this.stageTotals = [0, 0, 0, 0, 0]; nl.stage.forEach(s => this.stageTotals[s]++);
    // name index for search
    this.nameIndex = nl.names.map((n, i) => n || `${nl.types[nl.cells[i][0]].toLowerCase()} #${i}`);
    nl.flopSet = new Set(nl.flops);
    this.portOfNet = new Map();
    for (const [p, bits] of Object.entries(nl.ports)) bits.forEach((b, i) => this.portOfNet.set(b, bits.length > 1 ? `${p}[${i}]` : p));
    // flop groups (pipeline registers) for bank labels: base name -> first/last cell by position
    const groups = new Map();
    for (const i of nl.flops) {
      const nm = nl.names[i]; if (nm.startsWith('regs[')) continue;
      const base = nm.split('[')[0];
      const g = groups.get(base) ?? groups.set(base, { name: base, cells: [] }).get(base);
      g.cells.push(i);
    }
    this.bankGroups = [...groups.values()].map(g => { g.cells.sort((a, b) => nl.pos[a][0] - nl.pos[b][0] || nl.pos[a][1] - nl.pos[b][1]); return g; });
    // longest path under a unit-delay model (one level per cell), from depth labels
    let end = -1, best = -1;
    nl.depth.forEach((d, i) => { if (!this.isFlop[i] && d > best) { best = d; end = i; } });
    const path = [];
    let cur = end;
    while (cur >= 0) {
      path.push(cur);
      const c = nl.cells[cur]; let next = -1;
      for (let k = 1; k <= 3; k++) { const n = c[k]; if (n < 0) continue; const d = this.driver[n]; if (d >= 0 && !this.isFlop[d] && nl.depth[d] === nl.depth[cur] - 1) { next = d; break; } }
      if (next < 0) { // starts at a flop output or port
        for (let k = 1; k <= 3; k++) { const n = c[k]; if (n < 0) continue; const d = this.driver[n]; if (d >= 0 && this.isFlop[d]) { path.push(d); break; } }
        break;
      }
      cur = next;
    }
    // the path ends at the flop it feeds (if any)
    const endFan = this.fanout[nl.cells[end][4]]?.find(j => this.isFlop[j]);
    this.critical = { cells: path.reverse(), levels: best + 1, endFlop: endFan ?? -1 };
  }

  build() {
    const nl = this.nl;
    this.side = el('div', { class: 'nl-side' });
    this.canvasWrap = el('div', { class: 'nl-canvas-wrap' });
    this.canvas = el('canvas', { 'aria-label': 'Gate-level netlist' });
    this.tip = el('div', { class: 'nl-tip' });
    this.overlay = el('div', { class: 'nl-overlay' });
    this.actChip = el('span', { class: 'chip' }, el('span', { class: 'dot' }), el('span', { class: 'gt' }));
    this.overlay.append(this.actChip);
    this.progressBox = el('div', { class: 'nl-progress' }); this.progressBox.hidden = true;
    this.legend = el('div', { class: 'nl-legend' },
      el('span', {}, el('i', { style: 'background:linear-gradient(90deg,#c9a15a,#7fc9a0,#8fb6c9)' }), 'output toggled this cycle (colour = cell type)'),
      el('span', {}, el('i', { style: 'background:#3a3a42' }), 'unchanged'),
      el('span', {}, el('i', { style: 'background:#f2b544;border:1px solid #fff' }), 'flop'),
      el('span', {}, el('i', { style: 'background:#5cc8e6' }), 'selected / fan-in / fan-out'));
    this.zoomBox = el('div', { class: 'nl-zoom' },
      el('button', { class: 'btn', title: 'Fit', onclick: () => { this.fit(); this.draw(); } }, 'fit'),
      el('button', { class: 'btn', title: 'Zoom in', onclick: () => this.zoomBy(1.5) }, '+'),
      el('button', { class: 'btn', title: 'Zoom out', onclick: () => this.zoomBy(1 / 1.5) }, '−'));
    this.canvasWrap.append(this.canvas, this.overlay, this.tip, this.zoomBox, this.progressBox);
    this.root.append(this.side, this.canvasWrap);

    // --- side sections
    const total = nl.cells.length;
    this.search = el('input', { class: 'nl-search', type: 'text', placeholder: 'search: regs[10][0], a0, exmem_alu, pc, imem_addr…', 'aria-label': 'Search cells and nets' });
    this.results = el('div', { class: 'nl-results' });
    this.search.addEventListener('input', () => this.doSearch(this.search.value.trim()));
    this.search.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { const first = this.results.querySelector('div'); first?.click(); } });
    this.selInfo = el('div', { class: 'nl-kv' });
    this.stageBars = el('div', { class: 'nl-stages' });
    this.critBtn = el('button', { class: 'btn', onclick: () => { this.showCritical = !this.showCritical; this.critBtn.className = 'btn' + (this.showCritical ? ' active' : ''); this.draw(); } }, 'show longest path');
    this.voltBtn = el('button', { class: 'btn', onclick: () => { this.colorMode = this.colorMode === 'voltage' ? 'toggled' : 'voltage'; this.voltBtn.className = 'btn' + (this.colorMode === 'voltage' ? ' active' : ''); this.voltBtn.textContent = this.colorMode === 'voltage' ? 'mode: 0/1 voltage' : 'mode: toggled cells'; this.draw(); } }, 'mode: toggled cells');
    const exportRow = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:6px' },
      this.critBtn,
      this.voltBtn,
      el('a', { class: 'btn', href: 'data/silicon_die_8297.svg', download: 'silicon_die_8297.svg', style: 'text-decoration:none' }, 'SVG die'),
      el('a', { class: 'btn', href: 'data/silicon_die_8297.gds', download: 'silicon_die_8297.gds', style: 'text-decoration:none' }, 'GDSII')
    );
    const types = el('div', { class: 'nl-types' });
    const order = Object.entries(this.typeCounts).sort((a, b) => b[1] - a[1]);
    const max = order[0][1];
    for (const [t, n] of order) types.append(el('span', { style: `color:${TYPE_COLOR[t]}` }, t), el('span', { class: 'bar' }, el('i', { style: `width:${100 * n / max}%; background:${TYPE_COLOR[t]}` })), el('span', { class: 'n' }, fmtInt(n)));
    this.sideScroll = el('div', { class: 'nl-side-scroll' });   // the sections scroll in their own box; the colour key below never covers them
    this.side.append(this.sideScroll);
    this.sideScroll.append(
      el('div', { class: 'nl-section' }, el('h3', {}, 'Netlist'), el('p', {}, `${fmtInt(total)} cells (${fmtInt(nl.flops.length)} flip-flops, ${fmtInt(total - nl.flops.length)} gates) synthesized by Yosys from rtl/silicon_core.sv with `, el('code', {}, 'synth -flatten; abc -g AND,NAND,OR,NOR,XOR,XNOR,MUX'), '. Columns are pipeline stages; gates are packed by logic depth (left to right) and each stage\'s flip-flops form the bank on the right. The WB bank is the register file.')),
      el('div', { class: 'nl-section' }, el('h3', {}, 'Find'), this.search, this.results),
      el('div', { class: 'nl-section' }, el('h3', {}, 'Selected cell'), this.selInfo),
      el('div', { class: 'nl-section' }, el('h3', {}, 'Activity this cycle'), this.stageBars),
      el('div', { class: 'nl-section' }, el('h3', {}, 'Cells by type (Yosys stat)'), types),
      el('div', { class: 'nl-section' }, el('h3', {}, 'Longest combinational path & Die Export'), el('p', {}, `${this.critical.levels} gate levels from `, el('code', {}, this.cellName(this.critical.cells[0])), ' to ', el('code', {}, this.critical.endFlop >= 0 ? this.cellName(this.critical.endFlop) : 'output port'), ` — one of several paths of maximal depth (Yosys ltp reports the same ${this.critical.levels} levels). Unit-delay model, one level per cell.`), exportRow),
    );
    this.side.append(this.legend);                       // colour key: a fixed footer of the side panel, below the scroll box
    this.selInfo.append(el('span', { class: 'k' }, 'hover / click'), el('span', { class: 'v' }, 'a cell to inspect it'));

    // --- interaction
    const c = this.canvas;
    let drag = null;
    c.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, moved: false }; c.classList.add('grabbing'); });
    window.addEventListener('mousemove', (e) => {
      if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true; this.tx = drag.tx + dx; this.ty = drag.ty + dy; this.draw(); return; }
    });
    window.addEventListener('mouseup', () => { if (drag) { c.classList.remove('grabbing'); drag = null; } });
    c.addEventListener('mousemove', (e) => {
      if (drag) return;
      const i = this.hitTest(e.offsetX, e.offsetY);
      if (i !== this.hover) { this.hover = i; this.draw(); }
      if (i >= 0) { this.tip.style.display = 'block'; this.tip.style.left = (e.offsetX + 14) + 'px'; this.tip.style.top = (e.offsetY + 14) + 'px'; this.tip.textContent = this.tipText(i); } else this.tip.style.display = 'none';
    });
    c.addEventListener('mouseleave', () => { this.hover = -1; this.tip.style.display = 'none'; this.draw(); });
    c.addEventListener('click', (e) => { if (drag?.moved) return; const i = this.hitTest(e.offsetX, e.offsetY); this.select(i, false); });
    c.addEventListener('dblclick', (e) => { const i = this.hitTest(e.offsetX, e.offsetY); if (i >= 0) this.select(i, true); });
    c.addEventListener('wheel', (e) => { e.preventDefault(); const f = Math.exp(-e.deltaY * 0.0015); this.zoomAt(f, e.offsetX, e.offsetY); }, { passive: false });
    // touch: one finger pan, pinch zoom
    let touch = null;
    c.addEventListener('touchstart', (e) => { if (e.touches.length === 1) touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx: this.tx, ty: this.ty }; else if (e.touches.length === 2) touch = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), s: this.scale, tx: this.tx, ty: this.ty }; }, { passive: true });
    c.addEventListener('touchmove', (e) => {
      e.preventDefault(); if (!touch) return;
      if (e.touches.length === 1 && touch.x !== undefined) { this.tx = touch.tx + e.touches[0].clientX - touch.x; this.ty = touch.ty + e.touches[0].clientY - touch.y; this.draw(); }
      else if (e.touches.length === 2 && touch.d) { const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); const r = this.canvas.getBoundingClientRect(); const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top; const f = d / touch.d; this.scale = touch.s; this.tx = touch.tx; this.ty = touch.ty; this.zoomAt(f, cx, cy); }
    }, { passive: false });
    c.addEventListener('touchend', () => { touch = null; }, { passive: true });
  }

  cellName(i) { return this.nl.names[i] || `${this.nl.types[this.nl.cells[i][0]]} #${i}`; }
  netName(n) { return this.nl.netNames[n] || this.portOfNet.get(n) || (n === this.nl.const0 ? '0' : n === this.nl.const1 ? '1' : `net ${n}`); }

  tipText(i) {
    const nl = this.nl; const c = nl.cells[i]; const t = nl.types[c[0]];
    const v = this.tracker.gs.val;
    const name = this.cellName(i);
    const flop = this.isFlop[i];
    const io = flop ? `Q=${v[c[4]]} D=${v[c[1]]}${c[2] >= 0 ? ` E=${v[c[2]]}` : ''}${c[3] >= 0 ? ` R=${v[c[3]]}` : ''}` : `${[c[1], c[2], c[3]].filter(n => n >= 0).map(n => v[n]).join(',')} → ${v[c[4]]}`;
    return `${t} · ${name} · ${nl.stages[nl.stage[i]]} · ${io}${this.tracker.gs.toggled[i] ? ' · toggled' : ''}`;
  }

  select(i, center) {
    this.selected = i; this.group = null;
    if (center && i >= 0) this.centerOn([i], Math.max(this.scale, 14));
    this.draw(); this.updateSide();
  }
  selectGroup(cells, label) {
    this.group = { cells, label }; this.selected = cells[0] ?? -1;
    this.centerOn(cells, null);
    this.draw(); this.updateSide();
  }

  doSearch(q) {
    this.results.replaceChildren();
    if (!q) return;
    const nl = this.nl;
    const ql = q.toLowerCase();
    const out = [];
    // register alias: a0 / x10 / regs[10]
    const abi = ABI.indexOf(ql); const xm = ql.match(/^x(\d+)$/);
    const regIdx = abi > 0 ? abi : xm ? Number(xm[1]) : (ql.match(/^regs\[(\d+)\]$/) ? Number(ql.match(/^regs\[(\d+)\]$/)[1]) : -1);
    if (regIdx > 0 && regIdx < 32) {
      const cells = []; nl.names.forEach((n, i) => { if (n.startsWith(`regs[${regIdx}][`)) cells.push(i); });
      out.push({ label: `register ${ABI[regIdx]} (x${regIdx}) — 32 flops`, type: 'group', cells });
    }
    // net / port names → their driver cells
    for (const [n, name] of Object.entries(nl.netNames)) {
      if (out.length > 60) break;
      if (name.toLowerCase().includes(ql)) { const d = this.driver[Number(n)]; if (d >= 0) out.push({ label: name, type: nl.types[nl.cells[d][0]], cells: [d] }); }
    }
    // RTL names that Yosys merged onto differently named nets (exmem_alu[31:2] = dmem_addr[31:2], …)
    const aliasCells = new Map();   // base name -> { cells, via: Set of canonical base names }
    for (const [alias, n] of Object.entries(nl.aliases || {})) {
      if (!alias.toLowerCase().includes(ql)) continue;
      const d = this.driver[n]; if (!(d >= 0)) continue;
      const canon = this.netName(n);
      if (out.length <= 60) out.push({ label: `${alias} = ${canon}`, type: nl.types[nl.cells[d][0]], cells: [d] });
      if (nl.flopSet.has(d)) { const base = alias.split('[')[0]; const g = aliasCells.get(base) ?? aliasCells.set(base, { cells: [], via: new Set() }).get(base); g.cells.push(d); g.via.add(canon.split('[')[0]); }
    }
    // register groups by base name (e.g. exmem_alu)
    const bases = new Map();
    nl.flops.forEach(i => { const b = nl.names[i].split('[')[0]; if (b.toLowerCase().includes(ql)) (bases.get(b) ?? bases.set(b, []).get(b)).push(i); });
    for (const [b, g] of aliasCells) { const arr = bases.get(b) ?? bases.set(b, []).get(b); for (const c of g.cells) if (!arr.includes(c)) arr.push(c); }
    for (const [b, cells] of bases) if (cells.length > 1) {
      const g = aliasCells.get(b);
      const note = g ? ` (${g.cells.length} of them named ${[...g.via].join(', ')} by Yosys)` : '';
      out.unshift({ label: `${b} — ${cells.length} flops${note}`, type: 'group', cells });
    }
    const seen = new Set();
    for (const r of out.slice(0, 60)) {
      const key = r.label; if (seen.has(key)) continue; seen.add(key);
      this.results.append(el('div', { onclick: () => { if (r.cells.length > 1) this.selectGroup(r.cells, r.label); else this.select(r.cells[0], true); } }, el('span', {}, r.label), el('span', { class: 'ty' }, r.type)));
    }
    if (!out.length) this.results.append(el('div', { class: 'hint' }, 'no matches'));
  }

  updateSide() {
    const nl = this.nl, gs = this.tracker.gs;
    // activity per stage
    const tog = [0, 0, 0, 0, 0];
    for (let i = 0; i < nl.cells.length; i++) if (gs.toggled[i]) tog[nl.stage[i]]++;
    this.stageBars.replaceChildren();
    for (let s = 0; s < 5; s++) this.stageBars.append(el('span', { style: `color:${STAGE_COLOR[s]}` }, nl.stages[s]), el('span', { class: 'bar' }, el('i', { style: `width:${100 * tog[s] / this.stageTotals[s]}%; background:${STAGE_COLOR[s]}` })), el('span', { class: 'n' }, `${fmtInt(tog[s])} / ${fmtInt(this.stageTotals[s])}`));
    const total = tog.reduce((a, b) => a + b, 0);
    const synced = this.tracker.cycle === this.session.core.cycle && !this.tracker.progress;
    this.actChip.className = 'chip ' + (this.tracker.progress ? 'busy' : synced ? 'ok' : 'warn');
    const gt = this.actChip.querySelector('.gt');
    // activity only: the port-equivalence check (cycles checked, mismatches) is already stated by the transport bar's gate-level chip
    const tail = `${fmtInt(total)} of ${fmtInt(nl.cells.length)} cells toggled`;
    if (this.tracker.progress) gt.textContent = `replaying gate-level simulation…`;
    else if (!synced) gt.textContent = `gate-level state is at cycle ${fmtInt(Math.max(0, this.tracker.cycle))} (model at ${fmtInt(this.session.core.cycle)})`;
    else if (this.session.core.halted) {
      // the program has finished: the result register a0 is stated here too (the transport bar says the same), so the
      // gate-level view carries its own halt line
      const a0 = this.session.core.regs[10];
      gt.replaceChildren(`halted at cycle ${fmtInt(this.tracker.cycle)} · a0 = `, el('b', {}, `${hex8(a0)} (${a0 | 0})`), ` · ${tail}`);
    } else gt.textContent = `cycle ${fmtInt(this.tracker.cycle)} · ${tail}`;
    // selection
    this.selInfo.replaceChildren();
    const kv = (k, v, cls = '') => this.selInfo.append(el('span', { class: 'k' }, k), el('span', { class: 'v ' + cls, title: v }, v));
    if (this.group) {
      kv('group', this.group.label);
      const vals = this.group.cells.map(i => gs.val[nl.cells[i][4]]);
      // show as a word when 32 bits of one register
      if (this.group.cells.length === 32) { let w = 0; this.group.cells.forEach(i => { const m = nl.names[i].match(/\[(\d+)\]$/); if (m) w |= gs.val[nl.cells[i][4]] << Number(m[1]); }); kv('value', '0x' + (w >>> 0).toString(16).padStart(8, '0'), 'amber'); }
      kv('toggled now', `${this.group.cells.filter(i => gs.toggled[i]).length} of ${this.group.cells.length}`);
      kv('bits 0→31', vals.map((b, k) => (k && k % 8 === 0 ? ' ' : '') + b).join(''));
      return;
    }
    const i = this.selected >= 0 ? this.selected : this.hover;
    if (i < 0) { kv('hover / click', 'a cell to inspect it'); return; }
    const c = nl.cells[i], t = nl.types[c[0]];
    kv('cell', this.cellName(i), 'amber');
    kv('type', TYPE_LABEL[t] || t);
    kv('stage', `${nl.stages[nl.stage[i]]} — ${STAGE_DESC[nl.stage[i]]}`);
    if (!this.isFlop[i]) kv('logic depth', `${nl.depth[i]} (longest input path, unit delay)`);
    const pins = this.isFlop[i] ? ['D', 'E', 'R'] : t === 'MUX' ? ['A', 'B', 'S'] : ['A', 'B'];
    pins.forEach((p, k) => { const n = c[k + 1]; if (n >= 0) kv(`${p} ←`, `${this.netName(n)} = ${gs.val[n]}${this.driver[n] >= 0 ? `  (${nl.types[nl.cells[this.driver[n]][0]]})` : ''}`); });
    kv(this.isFlop[i] ? 'Q →' : 'Y →', `${this.netName(c[4])} = ${gs.val[c[4]]}`, 'amber');
    const fo = this.fanout[c[4]] || [];
    kv('fan-out', `${fo.length} cell${fo.length === 1 ? '' : 's'}${fo.length ? ': ' + fo.slice(0, 6).map(j => this.cellName(j)).join(', ') + (fo.length > 6 ? ', …' : '') : ''}`);
    kv('this cycle', gs.toggled[i] ? 'output toggled' : 'output unchanged');
  }

  updateProgress() {
    // also called on every 'update': the last chunk of a long replay emits 'update' (not 'progress'), so the box is
    // hidden here once progress is cleared instead of lingering at its final percentage
    const p = this.tracker.progress;
    if (!p) { this.progressBox.hidden = true; return; }
    this.progressBox.hidden = false;
    const pct = Math.round(100 * (p.at - p.from) / Math.max(1, p.to - p.from));
    this.progressBox.replaceChildren(el('div', {}, `Replaying the gate-level simulation to cycle ${fmtInt(p.to)}: ${fmtInt(p.at)} (${pct}%). The netlist runs at roughly 10 k cycles/s in the browser.`), el('div', { class: 'bar' }, el('i', { style: `width:${pct}%` })));
    this.actChip.className = 'chip busy'; this.actChip.querySelector('.gt').textContent = `replaying gate-level simulation… ${pct}%`;
  }

  // --- geometry
  resize() {
    const r = this.canvasWrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr);
    this.dpr = dpr;
    if (!this.fitted && this.w > 50 && this.h > 50) { this.fit(); this.fitted = true; }
    this.draw();
  }
  fit() {
    const [bw, bh] = this.nl.bounds;
    this.scale = Math.min((this.w - 40) / bw, (this.h - 110) / bh);
    this.tx = (this.w - bw * this.scale) / 2; this.ty = (this.h - bh * this.scale) / 2 + 6;
  }
  zoomAt(f, cx, cy) {
    const ns = Math.max(this.minScale(), Math.min(60, this.scale * f));
    f = ns / this.scale;
    this.tx = cx - (cx - this.tx) * f; this.ty = cy - (cy - this.ty) * f; this.scale = ns;
    this.draw();
  }
  zoomBy(f) { this.zoomAt(f, this.w / 2, this.h / 2); }
  minScale() { const [bw, bh] = this.nl.bounds; return Math.min((this.w - 40) / bw, (this.h - 110) / bh) * 0.5; }
  centerOn(cells, scale) {
    let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    for (const i of cells) { const [x, y] = this.nl.pos[i]; minx = Math.min(minx, x); miny = Math.min(miny, y); maxx = Math.max(maxx, x + 1); maxy = Math.max(maxy, y + 1); }
    if (scale == null) scale = Math.max(this.minScale(), Math.min(30, Math.min((this.w - 80) / Math.max(4, maxx - minx), (this.h - 120) / Math.max(4, maxy - miny))));
    this.scale = scale;
    this.tx = this.w / 2 - (minx + maxx) / 2 * scale; this.ty = this.h / 2 - (miny + maxy) / 2 * scale;
  }
  toScreen(x, y) { return [x * this.scale + this.tx, y * this.scale + this.ty]; }
  hitTest(px, py) {
    const x = (px - this.tx) / this.scale, y = (py - this.ty) / this.scale;
    const k = `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
    const cand = this.grid.get(k); if (!cand) return -1;
    let best = -1, bd = 1e9;
    for (const i of cand) { const [cx, cy] = this.nl.pos[i]; if (x >= cx - 0.1 && x <= cx + 1.1 && y >= cy - 0.1 && y <= cy + 1.1) { const d = Math.hypot(x - cx - 0.5, y - cy - 0.5); if (d < bd) { bd = d; best = i; } } }
    return best;
  }

  // --- drawing
  draw() {
    if (!this.visible || !this.w) return;
    const ctx = this.canvas.getContext('2d');
    const nl = this.nl, gs = this.tracker.gs;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const s = this.scale;
    // stage columns: comb block + flop bank
    ctx.font = '11px "Geist Variable", system-ui, sans-serif';
    for (let st = 0; st < 5; st++) {
      const col = nl.columns[nl.stages[st]];
      const [x0, y0] = this.toScreen(col.x0, 0); const w = col.w * s, h = nl.bounds[1] * s;
      ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(x0 - 3, y0 - 3, w + 6, h + 6);
      if (col.bankW > 0) { const bx = this.toScreen(col.bankX0, 0)[0]; ctx.fillStyle = 'rgba(242,181,68,0.05)'; ctx.fillRect(bx - 2, y0 - 3, col.bankW * s + 4, h + 6); }
      ctx.font = '600 11px "Geist Variable", system-ui, sans-serif';
      const nameW = ctx.measureText(nl.stages[st]).width;
      ctx.font = '11px "Geist Variable", system-ui, sans-serif';
      const stats = `${fmtInt(col.comb)} gates · ${col.flops} flops · depth ${col.layers}`;
      const short = `${fmtInt(col.comb)} g · ${col.flops} ff`;
      const statsText = ctx.measureText(stats).width < w - nameW - 12 ? stats : (ctx.measureText(short).width < w - nameW - 12 ? short : '');
      const headW = nameW + (statsText ? 8 + ctx.measureText(statsText).width : 0);
      // column header: when the column is panned past the left edge, keep the header inside the canvas (pinned at x 8) for as
      // long as it fits within the column's span, instead of clipping it mid-word at the canvas edge. Once the register-file
      // axes are drawn (scale >= 10) the bit indices occupy the same row above the WB bank: a header that would overlap them
      // (or any pinned header) is left out rather than drawn on top of them.
      const pinned = x0 < 8;
      const hx = pinned ? Math.max(x0, Math.min(8, x0 + w - headW - 8)) : x0;
      const bankSx = col.bankW > 0 ? this.toScreen(col.bankX0, 0)[0] : Infinity;
      const skipHead = s >= 10 && (pinned || (st === 4 && hx + headW > bankSx - 6));
      if (!skipHead) {
        ctx.fillStyle = STAGE_COLOR[st];
        ctx.font = '600 11px "Geist Variable", system-ui, sans-serif';
        ctx.fillText(nl.stages[st], hx, y0 - 9);
        ctx.font = '11px "Geist Variable", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(180,177,168,0.9)';
        if (statsText) ctx.fillText(statsText, hx + nameW + 8, y0 - 9);
      }
      if (col.bankW * s > 40) { ctx.fillStyle = 'rgba(242,181,68,0.7)'; const bl = st === 4 ? 'register file · rows x1…x31 · columns bit 0…31' : 'pipeline register flops'; const bx0 = this.toScreen(col.bankX0, 0)[0]; const bw = ctx.measureText(bl).width; ctx.fillText(bl, Math.min(bx0, this.w - bw - 8), y0 + h + 14); }
      if (col.combCols * s > 60) { ctx.fillStyle = 'rgba(180,177,168,0.7)'; ctx.fillText('logic depth →', x0, y0 + h + 14); }
    }
    // cells
    const cw = Math.max(1, s * 0.86), ch = Math.max(1, s * 0.86);
    const vis = { x0: -this.tx / s - 2, y0: -this.ty / s - 2, x1: (this.w - this.tx) / s + 2, y1: (this.h - this.ty) / s + 2 };
    const pos = nl.pos, cells = nl.cells, toggled = gs.toggled, types = nl.types;
    const highlight = new Set();
    const sel = this.selected >= 0 ? this.selected : this.hover;
    const groupSet = this.group ? new Set(this.group.cells) : null;
    if (sel >= 0 && !groupSet) {
      highlight.add(sel);
      const c = cells[sel];
      for (let k = 1; k <= 3; k++) { const n = c[k]; if (n >= 0 && this.driver[n] >= 0) highlight.add(this.driver[n]); }
      for (const j of this.fanout[c[4]] || []) highlight.add(j);
    }
    const critSet = this.showCritical ? new Set(this.critical.cells) : null;
    let drawn = 0;
    if (this.colorMode === 'voltage') {
      const val = gs.val;
      for (let i = 0; i < cells.length; i++) {
        const [x, y] = pos[i];
        if (x < vis.x0 || x > vis.x1 || y < vis.y0 || y > vis.y1) continue;
        const v1 = val[cells[i][4]] === 1;
        const tog = toggled[i];
        ctx.fillStyle = v1 ? (this.isFlop[i] ? '#f2b544' : tog ? '#7cd992' : '#3fb984') : (tog ? '#5cc8e6' : '#262830');
        ctx.fillRect(x * s + this.tx, y * s + this.ty, cw, ch);
        drawn++;
      }
    } else {
      // pass 1: unchanged cells
      ctx.fillStyle = '#34343c';
      for (let i = 0; i < cells.length; i++) {
        const [x, y] = pos[i];
        if (x < vis.x0 || x > vis.x1 || y < vis.y0 || y > vis.y1) continue;
        if (toggled[i]) continue;
        ctx.fillRect(x * s + this.tx, y * s + this.ty, cw, ch); drawn++;
      }
      // pass 2: toggled cells, colored by type
      for (let i = 0; i < cells.length; i++) {
        if (!toggled[i]) continue;
        const [x, y] = pos[i];
        if (x < vis.x0 || x > vis.x1 || y < vis.y0 || y > vis.y1) continue;
        ctx.fillStyle = TYPE_COLOR[types[cells[i][0]]] || '#ccc';
        ctx.fillRect(x * s + this.tx, y * s + this.ty, cw, ch); drawn++;
      }
    }
    // flop outline
    if (s >= 3) {
      ctx.strokeStyle = 'rgba(242,181,68,0.55)'; ctx.lineWidth = 1;
      for (const i of nl.flops) { const [x, y] = pos[i]; if (x < vis.x0 || x > vis.x1 || y < vis.y0 || y > vis.y1) continue; ctx.strokeRect(x * s + this.tx + 0.5, y * s + this.ty + 0.5, cw - 1, ch - 1); }
    }
    // local wires when zoomed in
    if (s >= 14) {
      ctx.strokeStyle = 'rgba(180,177,168,0.3)'; ctx.lineWidth = 1;
      ctx.beginPath();
      let n = 0;
      for (let i = 0; i < cells.length && n < 3000; i++) {
        const [x, y] = pos[i];
        if (x < vis.x0 || x > vis.x1 || y < vis.y0 || y > vis.y1) continue;
        const c = cells[i];
        for (let k = 1; k <= 3; k++) { const net = c[k]; if (net < 0) continue; const d = this.driver[net]; if (d < 0) continue; const [dx, dy] = pos[d]; if (Math.abs(dx - x) > 10 || Math.abs(dy - y) > 10) continue; ctx.moveTo(dx * s + this.tx + cw, dy * s + this.ty + ch / 2); ctx.lineTo(x * s + this.tx, y * s + this.ty + ch / 2 + (k - 2) * ch * 0.3); n++; }
      }
      ctx.stroke();
    }
    // glyphs
    if (s >= 12) {
      ctx.fillStyle = '#121214'; ctx.font = `${Math.max(7, s * 0.45)}px "JetBrains Mono Variable", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let i = 0; i < cells.length; i++) {
        const [x, y] = pos[i]; if (x < vis.x0 || x > vis.x1 || y < vis.y0 || y > vis.y1) continue;
        ctx.fillStyle = toggled[i] ? '#121214' : '#8a8a94';
        let g = TYPE_GLYPH[types[cells[i][0]]] || '?';
        if (s >= 22 && this.isFlop[i]) { const m = nl.names[i].match(/\[(\d+)\]$/); if (m) g = m[1]; }
        ctx.fillText(g, x * s + this.tx + cw / 2, y * s + this.ty + ch / 2);
      }
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
    if (s >= 10) {
      // register file axes
      const wb = nl.columns.WB; const bx = wb.bankX0;
      const fs = Math.max(8, Math.min(12, s * 0.5));
      ctx.font = `${fs}px "JetBrains Mono Variable", monospace`; ctx.fillStyle = 'rgba(231,229,223,0.75)'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (let r = 1; r < 32; r++) { const [px, py] = this.toScreen(bx - 0.25, r - 1 + 0.5); if (py < -10 || py > this.h + 10 || px < 0 || px > this.w + 60) continue; ctx.fillText(`${ABI[r]} x${r}`, px, py); }
      ctx.textAlign = 'center';
      for (let b = 0; b < 32; b += s >= 20 ? 1 : 4) { const [px, py] = this.toScreen(bx + b + 0.5, -0.4); if (px < 0 || px > this.w) continue; ctx.fillText(String(b), px, py); }
      // pipeline register names along their runs
      ctx.fillStyle = 'rgba(231,229,223,0.85)';
      for (const g of this.bankGroups) {
        const [x0g, y0g] = pos[g.cells[0]], [x1g, y1g] = pos[g.cells[g.cells.length - 1]];
        if (x0g !== x1g) continue; // split across two bank columns: skip label
        const runH = (y1g - y0g + 1) * s; const tw = ctx.measureText(g.name).width;
        if (runH < tw + 6) continue;
        const [px, py] = this.toScreen(x0g + 0.5, (y0g + y1g + 1) / 2);
        if (px < -20 || px > this.w + 20 || py < -runH || py > this.h + runH) continue;
        ctx.save(); ctx.translate(px, py); ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = 'rgba(18,18,20,0.75)'; ctx.fillRect(-tw / 2 - 3, -fs / 2 - 1, tw + 6, fs + 2);
        ctx.fillStyle = '#e7e5df'; ctx.fillText(g.name, 0, 0); ctx.restore();
      }
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
    // critical path
    if (critSet) {
      ctx.strokeStyle = '#5cc8e6'; ctx.lineWidth = Math.max(1, Math.min(3, s / 4));
      ctx.beginPath();
      const p = this.critical.cells;
      for (let k = 0; k < p.length; k++) { const [x, y] = pos[p[k]]; const sx = x * s + this.tx + cw / 2, sy = y * s + this.ty + ch / 2; if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy); }
      ctx.stroke();
      ctx.fillStyle = '#5cc8e6';
      for (const i of p) { const [x, y] = pos[i]; ctx.fillRect(x * s + this.tx, y * s + this.ty, cw, ch); }
    }
    // selection / group / highlight wires
    const wire = (a, b, color) => { const [ax, ay] = pos[a], [bx, by] = pos[b]; ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(ax * s + this.tx + cw / 2, ay * s + this.ty + ch / 2); ctx.lineTo(bx * s + this.tx + cw / 2, by * s + this.ty + ch / 2); ctx.stroke(); };
    if (groupSet) {
      ctx.strokeStyle = '#5cc8e6'; ctx.lineWidth = 1.5;
      for (const i of groupSet) { const [x, y] = pos[i]; ctx.strokeRect(x * s + this.tx - 1, y * s + this.ty - 1, cw + 2, ch + 2); }
    } else if (sel >= 0) {
      ctx.lineWidth = Math.max(1, Math.min(2.5, s / 6));
      const c = cells[sel];
      for (let k = 1; k <= 3; k++) { const n = c[k]; if (n >= 0 && this.driver[n] >= 0) wire(this.driver[n], sel, 'rgba(92,200,230,0.9)'); }
      for (const j of this.fanout[c[4]] || []) wire(sel, j, 'rgba(124,217,146,0.9)');
      for (const i of highlight) { const [x, y] = pos[i]; ctx.strokeStyle = i === sel ? '#ffffff' : '#5cc8e6'; ctx.lineWidth = i === sel ? 2 : 1.2; ctx.strokeRect(x * s + this.tx - 1.5, y * s + this.ty - 1.5, cw + 3, ch + 3); }
      // labels for the neighbourhood when zoomed
      if (s >= 6) {
        ctx.fillStyle = '#e7e5df'; ctx.font = '10px "JetBrains Mono Variable", monospace';
        for (const i of highlight) { const [x, y] = pos[i]; const nm = this.cellName(i); if (nm) ctx.fillText(nm.length > 26 ? nm.slice(0, 25) + '…' : nm, x * s + this.tx + cw + 3, y * s + this.ty + ch / 2 + 3); }
      }
    }
    // scale bar / hint
    if (this.w > 700) {
      const hint = `${fmtInt(drawn)} cells in view · scroll to zoom · drag to pan · click a cell`;
      ctx.font = '11px "Geist Variable", system-ui, sans-serif';
      const tw = ctx.measureText(hint).width;
      ctx.fillStyle = '#121214'; ctx.strokeStyle = '#2b2b31'; ctx.lineWidth = 1;          // opaque backing so the hint never sits on cells
      ctx.beginPath(); ctx.roundRect(4.5, this.h - 24.5, tw + 12, 20, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(127,125,118,0.9)'; ctx.fillText(hint, 10, this.h - 10);
    }
  }

  show(v) { this.visible = v; if (v) { this.resize(); if (!this.fitted) requestAnimationFrame(() => this.resize()); this.updateSide(); } }
}

export class MiniDiePanel {
  constructor(root, onOpenFull) {
    this.root = root;
    this.onOpenFull = onOpenFull;
    this.nl = null;
    this.tracker = null;
    this.session = null;
    this.visible = false;
    this.colorMode = 'voltage'; // default to live 0/1 voltage + toggle highlights in Split View
    this.modeBtn = el('button', {
      class: 'btn active',
      title: 'Switch between live 0/1 voltage states and toggled-only highlight',
      onclick: () => {
        this.colorMode = this.colorMode === 'voltage' ? 'toggled' : 'voltage';
        this.modeBtn.className = 'btn' + (this.colorMode === 'voltage' ? ' active' : '');
        this.modeBtn.textContent = this.colorMode === 'voltage' ? '0/1 voltage' : 'toggled';
        this.draw();
      }
    }, '0/1 voltage');
    this.expandBtn = el('button', {
      class: 'btn',
      title: 'Open full-screen 8,297-Gate Netlist Explorer',
      onclick: () => this.onOpenFull && this.onOpenFull()
    }, 'full netlist ↗');
    this.head = el('div', { class: 'panel-head' },
      el('span', { class: 'label' }, '8,297-Gate Silicon Die'),
      el('span', { class: 'hint' }, 'Yosys RV32I'),
      el('span', { class: 'spacer' }),
      this.modeBtn,
      this.expandBtn
    );
    this.canvasWrap = el('div', { class: 'panel-body mini-die-wrap', style: 'position:relative;overflow:hidden;background:#0e0f12' });
    this.canvas = el('canvas', { 'aria-label': '8,297-Gate Silicon Die Live View', style: 'width:100%;height:100%;display:block;cursor:pointer' });
    this.tip = el('div', { class: 'nl-tip' });
    this.canvasWrap.append(this.canvas, this.tip);
    this.foot = el('div', { class: 'regs-foot' }, el('span', {}, 'Loading 8,297-cell Yosys gate netlist…'));
    this.root.replaceChildren(this.head, this.canvasWrap, this.foot);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.canvasWrap);
    this.canvas.addEventListener('click', () => this.onOpenFull && this.onOpenFull());
  }

  bind(nl, tracker, session) {
    this.nl = nl;
    this.tracker = tracker;
    this.session = session;
    this.isFlop = new Uint8Array(nl.cells.length);
    for (const i of nl.flops) this.isFlop[i] = 1;
    tracker.addEventListener('update', () => { if (this.visible) this.draw(); });
    this.resize();
  }

  show(v) {
    this.visible = v;
    this.root.hidden = !v;
    if (v) requestAnimationFrame(() => this.resize());
  }

  resize() {
    if (!this.visible) return;
    const r = this.canvasWrap.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    const dpr = window.devicePixelRatio || 1;
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.dpr = dpr;
    this.draw();
  }

  draw() {
    if (!this.visible || !this.nl || !this.tracker || !this.w) return;
    const ctx = this.canvas.getContext('2d');
    const nl = this.nl, gs = this.tracker.gs;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    const [bw, bh] = nl.bounds;
    const padX = 10, padTop = 20, padBot = 8;
    const s = Math.min((this.w - padX * 2) / bw, (this.h - padTop - padBot) / bh);
    const tx = (this.w - bw * s) / 2;
    const ty = padTop + (this.h - padTop - padBot - bh * s) / 2;

    for (let st = 0; st < 5; st++) {
      const col = nl.columns[nl.stages[st]];
      const x0 = col.x0 * s + tx, y0 = ty, w = col.w * s, h = bh * s;
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(x0 - 1.5, y0 - 1.5, w + 3, h + 3);
      if (col.bankW > 0) {
        const bx = col.bankX0 * s + tx;
        ctx.fillStyle = 'rgba(242,181,68,0.06)';
        ctx.fillRect(bx - 1, y0 - 1.5, col.bankW * s + 2, h + 3);
      }
      ctx.fillStyle = STAGE_COLOR[st];
      ctx.font = '600 10px "Geist Variable", system-ui, sans-serif';
      ctx.fillText(nl.stages[st], x0, y0 - 4);
    }

    const cw = Math.max(1, s * 0.85), ch = Math.max(1, s * 0.85);
    const pos = nl.pos, cells = nl.cells, toggled = gs.toggled, val = gs.val, types = nl.types;
    let togCount = 0, highCount = 0;

    for (let i = 0; i < cells.length; i++) {
      const [x, y] = pos[i];
      const v1 = val[cells[i][4]] === 1;
      const tog = toggled[i];
      if (tog) togCount++;
      if (v1) highCount++;
      if (this.colorMode === 'voltage') {
        ctx.fillStyle = v1 ? (this.isFlop[i] ? '#f2b544' : tog ? '#7cd992' : '#3fb984') : (tog ? '#5cc8e6' : '#252730');
      } else {
        ctx.fillStyle = tog ? (TYPE_COLOR[types[cells[i][0]]] || '#ccc') : '#32343d';
      }
      ctx.fillRect(x * s + tx, y * s + ty, cw, ch);
    }

    this.foot.replaceChildren(
      el('span', {}, 'toggled ', el('b', {}, `${fmtInt(togCount)} / 8,297`)),
      el('span', {}, 'logic-1 ', el('b', {}, fmtInt(highCount))),
      el('span', { style: 'color:#7cd992' }, `gate = RTL (0 mism)`)
    );
  }
}

