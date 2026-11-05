# Limitations

## Processor

- RV32I only. No M extension (GCC is invoked with `-march=rv32i`; multiplications become calls to libgcc's `__mulsi3`), no Zicsr, no counters readable from software, no privilege modes, no traps or exceptions. Illegal and CSR instructions retire as NOPs; misaligned loads and stores are not detected.
- `ecall` and `ebreak` halt the core; there is no environment to call into.
- Static not-taken branch prediction, resolved in EX: every taken branch or jump costs two cycles. No branch predictor, no return-address stack.
- Memory is a flat 64 KiB RAM (4 MiB in the arch-test bench) with combinational reads and no caches; instruction and data ports read the same array, so self-modifying code works without `fence.i`. The core has no bus interface, interrupts or peripherals.
- The design is a teaching-scale core and has not been through a physical flow: no timing library, no placement, no clock-tree, no power numbers. The reported critical path is a unit-delay logic depth (76 levels).

## Verification

- Arch tests are run against the reference signatures of riscv-arch-test 2.7.4 (RV32I, 38 tests). Spike was not used as a second oracle: the Silicon programs are linked at address 0, which Spike reserves for its debug module, and relinking them elsewhere would change the programs being verified.
- The gate-level comparison under Verilator checks the port traces (every memory access, every cycle) and the final memory images, which together determine the architectural outcome; it does not compare the internal flops of the gate netlist with the RTL (their names differ after synthesis). The browser evaluator additionally checks the netlist's port outputs against the behavioural model every cycle.
- Equivalence between the browser twin and the RTL is established by trace comparison over the arch tests (complete) and the curated programs (complete for programs up to 60,000 cycles; for mandel the first 60,000 cycles plus the final state). It is not a formal proof: a user program can in principle reach a state no test reached. The gate-level evaluator's per-cycle port check in the app is the runtime guard for that case; a mismatch would be shown in the transport bar.
- Random instruction-stream testing of the core itself was not done; the assembler fuzzer tests the assembler, not the pipeline.

## App

- C is compiled in the sandbox, not in the browser. The C source view is read-only; editing is possible at the instruction level in the Assembly tab (the disassembly reassembles to the identical image).
- The in-browser assembler covers the GNU as dialect used by the curated programs (see Assembler). It does not support macros, `.include`, `.rept`, `.irp`, multiple files, floating-point or compressed instructions, or relocations to external symbols.
- Programs are limited to 64 KiB of memory and 3 million cycles per run (mandel, the longest curated program, is 2.29 M cycles; it takes well under a minute at full speed in the browser). Gate-level activity for a cycle far from the last computed one is reconstructed by replaying the netlist from the nearest keyframe (every 256 cycles); a progress bar is shown for long replays.
- Gate-level activity is computed for the cycle being viewed. During fast runs the netlist view catches up when the run stops; it does not animate every intermediate cycle at thousands of cycles per second.
- The netlist layout groups cells by pipeline stage and register-file bank; it is a reading aid, not a placement. Wires are drawn only for a cell's immediate neighbours at high zoom.
- Step back uses a history ring of the last 4,096 cycles; seeking further back replays the program from reset to the requested cycle (a progress bar is shown), so every cycle is reachable but far seeks in long runs take a moment.
- No persistence: an edited program lives in the page until it is reloaded. Nothing is sent anywhere; the app is static.
