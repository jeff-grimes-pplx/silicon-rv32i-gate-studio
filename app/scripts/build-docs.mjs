// Render docs/*.md into public/data/docs.json for the Documentation view.
import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
const here = path.dirname(new URL(import.meta.url).pathname);
const docsDir = path.join(here, '../../docs');
const ORDER = [
  ['overview', 'OVERVIEW.md', 'Overview and what is live'],
  ['microarchitecture', 'MICROARCHITECTURE.md', 'Microarchitecture'],
  ['verification', 'VERIFICATION.md', 'Verification'],
  ['synthesis', 'SYNTHESIS.md', 'Synthesis report'],
  ['programs', 'PROGRAMS.md', 'Programs and CPI'],
  ['assembler', 'ASSEMBLER.md', 'Assembler'],
  ['limitations', 'LIMITATIONS.md', 'Limitations'],
  ['licenses', 'LICENSES.md', 'Licenses and attribution'],
];
const out = [];
for (const [id, file, title] of ORDER) {
  const p = path.join(docsDir, file);
  if (!fs.existsSync(p)) { console.warn('missing', file); continue; }
  let html = marked.parse(fs.readFileSync(p, 'utf8'));
  // tables with many columns scroll horizontally instead of wrapping
  html = html.replace(/<table>([\s\S]*?)<\/table>/g, (m, body) => {
    const cols = (body.match(/<th>/g) || []).length;
    return cols >= 6 ? `<table class="wide">${body}</table>` : m;
  });
  out.push({ id, title, html });
}
fs.mkdirSync(path.join(here, '../public/data'), { recursive: true });
fs.writeFileSync(path.join(here, '../public/data/docs.json'), JSON.stringify(out));
console.log(`docs.json: ${out.length} sections`);
