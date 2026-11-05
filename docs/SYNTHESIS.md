# Synthesis report

Yosys 0.52 synthesizes `rtl/silicon_core.sv` to a flat netlist of generic cells. The script (`synth/synth.ys`):

```
read_verilog -sv rtl/silicon_core.sv
hierarchy -check -top silicon_core
synth -top silicon_core -flatten
dfflegalize -cell $_DFF_P_ 01 -cell $_DFFE_PP_ 01 -cell $_SDFF_PP?_ 01 -cell $_SDFFE_PP?P_ 01
abc -g AND,NAND,OR,NOR,XOR,XNOR,MUX
opt_clean -purge
tee -o synth/stat.txt stat
tee -o synth/ltp.txt ltp -noff
write_json synth/silicon_netlist.json
write_verilog -noattr -noexpr synth/silicon_gates.v
```

`dfflegalize` restricts the sequential cells to positive-edge flops with optional enable and synchronous reset; ABC maps all combinational logic onto two-input gates plus a 2:1 multiplexer. There is no memory macro: the register file is synthesized to flip-flops and multiplexers, which is why MUX and NAND dominate.

## Cell counts (`synth/stat.txt`)

| Cell | Count | Role |
|---|---|---|
| $_NAND_ | 2298 | combinational |
| $_MUX_ | 1784 | combinational (register-file read trees, forwarding muxes, write-back select) |
| $_AND_ | 1234 | combinational |
| $_DFFE_PP_ | 992 | flop with enable: the 31 × 32 register-file bits |
| $_OR_ | 781 | combinational |
| $_SDFFE_PP0P_ | 474 | flop with synchronous reset and enable: PC, IF/ID, ID/EX, EX/MEM, MEM/WB, `halted`, `fetch_stopped` (the enable is the stall hold or `~halted`) |
| $_NOT_ | 396 | combinational |
| $_XOR_ | 119 | combinational (adder, comparators) |
| $_XNOR_ | 116 | combinational |
| $_NOR_ | 83 | combinational |
| $_SDFF_PP0_ | 10 | flop with synchronous reset: the two 5-bit register-read address fields of IF/ID (`rdaddr1`, `rdaddr2`) |
| $_DFF_P_ | 10 | plain flop: the ID/EX ALU-operation code, which Yosys's `fsm` pass extracted as a state register and re-encoded one-hot (4-bit binary with 11 reachable codes in the RTL; 10 state flops remain after optimization; `synth/yosys.log`) |
| **Total** | **8297** | 6811 combinational cells, 1486 flip-flops |

Nets: 8,368 (Yosys bit ids, plus two constants) in the compact form the browser loads; 11 ports. Yosys names a flop after the net it drives, so in the netlist view the PC appears as `imem_addr[31:0]`, the EX/MEM ALU result mostly as `dmem_addr[...]`, and the IF/ID instruction as its decoded fields (`id_opcode`, `id_rd`, `id_funct3`, `rdaddr1`, `rdaddr2`, `id_funct7`, `id_imm`). The RTL names Yosys merged away are kept as aliases (39 bits, e.g. `exmem_alu[31:2]` = `dmem_addr[31:2]`, `exmem_store_data[7:0]` = `dmem_wdata[7:0]`), so searching for the RTL name finds the same flops and says which name Yosys gave them.

## Estimated critical path

There is no timing library for these generic cells, so there is no path delay in nanoseconds; Yosys's `ltp` (longest topological path, `-noff` stops at flip-flops) gives the logic depth in gate levels:

- **Longest path: 76 levels**, from the flop `memwb_rd[4]` (the destination-register field in MEM/WB) through the forwarding comparators and operand muxes into the ALU and out to `alu_y[31]`, which is captured by the `dmem_addr[31]` flop (the EX/MEM ALU-result register; Yosys names flops after the net they drive).
- This is the expected critical path of a forwarding five-stage pipeline: forwarding-select compare → 3:1 operand mux → 32-bit adder carry chain → result mux. The branch comparison and jump-target adder share most of the depth.
- The netlist view's "longest path" overlay walks the compact netlist in the browser and highlights one path of the same length (76 levels); several paths tie at that length, so the highlighted flops can differ from the Yosys printout.

What this means: with unit delay per gate the clock period would be about 76 gate delays plus setup and clock-to-Q. A timing-annotated flow (a real cell library plus OpenSTA) was not run; the unit-delay depth is the only timing figure reported, and it is labelled as such in the app.

## Gate-level equivalence

The gate-level netlist (`synth/silicon_gates.v`) was simulated under Verilator against the RTL on all 55 binaries with identical port traces and memory images (see Verification). The browser evaluates the same netlist (`netlist.compact.json`: identical 8,297 cells and connectivity, with a stage assignment and a 2-D placement for drawing) and checks its ports against the behavioural model on every computed cycle.

## Toolchain

| Tool | Version |
|---|---|
| Yosys | 0.52 |
| Verilator | 5.032 |
| Icarus Verilog | 12.0 (installed; the receipts use Verilator) |
| riscv64-unknown-elf-gcc | 14.2.0 |
| GNU binutils (as, ld, objdump) | 2.45 |
| Node.js | 20.20.2 |
