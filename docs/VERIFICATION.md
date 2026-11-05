# Verification

Every number below is reproduced by a script in the repository; the raw receipts are in `archtest/results.md` and `test/results/`.

## Official architecture tests (riscv-arch-test 2.7.4, rv32i_m/I)

The 38 test programs of the RV32I suite were assembled with GNU as 2.45 against Silicon's own target description (`archtest/target/`: `model_test.h` uses `tohost` to end a test; the signature region is dumped by the test bench and compared with the reference signatures shipped in the suite, which were generated from the Sail formal model). Run: `make && archtest/run.sh`. Each test runs on the RTL under Verilator 5.032.

| Test | Result | Cycles | Instructions | CPI | Signature lines |
|---|---|---|---|---|---|
| add-01 | PASS | 3215 | 3211 | 1.0012 | 588 |
| addi-01 | PASS | 2143 | 2139 | 1.0019 | 564 |
| and-01 | PASS | 3191 | 3187 | 1.0013 | 584 |
| andi-01 | PASS | 2143 | 2139 | 1.0019 | 564 |
| auipc-01 | PASS | 395 | 391 | 1.0102 | 64 |
| beq-01 | PASS | 7901 | 5515 | 1.4326 | 584 |
| bge-01 | PASS | 8543 | 5565 | 1.5351 | 592 |
| bgeu-01 | PASS | 10467 | 6807 | 1.5377 | 728 |
| blt-01 | PASS | 8352 | 5480 | 1.5241 | 580 |
| bltu-01 | PASS | 10411 | 6799 | 1.5313 | 728 |
| bne-01 | PASS | 8978 | 5518 | 1.6270 | 584 |
| fence-01 | PASS | 79 | 75 | 1.0533 | 4 |
| jal-01 | PASS | 689 | 489 | 1.4090 | 32 |
| jalr-01 | PASS | 603 | 467 | 1.2912 | 36 |
| lb-align-01 | PASS | 271 | 267 | 1.0150 | 36 |
| lbu-align-01 | PASS | 267 | 263 | 1.0152 | 32 |
| lh-align-01 | PASS | 267 | 263 | 1.0152 | 32 |
| lhu-align-01 | PASS | 267 | 263 | 1.0152 | 32 |
| lui-01 | PASS | 199 | 195 | 1.0205 | 64 |
| lw-align-01 | PASS | 267 | 263 | 1.0152 | 32 |
| or-01 | PASS | 3215 | 3211 | 1.0012 | 588 |
| ori-01 | PASS | 2139 | 2135 | 1.0019 | 560 |
| sb-align-01 | PASS | 591 | 587 | 1.0068 | 72 |
| sh-align-01 | PASS | 595 | 591 | 1.0068 | 72 |
| sll-01 | PASS | 471 | 467 | 1.0086 | 92 |
| slli-01 | PASS | 375 | 371 | 1.0108 | 88 |
| slt-01 | PASS | 3195 | 3191 | 1.0013 | 584 |
| slti-01 | PASS | 2139 | 2135 | 1.0019 | 560 |
| sltiu-01 | PASS | 2623 | 2619 | 1.0015 | 700 |
| sltu-01 | PASS | 3883 | 3879 | 1.0010 | 724 |
| sra-01 | PASS | 475 | 471 | 1.0085 | 92 |
| srai-01 | PASS | 375 | 371 | 1.0108 | 88 |
| srl-01 | PASS | 487 | 483 | 1.0083 | 92 |
| srli-01 | PASS | 383 | 379 | 1.0106 | 92 |
| sub-01 | PASS | 3235 | 3231 | 1.0012 | 592 |
| sw-align-01 | PASS | 575 | 571 | 1.0070 | 68 |
| xor-01 | PASS | 3211 | 3207 | 1.0012 | 588 |
| xori-01 | PASS | 2159 | 2155 | 1.0019 | 568 |

38 passed, 0 failed. The arithmetic tests run at CPI ≈ 1.00 because they are straight-line code; the branch tests show the two-cycle taken-branch cost. One edit was needed to build the suite: binutils 2.45 rejects the pseudo-instruction `la x0, label` in jalr-01; it is replaced by two explicit instructions of the same size that also target x0 (no architectural effect, see `archtest/run.sh`).

Spike was not used as a second reference: Spike reserves addresses 0x0–0xfff for its debug module and the Silicon programs are linked at address 0 (the reset vector). The Sail-generated reference signatures are the authoritative check the suite was designed around.

## Targeted hazard and branch tests

`test/hazards-rtl.mjs` asserts the hazard behaviour directly on the Verilator RTL trace of four assembly programs (32 checks, `test/results/hazards-rtl.txt`):

| Program | What is asserted on the RTL trace |
|---|---|
| hazards.S | Cycle 4: `add t2,t0,t1` in EX takes t0 from MEM/WB and t1 from EX/MEM, operands 40 and 2, result 42. Cycle 5: `sub t3,t2,t1` takes t2 from EX/MEM and t1 from MEM/WB. Cycle 9: `lw t5` in EX with `addi t6,t5,1` in ID raises `stall`; cycle 10 holds PC and IF/ID and inserts a bubble; cycle 11 the addi receives the load result from MEM/WB. Cycle 15: `beq` not taken, no redirect. Cycle 16: `bne a3,t6,done` taken, redirect to 0x4c; cycle 17 IF/ID and ID/EX are flushed and fetch resumes at 0x4c. Exactly one stall and one branch redirect; halt after 23 cycles, a0 = 103 |
| sum.S | Exactly 8 stalls, each with `lw t2` in EX and `add a0,a0,t2` in ID (the naive loop), none in the scheduled loop; a0 = 1240 |
| branches.S | 9 taken branches, each followed by a cycle with IF/ID and ID/EX invalid and PC at the redirect target; a0 = 55 |
| memcopy.S | Every store whose data operand is forwarded gets it from MEM/WB (the load result after the load-use stall); 20 stalls |

## Gate-level simulation vs RTL (Verilator)

`test/run-verilator-gate.sh` simulates the Yosys output (`synth/silicon_gates.v` with Yosys's `simcells.v`) under Verilator and compares it with the RTL simulation on every binary: the per-cycle memory-port trace (`imem_addr`, `dmem_addr`, `dmem_wdata`, `dmem_we`, `dmem_be`, `dmem_re`, `halted`), the final 64 KiB / 4 MiB memory image and the cycle count must be identical.

Result: 55 of 55 identical (17 curated programs including `smoke`, 38 arch tests; `test/results/verilator-gate.md`). The longest run is mandel: 2,288,139 cycles, trace identical line by line.

## Browser twin vs RTL

The browser does not run Verilator; it runs `core.js`, a JavaScript model of the same microarchitecture. `test/trace-equivalence.mjs` compares its full per-cycle trace line (30 fields: PC, every pipeline register's valid/pc/instr, stall, redirect and target, both forwarding selects, ALU operands and result, write-back port, data-memory port, halted) with the Verilator trace of the RTL:

| Suite | Result |
|---|---|
| 38 arch tests, every cycle | 38/38 identical (`archtest-js-vs-rtl.txt`) |
| 17 programs: trace prefix (60,000 cycles max per program), final registers, final memory, cycle and instruction counts | 17/17 identical (`programs-js-vs-rtl.txt`) |

## Browser gate-level evaluator vs RTL

`gatesim.js` evaluates the real netlist (`netlist.compact.json`, derived from `synth/silicon_netlist.json` without loss of cells or connections) in topological order each cycle. `test/gate-equivalence.mjs` runs it on all 38 arch tests next to the behavioural model and compares the netlist's output ports every cycle: 38/38 identical (`archtest-jsgate-vs-rtl.txt`). In the app, the gate evaluator is checked against the recorded behavioural trace on every cycle it computes: `imem_addr`, `dmem_addr`, `dmem_we`, `dmem_be`, `dmem_wdata` (on writes) and `halted` (`dmem_re` is not recorded in the browser's cycle log; the Verilator gate-level run compares it). The "gate-level ≡ RTL · N cycles" chip in the transport bar counts the distinct cycles checked and would turn red on a mismatch.

## Session machinery

`test/session-gatetrack.mjs` (run on hazards, primes, calls, bubble) checks the step-back history, run-to-halt cycle counts against the Verilator run, the final a0, the memory undo log, breakpoint stops, seeking to arbitrary cycles, and the gate tracker's flop state and toggle counts at sampled cycles against a fresh evaluation.

## Assembler

See Assembler: 41/41 curated checks byte-identical to GNU as/ld, 110/110 random programs, 23/23 negative tests, and the disassembly-to-source round trip on all programs.

## Reproduce

```
make all gate                 # Verilator RTL and gate-level simulators
archtest/run.sh               # 38 arch tests -> archtest/results.md
programs/build.sh             # compile, run and record all programs
test/run-all.sh               # every JS-side suite -> test/results/*.txt (~40 s)
test/run-verilator-gate.sh    # gate vs RTL on all 55 binaries (~4 min)
```
