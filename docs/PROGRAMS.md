# Programs and CPI

Eighteen curated programs: twelve in C (compiled in the sandbox with `riscv64-unknown-elf-gcc 14.2.0`, flags `-g -march=rv32i -mabi=ilp32 -O2 -ffreestanding -fno-builtin -nostdlib -nostartfiles`, linked with `programs/crt0.S`, `programs/link.ld` and `-lgcc` into a 64 KiB RAM at address 0) and six in assembly. Each one ends with `ebreak` and leaves its result in `a0`. The browser receives the machine code, symbols and line table; the assembly programs can be edited and reassembled in the browser.

## Measured CPI

Cycles and instructions are from the Verilator run of the RTL (`programs/build/<name>.run`); stalls, flushes and forwards are counted on the browser twin, whose per-cycle trace is identical to the RTL's (Verification). The identity `cycles = 4 + instructions + stalls + 2 × flushes` holds for every program: four cycles of pipeline fill, one cycle per load-use stall, two discarded fetch slots per taken branch or jump.

| Program | Source | Result in a0 | Cycles | Instructions | CPI | Load-use stalls | Flushes (redirects) | EX forwards | WB bypasses |
|---|---|---|---|---|---|---|---|---|---|
| primes — Sieve of Eratosthenes | C | 541 (0x21d) | 16,700 | 11,451 | 1.4584 | 279 | 2,483 | 2,022 | 1,260 |
| quicksort — Quicksort (Lomuto) | C | 760 (0x2f8) | 1,021 | 817 | 1.2497 | 0 | 100 | 185 | 199 |
| fibonacci_matrix — Fibonacci 2x2 Matrix Power | C | 832040 (0xcb228) | 2,340 | 1,624 | 1.4409 | 0 | 356 | 420 | 82 |
| fib — Fibonacci table | C | 832040 (0xcb228) | 456 | 324 | 1.4074 | 0 | 64 | 66 | 2 |
| gcd — Binary GCD | C | 21 (0x15) | 864 | 554 | 1.5596 | 0 | 153 | 272 | 42 |
| bubble — Bubble sort | C | 62 (0x3e) | 1,326 | 842 | 1.5748 | 120 | 180 | 289 | 242 |
| crc32 — CRC-32 (bitwise) | C | 1475291997 (0x57ef2b5d) | 2,570 | 2,032 | 1.2648 | 0 | 267 | 1,129 | 265 |
| matmul — 3x3 matrix multiply | C | 175 (0xaf) | 1,075 | 749 | 1.4352 | 0 | 161 | 178 | 39 |
| strrev — String reverse | C | 25 (0x19) | 330 | 249 | 1.3253 | 1 | 38 | 7 | 77 |
| bsearch — Binary search | C | 21 (0x15) | 377 | 295 | 1.2780 | 0 | 39 | 85 | 32 |
| collatz — Collatz chains | C | 97 (0x61) | 24,841 | 17,975 | 1.3820 | 0 | 3,431 | 9,649 | 198 |
| mandel — Mandelbrot (fixed point) | C | 144 (0x90) | 2,288,139 | 1,605,069 | 1.4256 | 144 | 341,461 | 522,126 | 21,901 |
| hazards — Hazards, one at a time | asm | 103 (0x67) | 23 | 16 | 1.4375 | 1 | 1 | 13 | 1 |
| branches — Counting loop | asm | 55 (0x37) | 56 | 34 | 1.6471 | 0 | 9 | 21 | 2 |
| sum — Load-use: naive vs scheduled | asm | 1240 (0x4d8) | 127 | 87 | 1.4598 | 8 | 14 | 24 | 11 |
| multiply — Shift-and-add multiply | asm | 56088 (0xdb18) | 83 | 53 | 1.5660 | 0 | 13 | 19 | 1 |
| memcopy — Byte copy and word copy | asm | 32 (0x20) | 188 | 128 | 1.4688 | 20 | 18 | 40 | 4 |
| calls — Calls and a stack frame | asm | 74 (0x4a) | 98 | 66 | 1.4848 | 0 | 14 | 22 | 17 |

"Flushes" counts redirects from EX (taken branches, `jal`, `jalr`); the final `ebreak` is not counted because nothing younger needs to retire. "EX forwards" counts operands taken from EX/MEM or MEM/WB in EX; "WB bypasses" counts register-file reads in ID that saw the value being written in WB that same cycle.

## Expected outputs

- **primes** (Sieve of Eratosthenes): a0 = 541 (the 100th prime); primes[0..99] in memory. 
  Watch: Byte stores (sb) marking composite[] in the inner loop; the final loop collects primes[] with a load-use stall on every candidate.
- **fib** (Fibonacci table): a0 = 832040 = fib(30); fib[0..31] in memory. 
  Watch: The running sum is forwarded EX/MEM to EX on every iteration; each sw depends on a value computed one instruction earlier.
- **gcd** (Binary GCD): a0 = 21 = gcd(1071, 462); the g field of every table entry is filled in. 
  Watch: Shift loops where each srli feeds the next andi; the loop-exit branches flush two fetched instructions each time.
- **bubble** (Bubble sort): a0 = 62 swaps; data[16] sorted ascending in memory. 
  Watch: Compare-and-swap pairs in the memory view; back-to-back lw/lw/bgeu with a load-use stall before the compare.
- **crc32** (CRC-32 (bitwise)): a0 = 0x57ef2b5d, the same value zlib.crc32 computes for the message. 
  Watch: The 8-step inner loop is a dependent chain (andi, neg, and, srli, xor): every ALU result is forwarded to the next instruction.
- **matmul** (3x3 matrix multiply): a0 = 175 = trace(C); C[3][3] in memory. 
  Watch: RV32I has no multiply instruction: GCC calls libgcc __mulsi3. Each call and return is a redirect that flushes the front end.
- **strrev** (String reverse): a0 = 25 (length); text[] reversed in place. 
  Watch: lbu/sb pairs swap characters from both ends; the ASCII column of the memory view flips while it runs.
- **bsearch** (Binary search): a0 = 21 (index of 733); found[4] and probes[4] in memory. 
  Watch: Data-dependent branches: each probe is a lw followed by two compares, one taken and one not, flushing on every taken branch.
- **collatz** (Collatz chains): a0 = 97 (longest chain below 100); best_steps = 118; steps[1..99] in memory. 
  Watch: The parity test (andi, bnez) decides between a shift and a slli+add+addi chain; branch outcomes alternate unpredictably.
- **mandel** (Mandelbrot (fixed point)): a0 = 144 bounded points; 12 rows of 40 characters at image[]. 
  Watch: Long run (2.29 M cycles): press Run. The ASCII image appears row by row in memory at image[]; most time is spent in __mulsi3.
- **hazards** (Hazards, one at a time): a0 = 103. 
  Watch: Step from reset. Cycle 4: add t2,t0,t1 takes t0 from MEM/WB and t1 from EX/MEM. Cycle 9: addi t6,t5,1 waits in ID for one cycle while lw t5 is in EX (load-use stall). Cycle 16: bne is taken and the two instructions fetched after it are flushed.
- **branches** (Counting loop): a0 = 55, a1 = 10. 
  Watch: Nine taken branches, each flushing two wrongly fetched instructions (the core predicts not-taken); the last blt falls through.
- **sum** (Load-use: naive vs scheduled): a0 = a1 = 1240. 
  Watch: The first loop stalls one cycle per element (lw immediately followed by add). The second loop does the same work with the pointer and counter updates moved between them: no stalls.
- **multiply** (Shift-and-add multiply): a0 = 56088 = 123 x 456. 
  Watch: andi t0 -> beqz t0 is a forwarded compare; the loop runs 9 times for a 9-bit multiplier.
- **memcopy** (Byte copy and word copy): a0 = 32; dst_bytes and dst_words equal src. 
  Watch: lbu/sb pairs then lw/sw pairs; the store data is forwarded from the load result in WB. Both destination buffers fill in the memory view.
- **calls** (Calls and a stack frame): a0 = 74 = 7*7 + 5*5. 
  Watch: jal writes ra from PC+4 in WB; ret is a jalr whose target comes from a forwarded ra. sp moves down and back up in the register file.

The final register and memory images of every program are recorded in `programs/build/<name>.run` and `<name>.mem`; the app compares a finished run's a0 with the recorded value ("same as the Verilator run"). A seventeenth program, `smoke`, is used only by the test scripts.

## Why the CPI is what it is

- Straight-line arithmetic (the arch tests) runs at CPI ≈ 1.00.
- Every taken branch costs two cycles because the core predicts not-taken and resolves in EX. `branches` (a counting loop) is the worst case at 1.65; `collatz` and `mandel` sit around 1.4 because their loop bodies are longer.
- Load-use stalls cost one cycle; `sum` shows the same work with and without them (8 stalls in the naive loop, none in the scheduled loop).
- RV32I has no multiply: `matmul` and `mandel` call libgcc's `__mulsi3`, so most of `mandel`'s 2.29 M cycles are shift-and-add loops inside that routine.
