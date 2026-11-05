#!/bin/bash
cd "$(dirname "$0")/.."
pass=0; fail=0
for elf in archtest/work/*.elf; do
  t=$(basename $elf .elf); th=$(riscv64-unknown-elf-nm $elf | awk '$3=="tohost"{print $1}')
  if node test/gate-equivalence.mjs archtest/work/$t.bin 4096 5000000 $th > /tmp/$t.gate.log 2>&1; then pass=$((pass+1)); tail -1 /tmp/$t.gate.log; else fail=$((fail+1)); echo "FAIL $t"; head -3 /tmp/$t.gate.log; fi
done
echo "JS gate-level vs behavioural: $pass pass, $fail fail"
