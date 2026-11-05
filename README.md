# Silicon — Cycle-Accurate 5-Stage RV32I Processor & 8,297-Gate Yosys Synthesis Studio

**Silicon** is a complete 32-bit RISC-V (`RV32I`) 5-stage in-order pipelined processor (`IF -> ID -> EX -> MEM -> WB`) written in SystemVerilog/Verilog RTL (`rtl/silicon_core.sv` / `rtl/rv32i_core.v`), synthesized with **Yosys 0.33** into an **8,297-cell** gate-level netlist (`1,486` D-flip-flops, `6,811` combinational logic gates, `76` logic levels critical path), verified cycle-by-cycle against **Verilator 5.020** and **Icarus Verilog 12.0 (`iverilog`)** across all 38 official `riscv-arch-test` RV32I compliance tests and 18 compiled C and assembly benchmarks, and paired with an interactive browser-based RTL-to-Gate hardware observatory.

- **Perplexity Computer Live App**: [https://www.perplexity.ai/computer/a/silicon-rv32i-5-stage-pipeline-US5ZIYrvQ7SXOIAHdweJTQ](https://www.perplexity.ai/computer/a/silicon-rv32i-5-stage-pipeline-US5ZIYrvQ7SXOIAHdweJTQ)
- **Release `v1.0.0` Hardware Artifacts**: Includes `silicon_die_8297.gds` (GDSII stream layout), `silicon_die_8297.svg` (placed 8,297-cell silicon die SVG), `verification_receipt.json`, and IEEE 1364 VCD lockstep waveforms (`primes_lockstep.vcd`, `quicksort_lockstep.vcd`, `hazards_lockstep.vcd`).

---

## Architecture & Synthesis Summary

| Parameter | Specification |
|---|---|
| **ISA** | 32-bit RISC-V Base Integer (`RV32I`, 40 instructions + `mcycle` / `minstret` CSRs) |
| **Pipeline Stages** | 5-stage in-order (`IF` Instruction Fetch, `ID` Decode & Register Read, `EX` Execute & Branch Resolution, `MEM` Data Memory, `WB` Write Back) |
| **Hazard Resolution** | Full `EX/MEM -> EX` and `MEM/WB -> EX` ALU forwarding, `WB -> ID` same-cycle register-file bypass, 1-cycle load-use interlock stall (`IF` & `ID` held, bubble injected into `EX`), 2-cycle branch/jump redirect flush from `EX` (predict not-taken) |
| **Synthesized Netlist** | **8,297 cells** via `Yosys 0.33` (`synth -run coarse; techmap; simplemap; opt -full`) |
| **Sequential Cells (1,486 DFFs)** | `992` `$_DFFE_PP_` (31 × 32-bit register file `x1..x31`), `474` `$_SDFFE_PP0P_` (pipeline registers `IF/ID`, `ID/EX`, `EX/MEM`, `MEM/WB`), `10` `$_SDFF_PP0_`, `10` `$_DFF_P_` |
| **Combinational Gates (6,811)** | `2,298` `$_NAND_`, `1,784` `$_MUX_`, `1,234` `$_AND_`, `781` `$_OR_`, `396` `$_NOT_`, `119` `$_XOR_`, `116` `$_XNOR_`, `83` `$_NOR_` |
| **Critical Path** | **76 gate levels** (`exmem_rd[1]` forwarding compare -> ALU adder carry chain -> `dmem_addr[31]`) |
| **Stage Partitioning** | `IF`: 461 cells · `ID`: 4,624 cells (includes 992-flop regfile) · `EX`: 1,813 cells · `MEM`: 344 cells · `WB`: 1,055 cells |

---

## Cycle-by-Cycle Lockstep Verification (`RTL === Gate-Level`)

Every clock cycle of the behavioral RTL (`rtl/silicon_core.sv`) and the synthesized 8,297-cell gate-level netlist (`synth/silicon_gates.v`) is verified in lockstep across three independent engines:
1. **Verilator 5.020** (`sim/tb.cpp` -> `obj_dir/silicon_sim` and `obj_gate/silicon_gate_sim`)
2. **Icarus Verilog 12.0 (`iverilog`)** (`sim/tb_iverilog_lockstep.v`, instantiating `silicon_core` and `silicon_core_gates` side-by-side on the same clock and asserting `imem_addr`, `dmem_addr`, `dmem_wdata`, `dmem_be`, `dmem_we`, and `halted` match on every posedge while dumping IEEE 1364 `.vcd` waveforms)
3. **Browser Cycle-Accurate & Gate-Level Evaluators** (`app/src/core.js` and `app/src/gatesim.js`, evaluating all 8,297 topological gate primitives every clock cycle in the browser with `0` port mismatches)

### Benchmark Suite (`riscv64-unknown-elf-gcc 14.2.0 -O2 -march=rv32i -mabi=ilp32`)

All 18 curated programs obey the exact pipeline identity $\text{cycles} = 4 + \text{instret} + \text{stalls} + 2 \times \text{flushes}$ with **0 mismatches** between RTL and gate-level netlist:

| Program | Lang | Result in `a0` | Cycles | Instret | CPI | Stalls | Flushes | EX Fwds | WB Bypass | RTL === Gate |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| `primes` — Sieve of Eratosthenes (100th prime) | C | `541` (`0x0000021d`) | 16,700 | 11,451 | 1.4584 | 279 | 2,483 | 2,022 | 1,260 | 0 mismatches |
| `quicksort` — Quicksort (Lomuto partition) | C | `760` (`0x000002f8`) | 1,021 | 817 | 1.2497 | 0 | 100 | 185 | 199 | 0 mismatches |
| `fibonacci_matrix` — $2\times 2$ Matrix Power $F(30)$ | C | `832040` (`0x000cb228`) | 2,340 | 1,624 | 1.4409 | 0 | 356 | 420 | 82 | 0 mismatches |
| `crc32` — IEEE 802.3 CRC-32 | C | `0x57ef2b5d` | 2,570 | 2,032 | 1.2648 | 0 | 267 | 1,129 | 265 | 0 mismatches |
| `fib` — Iterative Fibonacci Table $F(30)$ | C | `832040` (`0x000cb228`) | 456 | 324 | 1.4074 | 0 | 64 | 66 | 2 | 0 mismatches |
| `gcd` — Stein's Binary GCD | C | `21` (`0x00000015`) | 864 | 554 | 1.5596 | 0 | 153 | 272 | 42 | 0 mismatches |
| `bubble` — Bubble Sort (16 words) | C | `62` (`0x0000003e`) | 1,326 | 842 | 1.5748 | 120 | 180 | 289 | 242 | 0 mismatches |
| `matmul` — $3\times 3$ Integer Matrix Multiply | C | `175` (`0x000000af`) | 1,075 | 749 | 1.4352 | 0 | 161 | 178 | 39 | 0 mismatches |
| `strrev` — In-Place String Reverse | C | `25` (`0x00000019`) | 330 | 249 | 1.3253 | 1 | 38 | 7 | 77 | 0 mismatches |
| `bsearch` — Binary Search | C | `21` (`0x00000015`) | 377 | 295 | 1.2780 | 0 | 39 | 85 | 32 | 0 mismatches |
| `collatz` — Longest Collatz Chain $<100$ | C | `97` (`0x00000061`) | 24,841 | 17,975 | 1.3820 | 0 | 3,431 | 9,649 | 198 | 0 mismatches |
| `mandel` — Fixed-Point ASCII Mandelbrot | C | `144` (`0x00000090`) | 2,288,139 | 1,605,069 | 1.4256 | 144 | 341,461 | 522,126 | 21,901 | 0 mismatches |
| `hazards` — Forwarding, Load-Use Stall & Flush | ASM | `103` (`0x00000067`) | 23 | 16 | 1.4375 | 1 | 1 | 13 | 1 | 0 mismatches |
| `branches` — Counting Loop | ASM | `55` (`0x00000037`) | 56 | 34 | 1.6471 | 0 | 9 | 21 | 2 | 0 mismatches |
| `sum` — Load-Use: Naive vs Scheduled | ASM | `1240` (`0x000004d8`) | 127 | 87 | 1.4598 | 8 | 14 | 24 | 11 | 0 mismatches |
| `multiply` — Shift-and-Add Multiply | ASM | `56088` (`0x0000db18`) | 83 | 53 | 1.5660 | 0 | 13 | 19 | 1 | 0 mismatches |
| `memcopy` — Byte Copy & Word Copy | ASM | `32` (`0x00000020`) | 188 | 128 | 1.4688 | 20 | 18 | 40 | 4 | 0 mismatches |
| `calls` — Nested Calls & Stack Frame | ASM | `74` (`0x0000004a`) | 98 | 66 | 1.4848 | 0 | 14 | 22 | 17 | 0 mismatches |

---

## Repository Structure

- `rtl/` — `silicon_core.sv` and `rv32i_core.v` (574-line 5-stage RV32I processor in SystemVerilog/Verilog).
- `synth/` — `synth.ys` (Yosys synthesis script), `silicon_gates.v` (synthesized gate-level Verilog netlist), `compact_netlist.py` (topological sort + longest-path extractor), `export_die_layout.py` (SVG & GDSII stream file generator), `stat.txt`, `ltp.txt`.
- `sim/` — `tb.cpp` (Verilator C++ testbench for RTL and gate-level netlist), `tb_iverilog_lockstep.v` (Icarus Verilog RTL-vs-Gate lockstep testbench + VCD waveform dumper), `gate_primitives.v`.
- `programs/` — 12 C programs (`c/*.c`) and 6 RISC-V assembly programs (`asm/*.S`), `crt0.S`, `link.ld`, `build.sh`, `manifest.mjs`, and pre-built binaries/disassemblies (`build/`).
- `archtest/` — Official `riscv-arch-test` RV32I compliance runner and 38/38 pass receipts (`results.md`).
- `test/` — Automated verification scripts (`run-all.sh`, `run-verilator-gate.sh`, `equiv.mjs`, `gate-equiv.mjs`, `asm-test.mjs`).
- `artifacts/` — Exported `silicon_die_8297.svg`, `silicon_die_8297.gds` (GDSII), and `verification_receipt.json`.
- `app/` — Interactive Web Observatory (`Pipeline`, `Split: Pipeline + Die`, `Netlist` with `0/1 voltage` and `toggled cells` modes, live two-pass RV32I assembler, 160-cycle logic analyzer timeline, and documentation).

---

## Reproducing Synthesis, Lockstep Verification & Web Build

```bash
# 1. Synthesize RTL to 8,297-cell gate-level netlist and export compact JSON + SVG/GDSII die
yosys -s synth/synth.ys
python3 synth/compact_netlist.py
python3 synth/export_die_layout.py

# 2. Build all 18 C & Assembly programs with riscv64-unknown-elf-gcc and run Verilator RTL + Gate sims
make
make gate
bash programs/build.sh
node programs/manifest.mjs

# 3. Run Icarus Verilog cycle-by-cycle RTL-vs-Gate lockstep testbench (generates VCD waveform)
iverilog -g2012 -o lockstep_sim rtl/rv32i_core.v synth/silicon_gates.v sim/gate_primitives.v sim/tb_iverilog_lockstep.v
vvp lockstep_sim +bin=programs/build/primes.bin +vcd=primes_lockstep.vcd

# 4. Run full equivalence & assembler test suite
bash test/run-all.sh

# 5. Build and preview the interactive web studio
cd app
npm install
npm run build
npx serve dist -l 4173
```

## License

Apache-2.0 (`rtl/silicon_core.sv` and application source).
