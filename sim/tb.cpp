// Verilator harness for silicon_core.
//
//   silicon_sim --bin prog.bin[@hexaddr] [--bin ...] [--mem-kb N]
//               [--max-cycles N] [--tohost hexaddr]
//               [--sig begin end --sig-out file]
//               [--trace file] [--trace-max N]
//               [--dump-regs] [--dump-mem addr len file]
//
// Memory is a flat word array outside the core. The instruction port is a
// combinational read; the data port is a combinational read with a
// synchronous write applied at the clock edge.
//
// The per-cycle trace prints, for every cycle, the architectural and
// microarchitectural state that the browser model must reproduce exactly.

#include "Vsilicon_core.h"
#ifndef GATE_LEVEL
#include "Vsilicon_core___024root.h"
#endif
#include "verilated.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <fstream>

static std::vector<uint32_t> mem;
static uint32_t mem_words = 0;

static uint32_t rd_word(uint32_t addr) {
  uint32_t w = addr >> 2;
  return (w < mem_words) ? mem[w] : 0u;
}

static void wr_word(uint32_t addr, uint32_t data, uint8_t be) {
  uint32_t w = addr >> 2;
  if (w >= mem_words) return;
  uint32_t m = 0;
  if (be & 1) m |= 0x000000ffu;
  if (be & 2) m |= 0x0000ff00u;
  if (be & 4) m |= 0x00ff0000u;
  if (be & 8) m |= 0xff000000u;
  mem[w] = (mem[w] & ~m) | (data & m);
}

static bool load_bin(const std::string& spec) {
  std::string path = spec;
  uint32_t addr = 0;
  size_t at = spec.find('@');
  if (at != std::string::npos) {
    path = spec.substr(0, at);
    addr = (uint32_t)strtoul(spec.substr(at + 1).c_str(), nullptr, 16);
  }
  FILE* f = fopen(path.c_str(), "rb");
  if (!f) { fprintf(stderr, "cannot open %s\n", path.c_str()); return false; }
  std::vector<uint8_t> bytes;
  uint8_t buf[4096];
  size_t n;
  while ((n = fread(buf, 1, sizeof buf, f)) > 0) bytes.insert(bytes.end(), buf, buf + n);
  fclose(f);
  for (size_t i = 0; i < bytes.size(); i++) {
    uint32_t a = addr + (uint32_t)i;
    if ((a >> 2) >= mem_words) { fprintf(stderr, "image exceeds memory at %08x\n", a); return false; }
    uint32_t sh = (a & 3) * 8;
    mem[a >> 2] = (mem[a >> 2] & ~(0xffu << sh)) | ((uint32_t)bytes[i] << sh);
  }
  fprintf(stderr, "loaded %zu bytes at %08x from %s\n", bytes.size(), addr, path.c_str());
  return true;
}

int main(int argc, char** argv) {
  Verilated::commandArgs(argc, argv);
  std::vector<std::string> bins;
  uint32_t mem_kb = 1024;
  uint64_t max_cycles = 2000000;
  uint32_t tohost = 0xffffffffu;
  bool have_tohost = false;
  uint32_t sig_begin = 0, sig_end = 0;
  bool have_sig = false;
  std::string sig_out, trace_path, dump_mem_file, io_trace_path;
  uint64_t trace_max = ~0ull;
  bool dump_regs = false;
  uint32_t dump_mem_addr = 0, dump_mem_len = 0;

  for (int i = 1; i < argc; i++) {
    std::string a = argv[i];
    auto next = [&](void) -> const char* { if (i + 1 >= argc) { fprintf(stderr, "missing value for %s\n", a.c_str()); exit(2); } return argv[++i]; };
    if (a == "--bin") bins.push_back(next());
    else if (a == "--mem-kb") mem_kb = (uint32_t)strtoul(next(), nullptr, 0);
    else if (a == "--max-cycles") max_cycles = strtoull(next(), nullptr, 0);
    else if (a == "--tohost") { tohost = (uint32_t)strtoul(next(), nullptr, 16); have_tohost = true; }
    else if (a == "--sig") { sig_begin = (uint32_t)strtoul(next(), nullptr, 16); sig_end = (uint32_t)strtoul(next(), nullptr, 16); have_sig = true; }
    else if (a == "--sig-out") sig_out = next();
    else if (a == "--trace") trace_path = next();
    else if (a == "--io-trace") io_trace_path = next();
    else if (a == "--trace-max") trace_max = strtoull(next(), nullptr, 0);
    else if (a == "--dump-regs") dump_regs = true;
    else if (a == "--dump-mem") { dump_mem_addr = (uint32_t)strtoul(next(), nullptr, 16); dump_mem_len = (uint32_t)strtoul(next(), nullptr, 0); dump_mem_file = next(); }
    else { fprintf(stderr, "unknown arg %s\n", a.c_str()); return 2; }
  }

  mem_words = mem_kb * 256;
  mem.assign(mem_words, 0);
  for (auto& b : bins) if (!load_bin(b)) return 2;

  Vsilicon_core* top = new Vsilicon_core;
  FILE* io_trace = nullptr;
  if (!io_trace_path.empty()) {
    io_trace = fopen(io_trace_path.c_str(), "w");
    if (!io_trace) { fprintf(stderr, "cannot write %s\n", io_trace_path.c_str()); return 2; }
  }
  FILE* trace = nullptr;
  if (!trace_path.empty()) {
    trace = fopen(trace_path.c_str(), "w");
    if (!trace) { fprintf(stderr, "cannot write %s\n", trace_path.c_str()); return 2; }
  }

  // reset: two cycles with rst high
  top->clk = 0; top->rst = 1; top->imem_rdata = 0; top->dmem_rdata = 0;
  for (int i = 0; i < 2; i++) {
    top->eval(); top->clk = 1; top->eval(); top->clk = 0; top->eval();
  }
  top->rst = 0;

  uint64_t cycle = 0, instret = 0;
  bool finished = false;
  std::string reason = "max-cycles";
#ifndef GATE_LEVEL
  auto* r = top->rootp;
#endif

  while (cycle < max_cycles) {
    // low phase: present memory read data, settle combinational logic
    top->clk = 0;
    top->imem_rdata = rd_word(top->imem_addr);
    top->eval();
    top->dmem_rdata = rd_word(top->dmem_addr);
    top->eval();

    if (io_trace && cycle < trace_max) {
      fprintf(io_trace, "%llu %08x %08x %08x %u %x %u %u\n", (unsigned long long)cycle,
        top->imem_addr, top->dmem_addr, top->dmem_wdata, top->dmem_we, top->dmem_be, top->dmem_re, top->halted);
    }
#ifndef GATE_LEVEL
    if (trace && cycle < trace_max) {
      fprintf(trace,
        "%llu %08x %u %08x %08x %u %08x %08x %u %08x %08x %u %08x %08x %u %u %08x %u %u %08x %08x %08x %u %u %08x %u %08x %08x %x %u\n",
        (unsigned long long)cycle,
        r->silicon_core__DOT__pc,
        r->silicon_core__DOT__ifid_valid, r->silicon_core__DOT__ifid_pc, r->silicon_core__DOT__ifid_instr,
        r->silicon_core__DOT__idex_valid, r->silicon_core__DOT__idex_pc, r->silicon_core__DOT__idex_instr,
        r->silicon_core__DOT__exmem_valid, r->silicon_core__DOT__exmem_pc, r->silicon_core__DOT__exmem_instr,
        r->silicon_core__DOT__memwb_valid, r->silicon_core__DOT__memwb_pc, r->silicon_core__DOT__memwb_instr,
        r->silicon_core__DOT__stall, r->silicon_core__DOT__redirect, r->silicon_core__DOT__redirect_target,
        r->silicon_core__DOT__fwd_a_used ? r->silicon_core__DOT__fwd_a_sel : 0,
        r->silicon_core__DOT__fwd_b_used ? r->silicon_core__DOT__fwd_b_sel : 0,
        r->silicon_core__DOT__alu_y, r->silicon_core__DOT__ex_rs1, r->silicon_core__DOT__ex_rs2,
        r->silicon_core__DOT__wb_we, r->silicon_core__DOT__wb_rd, r->silicon_core__DOT__wb_data,
        top->dmem_we, top->dmem_addr, top->dmem_wdata, top->dmem_be,
        top->halted);
    }
#endif

    if (top->halted) { finished = true; reason = "halt"; break; }

    // writes take effect at the edge
    bool we = top->dmem_we;
    uint32_t waddr = top->dmem_addr, wdata = top->dmem_wdata;
    uint8_t wbe = top->dmem_be;
#ifndef GATE_LEVEL
    if (r->silicon_core__DOT__memwb_valid) instret++;
#endif

    top->clk = 1;
    top->eval();
    cycle++;

    if (we) {
      wr_word(waddr, wdata, wbe);
      if (have_tohost && (waddr & ~3u) == (tohost & ~3u) && (wdata & 0xff) != 0) {
        finished = true; reason = "tohost"; break;
      }
    }
  }

  if (trace) fclose(trace);
  if (io_trace) fclose(io_trace);

  // signature
  if (have_sig) {
    FILE* sf = sig_out.empty() ? stdout : fopen(sig_out.c_str(), "w");
    for (uint32_t a = sig_begin; a < sig_end; a += 4) fprintf(sf, "%08x\n", rd_word(a));
    if (sf != stdout) fclose(sf);
  }
#ifndef GATE_LEVEL
  if (dump_regs) {
    printf("regs");
    for (int i = 1; i < 32; i++) printf(" %08x", r->silicon_core__DOT__regs[i - 1]);
    printf("\n");
  }
#else
  (void)dump_regs;
#endif
  if (dump_mem_len) {
    FILE* mf = fopen(dump_mem_file.c_str(), "w");
    for (uint32_t a = dump_mem_addr; a < dump_mem_addr + dump_mem_len; a += 4) fprintf(mf, "%08x %08x\n", a, rd_word(a));
    fclose(mf);
  }
  printf("done reason=%s cycles=%llu instret=%llu cpi=%.4f\n", reason.c_str(),
         (unsigned long long)cycle, (unsigned long long)instret,
         instret ? (double)cycle / (double)instret : 0.0);
  delete top;
  return finished ? 0 : 1;
}
