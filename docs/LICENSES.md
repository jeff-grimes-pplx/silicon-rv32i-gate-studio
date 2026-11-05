# Licenses and attribution

## Original work (Apache License 2.0)

Everything written for Silicon: the processor (`rtl/silicon_core.sv`), the Verilator test bench (`sim/tb.cpp`), the arch-test target files (`archtest/target/`), the synthesis script and netlist conversion (`synth/`), the curated programs (`programs/c/*.c`, `programs/asm/*.S`, `crt0.S`, `link.ld`), the browser twin, gate evaluator, assembler, disassembler, layout and UI (`app/src/`), the tests (`test/`) and this documentation. No existing processor core was used as a source; the pipeline, hazard logic and encodings were written from the RISC-V ISA specification.

## Third-party content shipped with the app

| Component | Use | License |
|---|---|---|
| Geist Variable (Vercel), via `@fontsource-variable/geist` 5.3.0 | interface font | SIL Open Font License 1.1 |
| JetBrains Mono Variable (JetBrains), via `@fontsource-variable/jetbrains-mono` 5.3.0 | code and values | SIL Open Font License 1.1 |
| libgcc routines (GCC 14.2.0): `__mulsi3` in `matmul` and `mandel`; `__divsi3`, `__udivsi3`, `__modsi3`, `__umodsi3` in `mandel` | linked into the machine code of those programs | GPLv3 with the GCC Runtime Library Exception |

The icon is an inline SVG drawn for this app. No stock images, photographs or external media are used.

## Third-party content used to build and verify (not shipped)

| Component | Use | License |
|---|---|---|
| riscv-arch-test 2.7.4 (RISC-V International) | the 38 RV32I test programs and their reference signatures (`archtest/work/`, `archtest/results.md`) | BSD-3-Clause (code), CC-BY-4.0 (documentation) |
| Yosys 0.52 | synthesis; its `simcells.v` is used by the gate-level Verilator build | ISC |
| Verilator 5.032 | RTL and gate-level simulation | LGPL-3.0 / Artistic-2.0 |
| Icarus Verilog 12.0 | installed as a second simulator; not used for the receipts | GPL-2.0 |
| GNU toolchain: riscv64-unknown-elf-gcc 14.2.0, binutils 2.45 | compiling and assembling programs; reference for the assembler tests | GPL-3.0 (the compiled programs are not affected, except libgcc as noted above) |
| Vite 8, marked 18 | build tooling; rendering these documents to HTML at build time | MIT |
| Node.js 20 | test scripts | MIT |

The RISC-V name and ISA specification belong to RISC-V International; "RISC-V" is used here descriptively.
