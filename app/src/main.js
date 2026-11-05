import './style.css';
import { Session } from './session.js';
import { GateTracker } from './gatetrack.js';
import { PipelineView } from './ui/pipeline.js';
import { ProgramPanel } from './ui/program.js';
import { RegsPanel, MemoryPanel, EventsPanel } from './ui/state.js';
import { Transport } from './ui/transport.js';
import { NetlistView, MiniDiePanel } from './ui/netlist.js';
import { DocsView } from './ui/docs.js';
import { el } from './ui/format.js';

const $ = (sel) => document.querySelector(sel);

async function boot() {
  const manifest = await (await fetch('data/programs.json')).json();
  const programs = manifest.programs.map(p => ({ ...p, image: Uint8Array.from(atob(p.image), c => c.charCodeAt(0)), toolchain: `${manifest.toolchain.gcc.replace(/\(.*\)\s*/, '')} (-O2 -march=rv32i -mabi=ilp32)` }));

  const session = new Session(64 * 1024);
  let tracker = null, netlistView = null;
  let program = null;

  // ---- views
  const main = $('.main');
  const pipeline = new PipelineView($('#pipeline'), new Map());
  const miniDie = new MiniDiePanel($('#die-panel'), () => setView('netlist'));
  const regs = new RegsPanel($('#regs-panel'), session);
  const mem = new MemoryPanel($('#mem-panel'), session);
  const events = new EventsPanel($('#events-panel'), session, (c) => session.seekCycle(c));
  const programPanel = new ProgramPanel($('#side-program'), { session, onLoad: (p) => loadProgram(p, true) });
  const transport = new Transport($('#transport'), session, null, { onSeek: (c) => session.seekCycle(c), forwards: () => session.core.fwds });
  const docs = new DocsView($('#work-docs'));
  fetch('data/docs.json').then(r => r.json()).then(d => docs.setSections(d)).catch(() => docs.setSections([{ id: 'missing', title: 'Documentation', html: '<p>Documentation bundle not found.</p>' }]));

  const netlistRoot = $('#work-netlist');
  netlistRoot.append(el('div', { class: 'nl-side' }, el('div', { class: 'nl-section' }, el('h3', {}, 'Netlist'), el('p', {}, 'Loading the synthesized netlist (0.8 MB)…'))), el('div', { class: 'nl-canvas-wrap' }));

  // ---- program select
  const sel = $('#program-select');
  const groups = { c: el('optgroup', { label: 'C programs (compiled with GCC)' }), asm: el('optgroup', { label: 'Assembly programs' }) };
  for (const p of programs) groups[p.kind].append(el('option', { value: p.name }, `${p.name} — ${p.title}`));
  sel.append(groups.c, groups.asm);
  const userGroup = el('optgroup', { label: 'Edited in the browser' });
  sel.addEventListener('change', () => { const p = programs.find(x => x.name === sel.value) || userPrograms.get(sel.value); if (p) loadProgram(p, false); });
  const userPrograms = new Map();

  function loadProgram(p, fromEditor) {
    program = p;
    const symMap = new Map(); for (const s of p.symbols) if (!symMap.has(s.addr)) symMap.set(s.addr, s.name);
    pipeline.setSymbols(symMap);
    events.setSymbols(symMap);
    events.reset();
    session.load(p);
    mem.setProgram(p);
    if (p.kind === 'user') {
      if (!userPrograms.has(p.name)) { userPrograms.set(p.name, p); if (!userGroup.parentNode) sel.append(userGroup); userGroup.append(el('option', { value: p.name }, `${p.name}`)); }
      else userPrograms.set(p.name, p);
      sel.value = p.name;
      if (!fromEditor) programPanel.setProgram(p); else programPanel.rebind(p);
    } else { sel.value = p.name; programPanel.setProgram(p); }
    document.title = `Silicon — ${p.name}`;
    updateAll();
  }

  // ---- update plumbing
  let pendingFrame = false;
  function updateAll() {
    pipeline.update(session);
    regs.update();
    mem.update();
    programPanel.updateListing();
    transport.update(program);
    if (!session.running) { events.rebuildRecent(); events.record(); events.render(); }
    else if (transport.speed <= 30) { events.record(); events.render(); }
    if (tracker) {
      const fast = session.running && transport.speed > 1000;
      if (!fast) tracker.seek(session.core.cycle);
    }
  }
  session.addEventListener('cycle', () => { if (pendingFrame) return; pendingFrame = true; requestAnimationFrame(() => { pendingFrame = false; updateAll(); }); });
  session.addEventListener('stop', () => { updateAll(); if (tracker) tracker.seek(session.core.cycle); });
  session.addEventListener('run', () => transport.update(program));
  session.addEventListener('breakpoints', () => programPanel.updateListing());

  // ---- view tabs
  function setView(v) {
    main.dataset.view = v;
    document.querySelectorAll('.view-tab').forEach(b => { const on = b.dataset.view === v; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on); });
    const showPipe = (v === 'pipeline' || v === 'split' || v === 'state' || v === 'program');
    $('#work-pipeline').hidden = !showPipe;
    $('#work-pipeline').classList.toggle('is-split', v === 'split');
    miniDie.show(v === 'split');
    $('#work-netlist').hidden = v !== 'netlist';
    $('#work-docs').hidden = v !== 'docs';
    netlistView?.show(v === 'netlist');
    if ((v === 'netlist' || v === 'split') && tracker) tracker.seek(session.core.cycle);
    mem.layout();
  }
  document.querySelectorAll('.view-tab').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

  // ---- keyboard
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (e.key === ' ') { e.preventDefault(); if (session.running) session.pause(); else session.stepOnce(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (!session.running) session.stepBack(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); if (!session.running) session.stepOnce(); }
    else if (e.key === 'Enter') { e.preventDefault(); transport.toggleRun(); }
    else if (e.key === 'r' || e.key === 'R') { session.reset(); }
    else if (e.key === '1') setView('pipeline');
    else if (e.key === '2') setView('split');
    else if (e.key === '3') setView('netlist');
    else if (e.key === '4') setView('docs');
  });

  // ---- initial program: hazards.S at cycle 4, where two forwards are active
  const first = programs.find(p => p.name === 'hazards') || programs[0];
  loadProgram(first, false);
  for (let i = 0; i < 4; i++) session.stepOnce();
  session.stopReason = 'initial';
  updateAll();

  // ---- netlist (loaded after first paint)
  try {
    const nl = await (await fetch('data/netlist.compact.json')).json();
    tracker = new GateTracker(nl, session);
    transport.tracker = tracker;
    netlistRoot.replaceChildren();
    netlistView = new NetlistView(netlistRoot, nl, tracker, session);
    miniDie.bind(nl, tracker, session);
    tracker.addEventListener('update', () => { transport.update(program); miniDie.draw(); });
    tracker.addEventListener('progress', () => transport.update(program));
    tracker.seek(session.core.cycle);
    netlistView.show(main.dataset.view === 'netlist');
    miniDie.show(main.dataset.view === 'split');
    transport.update(program);
  } catch (e) {
    console.error(e);
    netlistRoot.replaceChildren(el('div', { class: 'nl-side' }, el('div', { class: 'nl-section' }, el('h3', {}, 'Netlist'), el('p', {}, `Could not load the netlist: ${e.message}`))));
  }
}

boot();
