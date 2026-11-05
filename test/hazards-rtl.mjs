// Targeted hazard / branch checks, asserted directly on the Verilator RTL
// traces (programs/build/*.trace written by programs/build.sh), so they test
// the hardware description, not the browser twin.
//
// Trace columns (sim/tb.cpp): cycle pc ifid_valid ifid_pc ifid_instr idex_valid
// idex_pc idex_instr exmem_valid exmem_pc exmem_instr memwb_valid memwb_pc
// memwb_instr stall redirect redirect_target fwd_a fwd_b alu_y ex_rs1 ex_rs2
// wb_we wb_rd wb_data dmem_we dmem_addr dmem_wdata dmem_be halted
import fs from 'node:fs';
const FWD_NONE = 0, FWD_MEM = 1, FWD_WB = 2;
let fails = 0, checks = 0;
const check = (cond, msg) => { checks++; if (!cond) { fails++; console.log('FAIL', msg); } };
const load = (name) => fs.readFileSync(new URL(`../programs/build/${name}.trace`, import.meta.url), 'utf8')
  .split('\n').filter(Boolean).map((l) => {
    const f = l.split(' ');
    const h = (i) => parseInt(f[i], 16), d = (i) => Number(f[i]);
    return { cycle: d(0), pc: h(1), ifid_valid: d(2), ifid_pc: h(3), ifid_instr: h(4), idex_valid: d(5), idex_pc: h(6), idex_instr: h(7),
      exmem_valid: d(8), exmem_pc: h(9), exmem_instr: h(10), memwb_valid: d(11), memwb_pc: h(12), memwb_instr: h(13),
      stall: d(14), redirect: d(15), redirect_target: h(16), fwd_a: d(17), fwd_b: d(18), alu_y: h(19), ex_rs1: h(20), ex_rs2: h(21),
      wb_we: d(22), wb_rd: d(23), wb_data: h(24), dmem_we: d(25), dmem_addr: h(26), dmem_wdata: h(27), dmem_be: h(28), halted: d(29) };
  });
const runOf = (name) => fs.readFileSync(new URL(`../programs/build/${name}.run`, import.meta.url), 'utf8');
const a0Of = (name) => parseInt(runOf(name).match(/^regs (.*)$/m)[1].split(' ')[9], 16);  // regs line lists x1..x31

// ---- hazards.S: forwarding from both sources, load-use stall, taken-branch flush
{
  const t = load('hazards');
  const c4 = t[4];
  check(c4.idex_instr === 0x006283b3, 'c4: add t2,t0,t1 is in EX');
  check(c4.fwd_a === FWD_WB && c4.fwd_b === FWD_MEM, `c4: t0 forwarded from MEM/WB, t1 from EX/MEM (got ${c4.fwd_a},${c4.fwd_b})`);
  check(c4.ex_rs1 === 40 && c4.ex_rs2 === 2 && c4.alu_y === 42, 'c4: forwarded operands 40 + 2 = 42');
  check(c4.stall === 0 && c4.redirect === 0, 'c4: no stall, no redirect');
  const c5 = t[5];
  check(c5.idex_instr === 0x40638e33 && c5.fwd_a === FWD_MEM && c5.fwd_b === FWD_WB && c5.alu_y === 40, 'c5: sub t3,t2,t1 takes t2 from EX/MEM and t1 from MEM/WB');
  const c9 = t[9], c10 = t[10];
  check(c9.idex_instr === 0x0005af03 && c9.ifid_instr === 0x001f0f93 && c9.stall === 1, 'c9: lw t5 in EX, addi t6,t5,1 in ID -> stall');
  check(c10.ifid_instr === 0x001f0f93 && c10.ifid_pc === c9.ifid_pc && c10.pc === c9.pc, 'c10: PC and IF/ID held during the stall');
  check(c10.idex_valid === 0, 'c10: bubble in ID/EX');
  check(t[11].idex_instr === 0x001f0f93 && t[11].fwd_a === FWD_WB && t[11].alu_y === 3, 'c11: addi t6,t5,1 gets the load result from MEM/WB (2 + 1 = 3)');
  const c16 = t[16], c17 = t[17];
  check(c16.idex_instr === 0x01f69c63 && c16.redirect === 1 && c16.redirect_target === 0x4c, 'c16: bne a3,t6,done is taken, redirect to 0x4c');
  check(c17.pc === 0x4c && c17.ifid_valid === 0 && c17.idex_valid === 0, 'c17: IF/ID and ID/EX flushed, fetch resumes at 0x4c');
  check(t[15].idex_instr === 0x01f68863 && t[15].redirect === 0, 'c15: beq a3,t6,wrong not taken, no redirect');
  check(t.filter((l) => l.stall).length === 1, 'exactly one stall cycle in hazards.S');
  check(t.filter((l) => l.redirect && l.idex_instr !== 0x00100073).length === 1, 'exactly one branch redirect in hazards.S');
  check(t.at(-1).halted === 1 && t.length === 24 && a0Of('hazards') === 103, 'hazards halts after 23 cycles with a0 = 103');
}

// ---- sum.S: naive loop stalls once per element, scheduled loop never
{
  const t = load('sum');
  const stalls = t.filter((l) => l.stall);
  check(stalls.length === 8, `sum: 8 load-use stalls total (got ${stalls.length})`);
  check(stalls.every((l) => l.idex_instr === 0x0002a383 && l.ifid_instr === 0x00750533), 'sum: every stall is lw t2 in EX with add a0,a0,t2 in ID');
  const secondLoopStart = 0x2c;  // <scheduled>, see programs/build/sum.dis
  check(stalls.every((l) => l.ifid_pc < secondLoopStart), 'sum: no stall in the scheduled loop');
  check(a0Of('sum') === 1240, 'sum: a0 = 1240');
}

// ---- branches.S: every taken branch flushes two fetched instructions
{
  const t = load('branches');
  const redirects = t.filter((l) => l.redirect && l.idex_instr !== 0x00100073);
  check(redirects.length === 9, `branches: 9 taken branches (got ${redirects.length})`);
  for (const r of redirects) {
    const n = t[r.cycle + 1];
    check(n.ifid_valid === 0 && n.idex_valid === 0 && n.pc === r.redirect_target, `branches: flush after redirect at cycle ${r.cycle}`);
  }
  check(a0Of('branches') === 55, 'branches: a0 = 55');
}

// ---- memcopy.S: store data forwarded from a load result
{
  const t = load('memcopy');
  const fwdStores = t.filter((l) => l.idex_valid && (l.idex_instr & 0x7f) === 0x23 && l.fwd_b !== FWD_NONE);
  check(fwdStores.length > 0 && fwdStores.every((l) => l.fwd_b === FWD_WB), `memcopy: store data comes from MEM/WB after the load-use stall (${fwdStores.length} stores)`);
  check(t.filter((l) => l.stall).length === 20, 'memcopy: 20 load-use stalls');
}

console.log(`hazard/branch RTL trace checks: ${checks - fails}/${checks} passed`);
process.exit(fails ? 1 : 0);
