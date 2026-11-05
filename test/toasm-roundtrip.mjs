import fs from 'node:fs';
import { imageToAsm } from '../app/src/toasm.js';
import { assemble } from '../app/src/asm.js';
const manifest = JSON.parse(fs.readFileSync(new URL('../app/public/data/programs.json', import.meta.url)));
let fails = 0;
for (const p of manifest.programs) {
  const image = Uint8Array.from(Buffer.from(p.image, 'base64'));
  const src = imageToAsm(image, p.textSize, p.symbols, p.dataEnd);
  const r = assemble(src);
  let ok = r.ok;
  if (ok) for (let i = 0; i < Math.max(image.length, r.image.length); i++) if ((image[i] ?? 0) !== (r.image[i] ?? 0)) { ok = false; console.log(`  ${p.name}: byte ${i.toString(16)} differs`); break; }
  if (ok && r.bssBase < p.dataEnd) { ok = false; console.log(`  ${p.name}: region too short ${r.bssBase} < ${p.dataEnd}`); }
  if (!ok) { fails++; console.log('FAIL', p.name, r.errors.slice(0, 3)); } else console.log('OK  ', p.name, src.split('\n').length, 'lines');
}
console.log(fails ? `${fails} failures` : 'toasm round-trip: all programs reassemble to the identical image');
process.exit(fails ? 1 : 0);
