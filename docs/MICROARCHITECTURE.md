# Microarchitecture

Silicon implements RV32I (the base integer instruction set, without Zicsr, traps or the M extension) as a classic five-stage in-order pipeline: IF, ID, EX, MEM, WB, with four pipeline registers (IF/ID, ID/EX, EX/MEM, MEM/WB). One instruction can enter and one can leave every cycle; the peak throughput is one instruction per cycle.

```
 IF          ID               EX                  MEM             WB
 pc ──► imem │ decode, imm    │ fwd mux A/B        │ dmem addr/data │ regfile write
             │ regfile read   │ ALU                │ byte enables   │ (x0 ignored)
             │ (WB bypass)    │ branch/jump target │ load extension │
             │ load-use check │ redirect           │                │
      ◄──────── stall ────────┘                    │                │
      ◄──────── redirect (flush IF/ID, ID/EX) ─────┘                │
                 ▲────────── EX/MEM → EX forwarding ──┘             │
                 ▲────────── MEM/WB → EX forwarding ────────────────┘
                 ▲────────── WB → ID register-file bypass ──────────┘
```

## Interfaces

The core has an instruction port and a data port; the memories live outside the core (in the test bench and in the browser, one 64 KiB RAM serves both ports).

- Instruction port: `imem_addr` out, `imem_rdata` in, combinational (same-cycle) read.
- Data port: `dmem_addr`, `dmem_wdata`, `dmem_be[3:0]`, `dmem_we`, `dmem_re` out, `dmem_rdata` in. Reads are combinational, writes happen at the clock edge. Loads therefore have a one-cycle latency as seen by the pipeline (the data is available in MEM, usable by the next instruction only through forwarding from MEM/WB, hence the load-use stall).
- `halted` out, `rst` is synchronous. Two reset cycles bring every flop to its defined value; fetch starts at PC 0.

## Stage by stage

**IF.** `pc` is a 32-bit register. The fetched word and its PC go to IF/ID with a valid bit. Prediction is static not-taken: the next PC is always PC + 4 unless EX redirects. If the pipeline is stalled, PC and IF/ID hold their values. After a halt instruction has passed EX, `fetch_stopped` is set and nothing further is fetched.

**ID.** The instruction is decoded into an ALU operation, operand selects (PC or rs1; immediate or rs2), the memory operation and the write-back select (ALU, load, PC + 4). The immediate is generated for the I, S, B, U and J formats. The register file (32 × 32 bit, x0 hard-wired to zero) is read combinationally; a write happening in WB in the same cycle is bypassed into the read value (WB → ID bypass), so a producer three instructions ahead needs no forwarding path in EX. Load-use detection also lives here:

```
stall = idex_valid & idex_mem_read & (idex_rd != 0) & ifid_valid
      & ((id_uses_rs1 & id_rs1 == idex_rd) | (id_uses_rs2 & id_rs2 == idex_rd))
```

When `stall` is set the PC and IF/ID hold, and a bubble (valid = 0) is inserted into ID/EX. Exactly one cycle later the load is in MEM and the consumer in EX receives the value through the MEM/WB forwarding path on the following cycle. Operand usage is decoded precisely (`id_uses_rs1`/`id_uses_rs2`), so an immediate instruction or a `lui` after a load does not stall on an accidental register-field match.

**EX.** Operand A and B each pass through a three-way forwarding mux:

```
fwd_a = FWD_MEM if exmem_valid & exmem_reg_write & exmem_rd != 0 & exmem_rd == idex_rs1
      else FWD_WB if wb_we & wb_rd == idex_rs1
      else register value read in ID
```

EX/MEM has priority over MEM/WB because it holds the younger instruction. The value forwarded from EX/MEM is the ALU result, or PC + 4 for `jal`/`jalr`; a load in EX/MEM is never forwarded from there (its data does not exist yet), which is exactly the case the load-use stall prevents. The ALU implements add, sub, sll, slt, sltu, xor, srl, sra, or, and; `lui` passes the immediate through, `auipc` adds PC and immediate. Branch conditions (`beq`, `bne`, `blt`, `bge`, `bltu`, `bgeu`) are evaluated on the forwarded operands; the target is `pc + imm` for branches and `jal`, `(rs1 + imm) & ~1` for `jalr`.

A taken branch or any jump asserts `redirect`: the PC is loaded with the target and both IF/ID and ID/EX are flushed (two instructions fetched down the wrong path are discarded, so a taken branch costs two cycles). A not-taken branch costs nothing.

**MEM.** The address is the ALU result. Stores drive `dmem_wdata` (replicated bytes/halfwords) and byte enables from the low address bits; loads read the word and the extension (`lb`, `lbu`, `lh`, `lhu`, `lw`) is done here. Misaligned accesses are not trapped (there are no traps); the arch tests only exercise aligned accesses.

**WB.** The selected result (ALU, load data or PC + 4) is written to the register file if `rd != 0`. The written value is also the MEM/WB forwarding source for EX and the bypass source for ID.

## Halting

`ecall` and `ebreak` are the halt instructions. In EX a halt instruction redirects to its own PC and sets `fetch_stopped`, so no younger instruction survives; it then drains through MEM and WB and `halted` is set when it reaches WB. Every older instruction has retired at that point, which makes the final register and memory state well defined. The arch tests end differently: they write to `tohost`, which the test bench watches.

Illegal instructions, `fence` and the CSR instructions retire as NOPs (no exception model). `fence.i` is unnecessary because the instruction port reads the same memory that stores write, with no cache.

## Cycle accounting

- `cycle` counts clock edges after reset. `instret` counts instructions reaching WB with valid = 1.
- A load-use stall adds exactly one cycle; a taken branch or jump adds two (the flushed slots).
- CPI = cycles ÷ instret, measured on the Verilator run of every program (see Programs and CPI).

## Pipeline registers

| Register | Contents |
|---|---|
| IF/ID | valid, pc, instr |
| ID/EX | valid, pc, instr, rs1/rs2 data, imm, rs1/rs2/rd indices, uses_rs1/uses_rs2, alu_op, operand selects, mem_read/mem_write, funct3, reg_write, wb_sel, branch/jal/jalr/halt |
| EX/MEM | valid, pc, instr, alu result, store data, rd, funct3, mem_read/mem_write, reg_write, wb_sel, halt |
| MEM/WB | valid, pc, instr, alu result, load data, rd, reg_write, wb_sel, halt |

The synthesized netlist contains 1,486 flip-flops: these pipeline registers, the PC, the 32 × 31 register-file bits (x0 has none) and the `halted`/`fetch_stopped` state.
