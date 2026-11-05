#!/bin/bash
# Build and run the riscv-arch-test 2.7.4 RV32I suite on the Silicon core (Verilator).
# Usage: ./run.sh [testname...]   -> writes work/<test>.{elf,bin,sig,log} and results.md
set -u
cd "$(dirname "$0")"
SUITE=../riscv-arch-test-2.7.4/riscv-test-suite
SIM=../obj_dir/silicon_sim
CC=riscv64-unknown-elf-gcc
tests=("$@")
if [ ${#tests[@]} -eq 0 ]; then tests=($(ls $SUITE/rv32i_m/I/src/*.S | xargs -n1 basename | sed 's/\.S$//')); fi
pass=0; fail=0
printf "| Test | Result | Cycles | Instructions | CPI | Signature lines |\n|---|---|---|---|---|---|\n" > results.md
for t in "${tests[@]}"; do
  src=$SUITE/rv32i_m/I/src/$t.S
  ref=$SUITE/rv32i_m/I/references/$t.reference_output
  elf=work/$t.elf; bin=work/$t.bin; sig=work/$t.sig; log=work/$t.log
  # preprocess, then assemble+link. binutils 2.45 rejects the pseudo-instruction
  # `la x0,label` (jalr-01 inst_7, rd==x0); it is replaced by two explicit
  # instructions of the same size that also write x0 (no architectural effect).
  $CC -march=rv32i -mabi=ilp32 -DXLEN=32 -I target -I $SUITE/env -E -x assembler-with-cpp "$src" -o "work/$t.s" 2> "$log" || { echo "$t: PREPROCESS FAIL"; fail=$((fail+1)); continue; }
  sed -i -E 's/\bla x0,[^;]*/auipc x0,0; addi x0,x0,0/' "work/$t.s"
  $CC -march=rv32i -mabi=ilp32 -static -mcmodel=medany -fvisibility=hidden -nostdlib -nostartfiles \
      -T target/link.ld "work/$t.s" -o "$elf" 2>> "$log" || { echo "$t: COMPILE FAIL"; fail=$((fail+1)); continue; }
  riscv64-unknown-elf-objcopy -O binary "$elf" "$bin"
  sb=$(riscv64-unknown-elf-nm "$elf" | awk '$3=="begin_signature"{print $1}')
  se=$(riscv64-unknown-elf-nm "$elf" | awk '$3=="end_signature"{print $1}')
  th=$(riscv64-unknown-elf-nm "$elf" | awk '$3=="tohost"{print $1}')
  out=$($SIM --bin "$bin" --mem-kb 4096 --max-cycles 5000000 --tohost "$th" --sig "$sb" "$se" --sig-out "$sig" 2>>"$log")
  echo "$out" >> "$log"
  cyc=$(echo "$out" | sed -n 's/.*cycles=\([0-9]*\).*/\1/p'); ins=$(echo "$out" | sed -n 's/.*instret=\([0-9]*\).*/\1/p'); cpi=$(echo "$out" | sed -n 's/.*cpi=\([0-9.]*\).*/\1/p')
  n=$(wc -l < "$sig")
  if echo "$out" | grep -q "reason=tohost" && diff -q "$sig" "$ref" > /dev/null; then
    res=PASS; pass=$((pass+1))
  else
    res=FAIL; fail=$((fail+1))
  fi
  echo "$t: $res ($cyc cycles, $ins instr, CPI $cpi, $n sig lines)"
  printf "| %s | %s | %s | %s | %s | %s |\n" "$t" "$res" "$cyc" "$ins" "$cpi" "$n" >> results.md
done
echo; echo "PASS $pass / FAIL $fail / TOTAL $((pass+fail))"
printf "\n%s tests passed, %s failed (riscv-arch-test 2.7.4, rv32i_m/I, Verilator %s, %s)\n" "$pass" "$fail" "$(verilator --version | awk '{print $2}')" "$(date -u +%Y-%m-%dT%H:%MZ)" >> results.md
