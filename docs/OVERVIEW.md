# Overview

Silicon is an original five-stage in-order RV32I processor (`rtl/silicon_core.sv`, 574 lines of SystemVerilog, Apache-2.0), verified against the official riscv-arch-test suite under Verilator, synthesized with Yosys to a generic gate library, and driven in this app by a browser twin that is trace-identical to the RTL.

## What is live in the browser, and what is not

| Part | Where it runs | Receipt |
|---|---|---|
| Pipeline simulation | In the browser: `core.js`, a cycle-accurate model of the same microarchitecture | Per-cycle trace identical to the Verilator and Icarus Verilog (`iverilog`) RTL runs on all 38 arch tests and all 19 programs (`test/results/`) |
| Gate-level activity | In the browser: `gatesim.js` evaluates the real Yosys netlist (8,297 cells) every cycle | Its port outputs are checked against the behavioural model every cycle; identical on all 38 arch tests (`archtest-jsgate-vs-rtl.txt`). The same netlist simulated with Verilator and Icarus Verilog matches the RTL on all 57 binaries (`verilator-gate.md`) |
| Assembly | Live. Edit any program in the Assembly tab; it is assembled in the browser by Silicon's own two-pass assembler (`asm.js`) and loaded into memory | Byte-identical to GNU as/ld on all curated programs (41 checks) and 110 random programs; 23 negative tests |
| C | Not live. The twelve C programs were compiled once, in the sandbox, with `riscv64-unknown-elf-gcc 14.2.0 -O2`; the browser receives the machine code, the symbol table and the DWARF line table. There is no compiler in the browser | `programs/build.sh`, `programs/build/*.elf` |

Editing a C program's source has no effect; the source is shown read-only with per-line pipeline marks derived from the DWARF line table. Editing the disassembly of a C program is possible: "Assembly" shows a GNU-style disassembly that reassembles to the identical image (`toasm-roundtrip.txt`), so a C program can be modified at the instruction level.

## Measured, computed, modelled

- **Measured:** cycle counts, instruction counts, CPI, stall/flush/forward counts, register and memory contents, pipeline-register values, gate activity. All come from executing the program on the model that is proven identical to the RTL; the Verilator run of every curated program is the reference (`programs/build/*.run`).
- **Computed:** the cell counts and the longest topological path are Yosys outputs over the real netlist. The netlist layout (which gate is drawn where) is Silicon's own grouping by pipeline stage; the placement carries no physical meaning.
- **Not available:** physical timing in nanoseconds. There is no timing library for the generic cells; the critical path is reported as logic depth in gate levels (unit delay), see Synthesis.

## Layout of the app

- **Pipeline view:** the five stages with per-stage contents, the pipeline registers, the three forwarding and bypass lanes (lit when used this cycle), the redirect lane, hazard annotations, register file, memory and the event log.
- **Split: Pipeline + Die view:** side-by-side view pairing the 5-stage pipeline datapath with the 8,297-gate Yosys silicon die, register file, and data memory so you can watch instructions flow through `IF -> ID -> EX -> MEM -> WB` while individual gates toggle `0/1` voltage states in lockstep.
- **Netlist view:** the synthesized netlist by stage, zoomable and searchable, with the cells that toggled this cycle or live `0/1` voltage levels highlighted from the gate-level evaluation, a 76-level longest-path overlay, and vector SVG / GDSII die layout exports.
- **Transport bar:** reset, step back, step, run/pause, run to end, speed, breakpoints (click an address in the Machine code listing; the run stops when that instruction reaches EX, where it is certain to execute), counters and the cycle timeline.
