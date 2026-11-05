#!/bin/bash
# JS twin vs Verilator RTL on every arch test (full per-cycle traces)
cd "$(dirname "$0")/.."
pass=0; fail=0
for elf in archtest/work/*.elf; do
  t=$(basename $elf .elf)
  th=$(riscv64-unknown-elf-nm $elf | awk '$3=="tohost"{print $1}')
  ./obj_dir/silicon_sim --bin archtest/work/$t.bin --mem-kb 4096 --tohost $th --trace /tmp/$t.rtl.trace > /dev/null 2>&1
  if node test/trace-equivalence.mjs archtest/work/$t.bin /tmp/$t.rtl.trace 4096 5000000 $th > /tmp/$t.eq.log 2>&1; then
    pass=$((pass+1)); tail -1 /tmp/$t.eq.log
  else
    fail=$((fail+1)); echo "FAIL $t"; head -5 /tmp/$t.eq.log
  fi
  rm -f /tmp/$t.rtl.trace
done
echo "JS-vs-RTL trace equivalence: $pass pass, $fail fail"
