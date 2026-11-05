// Turn a machine-code image back into assemblable GNU-dialect source: labels
// for every branch/jump target and known symbol, .word data for the data
// region. Reassembling the result reproduces the image byte for byte
// (checked in test/toasm-roundtrip.mjs for all curated programs).
import { disasm } from './disasm.js';

export function imageToAsm(image, textSize, symbols = [], dataEnd = image.length) {
  const words = [];
  for (let a = 0; a < textSize; a += 4) words.push((image[a] | (image[a + 1] << 8) | (image[a + 2] << 16) | (image[a + 3] << 24)) >>> 0);
  const symAt = new Map();
  for (const s of symbols) if (!symAt.has(s.addr)) symAt.set(s.addr, s.name);
  // targets
  const targets = new Set();
  words.forEach((w, i) => { const d = disasm(w, i * 4); if (d.target !== undefined) targets.add(d.target); });
  const labelFor = new Map();
  let n = 0;
  for (const t of [...targets].sort((a, b) => a - b)) labelFor.set(t, symAt.get(t) ?? `L${n++}`);
  for (const [a, name] of symAt) if (!labelFor.has(a)) labelFor.set(a, name);
  const lines = ['    .text', '    .globl _start'];
  if (!labelFor.has(0)) labelFor.set(0, '_start');
  for (let i = 0; i < words.length; i++) {
    const a = i * 4;
    if (labelFor.has(a) && a < textSize) lines.push(`${labelFor.get(a)}:`);
    const d = disasm(words[i], a);
    let text = d.text;
    if (d.target !== undefined) {
      const lab = labelFor.get(d.target) ?? `0x${d.target.toString(16)}`;
      text = text.replace(/0x[0-9a-f]+( <[^>]*>)?$/, lab);
    }
    if (d.kind === 'illegal') text = `.word 0x${words[i].toString(16)}`;
    lines.push(`    ${text}`);
  }
  // data region as words, with symbol labels
  const dStart = (textSize + 3) & ~3;
  if (dataEnd > dStart) {
    lines.push('', '    .data');
    const dataSyms = symbols.filter(s => s.addr >= dStart && s.addr < dataEnd).sort((a, b) => a.addr - b.addr);
    let si = 0;
    for (let a = dStart; a < dataEnd; a += 4) {
      while (si < dataSyms.length && dataSyms[si].addr <= a) { if (dataSyms[si].addr === a) lines.push(`${dataSyms[si].name}:`); si++; }
      if (a + 4 <= image.length) {
        const w = (image[a] | (image[a + 1] << 8) | (image[a + 2] << 16) | (image[a + 3] << 24)) >>> 0;
        lines.push(`    .word 0x${w.toString(16)}`);
      } else {
        // partial last word of the initialised image, then zero-filled space (bss)
        const tail = [];
        for (let b = a; b < image.length; b++) tail.push('0x' + image[b].toString(16));
        if (tail.length) lines.push(`    .byte ${tail.join(', ')}`);
        const rest = dataEnd - a - tail.length;
        if (rest > 0) lines.push(`    .space ${rest}`);
        break;
      }
    }
  }
  return lines.join('\n') + '\n';
}
