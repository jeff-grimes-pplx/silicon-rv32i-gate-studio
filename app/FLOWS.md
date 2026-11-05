# Main flows

## 1. Initial Workbench & Program Selection
- Start: index.html
- Steps: inspect initial loaded state, switch `#program-select` between `primes.c`, `quicksort.c`, `fibonacci_matrix.c`, `crc32.c`, and `hazards.S`
- Expect: C source or Assembly source populates left IDE pane; 5-stage pipeline diagram (`IF`, `ID`, `EX`, `MEM`, `WB`) renders in top-right; Registers (`x0`..`x31`), Data memory, and Pipeline events (`forwards`, `stalls`, `flushes`) render in bottom-right; transport bar shows `gate-level = RTL` equivalence badge with `0 mismatches`.

## 2. Single-Cycle Stepping, Backtracking & Clock Speeds (1 Hz to 100 kHz)
- Start: index.html (with `hazards.S` or `primes.c`)
- Steps: click `Step` (`Space`), `Back`, change speed selector (`1 Hz`, `10 Hz`, `100 Hz`, `1 kHz`, `10 kHz`, `100 kHz`, `Max`), click `Run`, click `Pause`/`Stop`, click `To end`
- Expect: Cycle counter, instruction counter (`instret`), CPI, pipeline stage cards, forwarding arcs (`EX/MEM -> EX`, `MEM/WB -> EX`, `WB -> ID`), load-use `STALL` / `HOLD` / `BUBBLE` badges, and `FLUSH` badges update synchronously; `To end` runs `primes.c` to cycle `16,700` with `a0 = 0000021d (541)` and `0 mismatches`.

## 3. C Source, Assembly & Machine Code Tabs + Breakpoints + Live RV32I Assembler
- Start: index.html
- Steps: click `C source`, `Assembly`, `Machine code` tabs; click gutter row `0x044` in `Machine code` to set a breakpoint and click `Run`; switch to `Assembly` tab, edit an instruction, and click `Assemble & reset`
- Expect: Active pipeline stages (`IF`, `ID`, `EX`, `MEM`, `WB`) highlight matching source lines and machine instructions; execution pauses at the breakpoint cycle (`1,465` on `primes.c`); edited assembly compiles in-browser into machine words and resets the pipeline and gate-level netlist.

## 4. Split View (Pipeline Datapath + Live 8,297-Gate Silicon Die Side-by-Side)
- Start: index.html
- Steps: click `Split: Pipeline + Die` tab in the top view bar; click `Step` or `Run`
- Expect: Both the 5-stage `IF -> ID -> EX -> MEM -> WB` pipeline datapath AND the live 8,297-cell synthesized silicon die canvas (plus Registers & Memory) are visible together in the same viewport, with logic gates and D-flip-flops toggling live `0/1` states in lockstep on every clock cycle.

## 5. Full 8,297-Gate Synthesized Silicon Die & Netlist Explorer
- Start: index.html
- Steps: click `Netlist` (`8,297-Gate Die`) tab in the top view bar; type `a0` in the `Find` input and press `Enter`; click `show longest path`; toggle `Color: Toggled` vs `Color: Voltage (0/1)`; hover and click individual gates/DFFs
- Expect: 8,297 Yosys cells (`1,486` DFFs, `6,811` combinational gates across `IF`, `ID`, `EX`, `MEM`, `WB`) render on the interactive canvas; searching `a0` highlights and centers the 32 flip-flops of register `a0 (x10)` showing its 32-bit hex value and bit vector; `show longest path` highlights the 76-gate-level critical path; Voltage mode colors every cell by live `0/1` logic level.

## 6. Architecture & Hardware Verification Documentation View
- Start: index.html
- Steps: click `Docs` tab in the top view bar; click sections in the left navigation (`Overview`, `Pipeline`, `Hazards & forwarding`, `Gate-level netlist`, `Verification`)
- Expect: Documentation renders cleanly with links to downloadable hardware artifacts (`silicon_die_8297.svg`, `silicon_die_8297.gds`, `verification_receipt.json`).
