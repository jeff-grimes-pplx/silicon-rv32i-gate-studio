#!/bin/bash
# Build every curated program, run it on the Verilator RTL model, and record
# machine code, listing, symbols, final state and CPI for the browser app.
set -e
cd "$(dirname "$0")"
CC=riscv64-unknown-elf-gcc
CFLAGS="-g -march=rv32i -mabi=ilp32 -O2 -ffreestanding -fno-builtin -nostdlib -nostartfiles -Wall"
SIM=../obj_dir/silicon_sim
mkdir -p build
build_one() {  # name kind source
  local name=$1 kind=$2 src=$3
  local elf=build/$name.elf
  if [ "$kind" = c ]; then
    $CC $CFLAGS -T link.ld -o $elf crt0.S $src -lgcc
  else
    $CC -g -march=rv32i -mabi=ilp32 -nostdlib -nostartfiles -T link.ld -o $elf $src
  fi
  riscv64-unknown-elf-objcopy -O binary $elf build/$name.bin
  riscv64-unknown-elf-objdump -d --no-show-raw-insn -M no-aliases,numeric $elf > build/$name.dis.raw
  riscv64-unknown-elf-objdump -d $elf > build/$name.dis
  riscv64-unknown-elf-nm -n $elf > build/$name.sym
  riscv64-unknown-elf-objdump --dwarf=decodedline $elf > build/$name.lines
  $SIM --bin build/$name.bin --mem-kb 64 --max-cycles 20000000 --dump-regs --trace build/$name.trace --trace-max 60000 --dump-mem 0 65536 build/$name.mem > build/$name.run 2>build/$name.err
  tail -1 build/$name.run
}
for f in c/*.c; do n=$(basename $f .c); printf "%-10s " $n; build_one $n c $f; done
for f in asm/*.S; do n=$(basename $f .S); printf "%-10s " $n; build_one $n asm $f; done
