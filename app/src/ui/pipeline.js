// Pipeline diagram: five stage cards, four pipeline registers, forwarding and
// bypass paths, the redirect path, and stall/flush markers. Every value drawn
// is read from the behavioural core's state and combinational signals.
import { svgEl, hex8 } from './format.js';
import { ABI } from '../isa.js';
import { disasm } from '../disasm.js';
import { ALU, WB, FWD } from '../core.js';

const ALU_NAME = ['add', 'sub', 'sll', 'slt', 'sltu', 'xor', 'srl', 'sra', 'or', 'and', 'pass B'];
const CARD_W = 200, CARD_Y = 70, CARD_H = 288, REG_W = 16;
const COLS = { IF: 14, ID: 250, EX: 486, MEM: 722, WB: 958 };
const REGS = { IFID: 224, IDEX: 460, EXMEM: 696, MEMWB: 932 };
const ROW0 = CARD_Y + 94, ROW_H = 22;   // pc and instruction on their own lines above the rows

const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
// bubbles carry a UI-only note of their origin (flushed / load-use stall / pipeline fill / fetch stopped)
const bubbleText = (r) => (r.why ? `bubble · ${r.why}` : 'bubble');
const sdec = (v) => { const s = v | 0; return s.toString(); };

export class PipelineView {
  constructor(container, symbols) {
    this.container = container;
    this.symbols = symbols;    // Map addr -> name
    this.svg = svgEl('svg', { viewBox: '0 0 1200 422', role: 'img', 'aria-label': 'Pipeline diagram' });
    container.append(this.svg);
    this.nodes = {};
    this.build();
  }

  setSymbols(map) { this.symbols = map; }

  build() {
    const s = this.svg;
    const N = this.nodes;
    // --- forwarding / bypass paths (top band)
    const portA = COLS.EX + 60, portB = COLS.EX + 140;
    const idA = COLS.ID + 60, idB = COLS.ID + 140;
    const srcMem = REGS.EXMEM + REG_W / 2, srcWb = REGS.MEMWB + REG_W / 2;
    const path = (cls, x0, y, x1) => {
      const r = 6;
      const d = `M ${x0} ${CARD_Y} V ${y + r} Q ${x0} ${y} ${x0 - r} ${y} H ${x1 + r} Q ${x1} ${y} ${x1} ${y + r} V ${CARD_Y - 6}`;
      const p = svgEl('path', { class: `pipe-path ${cls}`, d });
      const arrow = svgEl('path', { class: `pipe-arrow ${cls}`, d: `M ${x1 - 5} ${CARD_Y - 8} L ${x1 + 5} ${CARD_Y - 8} L ${x1} ${CARD_Y - 1} Z` });
      s.append(p, arrow);
      return { p, arrow };
    };
    // three lanes: EX/MEM→EX (lowest), MEM/WB→EX, WB→ID bypass (top). A and B ports share a lane.
    N.fwdMemA = path('fwd-mem', srcMem, 52, portA);
    N.fwdMemB = path('fwd-mem', srcMem, 52, portB);
    N.fwdWbA = path('fwd-wb', srcWb, 34, portA);
    N.fwdWbB = path('fwd-wb', srcWb, 34, portB);
    N.bypA = path('byp', srcWb, 16, idA);
    N.bypB = path('byp', srcWb, 16, idB);
    N.lblFwdMem = svgEl('text', { class: 'pipe-path-label', x: portB + 14, y: 48, text: 'EX/MEM → EX forwarding' });
    N.lblFwdWb = svgEl('text', { class: 'pipe-path-label', x: portB + 14, y: 30, text: 'MEM/WB → EX forwarding' });
    N.lblByp = svgEl('text', { class: 'pipe-path-label', x: idB + 14, y: 12, text: 'WB → ID register-file bypass' });
    s.append(N.lblFwdMem, N.lblFwdWb, N.lblByp);
    // input ports
    N.pA = svgEl('circle', { class: 'pipe-port', cx: portA, cy: CARD_Y, r: 4 });
    N.pB = svgEl('circle', { class: 'pipe-port', cx: portB, cy: CARD_Y, r: 4 });
    N.pIdA = svgEl('circle', { class: 'pipe-port', cx: idA, cy: CARD_Y, r: 4 });
    N.pIdB = svgEl('circle', { class: 'pipe-port', cx: idB, cy: CARD_Y, r: 4 });

    // --- redirect path (bottom band)
    const rx0 = COLS.EX + 100, rx1 = COLS.IF + 100, ry = CARD_Y + CARD_H + 34;
    N.redir = svgEl('path', { class: 'pipe-path redir', d: `M ${rx0} ${CARD_Y + CARD_H} V ${ry - 6} Q ${rx0} ${ry} ${rx0 - 6} ${ry} H ${rx1 + 6} Q ${rx1} ${ry} ${rx1} ${ry - 6} V ${CARD_Y + CARD_H + 7}` });
    N.redirArrow = svgEl('path', { class: 'pipe-arrow redir', d: `M ${rx1 - 5} ${CARD_Y + CARD_H + 8} L ${rx1 + 5} ${CARD_Y + CARD_H + 8} L ${rx1} ${CARD_Y + CARD_H + 1} Z` });
    N.lblRedir = svgEl('text', { class: 'pipe-path-label', x: (rx0 + rx1) / 2, y: ry + 16, 'text-anchor': 'middle', text: 'branch / jump redirect → pc; IF/ID and ID/EX are flushed' });
    s.append(N.redir, N.redirArrow, N.lblRedir);

    // --- stage cards
    N.cards = {};
    for (const [name, x] of Object.entries(COLS)) {
      const w = name === 'WB' ? 228 : CARD_W;
      const g = svgEl('g');
      const box = svgEl('rect', { class: 'pipe-stage-box', x, y: CARD_Y, width: w, height: CARD_H, rx: 6 });
      g.append(box);
      const head = svgEl('text', { class: 'pipe-head', x: x + 10, y: CARD_Y + 22, text: { IF: 'IF  instruction fetch', ID: 'ID  decode · register read', EX: 'EX  execute', MEM: 'MEM  data memory', WB: 'WB  write back' }[name] });
      const pc = svgEl('text', { class: 'pipe-pc', x: x + 10, y: CARD_Y + 46 });
      const instr = svgEl('text', { class: 'pipe-instr', x: x + 10, y: CARD_Y + 70 });
      const rows = [];
      for (let i = 0; i < 10; i++) {
        const k = svgEl('text', { class: 'pipe-k', x: x + 6, y: ROW0 + i * ROW_H });
        const v = svgEl('text', { class: 'pipe-v', x: x + w - 6, y: ROW0 + i * ROW_H, 'text-anchor': 'end' });
        rows.push({ k, v });
        g.append(k, v);
      }
      const tagBg = svgEl('rect', { class: 'pipe-badge-bg', x: x + 10, y: CARD_Y + CARD_H - 34, width: 0, height: 24, fill: 'transparent' });
      const tag = svgEl('text', { class: 'pipe-tag', x: x + 15, y: CARD_Y + CARD_H - 16 });
      g.append(head, pc, instr, tagBg, tag);
      s.append(g);
      N.cards[name] = { box, head, pc, instr, rows, tag, tagBg, w, x };
    }
    s.append(N.pA, N.pB, N.pIdA, N.pIdB);

    // --- pipeline registers
    N.regs = {};
    for (const [name, x] of Object.entries(REGS)) {
      const r = svgEl('rect', { class: 'pipe-reg', x, y: CARD_Y, width: REG_W, height: CARD_H, rx: 3 });
      const l = svgEl('text', { class: 'pipe-reg-label', x: x + REG_W / 2, y: CARD_Y + CARD_H + 14, 'text-anchor': 'middle', text: { IFID: 'IF/ID', IDEX: 'ID/EX', EXMEM: 'EX/MEM', MEMWB: 'MEM/WB' }[name] });
      // badge runs vertically inside the 16 px register strip so it never covers card text
      const cx = x + REG_W / 2, cy = CARD_Y + CARD_H / 2;
      const tagBg = svgEl('rect', { class: 'pipe-badge-bg', x: cx - 11, y: cy, width: 22, height: 0, fill: 'transparent' });
      const tag = svgEl('text', { class: 'pipe-tag', x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central', transform: `rotate(-90 ${cx} ${cy})` });
      s.append(r, l, tagBg, tag);
      N.regs[name] = { r, tag, tagBg, vertical: true, cx, cy };
    }
  }

  // ---------------------------------------------------------------------
  update(session) {
    const core = session.core, s = session.signals, N = this.nodes;
    const { ifid, idex, exmem, memwb } = core;
    const sym = this.symbols;
    // cards are narrow: drop the <symbol+offset> suffix, keep the hex target
    const dis = (w, pc) => disasm(w, pc, sym).text.replace(/ <[^>]*>$/, '');
    // key 14 units and value 16.5 units of JetBrains Mono (0.6 em advance) must leave ≥ 7 units between them inside the card's
    // w − 12 units; a row that would not (`A s11 ←MEM/WB` + an 8-digit value, `next pc` + `00000048 pc+4`) sets its value at 15 units
    const setRows = (card, rows) => {
      for (let i = 0; i < 10; i++) {
        const row = rows[i];
        const k = row ? row[0] : '', v = row ? row[1] : '';
        const tight = k.length * 14 * 0.6 + v.length * 16.5 * 0.6 > card.w - 12 - 7;
        card.rows[i].k.textContent = k;
        card.rows[i].v.textContent = v;
        card.rows[i].v.setAttribute('class', 'pipe-v ' + (tight ? 'tight ' : '') + (row && row[2] ? row[2] : ''));
      }
    };
    const setTag = (holder, text, color) => {
      holder.tag.textContent = text || '';
      holder.tag.setAttribute('fill', text ? color : 'transparent');
      holder.tagBg.setAttribute('fill', text ? 'rgba(18,20,26,0.92)' : 'transparent');
      holder.tagBg.setAttribute('stroke', text ? color : 'transparent');
      let len = 0;
      if (text) { try { len = holder.tag.getComputedTextLength() + 10; } catch {} if (!(len > 10)) len = text.length * 11 + 10; }
      if (holder.vertical) { holder.tagBg.setAttribute('height', len); holder.tagBg.setAttribute('y', holder.cy - len / 2); }
      else holder.tagBg.setAttribute('width', len);
    };
    const regLbl = (i) => ABI[i];   // the x-number alias is in the registers panel

    // ---- IF
    {
      const c = N.cards.IF;
      c.pc.textContent = hex8(core.pc);
      const stopped = core.fetch_stopped || core.halted;
      c.instr.textContent = stopped ? '(fetch stopped)' : trunc(dis(s.imem_rdata, core.pc), 16);
      c.instr.setAttribute('class', 'pipe-instr' + (stopped ? ' bubble' : ''));
      let next, nextCls = 'ctl';
      if (s.redirect) next = ['next', `${hex8(s.redirect_target)} ← EX`, 'ctl'];
      else if (s.stall) next = ['next', 'hold (stall)', 'neutral'];
      else if (stopped) next = ['next', '—', 'dim'];
      else next = ['next', `${hex8(s.pc_plus4)} pc+4`, 'ctl'];
      setRows(c, [
        ['imem addr', hex8(core.pc)],
        ['imem data', hex8(s.imem_rdata)],
        next,
        null,
        ['predict', 'not taken', 'neutral'],
      ]);
      setTag(c, s.redirect ? 'REDIRECT' : s.stall ? 'HOLD' : '', s.redirect ? 'var(--red)' : 'var(--magenta)');
      c.box.setAttribute('class', 'pipe-stage-box' + (s.redirect ? ' flush' : s.stall ? ' stall' : ''));
    }
    // ---- ID
    {
      const c = N.cards.ID;
      const d = s.id;
      c.pc.textContent = ifid.valid ? hex8(ifid.pc) : '';
      c.instr.textContent = ifid.valid ? trunc(dis(ifid.instr, ifid.pc), 16) : bubbleText(ifid);
      c.instr.setAttribute('class', 'pipe-instr' + (ifid.valid ? '' : ' bubble'));
      const rows = [];
      if (ifid.valid) {
        if (d.uses_rs1) rows.push([`rs1 ${regLbl(d.rs1)}`, `${hex8(s.id_rs1_data)}${s.id_bypass_rs1 ? ' ←WB' : ''}`, s.id_bypass_rs1 ? 'wb' : '']);
        if (d.uses_rs2) rows.push([`rs2 ${regLbl(d.rs2)}`, `${hex8(s.id_rs2_data)}${s.id_bypass_rs2 ? ' ←WB' : ''}`, s.id_bypass_rs2 ? 'wb' : '']);
        if (d.alu_b_imm || d.branch || d.jal || d.jalr || d.mem_write) rows.push(['imm', `${hex8(d.imm)}  ${sdec(d.imm)}`]);
        if (d.reg_write && d.rd !== 0) rows.push(['rd', regLbl(d.rd), 'neutral']);
        const ctl = [];
        if (d.branch) ctl.push('branch'); if (d.jal) ctl.push('jal'); if (d.jalr) ctl.push('jalr');
        if (d.mem_read) ctl.push('load'); if (d.mem_write) ctl.push('store'); if (d.halt) ctl.push('halt');
        if (!ctl.length) ctl.push(`alu ${ALU_NAME[d.alu_op]}`);
        rows.push(['control', ctl.join(' '), 'neutral']);
        if (s.stall) { rows.push(null); rows.push(['hazard', `load-use (${ABI[idex.rd]})`, 'ctl']); rows.push(['', 'waits for the load', 'neutral']); }
      } else rows.push(['', s.redirect ? 'flushed next edge' : '', 'dim']);
      setRows(c, rows);
      setTag(c, s.stall ? 'STALL' : (s.redirect && ifid.valid) ? 'FLUSH' : '', s.stall ? 'var(--magenta)' : 'var(--red)');
      c.box.setAttribute('class', 'pipe-stage-box' + (ifid.valid ? '' : ' bubble') + (s.stall ? ' stall' : (s.redirect && ifid.valid) ? ' flush' : ''));
    }
    // ---- EX
    {
      const c = N.cards.EX;
      c.pc.textContent = idex.valid ? hex8(idex.pc) : '';
      c.instr.textContent = idex.valid ? trunc(dis(idex.instr, idex.pc), 16) : bubbleText(idex);
      c.instr.setAttribute('class', 'pipe-instr' + (idex.valid ? '' : ' bubble'));
      const rows = [];
      if (idex.valid) {
        const srcName = (sel, used) => !used ? 'ID/EX' : sel === FWD.MEM ? '←EX/MEM' : sel === FWD.WB ? '←MEM/WB' : 'ID/EX';
        if (idex.uses_rs1) rows.push([`A ${ABI[idex.rs1]} ${srcName(s.fwd_a_sel, s.fwd_a_used)}`, hex8(s.ex_rs1), s.fwd_a_used ? (s.fwd_a_sel === FWD.MEM ? 'ctl' : 'wb') : '']);
        else if (idex.alu_a_pc) rows.push(['A pc', hex8(idex.pc)]);
        if (idex.uses_rs2 && !idex.alu_b_imm) rows.push([`B ${ABI[idex.rs2]} ${srcName(s.fwd_b_sel, s.fwd_b_used)}`, hex8(s.ex_rs2), s.fwd_b_used ? (s.fwd_b_sel === FWD.MEM ? 'ctl' : 'wb') : '']);
        else if (idex.alu_b_imm) rows.push(['B imm', hex8(idex.imm)]);
        if (idex.uses_rs2 && idex.alu_b_imm && (idex.mem_write)) rows.push([`D ${ABI[idex.rs2]} ${srcName(s.fwd_b_sel, s.fwd_b_used)}`, hex8(s.ex_rs2), s.fwd_b_used ? (s.fwd_b_sel === FWD.MEM ? 'ctl' : 'wb') : '']);
        else if (idex.uses_rs2 && idex.alu_b_imm && idex.branch) rows.push([`B ${ABI[idex.rs2]} ${srcName(s.fwd_b_sel, s.fwd_b_used)}`, hex8(s.ex_rs2), s.fwd_b_used ? (s.fwd_b_sel === FWD.MEM ? 'ctl' : 'wb') : '']);
        rows.push(['alu', ALU_NAME[idex.alu_op], 'neutral']);
        rows.push(['Y', `${hex8(s.alu_y)}  ${sdec(s.alu_y)}`]);
        if (idex.branch) { rows.push(null); rows.push(['branch', s.br_taken ? 'taken' : 'not taken', s.br_taken ? 'ctl' : 'neutral']); rows.push(['target', hex8(s.jump_target), s.br_taken ? 'ctl' : 'dim']); }
        if (idex.jal || idex.jalr) { rows.push(null); rows.push([idex.jalr ? 'jalr target' : 'jal target', hex8(s.jump_target), 'ctl']); rows.push(['link', `${ABI[idex.rd]} ← ${hex8((idex.pc + 4) >>> 0)}`, 'neutral']); }
        if (idex.halt) { rows.push(null); rows.push(['halt', 'stops fetch', 'ctl']); }
      } else rows.push(['', s.stall ? 'bubble inserted' : '', 'dim']);
      setRows(c, rows);
      const fw = (s.fwd_a_used ? 1 : 0) + (s.fwd_b_used ? 1 : 0);
      setTag(c, fw ? `FORWARD ×${fw}` : s.redirect && !idex.halt ? 'REDIRECT' : '', fw ? 'var(--magenta)' : 'var(--red)');
      c.box.setAttribute('class', 'pipe-stage-box' + (idex.valid ? '' : ' bubble'));
    }
    // ---- MEM
    {
      const c = N.cards.MEM;
      c.pc.textContent = exmem.valid ? hex8(exmem.pc) : '';
      c.instr.textContent = exmem.valid ? trunc(dis(exmem.instr, exmem.pc), 16) : bubbleText(exmem);
      c.instr.setAttribute('class', 'pipe-instr' + (exmem.valid ? '' : ' bubble'));
      const rows = [];
      if (exmem.valid) {
        if (exmem.mem_write) {
          rows.push(['store addr', hex8(exmem.alu), 'ctl']);
          rows.push(['data', hex8(s.dmem_wdata)]);
          rows.push(['byte enable', `${s.dmem_be.toString(2).padStart(4, '0')}  ${['', 'b', 'h', '', 'w'][exmem.funct3 === 2 ? 4 : exmem.funct3 === 1 ? 2 : 1]}`, 'neutral']);
        } else if (exmem.mem_read) {
          rows.push(['load addr', hex8(exmem.alu), 'ctl']);
          rows.push(['word read', hex8(s.dmem_rdata)]);
          rows.push(['result', `${hex8(s.load_result)}  ${sdec(s.load_result)}`]);
          rows.push(['width', ['lb', 'lh', 'lw', '', 'lbu', 'lhu'][exmem.funct3] || '', 'neutral']);
        } else {
          rows.push(['', 'no memory access', 'dim']);
          if (exmem.reg_write && exmem.rd !== 0) { rows.push(null); rows.push(['passes', `${ABI[exmem.rd]} = ${hex8(exmem.wb_sel === WB.PC4 ? (exmem.pc + 4) >>> 0 : exmem.alu)}`]); rows.push(['', 'can be forwarded', 'neutral']); }
        }
      }
      setRows(c, rows);
      setTag(c, exmem.valid && exmem.mem_write ? 'WRITE' : exmem.valid && exmem.mem_read ? 'READ' : '', 'var(--copper)');
      c.box.setAttribute('class', 'pipe-stage-box' + (exmem.valid ? '' : ' bubble'));
    }
    // ---- WB
    {
      const c = N.cards.WB;
      c.pc.textContent = memwb.valid ? hex8(memwb.pc) : '';
      c.instr.textContent = memwb.valid ? trunc(dis(memwb.instr, memwb.pc), 18) : bubbleText(memwb);
      c.instr.setAttribute('class', 'pipe-instr' + (memwb.valid ? '' : ' bubble'));
      const rows = [];
      if (memwb.valid) {
        if (s.wb_we) {
          rows.push([`${regLbl(s.wb_rd)} ←`, `${hex8(s.wb_data)}  ${sdec(s.wb_data)}`, 'wb']);
          rows.push(['source', memwb.wb_sel === WB.MEM ? 'load data' : memwb.wb_sel === WB.PC4 ? 'pc + 4 (link)' : 'alu result', 'neutral']);
        } else rows.push(['', memwb.rd === 0 && memwb.reg_write ? 'writes x0: discarded' : 'no register write', 'dim']);
        rows.push(null);
        rows.push(['retires', `#${core.instret + 1}`, 'neutral']);
        if (memwb.halt) { rows.push(['halt', 'halts after this', 'ctl']); }
      } else if (core.halted) rows.push(['', 'halted', 'dim']);
      setRows(c, rows);
      setTag(c, s.wb_we ? 'WRITE BACK' : memwb.halt && memwb.valid ? 'HALT' : '', s.wb_we ? 'var(--green)' : 'var(--amber)');
      c.box.setAttribute('class', 'pipe-stage-box' + (memwb.valid ? '' : ' bubble'));
    }

    // ---- paths
    const on = (node, active) => { node.p.setAttribute('class', node.p.getAttribute('class').replace(' on', '') + (active ? ' on' : '')); node.arrow.setAttribute('class', node.arrow.getAttribute('class').replace(' on', '') + (active ? ' on' : '')); };
    const memA = s.fwd_a_used && s.fwd_a_sel === FWD.MEM, memB = s.fwd_b_used && s.fwd_b_sel === FWD.MEM;
    const wbA = s.fwd_a_used && s.fwd_a_sel === FWD.WB, wbB = s.fwd_b_used && s.fwd_b_sel === FWD.WB;
    on(N.fwdMemA, memA); on(N.fwdMemB, memB); on(N.fwdWbA, wbA); on(N.fwdWbB, wbB);
    on(N.bypA, s.id_bypass_rs1); on(N.bypB, s.id_bypass_rs2);
    N.lblFwdMem.setAttribute('class', 'pipe-path-label' + ((memA || memB) ? ' on' : ''));
    N.lblFwdWb.setAttribute('class', 'pipe-path-label' + ((wbA || wbB) ? ' on' : ''));
    N.lblByp.setAttribute('class', 'pipe-path-label' + ((s.id_bypass_rs1 || s.id_bypass_rs2) ? ' on' : ''));
    N.pA.setAttribute('class', 'pipe-port' + (memA ? ' on-mem' : wbA ? ' on-wb' : ''));
    N.pB.setAttribute('class', 'pipe-port' + (memB ? ' on-mem' : wbB ? ' on-wb' : ''));
    N.pIdA.setAttribute('class', 'pipe-port' + (s.id_bypass_rs1 ? ' on-byp' : ''));
    N.pIdB.setAttribute('class', 'pipe-port' + (s.id_bypass_rs2 ? ' on-byp' : ''));
    const redir = s.redirect && !idex.halt;
    N.redir.setAttribute('class', 'pipe-path redir' + (redir ? ' on' : ''));
    N.redirArrow.setAttribute('class', 'pipe-arrow redir' + (redir ? ' on' : ''));
    N.lblRedir.setAttribute('class', 'pipe-path-label' + (redir ? ' on' : ''));
    N.lblRedir.textContent = redir ? `${idex.jal ? 'jal' : idex.jalr ? 'jalr' : 'taken branch'} redirects pc → ${hex8(s.redirect_target)}; IF/ID and ID/EX are flushed` : 'branch / jump redirect → pc (flushes IF/ID and ID/EX)';

    // ---- pipeline registers
    const setReg = (name, cls, tag, color) => {
      const r = N.regs[name];
      r.r.setAttribute('class', 'pipe-reg' + (cls ? ' ' + cls : ''));
      r.tag.textContent = tag || ''; r.tag.setAttribute('fill', color || 'transparent');
      r.tagBg.setAttribute('fill', tag ? 'rgba(18,18,20,0.9)' : 'transparent');
      r.tagBg.setAttribute('stroke', tag ? color : 'transparent');
    };
    setReg('IFID', s.redirect ? 'kill' : s.stall ? 'hold' : '', s.redirect ? 'FLUSH' : s.stall ? 'HOLD' : '', s.redirect ? 'var(--red)' : 'var(--magenta)');
    setReg('IDEX', s.redirect ? 'kill' : s.stall ? 'hold' : '', s.redirect ? 'FLUSH' : s.stall ? 'BUBBLE' : '', s.redirect ? 'var(--red)' : 'var(--magenta)');
    setReg('EXMEM', '', '', '');
    setReg('MEMWB', '', '', '');
  }
}
