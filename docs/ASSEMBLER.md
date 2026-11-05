# Assembler

`asm.js` is a two-pass RV32I assembler written for this app. It accepts the GNU as dialect used by the curated programs and produces the same bytes GNU as + ld produce for them.

## Accepted input

- Labels, including numeric local labels (`1:`, `1b`, `1f`); `.` for the current address.
- Sections: `.text`, `.data`, `.rodata`, `.bss`, `.section name` (recognised by prefix: `.text*`, `.data*`/`.rodata*`/`.sdata*`/`.srodata*`, `.bss*`/`.sbss*`). Layout follows `programs/link.ld`: text at 0, then data (4-aligned), then bss.
- Data: `.word`/`.long`/`.int`, `.half`/`.short`/`.2byte`, `.byte`, `.ascii`, `.asciz`/`.string`, `.space`/`.skip`/`.zero`, `.align`/`.p2align` (power of two), `.balign`, `.equ`/`.set`. `.globl`, `.option`, `.type`, `.size`, `.file`, `.ident`, `.attribute` are accepted and ignored.
- Expressions: `+ - * / % << >> & | ^ ~ ( )`, decimal, hex (`0x`), binary (`0b`), character literals with escapes, symbols, and the relocation functions `%hi`, `%lo`, `%pcrel_hi`, `%pcrel_lo`.
- All 37 RV32I base instructions plus `fence`, `ecall`, `ebreak`, and the standard pseudo-instructions: `nop`, `li` (one or two instructions, matching GNU's choice), `la`, `mv`, `not`, `neg`, `seqz`, `snez`, `sltz`, `sgtz`, `beqz`, `bnez`, `blez`, `bgez`, `bltz`, `bgtz`, `bgt`, `ble`, `bgtu`, `bleu`, `j`, `jr`, `jal offset`, `jalr rs`, `ret`, `call`, `tail`, and the `lw rd, symbol` / `sw rs, symbol, rt` forms.
- Register names: `x0`–`x31` and ABI names (`zero`, `ra`, `sp`, `gp`, `tp`, `t0`–`t6`, `s0`/`fp`–`s11`, `a0`–`a7`).
- Linker relaxation is reproduced: `la` and symbol-addressed loads/stores shrink to a single `x0`-relative instruction when the address fits in 12 bits, as GNU ld does for this memory map, so listings match `objdump` byte for byte.

## Errors

Errors are reported with the source line (for example `line 2: unknown instruction 'addx'`) and nothing is loaded. The negative test suite (`test/asm-errors.mjs`, 23 cases) covers unknown instructions and directives, wrong operand counts, bad registers, out-of-range immediates, branch and jump offsets that do not fit or are misaligned, undefined and duplicate labels, malformed expressions and strings, bad alignment arguments, and `la` into `zero`.

## Tests

| Test | Result |
|---|---|
| `test/asm-vs-gnu.mjs`: the 7 curated assembly sources assembled and compared with the GNU-built image byte for byte; the `objdump` listing of all 17 programs (C included) re-assembled word for word; the browser disassembler's output for every instruction re-assembled to the same word | 41/41 |
| `test/asm-fuzz-vs-gnu.mjs`: random programs (every instruction form, random immediates, labels, data directives, expressions), assembled by both assemblers and compared | 110/110 (seeds 1, 7, 3: 40 + 40 + 30 programs) |
| `test/asm-errors.mjs`: inputs that must be rejected, with the expected message | 23/23 |
| `test/toasm-roundtrip.mjs`: `toasm.js` turns each program's machine code into GNU-style source (the Assembly tab of a C program), which reassembles to the identical image | all 16 curated programs |

The assembler is used live in the browser: "Assemble & load" (Ctrl+Enter) assembles the editor contents, loads the image into a fresh 64 KiB memory, resets the core and keeps the line-to-address map so the pipeline marks in the editor gutter follow the instructions.
