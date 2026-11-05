#!/bin/bash
# Gate-level (Yosys netlist, Verilator) vs RTL (Verilator) equivalence on every
# curated program and every riscv-arch-test program: the per-cycle memory-port
# trace (imem_addr, dmem_addr, dmem_wdata, we, be, re, halted), the final memory
# image and the cycle count must be identical.
set -u
cd "$(dirname "$0")/.."
RTL=obj_dir/silicon_sim; GATE=obj_gate/silicon_gate_sim
OUT=test/results/verilator-gate.md
TMP=$(mktemp -d)
pass=0; fail=0
printf "| Program | Cycles (RTL) | Cycles (gate) | Port trace | Final memory | Result |\n|---|---|---|---|---|---|\n" > $OUT
run_pair() {  # name bin memkb extra-args...
  local name=$1 bin=$2 memkb=$3; shift 3
  $RTL --bin $bin --mem-kb $memkb --max-cycles 20000000 --trace-max 100000000 --io-trace $TMP/rtl.io --dump-mem 0 $((memkb*1024)) $TMP/rtl.mem "$@" > $TMP/rtl.out 2>/dev/null
  $GATE --bin $bin --mem-kb $memkb --max-cycles 20000000 --trace-max 100000000 --io-trace $TMP/gate.io --dump-mem 0 $((memkb*1024)) $TMP/gate.mem "$@" > $TMP/gate.out 2>/dev/null
  local cr=$(sed -n 's/.*cycles=\([0-9]*\).*/\1/p' $TMP/rtl.out) cg=$(sed -n 's/.*cycles=\([0-9]*\).*/\1/p' $TMP/gate.out)
  local tr="identical" mr="identical" res=PASS
  cmp -s $TMP/rtl.io $TMP/gate.io || { tr="DIFFER"; res=FAIL; }
  cmp -s $TMP/rtl.mem $TMP/gate.mem || { mr="DIFFER"; res=FAIL; }
  [ "$cr" = "$cg" ] || res=FAIL
  [ $res = PASS ] && pass=$((pass+1)) || fail=$((fail+1))
  echo "$name: $res (rtl $cr / gate $cg cycles, $(wc -l < $TMP/rtl.io) trace lines)"
  printf "| %s | %s | %s | %s | %s | %s |\n" "$name" "$cr" "$cg" "$tr" "$mr" "$res" >> $OUT
}
for b in programs/build/*.bin; do run_pair "$(basename $b .bin)" $b 64; done
for b in archtest/work/*.bin; do
  t=$(basename $b .bin); elf=archtest/work/$t.elf
  th=$(riscv64-unknown-elf-nm $elf | awk '$3=="tohost"{print $1}')
  run_pair "arch:$t" $b 4096 --tohost $th
done
rm -rf $TMP
echo; echo "PASS $pass / FAIL $fail"
printf "\n%s passed, %s failed (Verilator %s; RTL = rtl/silicon_core.sv, gate = synth/silicon_gates.v + yosys simcells.v; %s)\n" $pass $fail "$(verilator --version | awk '{print $2}')" "$(date -u +%Y-%m-%dT%H:%MZ)" >> $OUT
