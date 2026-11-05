// A two-pass RV32I assembler accepting the GNU as dialect used by the curated
// programs: labels (including 1:/1b/1f), .text/.data/.bss/.section, .word,
// .half, .byte, .ascii, .asciz/.string, .space/.skip/.zero, .align/.balign,
// .equ/.set, expressions with + - * / % << >> & | ^ ~ ( ), %hi/%lo/%pcrel_hi/
// %pcrel_lo, every RV32I instruction and the standard pseudo-instructions.
// Layout matches programs/link.ld: .text at 0, then .data (4-aligned), then .bss.
//
// Tested against GNU binutils output in test/asm-vs-gnu.mjs.

import { INSTR, REG_BY_NAME, encR, encI, encSH, encS, encB, encU, encJ } from './isa.js';

export class AsmError extends Error {
  constructor(line, message) { super(message); this.line = line; }
}

const sext = (v, bits) => (v << (32 - bits)) >> (32 - bits);
const fitsI = (v) => v >= -2048 && v <= 2047;

// ---------------------------------------------------------------------------
// expression parser
// ---------------------------------------------------------------------------
function tokenizeExpr(s) {
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'" ) {
      // character literal
      let j = i + 1, ch;
      if (s[j] === '\\') { const esc = { n: 10, t: 9, r: 13, '0': 0, '\\': 92, "'": 39 }; ch = esc[s[j + 1]]; if (ch === undefined) throw new Error('bad escape'); j += 2; }
      else { ch = s.charCodeAt(j); j++; }
      if (s[j] !== "'") throw new Error('unterminated character literal');
      toks.push({ t: 'num', v: ch }); i = j + 1; continue;
    }
    if (/[0-9]/.test(c)) {
      const m = s.slice(i).match(/^(0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+[bf]?)/);
      const txt = m[0];
      if (/^[0-9]+[bf]$/.test(txt)) toks.push({ t: 'local', v: txt });
      else if (/^0[bB]/.test(txt)) toks.push({ t: 'num', v: parseInt(txt.slice(2), 2) });
      else toks.push({ t: 'num', v: Number(txt) });
      i += txt.length; continue;
    }
    if (/[A-Za-z_.$]/.test(c)) {
      const m = s.slice(i).match(/^[A-Za-z_.$][A-Za-z0-9_.$]*/);
      toks.push({ t: 'sym', v: m[0] }); i += m[0].length; continue;
    }
    if (c === '%') {
      const m = s.slice(i).match(/^%(hi|lo|pcrel_hi|pcrel_lo)\b/);
      if (!m) throw new Error('unknown relocation function');
      toks.push({ t: 'func', v: m[1] }); i += m[0].length; continue;
    }
    if (s.startsWith('<<', i) || s.startsWith('>>', i)) { toks.push({ t: 'op', v: s.substr(i, 2) }); i += 2; continue; }
    if ('+-*/%&|^~()'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
    throw new Error(`unexpected character '${c}'`);
  }
  return toks;
}

// Evaluates to {value, reloc} where reloc is one of null|'hi'|'lo'|'pcrel_hi'|'pcrel_lo'
function parseExpr(s, ctx) {
  const toks = tokenizeExpr(s);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  let reloc = null;
  function primary() {
    const t = next();
    if (!t) throw new Error('unexpected end of expression');
    if (t.t === 'num') return t.v;
    if (t.t === 'local') return ctx.local(t.v);
    if (t.t === 'sym') return ctx.symbol(t.v);
    if (t.t === 'func') {
      if (peek()?.v !== '(') throw new Error(`expected ( after %${t.v}`);
      next(); const v = expr();
      if (next()?.v !== ')') throw new Error('expected )');
      reloc = t.v; return v;
    }
    if (t.t === 'op' && t.v === '(') { const v = expr(); if (next()?.v !== ')') throw new Error('expected )'); return v; }
    if (t.t === 'op' && t.v === '-') return -primary() | 0;
    if (t.t === 'op' && t.v === '+') return primary();
    if (t.t === 'op' && t.v === '~') return ~primary();
    throw new Error(`unexpected token ${t.v}`);
  }
  const PREC = { '*': 5, '/': 5, '%': 5, '+': 4, '-': 4, '<<': 3, '>>': 3, '&': 2, '^': 1, '|': 0 };
  function binary(minPrec) {
    let lhs = primary();
    for (;;) {
      const t = peek();
      if (!t || t.t !== 'op' || !(t.v in PREC) || PREC[t.v] < minPrec) return lhs;
      next();
      const rhs = binary(PREC[t.v] + 1);
      switch (t.v) {
        case '*': lhs = Math.imul(lhs, rhs); break;
        case '/': if (rhs === 0) throw new Error('division by zero'); lhs = Math.trunc(lhs / rhs); break;
        case '%': if (rhs === 0) throw new Error('division by zero'); lhs = lhs % rhs; break;
        case '+': lhs = (lhs + rhs) | 0; break;
        case '-': lhs = (lhs - rhs) | 0; break;
        case '<<': lhs = lhs << rhs; break;
        case '>>': lhs = lhs >>> rhs; break;
        case '&': lhs = lhs & rhs; break;
        case '^': lhs = lhs ^ rhs; break;
        case '|': lhs = lhs | rhs; break;
      }
    }
  }
  function expr() { return binary(0); }
  const value = expr();
  if (p !== toks.length) throw new Error(`unexpected token ${toks[p].v}`);
  return { value: value | 0, reloc };
}

// split on top-level commas
function splitOperands(s) {
  const out = []; let depth = 0, cur = '', inStr = false, q = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { cur += c; if (c === '\\') { cur += s[++i] ?? ''; } else if (c === q) inStr = false; continue; }
    if (c === '"' || c === "'") { inStr = true; q = c; cur += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() !== '' || out.length) out.push(cur.trim());
  return out.filter((x, i, a) => !(x === '' && i === a.length - 1));
}

function parseString(lit) {
  const m = lit.match(/^"((?:\\.|[^"\\])*)"$/);
  if (!m) throw new Error('expected a quoted string');
  const out = [];
  const s = m[1];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\') { out.push(s.charCodeAt(i) & 0xff); continue; }
    const e = s[++i];
    const esc = { n: 10, t: 9, r: 13, b: 8, f: 12, '0': 0, '\\': 92, '"': 34, "'": 39 };
    if (e in esc && !(e === '0' && /[0-7]/.test(s[i + 1] ?? ''))) { out.push(esc[e]); continue; }
    if (/[0-7]/.test(e)) { let j = i, v = 0, n = 0; while (n < 3 && /[0-7]/.test(s[j] ?? '')) { v = v * 8 + Number(s[j]); j++; n++; } out.push(v & 0xff); i = j - 1; continue; }
    if (e === 'x') { const m2 = s.slice(i + 1).match(/^[0-9a-fA-F]{1,2}/); out.push(parseInt(m2[0], 16)); i += m2[0].length; continue; }
    throw new Error(`unknown escape \\${e}`);
  }
  return out;
}

function reg(tok) {
  const r = REG_BY_NAME.get(tok.trim());
  if (r === undefined) throw new Error(`unknown register '${tok.trim()}'`);
  return r;
}

// "imm(reg)" or "(reg)" -> {imm, reg}; "sym" -> {sym}
function parseMem(tok) {
  const m = tok.match(/^(.*)\(\s*([A-Za-z0-9]+)\s*\)$/);
  if (!m) return null;
  return { immText: m[1].trim(), reg: reg(m[2]) };
}

const BRANCH_PSEUDO = {
  beqz: ['beq', 'rs,zero'], bnez: ['bne', 'rs,zero'], blez: ['bge', 'zero,rs'], bgez: ['bge', 'rs,zero'],
  bltz: ['blt', 'rs,zero'], bgtz: ['blt', 'zero,rs'],
};

// ---------------------------------------------------------------------------
export function assemble(source) {
  const lines = source.split('\n');
  const entries = { text: [], data: [], bss: [] };   // labels, alignment requests and sized items, in order
  const sections = { text: { base: 0, size: 0 }, data: { base: 0, size: 0 }, bss: { base: 0, size: 0 } };
  const symbols = new Map();           // name -> {section, offset}   (filled by layout())
  const equ = new Map();               // name -> value
  const localDefs = [];                // {num, section, entry}
  const items = [];                    // sized statements (instructions and data)
  const errors = [];
  const seen = new Set();

  // ---- pass 1: parse into entries
  let cur = 'text';
  const push = (e) => { entries[cur].push(e); return e; };

  for (let ln = 0; ln < lines.length; ln++) {
    let text = lines[ln];
    const hash = text.indexOf('#'); if (hash >= 0) text = text.slice(0, hash);
    text = text.replace(/\/\/.*$/, '');
    // statements separated by ';' (outside strings)
    const stmts = [];
    { let inStr = false, q = '', s = '';
      for (let i = 0; i < text.length; i++) { const c = text[i];
        if (inStr) { s += c; if (c === '\\') s += text[++i] ?? ''; else if (c === q) inStr = false; continue; }
        if (c === '"' || c === "'") { inStr = true; q = c; s += c; continue; }
        if (c === ';') { stmts.push(s); s = ''; continue; }
        s += c; }
      stmts.push(s); }
    for (let st of stmts) {
      st = st.trim();
      // labels
      for (;;) {
        const m = st.match(/^([A-Za-z_.$][A-Za-z0-9_.$]*|[0-9]+)\s*:\s*/);
        if (!m) break;
        const name = m[1];
        if (/^[0-9]+$/.test(name)) localDefs.push({ num: Number(name), section: cur, entry: push({ kind: 'local', num: Number(name), offset: 0 }) });
        else {
          if (seen.has(name) || equ.has(name)) errors.push({ line: ln + 1, message: `symbol '${name}' defined twice` });
          seen.add(name);
          push({ kind: 'label', name, ln });
        }
        st = st.slice(m[0].length);
      }
      if (!st) continue;
      const m = st.match(/^(\S+)\s*(.*)$/);
      const op = m[1].toLowerCase();
      const rest = m[2].trim();
      try {
        if (op.startsWith('.')) {
          // directives
          const args = splitOperands(rest);
          switch (op) {
            case '.text': cur = 'text'; break;
            case '.data': cur = 'data'; break;
            case '.bss': cur = 'bss'; break;
            case '.rodata': cur = 'data'; break;
            case '.section': {
              const name = args[0] || '';
              if (name.startsWith('.text')) cur = 'text';
              else if (name.startsWith('.data') || name.startsWith('.rodata') || name.startsWith('.sdata') || name.startsWith('.srodata')) cur = 'data';
              else if (name.startsWith('.bss') || name.startsWith('.sbss')) cur = 'bss';
              else throw new Error(`unsupported section '${name}'`);
              break;
            }
            case '.globl': case '.global': case '.option': case '.type': case '.size': case '.file': case '.ident': case '.attribute': break;
            case '.align': case '.p2align': {
              const n = parseExpr(args[0], simpleCtx(equ)).value;
              if (n < 0 || n > 16) throw new Error('alignment out of range');
              push({ kind: 'align', a: 1 << n }); break;
            }
            case '.balign': { const a = parseExpr(args[0], simpleCtx(equ)).value; if (a <= 0) throw new Error('alignment must be positive'); push({ kind: 'align', a }); break; }
            case '.equ': case '.set': {
              if (args.length !== 2) throw new Error(`${op} needs a symbol and a value`);
              if (seen.has(args[0])) throw new Error(`symbol '${args[0]}' defined twice`);
              equ.set(args[0], parseExpr(args[1], simpleCtx(equ)).value); break;
            }
            case '.word': case '.long': case '.int':
              if (cur === 'bss') throw new Error('initialised data is not allowed in .bss');
              items.push(push({ ln, section: cur, kind: 'data', unit: 4, size: 4 * args.length, exprs: args })); break;
            case '.half': case '.short': case '.2byte':
              if (cur === 'bss') throw new Error('initialised data is not allowed in .bss');
              items.push(push({ ln, section: cur, kind: 'data', unit: 2, size: 2 * args.length, exprs: args })); break;
            case '.byte':
              if (cur === 'bss') throw new Error('initialised data is not allowed in .bss');
              items.push(push({ ln, section: cur, kind: 'data', unit: 1, size: args.length, exprs: args })); break;
            case '.ascii': case '.asciz': case '.string': {
              if (cur === 'bss') throw new Error('initialised data is not allowed in .bss');
              const bytes = [];
              for (const a of args) { bytes.push(...parseString(a)); if (op !== '.ascii') bytes.push(0); }
              items.push(push({ ln, section: cur, kind: 'bytes', bytes, size: bytes.length })); break;
            }
            case '.space': case '.skip': case '.zero': {
              const n = parseExpr(args[0], simpleCtx(equ)).value;
              const fill = args[1] ? parseExpr(args[1], simpleCtx(equ)).value : 0;
              if (n < 0) throw new Error('negative size');
              if (n > 1 << 24) throw new Error('reservation too large');
              if (fill) { if (cur === 'bss') throw new Error('initialised data is not allowed in .bss'); items.push(push({ ln, section: cur, kind: 'bytes', bytes: new Array(n).fill(fill & 0xff), size: n })); }
              else push({ ln, kind: 'pad', size: n });
              break;
            }
            default: throw new Error(`unknown directive ${op}`);
          }
        } else {
          if (cur !== 'text') throw new Error('instructions must be in .text');
          const operands = splitOperands(rest);
          const size = instrSize(op, operands, equ);
          const relax = op === 'la' || (size === 8 && /^(lb|lh|lw|lbu|lhu|sb|sh|sw)$/.test(op));
          items.push(push({ ln, section: 'text', kind: 'instr', op, operands, size, relax }));
        }
      } catch (e) {
        errors.push({ line: ln + 1, message: e.message });
      }
    }
  }

  // ---- layout: offsets within sections, section bases (text at 0, data, bss)
  const symAddr = new Map();
  let localAddrs = [];
  const addrOf = (sec, off) => sections[sec].base + off;
  function layout() {
    for (const sec of ['text', 'data', 'bss']) {
      let off = 0;
      for (const e of entries[sec]) {
        if (e.kind === 'align') off += (e.a - (off % e.a)) % e.a;
        else if (e.kind === 'label') symbols.set(e.name, { section: sec, offset: off });
        else if (e.kind === 'local') e.offset = off;
        else { e.offset = off; off += e.size; }
      }
      sections[sec].size = off;
    }
    sections.text.base = 0;
    sections.data.base = (sections.text.size + 3) & ~3;
    sections.bss.base = (sections.data.base + sections.data.size + 3) & ~3;
    symAddr.clear();
    for (const [k, v] of symbols) symAddr.set(k, addrOf(v.section, v.offset));
    for (const [k, v] of equ) symAddr.set(k, v);
    localAddrs = localDefs.map(d => ({ num: d.num, addr: addrOf(d.section, d.entry.offset) })).sort((a, b) => a.addr - b.addr);
  }
  const makeCtx = (addr) => ({
    pc: addr,
    symbol: (name) => {
      if (name === '.') return addr;
      if (!symAddr.has(name)) throw new Error(`undefined symbol '${name}'`);
      return symAddr.get(name);
    },
    local: (ref) => {
      const num = Number(ref.slice(0, -1)); const dir = ref.at(-1);
      const cands = localAddrs.filter(l => l.num === num && (dir === 'b' ? l.addr <= addr : l.addr > addr));
      if (!cands.length) throw new Error(`local label ${ref} not found`);
      return dir === 'b' ? cands.at(-1).addr : cands[0].addr;
    },
  });

  // `la rd, sym` shrinks to a single `addi rd, zero, sym` when the absolute
  // address fits in 12 bits, exactly as GNU ld's relaxation does for these
  // programs. Shrinking only moves addresses down, so this converges.
  layout();
  for (let iter = 0; iter < 16; iter++) {
    let changed = false;
    for (const it of items) {
      if (!it.relax) continue;
      let fits = false;
      try { const a = resolveValue(parseExpr(it.operands[1], makeCtx(addrOf(it.section, it.offset))), addrOf(it.section, it.offset)); fits = fitsI(a); } catch { /* reported in pass 2 */ }
      // GNU ld shrinks la/lw/sw symbol forms to one x0-relative instruction when the address fits
      const ns = fits ? 4 : 8;
      if (ns < it.size) { it.size = ns; changed = true; }
    }
    if (!changed) break;
    layout();
  }

  // ---- pass 2: encode
  pcrelHi.clear();
  const listing = [];  // {addr, word, ln}
  const image = new Uint8Array(sections.bss.base);
  const lineAddrs = new Map();  // source line (1-based) -> first address
  const write32 = (a, w) => { image[a] = w & 0xff; image[a + 1] = (w >>> 8) & 0xff; image[a + 2] = (w >>> 16) & 0xff; image[a + 3] = (w >>> 24) & 0xff; };

  for (const it of items) {
    const addr = addrOf(it.section, it.offset);
    const ctx = makeCtx(addr);
    try {
      if (it.kind === 'data') {
        it.exprs.forEach((e, i) => {
          const v = resolveValue(parseExpr(e, ctx), addr + i * it.unit);
          if (it.unit === 1 && (v < -128 || v > 255)) throw new Error(`byte value ${v} out of range`);
          if (it.unit === 2 && (v < -32768 || v > 65535)) throw new Error(`halfword value ${v} out of range`);
          for (let b = 0; b < it.unit; b++) image[addr + i * it.unit + b] = (v >>> (8 * b)) & 0xff;
        });
        if (!lineAddrs.has(it.ln + 1)) lineAddrs.set(it.ln + 1, addr);
      } else if (it.kind === 'bytes') {
        it.bytes.forEach((b, i) => { image[addr + i] = b & 0xff; });
        if (!lineAddrs.has(it.ln + 1)) lineAddrs.set(it.ln + 1, addr);
      } else {
        const words = encodeInstr(it.op, it.operands, ctx, equ, it.size);
        if (words.length * 4 !== it.size) throw new Error('internal: size mismatch');
        words.forEach((w, i) => { write32(addr + 4 * i, w); listing.push({ addr: addr + 4 * i, word: w >>> 0, ln: it.ln + 1 }); });
        if (!lineAddrs.has(it.ln + 1)) lineAddrs.set(it.ln + 1, addr);
      }
    } catch (e) {
      errors.push({ line: it.ln + 1, message: e.message });
    }
  }
  errors.sort((a, b) => a.line - b.line);
  return {
    ok: errors.length === 0, errors, image, textSize: sections.text.size,
    dataBase: sections.data.base, dataSize: sections.data.size, bssBase: sections.bss.base, bssSize: sections.bss.size,
    symbols: symAddr, listing, lineAddrs,
  };
}

function simpleCtx(equ) {
  return { pc: 0, symbol: (n) => { if (!equ.has(n)) throw new Error(`'${n}' must be a constant here`); return equ.get(n); }, local: () => { throw new Error('local label not allowed here'); } };
}

// %pcrel_hi(sym) at address A records sym for a later %pcrel_lo(A).
const pcrelHi = new Map();
function resolveValue({ value, reloc }, pc) {
  switch (reloc) {
    case null: return value;
    case 'hi': return ((value + 0x800) >> 12) & 0xfffff;
    case 'lo': return sext(value & 0xfff, 12);
    case 'pcrel_hi': pcrelHi.set(pc, value); return (((value - pc) + 0x800) >> 12) & 0xfffff;
    case 'pcrel_lo': {
      if (!pcrelHi.has(value)) throw new Error('%pcrel_lo must name the label of an auipc that used %pcrel_hi');
      return sext((pcrelHi.get(value) - value) & 0xfff, 12);
    }
  }
}

function instrSize(op, operands, equ) {
  switch (op) {
    case 'li': {
      if (operands.length !== 2) throw new Error('li needs rd, imm');
      let v;
      try { v = parseExpr(operands[1], simpleCtx(equ)).value; } catch { throw new Error('li needs a constant immediate (use la for addresses)'); }
      return fitsI(v) ? 4 : ((v - ((((v + 0x800) >> 12) & 0xfffff) << 12)) | 0) === 0 ? 4 : 8;
    }
    case 'la': case 'call': case 'tail': return op === 'la' ? 8 : 4;
    case 'lb': case 'lh': case 'lw': case 'lbu': case 'lhu':
      return (operands.length === 2 && !parseMem(operands[1])) ? 8 : 4;
    case 'sb': case 'sh': case 'sw':
      return (operands.length === 3) ? 8 : 4;
    default:
      if (!(op in INSTR) && !(op in BRANCH_PSEUDO) && !PSEUDO1.has(op)) throw new Error(`unknown instruction '${op}'`);
      return 4;
  }
}

const PSEUDO1 = new Set(['nop', 'mv', 'not', 'neg', 'seqz', 'snez', 'sltz', 'sgtz', 'j', 'jr', 'ret', 'bgt', 'ble', 'bgtu', 'bleu', 'jal', 'jalr']);

function immOf(text, ctx) { return resolveValue(parseExpr(text, ctx), ctx.pc); }

function checkI(v, what = 'immediate') { if (!fitsI(v)) throw new Error(`${what} ${v} does not fit in 12 bits`); return v; }
function checkBr(off) { if (off < -4096 || off > 4094) throw new Error(`branch target out of range (${off} bytes)`); if (off & 1) throw new Error('branch target is misaligned'); return off; }
function checkJ(off) { if (off < -1048576 || off > 1048574) throw new Error(`jump target out of range (${off} bytes)`); if (off & 1) throw new Error('jump target is misaligned'); return off; }

function encodeInstr(op, ops, ctx, equ, size = 4) {
  const n = (k) => { if (ops.length !== k) throw new Error(`${op} expects ${k} operand${k === 1 ? '' : 's'}, got ${ops.length}`); };
  const target = (t) => immOf(t, ctx);
  const I = INSTR[op];
  // --- pseudo-instructions
  switch (op) {
    case 'nop': n(0); return [encI(INSTR.addi, 0, 0, 0)];
    case 'li': { n(2); const rd = reg(ops[0]); const v = parseExpr(ops[1], simpleCtx(equ)).value;
      if (fitsI(v)) return [encI(INSTR.addi, rd, 0, v)];
      const hi = ((v + 0x800) >> 12) & 0xfffff; const lo = (v - (hi << 12)) | 0;
      return lo === 0 ? [encU(INSTR.lui, rd, hi)] : [encU(INSTR.lui, rd, hi), encI(INSTR.addi, rd, rd, sext(lo & 0xfff, 12))]; }
    case 'la': { n(2); const rd = reg(ops[0]); if (rd === 0) throw new Error('la cannot load into zero'); const a = target(ops[1]);
      if (size === 4) { if (!fitsI(a)) throw new Error('internal: la relaxation'); return [encI(INSTR.addi, rd, 0, a)]; }
      const d = (a - ctx.pc) | 0; const hi = ((d + 0x800) >> 12) & 0xfffff; const lo = sext(d & 0xfff, 12);
      return [encU(INSTR.auipc, rd, hi), encI(INSTR.addi, rd, rd, lo)]; }
    case 'mv': n(2); return [encI(INSTR.addi, reg(ops[0]), reg(ops[1]), 0)];
    case 'not': n(2); return [encI(INSTR.xori, reg(ops[0]), reg(ops[1]), -1)];
    case 'neg': n(2); return [encR(INSTR.sub, reg(ops[0]), 0, reg(ops[1]))];
    case 'seqz': n(2); return [encI(INSTR.sltiu, reg(ops[0]), reg(ops[1]), 1)];
    case 'snez': n(2); return [encR(INSTR.sltu, reg(ops[0]), 0, reg(ops[1]))];
    case 'sltz': n(2); return [encR(INSTR.slt, reg(ops[0]), reg(ops[1]), 0)];
    case 'sgtz': n(2); return [encR(INSTR.slt, reg(ops[0]), 0, reg(ops[1]))];
    case 'j': n(1); return [encJ(INSTR.jal, 0, checkJ((target(ops[0]) - ctx.pc) | 0))];
    case 'jal': {
      if (ops.length === 1) return [encJ(INSTR.jal, 1, checkJ((target(ops[0]) - ctx.pc) | 0))];
      n(2); return [encJ(INSTR.jal, reg(ops[0]), checkJ((target(ops[1]) - ctx.pc) | 0))];
    }
    case 'jr': n(1); return [encI(INSTR.jalr, 0, reg(ops[0]), 0)];
    case 'ret': n(0); return [encI(INSTR.jalr, 0, 1, 0)];
    case 'jalr': {
      if (ops.length === 1) return [encI(INSTR.jalr, 1, reg(ops[0]), 0)];
      if (ops.length === 2) { const m = parseMem(ops[1]); if (!m) return [encI(INSTR.jalr, reg(ops[0]), reg(ops[1]), 0)];
        return [encI(INSTR.jalr, reg(ops[0]), m.reg, checkI(m.immText ? immOf(m.immText, ctx) : 0))]; }
      n(3); return [encI(INSTR.jalr, reg(ops[0]), reg(ops[1]), checkI(immOf(ops[2], ctx)))];
    }
    case 'call': { n(1); const off = (target(ops[0]) - ctx.pc) | 0; return [encJ(INSTR.jal, 1, checkJ(off))]; }
    case 'tail': { n(1); const off = (target(ops[0]) - ctx.pc) | 0; return [encJ(INSTR.jal, 0, checkJ(off))]; }
    case 'bgt': n(3); return [encB(INSTR.blt, reg(ops[1]), reg(ops[0]), checkBr((target(ops[2]) - ctx.pc) | 0))];
    case 'ble': n(3); return [encB(INSTR.bge, reg(ops[1]), reg(ops[0]), checkBr((target(ops[2]) - ctx.pc) | 0))];
    case 'bgtu': n(3); return [encB(INSTR.bltu, reg(ops[1]), reg(ops[0]), checkBr((target(ops[2]) - ctx.pc) | 0))];
    case 'bleu': n(3); return [encB(INSTR.bgeu, reg(ops[1]), reg(ops[0]), checkBr((target(ops[2]) - ctx.pc) | 0))];
  }
  if (op in BRANCH_PSEUDO) {
    n(2); const [base, form] = BRANCH_PSEUDO[op]; const rs = reg(ops[0]); const off = checkBr((target(ops[1]) - ctx.pc) | 0);
    return form === 'rs,zero' ? [encB(INSTR[base], rs, 0, off)] : [encB(INSTR[base], 0, rs, off)];
  }
  if (!I) throw new Error(`unknown instruction '${op}'`);
  switch (I.fmt) {
    case 'R': n(3); return [encR(I, reg(ops[0]), reg(ops[1]), reg(ops[2]))];
    case 'I': n(3); return [encI(I, reg(ops[0]), reg(ops[1]), checkI(immOf(ops[2], ctx)))];
    case 'SH': { n(3); const sh = immOf(ops[2], ctx); if (sh < 0 || sh > 31) throw new Error(`shift amount ${sh} out of range`); return [encSH(I, reg(ops[0]), reg(ops[1]), sh)]; }
    case 'U': { n(2); const v = immOf(ops[1], ctx); if (v < -524288 || v > 0xfffff) throw new Error(`immediate ${v} does not fit in 20 bits`); return [encU(I, reg(ops[0]), v & 0xfffff)]; }
    case 'J': { if (ops.length === 1) return [encJ(I, 1, checkJ((target(ops[0]) - ctx.pc) | 0))]; n(2); return [encJ(I, reg(ops[0]), checkJ((target(ops[1]) - ctx.pc) | 0))]; }
    case 'B': n(3); return [encB(I, reg(ops[0]), reg(ops[1]), checkBr((target(ops[2]) - ctx.pc) | 0))];
    case 'L': {
      n(2); const rd = reg(ops[0]); const m = parseMem(ops[1]);
      if (!m && ops[1].includes('(')) throw new Error(`expected ${op} rd, offset(rs1)`);
      if (m) return [encI(I, rd, m.reg, checkI(m.immText ? immOf(m.immText, ctx) : 0, 'offset'))];
      // lw rd, symbol  ->  auipc rd, %pcrel_hi(sym); lw rd, %pcrel_lo(sym)(rd)   (or lw rd, sym(zero) when it fits)
      const a = target(ops[1]);
      if (size === 4) { if (!fitsI(a)) throw new Error('internal: load relaxation'); return [encI(I, rd, 0, a)]; }
      if (rd === 0) throw new Error('load from symbol needs a non-zero destination');
      const d = (a - ctx.pc) | 0; const hi = ((d + 0x800) >> 12) & 0xfffff; const lo = sext(d & 0xfff, 12);
      return [encU(INSTR.auipc, rd, hi), encI(I, rd, rd, lo)];
    }
    case 'S': {
      if (ops.length === 3 && ops[1].includes('(')) throw new Error(`${op} expects 2 operands: ${op} rs2, offset(rs1)`);
      if (ops.length === 3) { // sw rs, symbol, rt   (or sw rs, sym(zero) when it fits)
        const rs = reg(ops[0]); const rt = reg(ops[2]); const a = target(ops[1]);
        if (size === 4) { if (!fitsI(a)) throw new Error('internal: store relaxation'); return [encS(I, 0, rs, a)]; }
        if (rt === 0) throw new Error('store to symbol needs a non-zero scratch register');
        const d = (a - ctx.pc) | 0;
        const hi = ((d + 0x800) >> 12) & 0xfffff; const lo = sext(d & 0xfff, 12);
        return [encU(INSTR.auipc, rt, hi), encS(I, rt, rs, lo)];
      }
      n(2); const rs = reg(ops[0]); const m = parseMem(ops[1]); if (!m) throw new Error(`expected ${op} rs2, offset(rs1)`);
      return [encS(I, m.reg, rs, checkI(m.immText ? immOf(m.immText, ctx) : 0, 'offset'))];
    }
    case 'FENCE': {
      if (ops.length === 0) return [0x0ff0000f];
      n(2); const bits = (s) => (s.includes('i') ? 8 : 0) | (s.includes('o') ? 4 : 0) | (s.includes('r') ? 2 : 0) | (s.includes('w') ? 1 : 0);
      return [((bits(ops[0]) << 24) | (bits(ops[1]) << 20) | 0x0f) >>> 0];
    }
    case 'FIXED': n(0); return [I.word];
  }
  throw new Error(`cannot encode ${op}`);
}
