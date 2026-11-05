// Documentation view: pre-rendered Markdown sections (built by scripts/build-docs.mjs).
import { el } from './format.js';

export class DocsView {
  constructor(root) {
    this.root = root;
    this.nav = el('nav', { class: 'docs-nav', 'aria-label': 'Documentation sections' });
    this.body = el('article', { class: 'docs-body' });
    root.append(this.nav, this.body);
    this.sections = [];
    this.body.append(el('p', { class: 'hint' }, 'Loading documentation…'));
  }
  setSections(sections) {
    this.sections = sections;
    this.nav.replaceChildren(...sections.map((s, i) => el('button', { class: i === 0 ? 'is-active' : '', onclick: () => this.show(s.id) }, s.title)));
    if (sections.length) this.show(sections[0].id);
  }
  show(id) {
    const s = this.sections.find(x => x.id === id); if (!s) return;
    this.body.innerHTML = s.html;
    this.body.scrollTop = 0;
    this.body.querySelectorAll('a[href^="http"]').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
    [...this.nav.children].forEach((b, i) => b.className = this.sections[i].id === id ? 'is-active' : '');
  }
}
