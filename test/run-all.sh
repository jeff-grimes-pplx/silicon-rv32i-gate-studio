#!/bin/bash
# Re-run every equivalence / assembler test and keep the receipts in test/results/.
# (Verilator gate-level vs RTL is separate: test/run-verilator-gate.sh, ~4 min.)
cd "$(dirname "$0")/.."
R=test/results; mkdir -p $R
run() { local name=$1; shift; echo "== $name"; "$@" > $R/$name.txt 2>&1; echo "exit $?" >> $R/$name.txt; tail -2 $R/$name.txt; }
run archtest-js-vs-rtl        ./test/run-archtest-equivalence.sh
run archtest-jsgate-vs-rtl    ./test/run-gate-equivalence.sh
echo "== programs-js-vs-rtl"; : > $R/programs-js-vs-rtl.txt
for b in programs/build/*.bin; do n=$(basename $b .bin); node test/program-equivalence.mjs $n >> $R/programs-js-vs-rtl.txt 2>&1 || echo "FAIL $n" >> $R/programs-js-vs-rtl.txt; done
grep -c ": OK" $R/programs-js-vs-rtl.txt | sed "s/^/OK count: /" | tee -a $R/programs-js-vs-rtl.txt
run hazards-rtl               node test/hazards-rtl.mjs
run asm-vs-gnu                node test/asm-vs-gnu.mjs
run asm-fuzz-seed1            node test/asm-fuzz-vs-gnu.mjs 1 /tmp/fuzz1 40
run asm-fuzz-seed7            node test/asm-fuzz-vs-gnu.mjs 7 /tmp/fuzz7 40
run asm-fuzz-seed3            node test/asm-fuzz-vs-gnu.mjs 3 /tmp/fuzz3 30
run asm-errors                node test/asm-errors.mjs
run toasm-roundtrip           node test/toasm-roundtrip.mjs
for p in hazards primes calls bubble; do run session-gatetrack-$p node test/session-gatetrack.mjs $p; done
date -u +%Y-%m-%dT%H:%MZ > $R/run-all.timestamp
