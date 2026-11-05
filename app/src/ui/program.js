// Program panel: source (C or assembly), the editable assembly buffer, and the
// machine-code listing with live stage markers and breakpoints.
import { el, hex8, hex, escapeHtml } from './format.js';
import { disasm } from '../disasm.js';
import { assemble } from '../asm.js';
import { imageToAsm } from '../toasm.js';

const C_KW = /\b(int|unsigned|char|void|return|for|while|if|else|break|continue|static|const|struct|sizeof|do|switch|case|default)\b/g;
const A_KW = /^(\s*)(\.[a-z0-9_]+)/;

function highlightC(src) {
  return src.split('\n').map((line, i) => {
    let h = escapeHtml(line);
    h = h.replace(/(\/\/.*$)/, '<span class="cm">$1</span>');
    if (!h.includes('class="cm"')) {
      h = h.replace(/("(?:\\.|[^"\\])*")/g, '<span class="str">$1</span>');
      h = h.replace(C_KW, '<span class="kw">$1</span>');
      h = h.replace(/\b(0x[0-9a-fA-F]+|\d+)\b/g, '<span class="num">$1</span>');
    }
    return `<span class="ln">${i + 1}</span>${h}`;
  }).join('\n');
}
function highlightAsm(src) {
  return src.split('\n').map((line, i) => {
    let h = escapeHtml(line);
    const c = h.indexOf('#');
    let code = c >= 0 ? h.slice(0, c) : h, cm = c >= 0 ? `<span class="cm">${h.slice(c)}</span>` : '';
    code = code.replace(A_KW, '$1<span class="kw">$2</span>');
    code = code.replace(/^([A-Za-z_.$0-9]+:)/, '<span class="str">$1</span>');
    code = code.replace(/(^|\s|,)(-?\b0x[0-9a-fA-F]+|-?\b\d+)\b/g, '$1<span class="num">$2</span>');
    return `<span class="ln">${i + 1}</span>${code}${cm}`;
  }).join('\n');
}

export class ProgramPanel {
  constructor(root, opts) {
    this.root = root;
    this.onLoad = opts.onLoad;            // (program) => void
    this.session = opts.session;
    this.program = null;
    this.tab = 'source';
    this.userSource = '';
    this.hoverHold = false;
    this.build();
  }

  build() {
    this.tabs = el('div', { class: 'side-tabs' });
    this.body = el('div', { class: 'side-body' });
    this.root.append(this.tabs, this.body);
  }

  setProgram(p) {
    this.program = p;
    this.tab = p.kind === 'c' ? 'source' : 'asm';
    if (p.kind === 'asm' || p.kind === 'user') this.userSource = p.source;
    this.render();
  }

  render() {
    const p = this.program;
    this.tabs.replaceChildren();
    const tabs = p.kind === 'c' ? [['source', 'C source'], ['asm', 'Edit as assembly'], ['listing', 'Machine code']] : [['asm', 'Assembly'], ['listing', 'Machine code']];
    for (const [id, label] of tabs) {
      this.tabs.append(el('button', { class: 'side-tab' + (this.tab === id ? ' is-active' : ''), role: 'tab', 'aria-selected': this.tab === id, onclick: () => { this.tab = id; if (id === 'asm' && p.kind === 'c' && !this.userSource) this.userSource = imageToAsm(p.image, p.textSize, p.symbols, p.dataEnd); this.render(); } }, label));
    }
    this.body.replaceChildren();
    if (this.tab === 'source') this.renderSource();
    else if (this.tab === 'asm') this.renderEditor();
    else this.renderListing();
  }

  renderSource() {
    const p = this.program;
    const note = el('div', { class: 'src-note' },
      el('div', {}, el('strong', {}, `${p.sourceFile}`), ` · compiled ahead of time in the sandbox with ${p.toolchain}`),
      el('div', { class: 'what' }, 'The simulator runs the resulting machine code (Machine code tab), never this source. Stage marks (F D X M W) come from the build\'s DWARF line table; the first cycles run the startup code (crt0.S), which has no C line. To change the program, use Edit as assembly.'));
    const pre = el('div', { class: 'source-view mono' });
    this.srcLines = [];
    const lines = p.source.replace(/\n$/, '').split('\n');
    highlightC(p.source).split('\n').slice(0, lines.length).forEach((html, i) => {
      const stg = el('span', { class: 'stg' });
      const row = el('div', { class: 'src-line' }, stg, el('span', { class: 'code', html }));
      this.srcLines.push({ row, stg });
      pre.append(row);
    });
    pre.addEventListener('mouseenter', () => { this.hoverHold = true; });
    pre.addEventListener('mouseleave', () => { this.hoverHold = false; });
    this.sourcePre = pre;
    this.body.append(note, pre);
    this.updateListing();
  }

  // address -> source line via the program's line table (sorted [addr, line] pairs; each entry covers up to the next)
  lineOf(addr) {
    const t = this.program?.lines; if (!t || !t.length || addr < t[0][0]) return -1;
    let lo = 0, hi = t.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (t[mid][0] <= addr) lo = mid; else hi = mid - 1; }
    return t[lo][1];
  }

  stageMarks() {
    const core = this.session.core;
    const marks = new Map();
    const add = (addr, m) => { if (!marks.has(addr)) marks.set(addr, []); marks.get(addr).push(m); };
    if (!core.fetch_stopped && !core.halted) add(core.pc, 'F');
    if (core.ifid.valid) add(core.ifid.pc, 'D');
    if (core.idex.valid) add(core.idex.pc, 'X');
    if (core.exmem.valid) add(core.exmem.pc, 'M');
    if (core.memwb.valid) add(core.memwb.pc, 'W');
    return marks;
  }

  renderEditor() {
    const p = this.program;
    const isUser = p.kind !== 'c';
    const note = el('div', { class: 'src-note' }, this.editorNote(p));
    this.editorNoteEl = note;
    const editor = el('div', { class: 'editor' });
    const gutter = el('div', { class: 'editor-gutter' });
    const ta = el('textarea', { spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', 'aria-label': 'Assembly source' });
    ta.value = this.userSource;
    const errors = el('div', { class: 'editor-errors' }); errors.hidden = true;
    const status = el('span', { class: 'hint' });
    const btn = el('button', { class: 'btn primary', onclick: () => this.assembleAndLoad(ta.value, errors, gutter, status) }, 'Assemble & load', el('kbd', {}, 'Ctrl↵'));
    const revert = el('button', { class: 'btn', onclick: () => { this.userSource = p.kind === 'c' ? imageToAsm(p.image, p.textSize, p.symbols, p.dataEnd) : (p.originalSource ?? p.source); ta.value = this.userSource; this.updateGutter(gutter, ta, []); errors.hidden = true; status.textContent = ''; } }, 'Revert');
    const bar = el('div', { class: 'editor-bar' }, btn, revert, status);
    const area = el('div', { class: 'editor-area' }, gutter, ta);
    editor.append(area, errors, bar);
    this.body.append(note, editor);
    this.updateGutter(gutter, ta, []);
    ta.addEventListener('input', () => { this.userSource = ta.value; this.updateGutter(gutter, ta, this.lastErrors || []); });
    ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; });
    area.addEventListener('mouseenter', () => { this.hoverHold = true; });
    area.addEventListener('mouseleave', () => { this.hoverHold = false; });
    ta.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); btn.click(); }
      if (e.key === 'Tab') { e.preventDefault(); const st = ta.selectionStart; ta.setRangeText('    ', st, ta.selectionEnd, 'end'); this.userSource = ta.value; this.updateGutter(gutter, ta, this.lastErrors || []); }
      e.stopPropagation();
    });
    this.editorRefs = { ta, errors, gutter, status };
  }

  editorNote(p) {
    return p.kind !== 'c'
      ? el('div', {}, el('strong', {}, p.kind === 'user' ? 'Your assembly' : p.sourceFile), ' · assembled here in the browser by Silicon\'s assembler. ', el('span', { class: 'what' }, 'It reproduces GNU as/ld output byte for byte on all curated programs and 110 random test programs (see Documentation).'))
      : el('div', {}, el('strong', {}, 'Disassembly of the compiled machine code'), ', made editable: labels were recovered from branch targets and symbols, data is listed as .word. ', el('span', { class: 'what' }, 'Edit and assemble; the result replaces the loaded program.'));
  }

  // The editor's own program was assembled and loaded: point the panel at the
  // new program (header, stage marks, Machine code listing) without rebuilding
  // the editor, so the buffer, status line and scroll position survive.
  rebind(p) {
    this.program = p;
    if (p.kind !== 'c') this.userSource = p.source;
    if (this.editorNoteEl) this.editorNoteEl.replaceChildren(this.editorNote(p));
    this.rows = null; this.srcLines = null;
    this.updateListing();
  }

  updateGutter(gutter, ta, errs) {
    const n = ta.value.split('\n').length;
    const bad = new Set(errs.map(e => e.line));
    this.gutterRows = Array.from({ length: n }, (_, i) => { const stg = el('span', { class: 'stg' }); return { stg, row: el('div', { class: bad.has(i + 1) ? 'err' : '' }, el('span', { class: 'num' }, String(i + 1)), stg) }; });
    gutter.replaceChildren(...this.gutterRows.map(r => r.row));
    gutter.scrollTop = ta.scrollTop;
    this.updateListing();
  }

  assembleAndLoad(src, errors, gutter, status) {
    const r = assemble(src);
    this.lastErrors = r.errors;
    this.updateGutter(gutter, this.editorRefs.ta, r.errors);
    if (!r.ok) {
      errors.hidden = false;
      errors.replaceChildren(...r.errors.slice(0, 20).map(e => el('div', { onclick: () => this.gotoLine(e.line) }, `line ${e.line}: ${e.message}`)));
      status.textContent = `${r.errors.length} error${r.errors.length > 1 ? 's' : ''} · nothing loaded`;
      status.className = 'hint';
      return;
    }
    if (r.textSize === 0) { errors.hidden = false; errors.replaceChildren(el('div', {}, 'no instructions')); return; }
    errors.hidden = true;
    const symbols = [...r.symbols.entries()].map(([name, addr]) => ({ name, addr, size: 0, type: addr < r.textSize ? 't' : 'd' })).sort((a, b) => a.addr - b.addr);
    const listing = [];
    for (let a = 0; a < r.textSize; a += 4) {
      const w = (r.image[a] | (r.image[a + 1] << 8) | (r.image[a + 2] << 16) | (r.image[a + 3] << 24)) >>> 0;
      listing.push([a, w, disasm(w, a, new Map(symbols.map(s => [s.addr, s.name]))).text]);
    }
    const base = this.program;
    const prog = {
      name: base.kind === 'user' ? base.name : `${base.name} (edited)`, kind: 'user', title: `${base.title} — edited`,
      source: src, originalSource: base.kind === 'user' ? base.originalSource : (base.kind === 'c' ? imageToAsm(base.image, base.textSize, base.symbols, base.dataEnd) : base.source),
      sourceFile: 'assembled in the browser', toolchain: 'Silicon assembler (browser)',
      image: r.image, imageBytes: r.image.length, textSize: r.textSize, dataStart: r.dataBase, dataEnd: Math.max(r.bssBase + r.bssSize, r.textSize),
      symbols, listing, lineAddrs: r.lineAddrs, lines: [...r.lineAddrs.entries()].map(([line, addr]) => [addr, line]).sort((a, b) => a[0] - b[0]), expected: null, measured: null, watch: null, result: null, baseName: base.baseName ?? base.name,
    };
    status.textContent = `assembled ${r.textSize / 4} instructions, ${r.image.length} bytes · loaded and reset`;
    status.className = 'editor-ok';
    this.onLoad(prog);
  }

  gotoLine(line) {
    const ta = this.editorRefs?.ta; if (!ta) return;
    const lines = ta.value.split('\n'); let pos = 0;
    for (let i = 0; i < line - 1; i++) pos += lines[i].length + 1;
    ta.focus(); ta.setSelectionRange(pos, pos + (lines[line - 1]?.length ?? 0));
  }

  renderListing() {
    const p = this.program;
    const note = el('div', { class: 'src-note' },
      el('div', {}, el('strong', {}, `${p.imageBytes} bytes`), ` loaded at 0x0 · ${p.textSize / 4} instructions · data from ${hex8(p.dataStart)} to ${hex8(p.dataEnd)}`),
      el('div', { class: 'what' }, 'Click an address to set a breakpoint; it stops when that instruction reaches EX, where it is certain to execute. F D X M W mark the stage holding each instruction this cycle.'));
    this.listing = el('div', { class: 'listing' });
    const table = el('table');
    const symAt = new Map(); for (const s of p.symbols) if (s.addr < p.textSize && !symAt.has(s.addr)) symAt.set(s.addr, s.name);
    this.rows = new Map();
    for (const [addr, word, text] of p.listing) {
      if (symAt.has(addr)) table.append(el('tr', { class: 'sym-row' }, el('td', { colspan: 5 }, `${symAt.get(addr)}:`)));
      const m = text.match(/^(\S+)\s*(.*)$/);
      const asm = el('td', { class: 'asm' }, el('span', { class: 'mn' }, m[1]), ' ', (m[2] || '').replace(/<([^>]+)>/, '<$1>'));
      const tr = el('tr', { 'data-addr': addr },
        el('td', { class: 'gut', title: 'toggle breakpoint', onclick: () => this.session.toggleBreakpoint(addr) }, '●'),
        el('td', { class: 'stg' }), el('td', { class: 'addr' }, hex(addr, 4)), el('td', { class: 'word' }, hex8(word)), asm);
      table.append(tr);
      this.rows.set(addr, tr);
    }
    this.listing.append(table);
    this.listing.addEventListener('mouseenter', () => { this.hoverHold = true; });
    this.listing.addEventListener('mouseleave', () => { this.hoverHold = false; });
    this.body.append(note, this.listing);
    this.updateListing();
  }

  updateListing() {
    if (!this.program) return;
    const core = this.session.core;
    const marks = this.stageMarks();
    const focus = core.idex.valid ? core.idex.pc : core.ifid.valid ? core.ifid.pc : core.pc;
    const scrollInto = (container, elRow) => {
      if (this.hoverHold || !elRow) return;
      const top = elRow.offsetTop, h = container.clientHeight;
      if (top < container.scrollTop + 40 || top > container.scrollTop + h - 60) container.scrollTop = Math.max(0, top - h / 2);
    };
    const byLine = () => {
      const m = new Map();
      for (const [addr, ms] of marks) { const ln = this.lineOf(addr); if (ln > 0) { if (!m.has(ln)) m.set(ln, []); for (const x of ms) if (!m.get(ln).includes(x)) m.get(ln).push(x); } }
      return m;
    };
    if (this.tab === 'listing' && this.rows) {
      for (const [addr, tr] of this.rows) {
        const ms = marks.get(addr);
        tr.children[1].replaceChildren(...(ms || []).map(m => el('span', { class: `stage-mark ${m}` }, m)));
        tr.className = (this.session.breakpoints.has(addr) ? 'bp ' : '') + (ms?.includes('F') ? 'in-if ' : '') + (ms?.includes('X') ? 'in-ex ' : '') + (ms?.includes('W') ? 'in-wb' : '');
      }
      scrollInto(this.listing, this.rows.get(focus));
    } else if (this.tab === 'source' && this.srcLines) {
      const m = byLine();
      const focusLine = this.lineOf(focus);
      this.srcLines.forEach((r, i) => {
        const ms = m.get(i + 1);
        r.stg.replaceChildren(...(ms || []).map(x => el('span', { class: `stage-mark ${x}` }, x)));
        r.row.className = 'src-line' + (ms?.includes('X') ? ' in-ex' : '') + (ms?.includes('F') ? ' in-if' : '');
      });
      if (focusLine > 0) scrollInto(this.sourcePre, this.srcLines[focusLine - 1]?.row);
    } else if (this.tab === 'asm' && this.gutterRows && this.editorRefs) {
      // marks only while the buffer is exactly the loaded program's source
      const live = this.editorRefs.ta.value === this.program.source;
      const m = live ? byLine() : new Map();
      this.gutterRows.forEach((r, i) => { const ms = m.get(i + 1); r.stg.replaceChildren(...(ms || []).map(x => el('span', { class: `stage-mark ${x}` }, x))); r.row.classList.toggle('in-ex', !!ms?.includes('X')); });
      if (live) { const fl = this.lineOf(focus); if (fl > 0 && !this.hoverHold) { const ta = this.editorRefs.ta; const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20; const top = (fl - 1) * lh; if (top < ta.scrollTop + 40 || top > ta.scrollTop + ta.clientHeight - 60) { ta.scrollTop = Math.max(0, top - ta.clientHeight / 2); this.editorRefs.gutter.scrollTop = ta.scrollTop; } } }
    }
  }
}
