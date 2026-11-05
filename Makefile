# Silicon build: RTL simulation (Verilator), synthesis (Yosys), programs (riscv gcc)
VERILATOR ?= verilator
RTL = rtl/silicon_core.sv
OBJ = obj_dir

all: $(OBJ)/silicon_sim

$(OBJ)/silicon_sim: $(RTL) sim/tb.cpp
	$(VERILATOR) --cc --exe --build -O3 -Wall -Wno-fatal --public-flat-rw \
	  --top-module silicon_core -CFLAGS "-O2" \
	  --Mdir $(OBJ) -o silicon_sim $(RTL) sim/tb.cpp > $(OBJ).build.log 2>&1 || (tail -30 $(OBJ).build.log; exit 1)

clean:
	rm -rf $(OBJ)

# gate-level simulation of the Yosys netlist with the same harness
GATE_OBJ = obj_gate
$(GATE_OBJ)/silicon_gate_sim: synth/silicon_gates.v sim/tb.cpp
	$(VERILATOR) --cc --exe --build -O3 -Wno-fatal -Wno-lint -Wno-style \
	  --top-module silicon_core -CFLAGS "-O2 -DGATE_LEVEL" \
	  --Mdir $(GATE_OBJ) -o silicon_gate_sim synth/silicon_gates.v /usr/share/yosys/simcells.v sim/tb.cpp > $(GATE_OBJ).build.log 2>&1 || (tail -30 $(GATE_OBJ).build.log; exit 1)

gate: $(GATE_OBJ)/silicon_gate_sim
