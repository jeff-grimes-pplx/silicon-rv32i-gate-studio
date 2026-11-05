// The in-browser assembler against GNU binutils:
//  (1) every curated .S source assembled by both; images compared byte for byte
//  (2) every program's objdump listing (C programs included) re-assembled; words compared
import fs from 'node:fs';
import path from 'node:path';
import { assemble } from '../app/src/asm.js';
import { disasm } from '../app/src/disasm.js';

const root = new URL('../programs/', import.meta.url);
let fails = 0, checks = 0;

for (const f of fs.readdirSync(new URL('asm/', root))) {
  if (!f.endsWith('.S')) continue;
  const name = f.slice(0, -2);
  const src = fs.readFileSync(new URL('asm/' + f, root), 'utf8');
  const r = assemble(src);
  const gnu = new Uint8Array(fs.readFileSync(new URL(`build/${name}.bin`, root)));
  const mine = r.image;
  let ok = r.ok;
  const n = Math.max(gnu.length, mine.length);
  let firstDiff = -1;
  for (let i = 0; i < n; i++) if ((gnu[i] ?? 0) !== (mine[i] ?? 0)) { firstDiff = i; break; }
  if (firstDiff >= 0) ok = false;
  checks++; if (!ok) fails++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} source ${name}.S: ${mine.length} bytes (gnu ${gnu.length})${firstDiff >= 0 ? ` first diff at 0x${firstDiff.toString(16)}` : ''}${r.errors.length ? ' errors: ' + r.errors.map(e => `L${e.line} ${e.message}`).join('; ') : ''}`);
}

for (const f of fs.readdirSync(new URL('build/', root))) {
  if (!f.endsWith('.dis')) continue;
  const name = f.slice(0, -4);
  const lines = fs.readFileSync(new URL('build/' + f, root), 'utf8').split('\n');
  const src = []; const expect = [];
  for (const l of lines) {
    const m = l.match(/^\s*([0-9a-f]+):\s+([0-9a-f]{8})\s+(\S+)\s*(.*)$/);
    if (!m) continue;
    const addr = parseInt(m[1], 16), word = parseInt(m[2], 16) >>> 0; let mn = m[3], ops = m[4].replace(/\s*#.*$/, '').trim();
    ops = ops.replace(/\b([0-9a-f]+) <[^>]*>/g, '0x$1');  // control-flow targets as absolute addresses
    if (mn === 'unimp') { mn = '.word'; ops = '0x' + word.toString(16); }
    src.push(`${mn} ${ops}`); expect.push({ addr, word });
  }
  // gaps (e.g. padding) are not present in listing: assemble as a contiguous stream and compare in order
  const r2 = assemble(src.join('\n'));
  let ok = r2.ok, mism = 0;
  if (ok) {
    for (let i = 0; i < expect.length; i++) {
      const a = r2.listing[i];
      if (!a || a.word !== expect[i].word) { mism++; if (mism <= 3) console.log(`   ${name} @${expect[i].addr.toString(16)} ${src[i]}: mine ${a?.word?.toString(16)} gnu ${expect[i].word.toString(16)}`); }
    }
    // addresses must be contiguous for the comparison to be meaningful
    for (let i = 1; i < expect.length; i++) if (expect[i].addr !== expect[i - 1].addr + 4) { ok = false; console.log(`   ${name}: non-contiguous listing at ${expect[i].addr.toString(16)}`); break; }
  } else console.log('   errors:', r2.errors.slice(0, 3).map(e => `L${e.line} ${e.message} :: ${src[e.line - 1]}`).join(' | '));
  if (mism) ok = false;
  checks++; if (!ok) fails++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} objdump round-trip ${name}: ${expect.length} instructions, ${mism} mismatches`);
  // disassembler round trip: disasm(word) must re-assemble to the same word
  let dmism = 0;
  for (const { addr, word } of expect) {
    const d = disasm(word, addr);
    if (d.kind === 'illegal') continue;
    const text = d.text.replace(/\b([0-9a-f]+)( <[^>]*>)?$/, (m0, a, s) => (d.kind === 'branch' || d.kind === 'jump') ? '0x' + a : m0);
    const rr = assemble(`.space ${addr}\n${text}`);
    if (!rr.ok || rr.listing[0]?.word !== word) { dmism++; if (dmism <= 3) console.log(`   disasm ${name}: ${word.toString(16)} -> "${text}" -> ${rr.ok ? rr.listing[0]?.word?.toString(16) : rr.errors[0].message}`); }
  }
  checks++; if (dmism) fails++;
  console.log(`${dmism ? 'FAIL' : 'OK  '} disassembler round-trip ${name}: ${dmism} mismatches`);
}
console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
