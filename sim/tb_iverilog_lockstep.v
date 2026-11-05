// Icarus Verilog lockstep testbench: runs behavioral RTL (rv32i_core) and
// Yosys-synthesized 8,297-cell gate-level netlist (silicon_core) side by side
// on the exact same instruction/data memory image, verifying 100% cycle-by-cycle
// port equivalence and dumping IEEE 1364 VCD waveforms.
`timescale 1ns/1ps

module tb_iverilog_lockstep;
  reg clk = 0;
  reg rst = 1;

  wire [31:0] rtl_imem_addr,  gate_imem_addr;
  reg  [31:0] imem_rdata;
  wire [31:0] rtl_dmem_addr,  gate_dmem_addr;
  wire [31:0] rtl_dmem_wdata, gate_dmem_wdata;
  wire [3:0]  rtl_dmem_be,    gate_dmem_be;
  wire        rtl_dmem_we,    gate_dmem_we;
  wire        rtl_dmem_re,    gate_dmem_re;
  reg  [31:0] dmem_rdata;
  wire        rtl_halted,     gate_halted;

  // 64 KiB unified memory (16,384 x 32-bit words)
  reg [31:0] mem [0:16383];
  reg [7:0]  bin_buf [0:65535];

  rv32i_core u_rtl (
    .clk        (clk),
    .rst        (rst),
    .imem_addr  (rtl_imem_addr),
    .imem_rdata (imem_rdata),
    .dmem_addr  (rtl_dmem_addr),
    .dmem_wdata (rtl_dmem_wdata),
    .dmem_be    (rtl_dmem_be),
    .dmem_we    (rtl_dmem_we),
    .dmem_re    (rtl_dmem_re),
    .dmem_rdata (dmem_rdata),
    .halted     (rtl_halted)
  );

  silicon_core u_gate (
    .clk        (clk),
    .rst        (rst),
    .imem_addr  (gate_imem_addr),
    .imem_rdata (imem_rdata),
    .dmem_addr  (gate_dmem_addr),
    .dmem_wdata (gate_dmem_wdata),
    .dmem_be    (gate_dmem_be),
    .dmem_we    (gate_dmem_we),
    .dmem_re    (gate_dmem_re),
    .dmem_rdata (dmem_rdata),
    .halted     (gate_halted)
  );

  always @(*) begin
    imem_rdata = mem[rtl_imem_addr[15:2]];
    dmem_rdata = mem[rtl_dmem_addr[15:2]];
  end

  integer cycles = 0;
  integer instret = 0;
  integer mismatches = 0;
  integer max_cycles = 50000;
  integer fd, nbytes, i;
  reg [8*256-1:0] bin_file;
  reg [8*256-1:0] vcd_file;
  reg [31:0] wmask;

  initial begin
    for (i = 0; i < 16384; i = i + 1) mem[i] = 32'd0;
    for (i = 0; i < 65536; i = i + 1) bin_buf[i] = 8'd0;

    if (!$value$plusargs("BIN=%s", bin_file)) begin
      bin_file = "programs/build/primes.bin";
    end
    if ($value$plusargs("MAX=%d", max_cycles)) begin end

    fd = $fopen(bin_file, "rb");
    if (fd == 0) begin
      $display("ERROR: cannot open binary %0s", bin_file);
      $finish(2);
    end
    nbytes = $fread(bin_buf, fd);
    $fclose(fd);

    for (i = 0; i < nbytes; i = i + 1) begin
      case (i[1:0])
        2'd0: mem[i >> 2][ 7: 0] = bin_buf[i];
        2'd1: mem[i >> 2][15: 8] = bin_buf[i];
        2'd2: mem[i >> 2][23:16] = bin_buf[i];
        2'd3: mem[i >> 2][31:24] = bin_buf[i];
      endcase
    end

    if ($value$plusargs("VCD=%s", vcd_file)) begin
      $dumpfile(vcd_file);
      if ($test$plusargs("VCD_PORTS")) begin
        $dumpvars(1, tb_iverilog_lockstep);
        $dumpvars(1, u_rtl);
      end else begin
        $dumpvars(0, tb_iverilog_lockstep);
      end
    end

    // Synchronous reset for 2 cycles
    rst = 1;
    #5 clk = 1; #5 clk = 0;
    #5 clk = 1; #5 clk = 0;
    rst = 0;

    while (!rtl_halted && cycles < max_cycles) begin
      #1; // allow combinational logic in RTL and 8,297-cell gate netlist to settle
      if (rtl_imem_addr  !== gate_imem_addr ||
          rtl_dmem_addr  !== gate_dmem_addr ||
          rtl_dmem_wdata !== gate_dmem_wdata ||
          rtl_dmem_be    !== gate_dmem_be    ||
          rtl_dmem_we    !== gate_dmem_we    ||
          rtl_dmem_re    !== gate_dmem_re    ||
          rtl_halted     !== gate_halted) begin
        mismatches = mismatches + 1;
        if (mismatches <= 5) begin
          $display("MISMATCH cycle %0d: RTL(pc=%08x daddr=%08x we=%b) vs GATE(pc=%08x daddr=%08x we=%b)",
            cycles, rtl_imem_addr, rtl_dmem_addr, rtl_dmem_we,
            gate_imem_addr, gate_dmem_addr, gate_dmem_we);
        end
      end

      if (u_rtl.memwb_valid) instret = instret + 1;

      // Clock rising edge
      #4 clk = 1;
      if (rtl_dmem_we) begin
        wmask = { {8{rtl_dmem_be[3]}}, {8{rtl_dmem_be[2]}}, {8{rtl_dmem_be[1]}}, {8{rtl_dmem_be[0]}} };
        mem[rtl_dmem_addr[15:2]] = (mem[rtl_dmem_addr[15:2]] & ~wmask) | (rtl_dmem_wdata & wmask);
      end
      #5 clk = 0;
      cycles = cycles + 1;
    end

    // Final check after halt
    #1;
    if (rtl_halted !== gate_halted) mismatches = mismatches + 1;

    $display("IVERILOG_LOCKSTEP bin=%0s bytes=%0d cycles=%0d instret=%0d a0=0x%08x (%0d) port_mismatches=%0d status=%0s",
      bin_file, nbytes, cycles, instret, u_rtl.regs[10], u_rtl.regs[10], mismatches,
      (mismatches == 0 && rtl_halted) ? "PASS" : "FAIL");

    if (mismatches != 0 || !rtl_halted) $finish(1);
    $finish(0);
  end
endmodule
