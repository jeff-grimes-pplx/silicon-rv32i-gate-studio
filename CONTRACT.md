# A8 Silicon — private acceptance contract

## Hard part (prove first, thin slice)
1. Original RV32I 5-stage pipelined core in SystemVerilog (IF/ID/EX/MEM/WB), forwarding EX/MEM→EX and MEM/WB→EX, load-use stall, branch resolved in EX with flush of IF/ID, static not-taken prediction, Harvard-style 2-port memory (combinational read for IMEM, sync for DMEM? — keep simple: one unified RAM with separate I/D ports, 1-cycle load latency).
2. Verilator C++ harness: loads ELF→hex, runs, dumps per-cycle pipeline state JSON trace (per-stage PC/instr/signals, forwarding mux selects, stall/flush, regfile writes, mem writes).
3. riscv-arch-test RV32I suite under Verilator: signature compare vs reference signatures (riscv-arch-test ships reference signatures from Sail). Preserve pass table.
4. Yosys synth to generic cells (`synth; abc -g AND,NAND,OR,NOR,XOR,XNOR,MUX` or just `synth` + `abc -g cmos`), `stat`, `write_json`. Gate-level sim with Icarus/Verilator on the synthesized netlist for sample program; compare regfile write log to RTL sim.
5. Per-cycle gate activity: simulate synthesized netlist (Verilator, with the netlist's internal nets) and dump per-cycle toggle set per cell for N cycles of the sample program → compressed trace for the explorer.

## App (static, private deploy)
- Left/center: pipeline diagram (five stages, latch registers between them), per-stage PC, instruction disasm, key signal values; forwarding paths light up when the forwarding mux selects them; stall/flush annotations; hazard annotations.
- Right: register file (x0–x31, ABI names, highlight writes), memory view (hex dump around data region, highlight writes), counters (cycle, instret, CPI).
- Controls: program picker (≥12 curated programs: C-compiled + asm), assembly editor with in-browser assembler (my own, tested against GNU as), step / step back / run / pause / speed / breakpoints (PC), reset.
- Simulator in browser: a JS cycle-accurate model of the SAME microarchitecture, cross-checked against Verilator trace for every curated program (trace equivalence test: identical per-cycle state). This is the honest route: browser gets machine code, runs a JS model that is proven cycle-equivalent to the RTL. Disclose.
- Netlist explorer: real Yosys JSON netlist, laid out (by my own layered layout code), zoomable/pannable canvas, searchable by cell/net name, activity per cycle from real gate-level trace (toggle set per cycle, from Verilator simulation of the synthesized netlist on the selected program).
  - Activity for arbitrary user programs: the gate-level trace can only come from an actual gate-level simulation. Options: (a) precomputed gate traces for curated programs; (b) a JS gate-level evaluator that evaluates the real netlist (netlist JSON → topologically sorted evaluation) in the browser — this IS a real gate-level simulation and works for any program. (b) is better and honest: the browser evaluates the actual synthesized gates every cycle. Cross-check (b) against Verilator gate-level sim on curated programs. Netlist size: RV32I core maybe 5–15k cells; JS eval per cycle ~ tens of thousands of ops → fine.
  - Decision: do (b), with (a) as validation receipts.
- Secondary area: microarchitecture doc, test table, synthesis report, CPI table, limitations, licenses.

## Films
- 60 s: C source → compile (precompiled machine code shown; compile receipt) → load → step clock, values flow → forwarding hazard → branch flush → zoom into netlist, activity ripples → final result in register.
- 30 s: compile, step, hazard, netlist.
- Frame-stepped Playwright capture, composited pointer, 1920×1080, 30 or 60 fps, silent.

## Honesty
- Live compile: GCC runs in sandbox only; browser gets precompiled machine code for curated C programs. Assembly editing is live via in-browser assembler. State it.
- Browser pipeline sim: JS model cycle-equivalent to RTL (receipt: trace diff on all curated programs). Browser gate-level: JS evaluation of real Yosys netlist (receipt: equivalence vs Verilator gate-level sim).
- Timing: Yosys has no real timing engine for generic cells; report logic depth (levels) as estimated critical path via `sta`-like longest path with unit delays (yosys `ltp` command gives longest topological path). Say "unit-delay longest path", not ns.

## 20-second reveal
primes.c on screen → "Build" → hex appears → Step, Step, Step: add x5 flows IF→ID→EX, forwarding arrow lights up EX/MEM→EX as the next instruction consumes it → beq mispredict flushes two bubbles → netlist tab: 8k gates, this cycle's toggled gates glow → x10 = 541 (100th prime).
