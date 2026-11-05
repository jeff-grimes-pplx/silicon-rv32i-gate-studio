// Silicon — an original five-stage in-order RV32I pipeline.
//
//   IF  : PC register, instruction fetch (combinational instruction port)
//   ID  : decode, immediate generation, register read (with WB bypass),
//         load-use hazard detection
//   EX  : operand forwarding (EX/MEM -> EX, MEM/WB -> EX), ALU,
//         branch/jump resolution and redirect (static predict not-taken)
//   MEM : data memory access (byte enables, load extension)
//   WB  : register writeback
//
// Memories live outside the core: the instruction port is a combinational
// read (address out, word in, same cycle) and the data port is a
// combinational read with a synchronous write. Reset is synchronous.
//
// Not implemented (by design, documented): Zicsr, traps/exceptions, M.
// Illegal and CSR instructions retire as NOPs. ECALL/EBREAK halt the core
// once they reach WB, after every older instruction has retired.
//
// Copyright 2026. Released under the Apache License 2.0.

/* verilator lint_off UNUSEDSIGNAL */
module rv32i_core (
  input  logic        clk,
  input  logic        rst,

  // instruction port (combinational read)
  output logic [31:0] imem_addr,
  input  logic [31:0] imem_rdata,

  // data port (combinational read, synchronous write)
  output logic [31:0] dmem_addr,
  output logic [31:0] dmem_wdata,
  output logic [3:0]  dmem_be,
  output logic        dmem_we,
  output logic        dmem_re,
  input  logic [31:0] dmem_rdata,

  output logic        halted
);

  // ------------------------------------------------------------------
  // Encodings
  // ------------------------------------------------------------------
  localparam [6:0] OP_LUI    = 7'b0110111;
  localparam [6:0] OP_AUIPC  = 7'b0010111;
  localparam [6:0] OP_JAL    = 7'b1101111;
  localparam [6:0] OP_JALR   = 7'b1100111;
  localparam [6:0] OP_BRANCH = 7'b1100011;
  localparam [6:0] OP_LOAD   = 7'b0000011;
  localparam [6:0] OP_STORE  = 7'b0100011;
  localparam [6:0] OP_OPIMM  = 7'b0010011;
  localparam [6:0] OP_OP     = 7'b0110011;
  localparam [6:0] OP_MISC   = 7'b0001111;
  localparam [6:0] OP_SYSTEM = 7'b1110011;

  // ALU operations
  localparam [3:0] ALU_ADD  = 4'd0;
  localparam [3:0] ALU_SUB  = 4'd1;
  localparam [3:0] ALU_SLL  = 4'd2;
  localparam [3:0] ALU_SLT  = 4'd3;
  localparam [3:0] ALU_SLTU = 4'd4;
  localparam [3:0] ALU_XOR  = 4'd5;
  localparam [3:0] ALU_SRL  = 4'd6;
  localparam [3:0] ALU_SRA  = 4'd7;
  localparam [3:0] ALU_OR   = 4'd8;
  localparam [3:0] ALU_AND  = 4'd9;
  localparam [3:0] ALU_PASSB = 4'd10;   // LUI: result = operand B

  // writeback source
  localparam [1:0] WB_ALU = 2'd0;
  localparam [1:0] WB_MEM = 2'd1;
  localparam [1:0] WB_PC4 = 2'd2;

  // forwarding select
  localparam [1:0] FWD_NONE = 2'd0;
  localparam [1:0] FWD_MEM  = 2'd1;    // from EX/MEM register
  localparam [1:0] FWD_WB   = 2'd2;    // from MEM/WB register

  // ------------------------------------------------------------------
  // Pipeline registers
  // ------------------------------------------------------------------
  // IF
  logic [31:0] pc;
  logic        fetch_stopped;         // set once a halt instruction passes EX

  // IF/ID
  logic        ifid_valid;
  logic [31:0] ifid_pc;
  logic [31:0] ifid_instr;

  // ID/EX
  logic        idex_valid;
  logic [31:0] idex_pc;
  logic [31:0] idex_instr;
  logic [31:0] idex_rs1_data;
  logic [31:0] idex_rs2_data;
  logic [31:0] idex_imm;
  logic [4:0]  idex_rs1;
  logic [4:0]  idex_rs2;
  logic [4:0]  idex_rd;
  logic        idex_uses_rs1;         // observation only (which forwards matter)
  logic        idex_uses_rs2;
  logic [3:0]  idex_alu_op;
  logic        idex_alu_a_pc;         // operand A = PC (AUIPC) else rs1
  logic        idex_alu_b_imm;        // operand B = imm else rs2
  logic        idex_branch;
  logic        idex_jal;
  logic        idex_jalr;
  logic [2:0]  idex_funct3;
  logic        idex_mem_read;
  logic        idex_mem_write;
  logic        idex_reg_write;
  logic [1:0]  idex_wb_sel;
  logic        idex_halt;

  // EX/MEM
  logic        exmem_valid;
  logic [31:0] exmem_pc;
  logic [31:0] exmem_instr;
  logic [31:0] exmem_alu;
  logic [31:0] exmem_store_data;
  logic [4:0]  exmem_rd;
  logic [2:0]  exmem_funct3;
  logic        exmem_mem_read;
  logic        exmem_mem_write;
  logic        exmem_reg_write;
  logic [1:0]  exmem_wb_sel;
  logic        exmem_halt;

  // MEM/WB
  logic        memwb_valid;
  logic [31:0] memwb_pc;
  logic [31:0] memwb_instr;
  logic [31:0] memwb_alu;
  logic [31:0] memwb_load;
  logic [4:0]  memwb_rd;
  logic        memwb_reg_write;
  logic [1:0]  memwb_wb_sel;
  logic        memwb_halt;

  // ------------------------------------------------------------------
  // Register file (x0 hard-wired to zero), read in ID with WB bypass
  // ------------------------------------------------------------------
  logic [31:0] regs [31:1];

  logic        wb_we;
  logic [4:0]  wb_rd;
  logic [31:0] wb_data;

  // ------------------------------------------------------------------
  // WB stage (computed first: it feeds the ID bypass and forwarding)
  // ------------------------------------------------------------------
  always @(*) begin
    case (memwb_wb_sel)
      WB_MEM:  wb_data = memwb_load;
      WB_PC4:  wb_data = memwb_pc + 32'd4;
      default: wb_data = memwb_alu;
    endcase
  end
  assign wb_we = memwb_valid & memwb_reg_write & (memwb_rd != 5'd0);
  assign wb_rd = memwb_rd;

  always @(posedge clk) begin
    if (wb_we & ~halted) regs[wb_rd] <= wb_data;
  end

  // ------------------------------------------------------------------
  // Hazard / control signals (declared early, assigned below)
  // ------------------------------------------------------------------
  logic stall;        // load-use: hold PC and IF/ID, bubble into ID/EX
  logic redirect;     // taken branch / jump / halt in EX: flush IF/ID, ID/EX
  logic [31:0] redirect_target;

  // ------------------------------------------------------------------
  // IF stage
  // ------------------------------------------------------------------
  assign imem_addr = pc;

  logic [31:0] pc_plus4;
  assign pc_plus4 = pc + 32'd4;

  always @(posedge clk) begin
    if (rst) begin
      pc            <= 32'h0000_0000;
      fetch_stopped <= 1'b0;
      ifid_valid    <= 1'b0;
      ifid_pc       <= 32'd0;
      ifid_instr    <= 32'd0;
    end else if (~halted) begin
      if (redirect) begin
        pc         <= redirect_target;
        ifid_valid <= 1'b0;
        if (idex_halt & idex_valid) fetch_stopped <= 1'b1;
      end else if (stall) begin
        // hold PC and IF/ID
      end else begin
        if (~fetch_stopped) pc <= pc_plus4;
        ifid_valid <= ~fetch_stopped;
        ifid_pc    <= pc;
        ifid_instr <= imem_rdata;
      end
    end
  end

  // ------------------------------------------------------------------
  // ID stage
  // ------------------------------------------------------------------
  logic [6:0]  id_opcode;
  logic [4:0]  id_rd, id_rs1, id_rs2;
  logic [2:0]  id_funct3;
  logic [6:0]  id_funct7;
  assign id_opcode = ifid_instr[6:0];
  assign id_rd     = ifid_instr[11:7];
  assign id_funct3 = ifid_instr[14:12];
  assign id_rs1    = ifid_instr[19:15];
  assign id_rs2    = ifid_instr[24:20];
  assign id_funct7 = ifid_instr[31:25];

  // immediates
  logic [31:0] imm_i, imm_s, imm_b, imm_u, imm_j;
  assign imm_i = {{20{ifid_instr[31]}}, ifid_instr[31:20]};
  assign imm_s = {{20{ifid_instr[31]}}, ifid_instr[31:25], ifid_instr[11:7]};
  assign imm_b = {{19{ifid_instr[31]}}, ifid_instr[31], ifid_instr[7], ifid_instr[30:25], ifid_instr[11:8], 1'b0};
  assign imm_u = {ifid_instr[31:12], 12'd0};
  assign imm_j = {{11{ifid_instr[31]}}, ifid_instr[31], ifid_instr[19:12], ifid_instr[20], ifid_instr[30:21], 1'b0};

  // register read with WB bypass (a write in WB is visible to ID this cycle)
  logic [31:0] rf_rs1_raw, rf_rs2_raw;
  logic [31:0] id_rs1_data, id_rs2_data;
  assign rf_rs1_raw = (id_rs1 == 5'd0) ? 32'd0 : regs[id_rs1];
  assign rf_rs2_raw = (id_rs2 == 5'd0) ? 32'd0 : regs[id_rs2];
  assign id_rs1_data = (wb_we && (wb_rd == id_rs1)) ? wb_data : rf_rs1_raw;
  assign id_rs2_data = (wb_we && (wb_rd == id_rs2)) ? wb_data : rf_rs2_raw;

  // control decode
  logic [31:0] id_imm;
  logic        id_uses_rs1, id_uses_rs2;
  logic [3:0]  id_alu_op;
  logic        id_alu_a_pc, id_alu_b_imm;
  logic        id_branch, id_jal, id_jalr;
  logic        id_mem_read, id_mem_write, id_reg_write;
  logic [1:0]  id_wb_sel;
  logic        id_halt;

  logic [3:0]  alu_op_from_funct;
  always @(*) begin
    // shared R/I ALU op decode; bit 30 distinguishes SUB/SRA (only for
    // OP, and for SRAI in OP-IMM)
    case (id_funct3)
      3'b000: alu_op_from_funct = (id_opcode == OP_OP && id_funct7[5]) ? ALU_SUB : ALU_ADD;
      3'b001: alu_op_from_funct = ALU_SLL;
      3'b010: alu_op_from_funct = ALU_SLT;
      3'b011: alu_op_from_funct = ALU_SLTU;
      3'b100: alu_op_from_funct = ALU_XOR;
      3'b101: alu_op_from_funct = id_funct7[5] ? ALU_SRA : ALU_SRL;
      3'b110: alu_op_from_funct = ALU_OR;
      default: alu_op_from_funct = ALU_AND;
    endcase
  end

  always @(*) begin
    id_imm       = imm_i;
    id_uses_rs1  = 1'b0;
    id_uses_rs2  = 1'b0;
    id_alu_op    = ALU_ADD;
    id_alu_a_pc  = 1'b0;
    id_alu_b_imm = 1'b1;
    id_branch    = 1'b0;
    id_jal       = 1'b0;
    id_jalr      = 1'b0;
    id_mem_read  = 1'b0;
    id_mem_write = 1'b0;
    id_reg_write = 1'b0;
    id_wb_sel    = WB_ALU;
    id_halt      = 1'b0;
    case (id_opcode)
      OP_LUI: begin
        id_imm = imm_u; id_alu_op = ALU_PASSB; id_reg_write = 1'b1;
      end
      OP_AUIPC: begin
        id_imm = imm_u; id_alu_a_pc = 1'b1; id_reg_write = 1'b1;
      end
      OP_JAL: begin
        id_imm = imm_j; id_jal = 1'b1; id_reg_write = 1'b1; id_wb_sel = WB_PC4;
      end
      OP_JALR: begin
        id_imm = imm_i; id_jalr = 1'b1; id_uses_rs1 = 1'b1; id_reg_write = 1'b1; id_wb_sel = WB_PC4;
      end
      OP_BRANCH: begin
        id_imm = imm_b; id_branch = 1'b1; id_uses_rs1 = 1'b1; id_uses_rs2 = 1'b1;
        id_alu_b_imm = 1'b0; id_alu_op = ALU_SUB;
      end
      OP_LOAD: begin
        id_imm = imm_i; id_uses_rs1 = 1'b1; id_mem_read = 1'b1; id_reg_write = 1'b1; id_wb_sel = WB_MEM;
      end
      OP_STORE: begin
        id_imm = imm_s; id_uses_rs1 = 1'b1; id_uses_rs2 = 1'b1; id_mem_write = 1'b1;
      end
      OP_OPIMM: begin
        id_imm = imm_i; id_uses_rs1 = 1'b1; id_reg_write = 1'b1;
        id_alu_op = alu_op_from_funct;
      end
      OP_OP: begin
        id_uses_rs1 = 1'b1; id_uses_rs2 = 1'b1; id_alu_b_imm = 1'b0; id_reg_write = 1'b1;
        id_alu_op = alu_op_from_funct;
      end
      OP_MISC: begin
        // FENCE / FENCE.I: nothing to order in this core
      end
      OP_SYSTEM: begin
        // ECALL (imm 0) and EBREAK (imm 1) halt; CSR ops retire as NOPs
        if (id_funct3 == 3'b000 && ifid_instr[31:21] == 11'd0) id_halt = 1'b1;
      end
      default: begin
        // illegal: NOP
      end
    endcase
    if (~ifid_valid) begin
      id_uses_rs1 = 1'b0; id_uses_rs2 = 1'b0;
    end
  end

  // load-use hazard: the instruction in EX is a load whose destination is
  // read by the instruction in ID
  assign stall = idex_valid & idex_mem_read & (idex_rd != 5'd0) & ifid_valid &
                 ((id_uses_rs1 & (id_rs1 == idex_rd)) | (id_uses_rs2 & (id_rs2 == idex_rd)));

  always @(posedge clk) begin
    if (rst) begin
      idex_valid <= 1'b0;
      idex_pc <= 32'd0; idex_instr <= 32'd0;
      idex_rs1_data <= 32'd0; idex_rs2_data <= 32'd0; idex_imm <= 32'd0;
      idex_rs1 <= 5'd0; idex_rs2 <= 5'd0; idex_rd <= 5'd0;
      idex_uses_rs1 <= 1'b0; idex_uses_rs2 <= 1'b0;
      idex_alu_op <= ALU_ADD; idex_alu_a_pc <= 1'b0; idex_alu_b_imm <= 1'b0;
      idex_branch <= 1'b0; idex_jal <= 1'b0; idex_jalr <= 1'b0; idex_funct3 <= 3'd0;
      idex_mem_read <= 1'b0; idex_mem_write <= 1'b0; idex_reg_write <= 1'b0;
      idex_wb_sel <= WB_ALU; idex_halt <= 1'b0;
    end else if (~halted) begin
      if (redirect | stall) begin
        // bubble
        idex_valid <= 1'b0;
        idex_mem_read <= 1'b0; idex_mem_write <= 1'b0; idex_reg_write <= 1'b0;
        idex_branch <= 1'b0; idex_jal <= 1'b0; idex_jalr <= 1'b0; idex_halt <= 1'b0;
        idex_uses_rs1 <= 1'b0; idex_uses_rs2 <= 1'b0;
        idex_instr <= 32'h0000_0013;
        idex_rd <= 5'd0;
      end else begin
        idex_valid    <= ifid_valid;
        idex_pc       <= ifid_pc;
        idex_instr    <= ifid_instr;
        idex_rs1_data <= id_rs1_data;
        idex_rs2_data <= id_rs2_data;
        idex_imm      <= id_imm;
        idex_rs1      <= id_rs1;
        idex_rs2      <= id_rs2;
        idex_rd       <= id_rd;
        idex_uses_rs1 <= id_uses_rs1;
        idex_uses_rs2 <= id_uses_rs2;
        idex_alu_op   <= id_alu_op;
        idex_alu_a_pc <= id_alu_a_pc;
        idex_alu_b_imm<= id_alu_b_imm;
        idex_branch   <= id_branch & ifid_valid;
        idex_jal      <= id_jal & ifid_valid;
        idex_jalr     <= id_jalr & ifid_valid;
        idex_funct3   <= id_funct3;
        idex_mem_read <= id_mem_read & ifid_valid;
        idex_mem_write<= id_mem_write & ifid_valid;
        idex_reg_write<= id_reg_write & ifid_valid;
        idex_wb_sel   <= id_wb_sel;
        idex_halt     <= id_halt & ifid_valid;
      end
    end
  end

  // ------------------------------------------------------------------
  // EX stage
  // ------------------------------------------------------------------
  // forwarding
  logic [1:0]  fwd_a_sel, fwd_b_sel;
  logic [31:0] exmem_fwd_value;
  always @(*) begin
    exmem_fwd_value = (exmem_wb_sel == WB_PC4) ? exmem_pc + 32'd4 : exmem_alu;
  end

  logic exmem_fwd_ok, memwb_fwd_ok;
  assign exmem_fwd_ok = exmem_valid & exmem_reg_write & (exmem_rd != 5'd0);
  assign memwb_fwd_ok = wb_we;

  always @(*) begin
    fwd_a_sel = FWD_NONE;
    if (exmem_fwd_ok && exmem_rd == idex_rs1)      fwd_a_sel = FWD_MEM;
    else if (memwb_fwd_ok && wb_rd == idex_rs1)    fwd_a_sel = FWD_WB;
    fwd_b_sel = FWD_NONE;
    if (exmem_fwd_ok && exmem_rd == idex_rs2)      fwd_b_sel = FWD_MEM;
    else if (memwb_fwd_ok && wb_rd == idex_rs2)    fwd_b_sel = FWD_WB;
  end

  logic [31:0] ex_rs1, ex_rs2;
  always @(*) begin
    case (fwd_a_sel)
      FWD_MEM: ex_rs1 = exmem_fwd_value;
      FWD_WB:  ex_rs1 = wb_data;
      default: ex_rs1 = idex_rs1_data;
    endcase
    case (fwd_b_sel)
      FWD_MEM: ex_rs2 = exmem_fwd_value;
      FWD_WB:  ex_rs2 = wb_data;
      default: ex_rs2 = idex_rs2_data;
    endcase
  end

  // ALU
  logic [31:0] alu_a, alu_b, alu_y;
  assign alu_a = idex_alu_a_pc ? idex_pc : ex_rs1;
  assign alu_b = idex_alu_b_imm ? idex_imm : ex_rs2;

  logic [31:0] alu_sub;
  logic        alu_lt, alu_ltu;
  assign alu_sub = alu_a - alu_b;
  assign alu_lt  = ($signed(alu_a) < $signed(alu_b));
  assign alu_ltu = (alu_a < alu_b);

  always @(*) begin
    case (idex_alu_op)
      ALU_ADD:   alu_y = alu_a + alu_b;
      ALU_SUB:   alu_y = alu_sub;
      ALU_SLL:   alu_y = alu_a << alu_b[4:0];
      ALU_SLT:   alu_y = {31'd0, alu_lt};
      ALU_SLTU:  alu_y = {31'd0, alu_ltu};
      ALU_XOR:   alu_y = alu_a ^ alu_b;
      ALU_SRL:   alu_y = alu_a >> alu_b[4:0];
      ALU_SRA:   alu_y = $signed(alu_a) >>> alu_b[4:0];
      ALU_OR:    alu_y = alu_a | alu_b;
      ALU_AND:   alu_y = alu_a & alu_b;
      ALU_PASSB: alu_y = alu_b;
      default:   alu_y = alu_a + alu_b;
    endcase
  end

  // observation: forwarding that actually feeds an operand this cycle
  logic fwd_a_used, fwd_b_used;
  assign fwd_a_used = idex_valid & idex_uses_rs1 & (fwd_a_sel != FWD_NONE);
  assign fwd_b_used = idex_valid & idex_uses_rs2 & (fwd_b_sel != FWD_NONE);

  // branch condition (operands are the forwarded rs1/rs2, never PC/imm)
  logic br_eq, br_cond, br_taken;
  assign br_eq = (ex_rs1 == ex_rs2);
  always @(*) begin
    case (idex_funct3)
      3'b000: br_cond = br_eq;                        // BEQ
      3'b001: br_cond = ~br_eq;                       // BNE
      3'b100: br_cond = $signed(ex_rs1) < $signed(ex_rs2);   // BLT
      3'b101: br_cond = ~($signed(ex_rs1) < $signed(ex_rs2)); // BGE
      3'b110: br_cond = ex_rs1 < ex_rs2;              // BLTU
      3'b111: br_cond = ~(ex_rs1 < ex_rs2);           // BGEU
      default: br_cond = 1'b0;
    endcase
  end
  assign br_taken = idex_branch & br_cond;

  // control-flow target
  logic [31:0] target_base, jump_target;
  assign target_base = idex_jalr ? ex_rs1 : idex_pc;
  assign jump_target = (target_base + idex_imm) & {{31{1'b1}}, ~idex_jalr};

  // a halt in EX also redirects (to its own PC) so nothing younger survives;
  // fetch then stops
  assign redirect        = idex_valid & (br_taken | idex_jal | idex_jalr | idex_halt);
  assign redirect_target = idex_halt ? idex_pc : jump_target;

  always @(posedge clk) begin
    if (rst) begin
      exmem_valid <= 1'b0; exmem_pc <= 32'd0; exmem_instr <= 32'h0000_0013;
      exmem_alu <= 32'd0; exmem_store_data <= 32'd0; exmem_rd <= 5'd0; exmem_funct3 <= 3'd0;
      exmem_mem_read <= 1'b0; exmem_mem_write <= 1'b0; exmem_reg_write <= 1'b0;
      exmem_wb_sel <= WB_ALU; exmem_halt <= 1'b0;
    end else if (~halted) begin
      exmem_valid      <= idex_valid;
      exmem_pc         <= idex_pc;
      exmem_instr      <= idex_valid ? idex_instr : 32'h0000_0013;
      exmem_alu        <= alu_y;
      exmem_store_data <= ex_rs2;
      exmem_rd         <= idex_rd;
      exmem_funct3     <= idex_funct3;
      exmem_mem_read   <= idex_mem_read & idex_valid;
      exmem_mem_write  <= idex_mem_write & idex_valid;
      exmem_reg_write  <= idex_reg_write & idex_valid;
      exmem_wb_sel     <= idex_wb_sel;
      exmem_halt       <= idex_halt & idex_valid;
    end
  end

  // ------------------------------------------------------------------
  // MEM stage
  // ------------------------------------------------------------------
  assign dmem_addr = {exmem_alu[31:2], 2'b00};
  assign dmem_re   = exmem_valid & exmem_mem_read;
  assign dmem_we   = exmem_valid & exmem_mem_write & ~halted;

  logic [1:0] mem_off;
  assign mem_off = exmem_alu[1:0];

  always @(*) begin
    dmem_be    = 4'b0000;
    dmem_wdata = exmem_store_data;
    case (exmem_funct3[1:0])
      2'b00: begin // SB
        dmem_be    = 4'b0001 << mem_off;
        dmem_wdata = {4{exmem_store_data[7:0]}};
      end
      2'b01: begin // SH
        dmem_be    = mem_off[1] ? 4'b1100 : 4'b0011;
        dmem_wdata = {2{exmem_store_data[15:0]}};
      end
      default: begin // SW
        dmem_be    = 4'b1111;
        dmem_wdata = exmem_store_data;
      end
    endcase
  end

  // load extension
  logic [31:0] load_word;
  logic [15:0] load_half;
  logic [7:0]  load_byte;
  logic [31:0] load_result;
  assign load_word = dmem_rdata;
  assign load_half = mem_off[1] ? load_word[31:16] : load_word[15:0];
  always @(*) begin
    case (mem_off)
      2'b00: load_byte = load_word[7:0];
      2'b01: load_byte = load_word[15:8];
      2'b10: load_byte = load_word[23:16];
      default: load_byte = load_word[31:24];
    endcase
  end
  always @(*) begin
    case (exmem_funct3)
      3'b000: load_result = {{24{load_byte[7]}}, load_byte};   // LB
      3'b001: load_result = {{16{load_half[15]}}, load_half};  // LH
      3'b100: load_result = {24'd0, load_byte};                // LBU
      3'b101: load_result = {16'd0, load_half};                // LHU
      default: load_result = load_word;                        // LW
    endcase
  end

  always @(posedge clk) begin
    if (rst) begin
      memwb_valid <= 1'b0; memwb_pc <= 32'd0; memwb_instr <= 32'h0000_0013;
      memwb_alu <= 32'd0; memwb_load <= 32'd0; memwb_rd <= 5'd0;
      memwb_reg_write <= 1'b0; memwb_wb_sel <= WB_ALU; memwb_halt <= 1'b0;
    end else if (~halted) begin
      memwb_valid     <= exmem_valid;
      memwb_pc        <= exmem_pc;
      memwb_instr     <= exmem_instr;
      memwb_alu       <= exmem_alu;
      memwb_load      <= load_result;
      memwb_rd        <= exmem_rd;
      memwb_reg_write <= exmem_reg_write;
      memwb_wb_sel    <= exmem_wb_sel;
      memwb_halt      <= exmem_halt;
    end
  end

  // ------------------------------------------------------------------
  // Halt: the halt instruction has retired; everything older retired before it
  // ------------------------------------------------------------------
  always @(posedge clk) begin
    if (rst) halted <= 1'b0;
    else if (memwb_valid & memwb_halt) halted <= 1'b1;
  end

endmodule
