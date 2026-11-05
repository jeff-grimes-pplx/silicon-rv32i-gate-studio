# A8 · Silicon — handoff

Silicon is an original five-stage in-order RV32I core (`rtl/silicon_core.sv`, 574 lines of SystemVerilog, Apache-2.0), verified 38/38 against riscv-arch-test 2.7.4 under Verilator 5.032, synthesized with Yosys 0.52 to 8,297 generic cells, and shown in the private app **Silicon** (deployed in place, asset `b1e153b5-4e88-4563-b2be-01faa40bb8b0`). The browser runs a cycle-accurate twin of the core (`app/src/core.js`) whose per-cycle trace is identical to the RTL on every arch test and every program, and evaluates the real Yosys netlist every cycle (`app/src/gatesim.js`) for the netlist explorer. Both films are frame-stepped captures of that app running the `primes` program; every number on screen is the simulator's.

## What is live, what is not

| Part | Status |
|---|---|
| Assembly | Live. Any program can be edited in the Assembly tab and is assembled in the browser by Silicon's own two-pass assembler (`app/src/asm.js`): byte-identical to GNU as/ld on all curated programs (41 checks), 110 random programs (3 seeds) and 16 disassembly round-trips; 23 negative tests with line-numbered errors. |
| C | Not live. The ten C programs were compiled once in the sandbox with `riscv64-unknown-elf-gcc 14.2.0 -O2 -march=rv32i -mabi=ilp32`; the browser receives machine code, symbols and the DWARF line table (`programs/build.sh`). The C source is read-only; its disassembly can be edited and reassembled (round-trip identical). |
| Pipeline simulation | In the browser (`core.js`). Trace-identical to the Verilator RTL run: 38/38 arch tests, 17/17 programs. |
| Gate-level activity | In the browser (`gatesim.js`) over the real netlist; port outputs checked against the behavioural model every cycle ("gate-level ≡ RTL" chip, 0 mismatches). The same netlist under Verilator matches the RTL on all 55 binaries. |
| Spike comparison | Not done: Spike's debug module occupies 0x0–0xfff and the programs link at 0. The signature-based arch tests are the reference instead. |

## Microarchitecture (docs/MICROARCHITECTURE.md)

IF/ID/EX/MEM/WB with four pipeline registers; static not-taken prediction, branches and jumps resolved in EX, redirect flushes IF/ID and ID/EX (a taken branch costs two cycles). Three-way forwarding into both EX operands (EX/MEM has priority over MEM/WB), WB → ID register-file bypass, one-cycle load-use stall with precise rs1/rs2 usage decode. Separate instruction and data ports (data with byte enables) into one single-cycle RAM (64 KiB for the programs, 4 MiB for the arch tests), no caches, no traps; `ecall`/`ebreak` halt the core after draining. RV32I only (no M, Zicsr); `fence`, CSR and illegal instructions retire as NOPs. Cycle identity, true for all 16 programs: cycles = 4 + instret + stalls + 2 × flushes.

## Verification (docs/VERIFICATION.md)

| Suite | Result | Receipt |
|---|---|---|
| riscv-arch-test 2.7.4 rv32i_m/I, Verilator, signature compare | 38 / 38 pass | `archtest/results.md` (table with cycles, instret, CPI per test); rerun `archtest/run.sh` |
| Hazard and branch checks on the Verilator RTL trace (`hazards`, `sum`, `branches`, `calls`, `memcopy`) | 32 / 32 | `test/results/hazards-rtl.txt`, `test/hazards-rtl.mjs` |
| Browser twin vs RTL, per-cycle trace + final registers + memory | 38 / 38 arch, 17 / 17 programs | `test/results/archtest-js-vs-rtl.txt`, `programs-js-vs-rtl.txt` |
| Gate-level (Yosys netlist, Verilator) vs RTL: port trace, final memory, cycle count | 55 / 55 (17 programs + 38 arch) | `test/results/verilator-gate.md`, `test/run-verilator-gate.sh` |
| Browser gate evaluator vs behavioural model, every cycle | 38 / 38 arch | `test/results/archtest-jsgate-vs-rtl.txt` |
| Assembler vs GNU as/ld | 41 / 41; fuzz 40 + 40 + 30 / 110; negatives 23 / 23; round-trip 16 / 16 | `test/results/asm-*.txt`, `toasm-roundtrip.txt` |
| Session / gate tracker (seek, step back, breakpoints) | 4 programs pass | `test/results/session-gatetrack-*.txt` |

The targeted hazard program (`programs/asm/hazards.S`, 16 instructions retire) shows at cycle 4 `add t2,t0,t1` with t0 from MEM/WB and t1 from EX/MEM (FORWARD ×2), at cycle 9 the load-use stall (`lw t5` in EX, `addi t6,t5,1` held in ID, bubble at cycle 10) and at cycle 16 the taken `bne` flushing two fetched instructions; the app annotates each and the RTL trace confirms them.

## Synthesis (docs/SYNTHESIS.md)

`synth/synth.ys`: `read_verilog -sv; hierarchy -check; synth -top silicon_core -flatten; dfflegalize` (plain, enable and sync-reset positive-edge flops only); `abc -g AND,NAND,OR,NOR,XOR,XNOR,MUX; opt_clean -purge; stat; ltp -noff; write_json; write_verilog`. Generic Yosys cells, no technology library.

| Cell | Count | | Cell | Count |
|---|---:|---|---|---:|
| NAND | 2,298 | | NOT | 396 |
| MUX | 1,784 | | XOR | 119 |
| AND | 1,234 | | XNOR | 116 |
| DFFE_PP (regfile) | 992 | | NOR | 83 |
| OR | 781 | | SDFF_PP0 | 10 |
| SDFFE_PP0P | 474 | | DFF_P | 10 |

Total 8,297 cells: 1,486 flip-flops, 6,811 gates. Longest topological path (Yosys `ltp`): 76 levels, `memwb_rd[4]` → forwarding compare → ALU → `dmem_addr[31]` flop; several paths tie. Unit-delay logic depth only: no timing library exists for the generic cells, so no nanosecond figure is claimed. `synth/compact_netlist.py` turns the 4.8 MB Yosys JSON into the 0.78 MB `app/public/data/netlist.compact.json` (same cells, same connectivity, stage grouping and layout added); the app's cell total and per-type counts are the Yosys `stat` numbers.

## Programs and CPI (docs/PROGRAMS.md)

Sixteen curated programs (10 C, 6 assembly) plus `smoke` for the tests. Cycles and instret are from the Verilator RTL run (`programs/build/<name>.run`); the app compares a finished run's a0 with the recorded value.

| Program | a0 | Cycles | Instret | CPI |
|---|---|---:|---:|---:|
| primes (sieve) | 541 | 16,700 | 11,451 | 1.458 |
| fib | 832040 | 456 | 324 | 1.407 |
| gcd | 21 | 864 | 554 | 1.560 |
| bubble | 62 swaps | 1,326 | 842 | 1.575 |
| crc32 | 0x57ef2b5d | 2,570 | 2,032 | 1.265 |
| matmul | 175 | 1,075 | 749 | 1.435 |
| strrev | 25 | 330 | 249 | 1.325 |
| bsearch | 21 | 377 | 295 | 1.278 |
| collatz | 97 | 24,841 | 17,975 | 1.382 |
| mandel | 144 | 2,288,139 | 1,605,069 | 1.426 |
| hazards (asm) | 103 | 23 | 16 | 1.438 |
| branches (asm) | 55 | 56 | 34 | 1.647 |
| sum (asm) | 1240 | 127 | 87 | 1.460 |
| multiply (asm) | 56088 | 83 | 53 | 1.566 |
| memcopy (asm) | 32 | 188 | 128 | 1.469 |
| calls (asm) | 74 | 98 | 66 | 1.485 |

## Films — the 60 s film (v4: wide-first camera, product rendered at 1.5 px per CSS px, kit v4 captions; current release candidate + clean film)

Two deliveries with the same 3,600 frames (1920×1080, 60/1, H.264 yuv420p bt709, 60.000 s, silent, nb_frames = nb_read_frames = 3600, every pts delta 1/60 s): `film/v4/out/silicon-60s-captioned.mp4` — 31,994,881 B, SHA-256 `9367ad9bfe608b289fa402396a426c41dab412a1f5b54b15d180c0062581f42a`, asset `db981c2b-91a1-4208-8fdf-9f5881dff310` — and `film/v4/out/silicon-60s.mp4` (clean) — 32,999,758 B, SHA-256 `92037aad0fed5012e0137dbea0471554e3644cfe5589bd3b84ab16b052d02727`, asset `960e58a8-7170-4041-b75b-87246895ae97`. Master (CRF 8 yuv444p intermediate, kept): `silicon-60s-master.mp4`, SHA-256 `f59535bb0d164a288849365acb462e634c990cc5fbfcd48c7d67cf99cbaf35bd`. Receipts: `film/v4/films-v4.md` (asset `07aac437-252f-4ba6-98c1-10ae11cab867`). The v3 pair (45 s) stays as assets `89b37e76-4789-42eb-be06-3bb27fda3ab4` / `6e087a70-bf39-40a0-9f6a-4e9f1b6d368f` with receipts `089271cb-1b76-45fd-a2b6-93bdfddd526d`; nothing was deleted.

**What v4 changed and why.** Jeff's notes of 2026-10-21 (set the scene with a zoomed-out view; the v3 cut was too zoomed in for much of its length; plain captions, bottom block) became the parent's standard v4. v4 therefore (1) renders the product at CSS 1280×720 into the 1920×1080 frame (1.5 output px per CSS px, each frame a native Chromium re-rasterisation of the camera window, never an upscale), with the app's type scale and layout adjusted so the smallest text the viewer must read at 1.0× is 21.0 px em and the counters 24.0 px em (v4a–v4d, `film/v4/measure/app-changes-v4.md`); (2) holds the whole populated workbench at 1.0× for the first 9.4 s (the C program, the pipeline at cycle 8, registers, memory, events) and returns to 1.0× after every push-in, so 2,451 of 3,600 frames (68.1 %) are at exactly 1.0× and 73.8 % at ≤ 1.25×, the kit's wide threshold (`camera_budget.py` exit 0); (3) uses four push-ins only — the stopped cycle counter (1.8×, 294 frames = 4.9 s above the kit's 1.25× wide threshold), the stall/forward cards during space-stepping (1.8×, 282 frames = 4.7 s), the Find field while `a0` is typed (1.795×, 149 frames = 2.5 s) and the 2.0× payoff on `a0 = 0000021d (541)` (218 frames = 3.6 s, 190 frames = 3.2 s above 1.8×) — each a 60-frame cubic ease on log zoom about a fixed page point, with 285 / 682 / 481 wide frames between the runs and the gate view re-established at 1× for 8.2 s before its push-in; (4) burns the parent's kit v4 captions (12 natural-sentence lines, Lato Bold 60 px on the opaque #1b262b bottom block, libass em 50 px, kit note v4.1 line splits), every caption ≥ 3.35 s and ≥ 0.065 s per character, cues derived from the executed record rather than typed and placed so no caption changes during a camera move, ≥ 24 px clear of the pointer, click targets, typed field and every value a caption names (`refcheck-v4.py` exit 0, worst +33.3 px), `caption_lint.py` exit 0, `verify_captions_v3.py` exit 0 on all 24 checked frames; (5) runs 60 s because the direction asks for a 5-s opener, wide consequence beats between every push-in and twelve captions at natural reading speed, which does not fit 45 s without dropping the stepping sequence or the gate view.

**Story (frames at 60 fps).** 0–565 opener at 1× (captions 1–2); f562 Machine code tab; f750 breakpoint on `j 0x58` at 0x44; f863 Run at 1 k cycles/s, the counters count 8 → 1,465 in 87 frames (per-frame deltas 16/17, mean 16.75 cycles/frame) and stop on the breakpoint at f953 (captions 3–4); push-in on the stopped counter f1006–1065, hold 228 frames, pull f1294–1353; Space ×5, the cycle changing at f1384/1461/1543/1717/1795 (cycles 1,466–1,470: the load-use stall at 1,468 with STALL · HOLD · BUBBLE and the hazard line `load-use (a5) waits for the load`, the bubble at 1,469, FORWARD ×1 with `A a5 ←MEM/WB 00000000` at 1,470), push-in on the cards f1585–1644 and pull f1861–1920 (captions 5–7); f2052 Netlist tab (caption 8, the gate view at 1×); f2314 Run, the 8,297 cells switching at 1× (caption 9); f2509 Find field, push-in f2549–2608, `a0` typed f2633–2644, result `register a0 (x10) — 32 flops · group` on one line, pull f2692–2751, Enter at f2776 selects the 32-flop group at 1× (caption 10); f2953 Stop at cycle 12,120, f3023 To end runs to the halt at 16,700 synchronously inside the click's frame (caption 11); payoff push-in f3180–3239 to 2.0× on the halt chip `halted at cycle 16,700 · a0 = 0000021d (541) · 599 of 8,297 cells toggled` with the a0 row highlighted below it, pull f3390–3449, final 1× frames to f3599 (caption 12 "The answer is 541, the hundredth prime."). All 13 logged counter states and 17/17 probe event states are reproduced by a fresh lockstep run of `core.js` + `gatesim.js` (`receipts-v4/number-receipts.md`); the final a0 and cycle count equal the Verilator run.

**Pointer and motion.** The real Playwright pointer performs every hover, click and keystroke; the arrow sprite is drawn in-page at that pointer and composited (disclosed in `capture.json`). Nine travels on cubic ease, peak 732 CSS px/s (1,098 output px/s at 1×), never cut by a window edge (0 off-window frames), no teleport: every travel starts where the previous ended, and `To end` is clicked at `Stop`'s point because the two labels share one button. No cuts (one continuous capture), no speed ramps, no retiming; motion profile and log agreement in `films-v4.md` §3 (one isolated jump > 8 levels, the Netlist tab's view change at its logged click; 12 sustained runs, all inside camera moves or at logged events); the literal 160×90 duplicate metric is explained there with full-resolution changed-pixel counts (0 exact duplicates among 1,136 motion pairs; the stricter alternation cadence test flags 0 windows).

**Product changes for v4** (`app-changes-v4.md`, hashes in `app-hashes-v4.txt`): v4a type scale and fit at 1280×720 (tokens 11/12/13 → 14/16/15 etc., registers/memory/pipeline-card sizes, Find field 15 px, netlist side panel 12.5 px); v4b the halt chip phrased as one line with the figure in bold; v4c the Find result row labelled `register a0 (x10) — 32 flops` with wrap-safe rows; v4d, for the 1280-px capture width only (media query 901–1599 px), a two-row transport bar (timeline and halt chip above, controls, speed, counters and status message below, so the counters are whole at 1× and clear of the caption block at the 1.8× push-in), a 57 % pipeline / 43 % program split with the pipeline cards at scale 0.775 (keys 16.3, values 19.2 px em at 1×; 29.3 / 34.5 at 1.8×), the hazard line `load-use (a5)`, 19-px register rows and 20-px listing rows (the breakpoint row 0x44 is whole above the listing's bottom edge). Deployed in place each time (asset unchanged; hosted files byte-identical to `app/dist` except the host's injected inline-edit script); v4d bundle hash `fe5d59748d6e1c4f3c49a7e83933ef69fd92c5bfc0d2be804b1911946488ae76`. The Project rule to load `user:app-build-rules` before UI edits could not be followed literally — the skill is not available in this session — so the rules as written in the Project instructions were applied (proportional edits, no new chrome, badges, hints or marketing copy) and this is disclosed rather than claimed as compliance with the skill's checklists.

**Disclosures.** Two caption texts depart from the kit's A8 baseline: caption 4 reads "The breakpoint stops the processor / at clock cycle 1,465." for the baseline's "A breakpoint stops the chip at clock cycle 1,465." ("processor" because the film never calls it a chip; "The" because the split must come before "at" — v3 §7.1 forbids a line ending on at, which the first v4d burn did and the independent review caught — and because the resulting 549–1372 px block hides the INSTRET … FORWARDS counter labels but for a 4-px sliver of INSTRET's I and an 8-px sliver of FORWARDS' S at its edges, where the kit's own split would cut both labels mid-word; a wider wording that covers them whole, "The breakpoint stopped the processor", was built and abandoned because its 518–1403 px block comes within 12.8 px of the counter value the caption names, against the 24-px rule — `receipts-v4d3-abandoned/`; the cue runs f1069–1289 inside the static 1.8× hold f1065–1294, 220 frames for the 219 its 56 characters need), and caption 12 is a one-line "The answer is 541, the hundredth prime." instead of the two-line baseline, because at the 2.0× payoff the highlighted a0 row (a referent) sits at output y 846–904 and a two-line block (top 891) would cover it; the halt cycle 16,700 is on screen in the chip for the whole caption. Caption 5 ("Press space and the pipeline …") enters 5 frames before the pull-back from the counters and spans it, so the pipeline is not on screen for its first 65 frames (the kit allows neither a gap > 0.4 s between cues nor a change during a move). Window edges and the block cover inert chrome: at the counter push-in the block hides the labels INSTRET · CPI · STALLS · FLUSHES · FORWARDS, except the two edge slivers above (their values show below it; CYCLE label and value are clear, +56.0 / +33.3 px), and during the push-in itself (f1006–1065) caption 3's narrower block crosses INSTRET and FORWARDS as they scale up under it; at the stall push-in the right edge cuts the `MEM/WB` stage label to `ME` and the bottom edge cuts the `ra` register row; at the Find push-in the bottom edge cuts the side panel under `ACTIVITY THIS CYCLE`; at 1× the timeline strip and gate canvas sit under the block and are not referents. Under the §3.3 thresholds and stated rather than hidden: pipeline-card headers 27.2 px em at 1.8× (labels want 28) and the cards' pc values 31.4 px em (readouts want 32); no caption cites either. At 1× the card fields are 16.3/19.2 px em and the register rows 18.0 px em, below the 20-px floor for text the viewer must read, and are read at the push-ins instead (29.3/34.5 and 32.4 px em). Clicks at 1× act on 19.5–22 px em controls because the direction asks for those beats wide. `To end` reaches the halt in one frame (12,120 → 16,700 cycles) because the product runs it synchronously. Earlier v4 renders are kept, not delivered: `film/v4/work-v4b/` (v4b app), `film/v4/work-v4c/` + `film/v4/out-v4c/` + `film/v4/measure/receipts-v4c/` (v4c app; failed independent review on three frame ranges: caption changes inside camera moves, counters half-covered by the 1× block, the forwarded value at 30 px em and the INSTRET label sliced by the 1.8× window) with its review `independent-review-v4.md`; `film/v4/out-v4d1/` + `work-v4d1/` + `receipts-v4d1/` (the v4d render's first caption burn, split after "at", failed the independent review on that one range); `film/v4/out-v4d2/` + `work-v4d2/` + `receipts-v4d2/` (the second burn, byte-identical to the delivery, kept as the archive copy); `receipts-v4d3-abandoned/` (the wider caption-4 wording, stopped at refcheck). The delivered pair is the v4d render with the second caption burn.

**Independent review (§6).** A fresh reviewer agent measured the decoded frames against the two kit questions (`film/v4/measure/review-brief-v4.md`; reports `independent-review-v4d.md` and `independent-review-v4d-recheck.md`, both reproduced in `films-v4.md` §10; the earlier v4c render's review, `independent-review-v4.md`, failed on three ranges and that render was replaced by v4d). Pass 1, on the v4d render's first caption burn — question 1 (every frame range breaking 2A, 3 v4 or 7 v4): one range, f1072–1287, caption 4's first line ending on "at" (v3 §7.1); everything else measured within the rules: zoomed runs 294 / 282 / 149 / 218 frames (max 300), wide 73.8 %, camera within ±3 % of `camera.csv`, pointer peak 732 CSS px/s = 1,098 px/s at 1×, pointer ≥ 59.6 px from the block, text at the push-ins 43 px em (1,465), 32 (CYCLE), 29.2 / 34.4 (card keys / values), 34.5 (forwarded value), ≈ 41 (typed a0), 48.0 (payoff digits), captioned = clean outside the block, durations 3.35–8.50 s; question 2 (when could a stranger first say what this is): at second 0, "a CPU simulator running in a web browser", because the words and the picture agree, with "running a C program that finds the first hundred primes" by second 5. Fix: caption 4 rebuilt with the forced split ("The breakpoint stops the processor / at clock cycle 1,465."), cues 3–5 re-cut to f562–1069 / 1069–1289 / 1289–1543, captions re-burned on the unchanged clean film, lint, refcheck and verify re-run (exit 0 each). Pass 2, on the delivered burn: PASS on all six checks — no line ends on a §7.1 word; the block changes exactly at f1069 and f1289 inside the static hold f1065–1294 (clean-film frame differences 1065→1069 ≤ 0.033, 1286→1294 = 0.0); measured block 549–1371 × 891–1016 = geometry; "1,465" ink 38 px horizontal, 20 px vertical, 43 px nearest-point clear of the block, CYCLE 61 px; INSTRET · CPI · STALLS · FLUSHES · FORWARDS under the block but for the 4-px and 8-px edge slivers; cues 3 / 4 / 5 hold 8.450 / 3.667 / 4.233 s against the 3.185 / 3.640 / 3.575 s their characters need; `verify_captions_v3.py` fails []; outside the block the captioned film differs from the clean film by 0.08–1.79 mean levels (encode noise); 3,600 frames, 60/1, 1920×1080, 31,994,881 B.

Reproduce: `cd app && npm run build`; serve `app/dist` at `http://127.0.0.1:4173/`; `env PROBE=1 SNAP=1 node film/v4/film-60.mjs http://127.0.0.1:4173/ film/v4/work film/v4/out/silicon-60s-master.mp4`; `bash film/v4/measure/post-render-v4.sh`; `python3 film/v4/measure/cadence-detail.py film/v4/out/silicon-60s.mp4 > film/v4/measure/receipts-v4/cadence-detail.txt`; `python3 film/v4/measure/make-films-v4.py film/v4/measure/independent-review-v4d-full.md`.

## Films — the 45 s film (v3: full-frame footage, Lato Bold block captions; superseded by the 60 s v4 film; kept)

Two deliveries with the same 2,700 frames (1920×1080, 60/1, H.264 High yuv420p bt709, 45.000 s, silent, nb_frames = nb_read_frames = 2700, monotonic pts): `silicon-45s-captioned.mp4` — 24,535,230 B, SHA-256 `4a186c73169057db6328b3d98f04d0b49606fab559c524ac3fb81801df181e57`, asset `89b37e76-4789-42eb-be06-3bb27fda3ab4` — and `silicon-45s.mp4` (clean) — 26,110,553 B, SHA-256 `8a43fda9ec28b86e996fc9b7a18c5ad3503e8c4142bba83d6a4b45f1a5f8ba96`, asset `6e087a70-bf39-40a0-9f6a-4e9f1b6d368f`. Receipts: `film/v3/films-v3.md` (asset `089271cb-1b76-45fd-a2b6-93bdfddd526d`). The v2.1 films stay as assets `2caaed51-540f-465d-9f62-39bce45e06a2` (captioned) and `22e473e9-3422-4a7a-a9b2-2fadabb82339` (clean), receipts `2583869e-4c60-461c-98de-35f88173955d`.

**What v3 changed and why.** Jeff's note (2026-10-20): the bottom closed-caption look of v2.1 was not professional; the parent's v3 mail set a single caption treatment for all nine films (kit v2.2) and allowed 60–90 s where helpful. v3 therefore (1) drops the v2.1 letterbox matte and renders the camera window full-frame, (2) burns the parent's treatment — Lato Bold 60 px white on an opaque #1b262b block, radius 7, padding 18/10, anchored at (960, 1009), no motion — with libass, (3) re-solves every camera window for the 1080-px-tall frame so the pointer, click targets, typed field and the values a caption names stay ≥ 24 px clear of the block, and (4) keeps the v2.1 input log frame-identical (every click, key and typed character on the same frames), so the story and the 45-s length are unchanged — every caption already holds ≥ 3.42 s, every read hold ≥ 1.2 s and the payoff 2.73 s, so 60 or 90 s would add hold time without information. Because the matte is gone, all 2,700 frames differ from v2.1; the per-shot window changes are tabulated in films-v3.md §12 (13 camera moves → 11: the two pans inside the transport windows are gone; the payoff now pushes 1× → 7.3× into the netlist activity chip instead of the transport status line).

**Captions (eleven, `film/v3/v3cap/cues.json`; ≤ 34 characters per line, two-sentence captions split at the sentence boundary).**

| # | caption | frames (s) |
|---|---|---|
| 1 | A RISC-V CPU built by Computer / runs this C program. | 0–237 (3.95) |
| 2 | In machine code, / this program is 55 instructions. | 237–503 (4.43) |
| 3 | A breakpoint stops / the CPU at cycle 1,465. | 503–783 (4.67) |
| 4 | Space steps the pipeline / one clock cycle at a time. | 783–1027 (4.07) |
| 5 | A load-use hazard / inserts a bubble. | 1027–1238 (3.52) |
| 6 | The loaded value / is forwarded to the branch. | 1238–1448 (3.50) |
| 7 | The same CPU / is 8,297 gates and flip-flops. | 1448–1653 (3.42) |
| 8 | The CPU runs again. / Gates light up as they switch. | 1653–1900 (4.12) |
| 9 | The result register a0 / is 32 of those flip-flops. | 1900–2156 (4.27) |
| 10 | Stop pauses the CPU. / To end runs until it halts. | 2156–2464 (5.13) |
| 11 | Halted at cycle 16,700: / a0 = 541, the 100th prime. | 2464–2700 (3.93) |

Caption 10 was reworded from v2.1's "To end finishes at full speed." to "To end runs until it halts." (what the button does: it runs the remaining 4,597 cycles to the halt; the shorter line also narrows the block so the pointer's travel to Stop stays ≥ 80 px clear). Explicit line breaks: captions 8 and 10 (sentence boundary, per the parent's §7.1 amendment of 2026-10-20) and captions 2, 7, 11 (clause boundary). Changes land on frames 237, 503, 783, 1027, 1238, 1448, 1653, 1900, 2156, 2464 — each inside a static hold, never during a camera move; caption 1 is on from frame 0 and caption 11 holds to frame 2699.

**Beats (frames at 60/1; zoom in the 1920×1080 frame).** 0–77 C source lines 12–16 at 5.6× (caption 1) → pull 78–144 to the view tabs (5.228×) → click Machine code f164 → pull 241–301 into the listing rows (3.857×), click the 0x44 gutter f321 (breakpoint) → push 395–455 onto the transport (4.64×), click Run f475; the CPU runs and stops at the breakpoint, cycle 1,465 · instret 975 (f607), hold to 678 → pull 679–757 into the ID/EX cards (2.84×, zoom dip 2.8); Space ×5 at f853/927/1001/1105/1213 (REDIRECT + FLUSH, then the load-use STALL/BUBBLE, then FORWARD ×1) → push 1325–1391 to the view tabs (5.925×), click Netlist f1411 → pull 1449–1497 to the MEM and WB columns (3.933×), Enter f1617 runs the netlist (toggling cells) → pull 1691–1763 to the whole netlist at 1× → push 1805–1877 into the Find field (3.947×), type "a0" f1917–1922, Enter f1973 → result "register a0 (x10) — all 32 flops" → push 2157–2235 onto the transport (7.2×), click Stop f2255 (cycle 12,103), click To end f2331 → halted at cycle 16,700 (f2333) → pull 2369–2441 to the halted machine at 1× (0.42-s picture beat) → push 2465–2537 into the activity chip at 7.3× — "halted at cycle 16,700 · a0 = 0000021d (541)" — hold 2537–2699 (2.73 s). Seven clicks, seven keys, one typed field; camera moves 0.8–1.3 s, quintic in-out, settle ≥ 0.4 s; pointer peak 1,092 px/s at 1× capture scale.

**Verification of the captions (parent's kit v2.2).** Build: `python3 captions_v3.py cues.json --fps 60 --frames 2700 --font /usr/share/fonts/truetype/lato/Lato-Bold.ttf --out build/` (font SHA-256 `bf1b8130069b44b9148eeece35e5423bedac49777ba746615b826b8276574a7b`, libass em 50 px). Burn-in: the kit's §7.5 ffmpeg command verbatim; the log shows `fontselect: (Lato, 700, 0) -> Lato-Bold`. Verifier: `verify_captions_v3.py silicon-45s-captioned.mp4 build/caption-geometry.json --clean silicon-45s.mp4` → **exit 0, fails []** (block fill ≥ 0.9996; padding measured 18–19 / 10–11 against 18/10 ± 3; vertical centre error ≤ 0.5 px, horizontal ≤ 1 px; ink bottom on the 1009 baseline; ink height within 1 px of the geometry; footage outside the block vs the clean film max 1.22 mean |Δ| against the 2.0 gate). Per-cue maxima: ring_adjacent_luma_diff ≤ 2.09 (gate 6), ring_outer_rgb_diff ≤ 2.49 (gate 6), ring_adjacent_rgb_diff ≤ 7.96 (information only in v2.2; 4:2:0 chroma on the line touching the block); the full per-cue table is in films-v3.md §7.5.

**A finding for the other eight films.** The kit floors caption times to centiseconds (frame 237 → 0:00:03.95) and ffmpeg 6.1's `ass` filter converts each frame's pts to milliseconds in double precision; with the default mp4 timebase of 1/15360 at 60 fps, frame 237 computes to 3949.9999 ms, so captions 2 and 4 appeared one frame late and the verifier failed (exit 2). Muxing the clean film with `-video_track_timescale 60000` makes every frame an exact millisecond; both captions then land on their in-frame and the verifier passes. Only the clean encode gained that flag (and `setparams` bt709 tags, since the yuv444p master is untagged); the burn-in command is untouched. Any film whose caption in-frame is a multiple of 3 at 1/15360 can hit this.

**Clearance from the block (rule 7.2, measured on every frame of every caption, `films-v3.md` §7.6).** Pointer ≥ 54.8 px (box) / 63.9 px (ink) on every frame; click targets Run +41.9, Netlist tab +674, Find field +616, Stop +127, To end +107.5; typed field +649; named values: cycle 1,465 counter +33.5, result row +562 (its selected-cell copy +289), payoff chip +691. Two items are disclosed rather than solved: during the pull-back from the transport to 1× (f2380–2416, caption 10 "Stop pauses the CPU. To end runs until it halts."), the cycle counter passes under the block (−89 px at f2383) — caption 10 names the Stop and To end buttons, not the counter, and the alternatives (moving the caption 11 change earlier makes "16,700" a named referent while it crosses; a bridging caption would be 1.6 s) are worse; and at f2464, the first frame of caption 11, the counter's padded DOM box is 23.8 px below the block while its ink is 26–27 px clear (the value "16,700" is also on the payoff chip the push-in targets). Under the block otherwise lies inert chrome (listed per caption): the Stop button and speed select at 4.64×, the "ID/EX" register label in the pipeline shot (f757–1447; the name stays legible in the card rows), side-panel activity bars.

**Independent review (fresh reviewer agent, measured on the decoded frames; `film/v3/measure/review-v3-independent.md`, resolution in `review-resolution-v3.md`).** Caption changes land on the pixels exactly on the eleven frames; block rectangles within 1 px of the geometry; footage outside the block identical to the clean film; text heights ≥ 28/32/48 px (tightest: readout digits "52" and "32" at 32–33 px); 11 moves of 0.8–1.3 s, none linear; clicks at 3.86–7.2× with ≥ 0.3 s static before and ≥ 0.63 s hold after; final frame is product. The reviewer's only hard-failure list came from the brief's stricter pointer-speed definition (output px/s, peaks 1,302–3,806 px/s on seven travels); under the standard's wording — "≤ 1,200 px/s at 1× capture scale", the figure the v2 and v2.1 acceptances used — the CSS peak is 1,092 px/s and the reviewer states no hard failure remains. Both scales are tabulated in `measure/pointer-screen-speed-v3.md`. Disclosures the reviewer accepted: the counter crossing at f2380–2416 (flagged as the one item to decide), the literal duplicate-pair metric (147 of 744 moving pairs below 0.02 of full scale on a 160×90 grey downscale; 0 exact duplicates, no cadence, no pops — same disclosure as v2.1), block height 118 px on captions without descenders (the kit's fit-to-ink), zoom dips in the two opening pulls.

**Text heights (native frames, `films-v3.md` §3, 62 rows, none below threshold).** Click/typing/toggle subjects ≥ 30 px tall with x-height ≥ 23 px; readouts ≥ 32 px (listing hex 44, counters 55, typed "a0" 40, '16,700' 85); payoff '541' 60 px, '0000021d' 61 px.

**Where the v3 sources are.** The Project repo is at its 5 GiB limit, so this checkpoint submits `HANDOFF.md`, `STATUS.md`, `PARENT-MAIL-v3.md` and (space permitting) `film/v3/films-v3.md`. The complete v3 tree — `film/v3/lib4.mjs` (v7), `film-45.mjs` (plan v14), `work/{capture.json, camera.csv.gz, probe.csv.gz}` of the delivered render and `work.v2.1/` of v2.1, `v3cap/` (kit v2.2 files, `cues.json`, `build/Captions.ass`, `build/caption-geometry.json`), `measure/` (every script and output: `post-render-v3.sh`, `receipts-v3/`, the review, clearance tables, text heights, change list) — is the session asset "A8 · Silicon — full build bundle" (new version, `Silicon-A8-full.zip`, 594 files; its byte size and SHA-256 are recorded in `PARENT-MAIL-v3.md`, since the hash cannot sit inside the bundle). To fit this checkpoint under the repo limit, eight large plain-text logs already in the repo (`film/camera-*.csv`, `film/capture-*.json`, `film/v3/measure/{capture.json, motion-profile.json, text-heights.json, text-heights.txt}`) were gzip-compressed in place, losslessly; the bundle holds them uncompressed. Reproduce: `cd app && npm ci && npm run build`, serve `app/dist` on 127.0.0.1:4173, `node film/v3/film-45.mjs` (writes the master and `work/`), then `bash film/v3/measure/post-render-v3.sh <render-dir>` (clean encode, kit build, burn-in, verifier, every receipt).

## Films — 60 s and 30 s (v2, superseded by the 45 s film)

v2 (after the coordination review of the first, full-frame 30 fps cut). Both films: 1920×1080, 60 fps in and out, H.264 (libx264, preset slow, CRF 18, yuv420p, faststart), one video stream, no audio, no captions, badges or added text. Frame counts, rate and a full decode verified with ffprobe/ffmpeg (`film/verify.txt`). Program in both films: `primes.c` (Sieve of Eratosthenes, 220 bytes, 55 instructions; result a0 = 0x21d = 541 after 16,700 cycles, instret 11,451, CPI 1.458, 279 stalls, 2,483 flushes, 2,022 forwards — the same numbers as the Verilator run).

| File | Frames | Rate | Duration | Size | SHA-256 |
|---|---:|---:|---:|---:|---|
| `film/out/Silicon-60s.mp4` | 3,600 | 60/1 | 60.000 s | 40,718,851 B | `25a2379f276cb2c490a76c64af73942da097901ec05c295906585a9af8148985` |
| `film/out/Silicon-30s.mp4` | 1,800 | 60/1 | 30.000 s | 23,248,750 B | `79a1d0f7bb15593fdf3a08ada047de970ccf17d04323ce85d26040d68d287a2f` |

60 s film (`film/capture-60.json.gz`, `film/camera-60.csv.gz`): 3600 frames, 60 fps, 1920x1080

| Time | Frames | Shot | Actions (frame → app state) |
|---|---|---|---|
| 0.0–3.1 s | 0–186 | C source | camera: zoom: C source |
| 3.1–7.0 s | 186–418 | Machine code | f232 Machine code tab → cycle 0 |
| 7.0–17.0 s | 418–1020 | Stepping and forwarding | f482 Step → cycle 1; f568 Step → cycle 2; f630 Step → cycle 3 (mv sp,sp in EX, FORWARD ×1); f764 Step → cycle 4; f808 Step → cycle 5; f852 Step → cycle 6 (bgeu t0,t1: FORWARD ×2) |
| 17.0–24.1 s | 1020–1448 | Breakpoint, run, load-use stall | f1084 breakpoint at 0x58 (lbu a5,0(a0)) → cycle 6; f1172 speed select → cycle 6; f1190 speed = 1 k cycles/s → cycle 6; f1236 Run → cycle 15; f1322 stopped at breakpoint: load-use stall → cycle 1,468 |
| 24.1–34.8 s | 1448–2088 | Stall bubble and branch flush | f1480 Step → cycle 1,469 (bubble · load-use stall); f1566 Step → cycle 1,470 (bnez a5: a5 ← MEM/WB); f1634 Step → cycle 1471; f1656 Step → cycle 1472; f1678 Step → cycle 1473; f1700 Step → cycle 1474; f1722 Step → cycle 1475; f1744 Step → cycle 1,476 (bge a2,a4 taken: FLUSH); f2010 Step → cycle 1,477 (flushed bubbles) |
| 34.8–47.3 s | 2088–2839 | Netlist | f2140 speed select → cycle 1,477; f2150 speed = 100 cycles/s → cycle 1,477; f2214 Netlist tab → cycle 1,477; f2308 Run (100 cycles/s) → cycle 1,478; f2576 Pause → cycle 1,923; f2579 paused → cycle 1,923; f2677 select cell → cycle 1,923; f2677 cell |
| 47.3–53.1 s | 2839–3185 | Run to end | f2891 Pipeline tab → cycle 1,923; f2949 clear breakpoint at 0x58 → cycle 1,923; f3013 speed select → cycle 1,923; f3027 speed = 10 k cycles/s → cycle 1,923; f3067 Run (10 k cycles/s) → cycle 1,963; f3155 halted → cycle 16,700 |
| 53.1–60.0 s | 3185–3600 | Result in a0 | camera: zoom: registers, a0; pull back: wide |

Camera keys: 25 eased moves; zoom levels used: 1×, 1.22×, 1.3×, 1.5×, 1.6×, 1.7×, 1.8×, 1.9×, 2×, 2.1×, 2.2×.

30 s film (`film/capture-30.json.gz`, `film/camera-30.csv.gz`): 1800 frames, 60 fps, 1920x1080

| Time | Frames | Shot | Actions (frame → app state) |
|---|---|---|---|
| 0.0–2.8 s | 0–168 | C source | camera: zoom: C source |
| 2.8–5.7 s | 168–340 | Machine code | f208 Machine code tab → cycle 0 |
| 5.7–13.3 s | 340–798 | Stepping and forwarding | f392 Step → cycle 1; f466 Step → cycle 2; f516 Step → cycle 3 (mv sp,sp in EX, FORWARD ×1); f608 Step → cycle 4; f640 Step → cycle 5; f672 Step → cycle 6 (bgeu t0,t1: FORWARD ×2) |
| 13.3–17.2 s | 798–1034 | Jump flush | f800 Step → cycle 7; f826 Step → cycle 8; f852 Step → cycle 9 (j 10 taken: FLUSH); f974 Step → cycle 10 (flushed bubbles) |
| 17.2–22.7 s | 1034–1360 | Netlist | f1074 speed select → cycle 10; f1088 speed = 100 cycles/s → cycle 10; f1140 Netlist tab → cycle 10; f1198 Run (100 cycles/s) → cycle 10 |
| 22.7–30.0 s | 1360–1800 | Result in a0 | f1400 Pipeline tab → cycle 347; f1440 speed select → cycle 415; f1454 speed = 10 k cycles/s (while running: pause + rerun at the new speed) → cycle 1,224; f1546 halted → cycle 16,700 |

Camera keys: 16 eased moves; zoom levels used: 1×, 1.22×, 1.5×, 1.6×, 1.8×, 1.9×, 2×, 2.1×.

Capture method (disclosed here, in `film/lib.mjs` and in both `capture-*.json`): the real built app in headless Chromium (Playwright) at 1920×1080, browser clock paused and advanced 17/17/16 ms per frame (exactly 60 frames per app second, so one film frame is one sixtieth of app time; no retiming). Every frame is a full screenshot at 2× device scale (3840×2160); an eased editorial camera (easeInOutCubic, one move per action, zoom 1–2.2×) crops the screenshot and Lanczos-resamples it to 1920×1080, and the raw RGB frames are piped straight into libx264. The pointer is Playwright's mouse, drawn in-page at its real coordinates (arrow + click ring); every click, key press and step in the films is a real interaction with the app, with the app's own state (counters, transport message) logged per frame in `capture-*.json` and the camera centre, zoom and pointer position per frame in `camera-*.csv`. Nothing is composited over the UI, no frames are generated or re-ordered, and the crops are the only editorial treatment. A 2 s "ripple" of the netlist means 200 app cycles at 100 cycles/s — the toggled-cell count in the view chip is the app's own number for that cycle.

Changes made for v2, all from the same build: contrast lift for secondary labels (`--muted`, `--dim`, stage-card keys, event cycle numbers), C-source lines wrap with a hanging indent (CSS), and a real bug fixed while scripting the Pause action: the transport rebuilt its button labels every cycle while running, so a normal human click on Pause/Stop was lost (`qa/REVIEW-RESOLUTION.md`, `qa/review/pause-fix.log`). The v1 scripts, logs and verification stay in `film/v1/`. Reproduce: `film/encode.sh <url>` (runs both captures and `film/verify.sh`). The synthetic query-typing opener was not used.

## Measured, computed, modelled

- Measured: cycles, instret, CPI, stall/flush/forward counts, register, memory and pipeline-register values, gate toggles (from executing the program on the model proven trace-identical to the RTL; Verilator runs are the reference).
- Computed: cell counts and longest path (Yosys). The netlist drawing's placement is Silicon's grouping by pipeline stage and carries no physical meaning.
- Not available: physical timing (no cell timing library); Spike comparison.

## Limitations (docs/LIMITATIONS.md)

RV32I only (no M; `matmul`/`mandel` use libgcc `__mulsi3`); no traps, CSRs or interrupts; misaligned accesses not trapped; single-cycle ideal memory; static not-taken prediction; C compiled ahead of time; unit-delay critical path.

## Reproduction

```
make                      # Verilator RTL sim  → obj_dir/silicon_sim
archtest/run.sh           # 38 arch tests → archtest/results.md (riscv-arch-test 2.7.4 checkout needed, see script)
programs/build.sh         # GCC + Verilator runs/traces for the 17 programs
yosys synth/synth.ys      # synth/stat.txt, ltp.txt, silicon_netlist.json, silicon_gates.v
make gate                 # Verilator gate-level sim → obj_gate/silicon_gate_sim
test/run-all.sh           # all JS equivalence/assembler suites (~40 s) → test/results/
test/run-verilator-gate.sh  # gate vs RTL on 55 binaries (~4 min)
cd app && npm ci && node scripts/build-docs.mjs && npx vite build   # app → app/dist
# 60 s film v4 (current): serve app/dist on 127.0.0.1:4173, then from the build root
cd app/dist && python3 -m http.server 4173 --bind 127.0.0.1 &
env PROBE=1 SNAP=1 node film/v4/film-60.mjs http://127.0.0.1:4173/ film/v4/work film/v4/out/silicon-60s-master.mp4   # master (libx264 CRF 8 yuv444p) + film/v4/work/{capture.json,camera.csv,probe.csv} (~10 min; DRY=1 rehearses only)
bash film/v4/measure/post-render-v4.sh   # clean encode, cues from the executed record, kit v4 build + burn-in, camera_budget / caption_lint / captions_v4 / verify_captions_v3, refcheck, every measurement → film/v4/measure/receipts-v4
python3 film/v4/measure/text-heights-v4.py --crops > film/v4/measure/receipts-v4/text-heights-v4.txt && python3 film/v4/measure/cadence-detail.py film/v4/out/silicon-60s.mp4 > film/v4/measure/receipts-v4/cadence-detail.txt
python3 film/v4/measure/make-films-v4.py film/v4/measure/independent-review-v4d.md   # → film/v4/films-v4.md
# 45 s film v3 (plan v14, lib4 v7; superseded, kept):
SNAP=1 PROBE=1 node film/v3/film-45.mjs http://127.0.0.1:4173/ /tmp/r4 film/v3/out/silicon-45s-master.mp4   # master (libx264 CRF 8 yuv444p) + /tmp/r4/{capture.json,camera.csv,probe.csv} (~15 min; DRY=1 rehearses only)
bash film/v3/measure/post-render-v3.sh /tmp/r4   # clean encode, kit v2.2 build + burn-in (Lato Bold from /usr/share/fonts/truetype/lato), verifier, every measurement → film/v3/measure/receipts-v3 (~12 min)
cd film/v3 && python3 measure/captions-section-v3.py > measure/captions-v3-section.md && python3 measure/make-films-v3.py > films-v3.md
```

Toolchain: riscv64-unknown-elf-gcc 14.2.0, binutils 2.45, Verilator 5.032, Yosys 0.52, Node 20.20.2, ffmpeg 8.0.1.

## Sources and licenses (docs/LICENSES.md)

Silicon RTL, simulator, assembler, app and scripts: Apache-2.0 (own work, no core copied). riscv-arch-test 2.7.4: BSD-3-Clause / CC-BY-4.0. Yosys: ISC. Verilator: LGPL-3.0 / Artistic-2.0. GCC and binutils: GPL-3.0 (libgcc runtime exception covers `__mulsi3` etc. linked into the programs). Fonts Geist and JetBrains Mono: OFL-1.1 (via @fontsource-variable). Vite, marked: MIT.
