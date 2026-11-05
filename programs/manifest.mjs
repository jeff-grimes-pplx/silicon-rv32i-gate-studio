// Builds app/public/data/programs.json from programs/build/* (GNU toolchain
// output + Verilator run records). Every number here is read from those
// files or computed by the JS twin, which test/program-equivalence.mjs proves
// trace-identical to the Verilator RTL simulation for each program.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { SiliconCore, Memory } from '../app/src/core.js';

const here = path.dirname(new URL(import.meta.url).pathname);
const build = path.join(here, 'build');

const PROGRAMS = [
  { name: 'primes', kind: 'c', title: 'Sieve of Eratosthenes',
    watch: 'Byte stores (sb) marking composite[] in the inner loop; the final loop collects primes[] with a load-use stall on every candidate.',
    result: 'a0 = 541 (the 100th prime); primes[0..99] in memory.' },
  { name: 'quicksort', kind: 'c', title: 'Recursive Quicksort',
    watch: 'Stack-frame saves (sw ra/s-regs), recursive jal redirects, and load-use stalls during partition scans as data[16] reorders in memory.',
    result: 'a0 = 760 (0x2f8, median pair sum 356 + 404); data[16] sorted in place.' },
  { name: 'fibonacci_matrix', kind: 'c', title: 'Fibonacci (2x2 matrix exp)',
    watch: 'O(log n) 2x2 matrix squaring: without RV32M, each multiply invokes libgcc __mulsi3 via jal/jalr redirects.',
    result: 'a0 = 832040 = fib(30); mat_result[0..3] in memory.' },
  { name: 'fib', kind: 'c', title: 'Fibonacci table',
    watch: 'The running sum is forwarded EX/MEM to EX on every iteration; each sw depends on a value computed one instruction earlier.',
    result: 'a0 = 832040 = fib(30); fib[0..31] in memory.' },
  { name: 'gcd', kind: 'c', title: 'Binary GCD',
    watch: 'Shift loops where each srli feeds the next andi; the loop-exit branches flush two fetched instructions each time.',
    result: 'a0 = 21 = gcd(1071, 462); the g field of every table entry is filled in.' },
  { name: 'bubble', kind: 'c', title: 'Bubble sort',
    watch: 'Compare-and-swap pairs in the memory view; back-to-back lw/lw/bgeu with a load-use stall before the compare.',
    result: 'a0 = 62 swaps; data[16] sorted ascending in memory.' },
  { name: 'crc32', kind: 'c', title: 'CRC-32 (bitwise)',
    watch: 'The 8-step inner loop is a dependent chain (andi, neg, and, srli, xor): every ALU result is forwarded to the next instruction.',
    result: 'a0 = 0x57ef2b5d, the same value zlib.crc32 computes for the message.' },
  { name: 'matmul', kind: 'c', title: '3x3 matrix multiply',
    watch: 'RV32I has no multiply instruction: GCC calls libgcc __mulsi3. Each call and return is a redirect that flushes the front end.',
    result: 'a0 = 175 = trace(C); C[3][3] in memory.' },
  { name: 'strrev', kind: 'c', title: 'String reverse',
    watch: 'lbu/sb pairs swap characters from both ends; the ASCII column of the memory view flips while it runs.',
    result: 'a0 = 25 (length); text[] reversed in place.' },
  { name: 'bsearch', kind: 'c', title: 'Binary search',
    watch: 'Data-dependent branches: each probe is a lw followed by two compares, one taken and one not, flushing on every taken branch.',
    result: 'a0 = 21 (index of 733); found[4] and probes[4] in memory.' },
  { name: 'collatz', kind: 'c', title: 'Collatz chains',
    watch: 'The parity test (andi, bnez) decides between a shift and a slli+add+addi chain; branch outcomes alternate unpredictably.',
    result: 'a0 = 97 (longest chain below 100); best_steps = 118; steps[1..99] in memory.' },
  { name: 'mandel', kind: 'c', title: 'Mandelbrot (fixed point)',
    watch: 'Long run (2.29 M cycles): press Run. The ASCII image appears row by row in memory at image[]; most time is spent in __mulsi3.',
    result: 'a0 = 144 bounded points; 12 rows of 40 characters at image[].' },
  { name: 'hazards', kind: 'asm', title: 'Hazards, one at a time',
    watch: 'Step from reset. Cycle 4: add t2,t0,t1 takes t0 from MEM/WB and t1 from EX/MEM. Cycle 9: addi t6,t5,1 waits in ID for one cycle while lw t5 is in EX (load-use stall). Cycle 16: bne is taken and the two instructions fetched after it are flushed.',
    result: 'a0 = 103.' },
  { name: 'branches', kind: 'asm', title: 'Counting loop',
    watch: 'Nine taken branches, each flushing two wrongly fetched instructions (the core predicts not-taken); the last blt falls through.',
    result: 'a0 = 55, a1 = 10.' },
  { name: 'sum', kind: 'asm', title: 'Load-use: naive vs scheduled',
    watch: 'The first loop stalls one cycle per element (lw immediately followed by add). The second loop does the same work with the pointer and counter updates moved between them: no stalls.',
    result: 'a0 = a1 = 1240.' },
  { name: 'multiply', kind: 'asm', title: 'Shift-and-add multiply',
    watch: 'andi t0 -> beqz t0 is a forwarded compare; the loop runs 9 times for a 9-bit multiplier.',
    result: 'a0 = 56088 = 123 x 456.' },
  { name: 'memcopy', kind: 'asm', title: 'Byte copy and word copy',
    watch: 'lbu/sb pairs then lw/sw pairs; the store data is forwarded from the load result in WB. Both destination buffers fill in the memory view.',
    result: 'a0 = 32; dst_bytes and dst_words equal src.' },
  { name: 'calls', kind: 'asm', title: 'Calls and a stack frame',
    watch: 'jal writes ra from PC+4 in WB; ret is a jalr whose target comes from a forwarded ra. sp moves down and back up in the register file.',
    result: 'a0 = 74 = 7*7 + 5*5.' },
];

function parseSym(elf) {
  const out = [];
  for (const line of execSync(`riscv64-unknown-elf-nm -S -n ${elf}`).toString().split('\n')) {
    const m = line.match(/^([0-9a-f]+)\s+(?:([0-9a-f]+)\s+)?([A-Za-z])\s+(\S+)$/);
    if (!m) continue;
    const addr = parseInt(m[1], 16), size = m[2] ? parseInt(m[2], 16) : 0, type = m[3], name = m[4];
    if (name.startsWith('.L') || name === '__bss_start' || name === '__bss_end' || name === '__stack_top' || name === '__global_pointer$') continue;
    out.push({ name, addr, size, type });
  }
  return out;
}
function parseSections(elf) {
  // only ALLOC sections (the ones loaded into memory); .debug_* and .comment are excluded
  const out = {};
  const lines = execSync(`riscv64-unknown-elf-objdump -h ${elf}`).toString().split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s+\d+\s+(\.\S+)\s+([0-9a-f]+)\s+([0-9a-f]+)/);
    if (m && /\bALLOC\b/.test(lines[i + 1] || '')) out[m[1]] = { addr: parseInt(m[3], 16), size: parseInt(m[2], 16) };
  }
  return out;
}
function parseListing(disFile) {
  const out = [];
  for (const line of fs.readFileSync(disFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([0-9a-f]+):\s+([0-9a-f]{8})\s+(\S+)\s*(.*)$/);
    if (m) out.push([parseInt(m[1], 16), parseInt(m[2], 16) >>> 0, (m[3] + ' ' + m[4].replace(/\s*#.*$/, '')).trim()]);
  }
  return out;
}

const manifest = { generated: new Date().toISOString(), toolchain: {}, programs: [] };
manifest.toolchain.gcc = execSync('riscv64-unknown-elf-gcc --version').toString().split('\n')[0];
manifest.toolchain.binutils = execSync('riscv64-unknown-elf-as --version').toString().split('\n')[0];
manifest.toolchain.verilator = execSync('verilator --version').toString().trim();
manifest.toolchain.cflags = '-march=rv32i -mabi=ilp32 -O2 -ffreestanding -fno-builtin -nostdlib -nostartfiles -lgcc (crt0.S, link.ld, 64 KiB RAM at 0)';

for (const p of PROGRAMS) {
  const elf = path.join(build, p.name + '.elf');
  const bin = new Uint8Array(fs.readFileSync(path.join(build, p.name + '.bin')));
  const run = fs.readFileSync(path.join(build, p.name + '.run'), 'utf8');
  const regs = run.match(/^regs (.*)$/m)[1].split(' ').map(h => parseInt(h, 16) >>> 0);
  const cycles = +run.match(/cycles=(\d+)/)[1], instret = +run.match(/instret=(\d+)/)[1];
  // stalls / flushes / forwards from the JS twin (identical per-cycle trace, see test/program-equivalence.mjs)
  const mem = new Memory(64 * 1024); mem.loadBytes(bin, 0);
  const core = new SiliconCore(mem);
  let fwd = 0, bypass = 0, loads = 0, stores = 0, taken = 0, branches = 0;
  while (!core.halted) {
    const s = core.comb();
    fwd += s.fwd_a_used + s.fwd_b_used; bypass += s.id_bypass_rs1 + s.id_bypass_rs2;
    if (core.idex.valid && core.idex.branch) { branches++; if (s.br_taken) taken++; }
    if (s.dmem_we) stores++; if (s.dmem_re) loads++;
    core.clock(s);
  }
  if (core.cycle !== cycles || core.instret !== instret) throw new Error(`${p.name}: JS twin disagrees with Verilator`);
  for (let r = 1; r < 32; r++) if (core.regs[r] !== regs[r - 1]) throw new Error(`${p.name}: register x${r} differs`);
  const sections = parseSections(elf);
  const dataStart = Math.min(...Object.entries(sections).filter(([k]) => k !== '.text').map(([, v]) => v.addr), 1 << 30);
  const dataEnd = Math.max(...Object.entries(sections).filter(([k]) => k !== '.text').map(([, v]) => v.addr + v.size), 0);
  const entry = {
    name: p.name, kind: p.kind, title: p.title, watch: p.watch, result: p.result,
    source: p.kind === 'c' ? fs.readFileSync(path.join(here, 'c', p.name + '.c'), 'utf8') : fs.readFileSync(path.join(here, 'asm', p.name + '.S'), 'utf8'),
    sourceFile: p.kind === 'c' ? `c/${p.name}.c` : `asm/${p.name}.S`,
    image: Buffer.from(bin).toString('base64'),
    imageBytes: bin.length,
    textSize: sections['.text'].size,
    dataStart: dataStart === 1 << 30 ? sections['.text'].size : dataStart,
    dataEnd: Math.max(dataEnd, sections['.text'].size),
    symbols: parseSym(elf),
    listing: parseListing(path.join(build, p.name + '.dis')),
    // DWARF line table (gcc -g; does not change the machine code): instruction address -> source line of the program's own file
    lines: parseLines(path.join(build, p.name + '.lines'), p.kind === 'c' ? `${p.name}.c` : `${p.name}.S`, sections['.text'].size),
    expected: { a0: regs[9], regs: regs.map(x => x.toString(16).padStart(8, '0')) },
    measured: {
      cycles, instret, cpi: +(cycles / instret).toFixed(4),
      stalls: core.stalls, flushes: core.flushes, forwards: fwd, wbBypasses: bypass,
      loads, stores, branches, taken, source: 'cycles/instret: Verilator RTL run (programs/build/*.run); event counts: JS twin, trace-identical to the RTL',
    },
  };
  manifest.programs.push(entry);
  console.log(`${p.name.padEnd(9)} ${String(bin.length).padStart(5)} B  cycles ${String(cycles).padStart(8)}  instret ${String(instret).padStart(8)}  CPI ${entry.measured.cpi}  stalls ${core.stalls} flushes ${core.flushes} fwd ${fwd} byp ${bypass}  a0=0x${regs[9].toString(16)}`);
}
function parseLines(file, srcName, textSize) {
  // objdump --dwarf=decodedline: "file  line  address  [view]  [x]" rows; take the row for each address (last wins)
  const rows = fs.readFileSync(file, 'utf8').split('\n');
  const byAddr = new Map();
  for (const r of rows) {
    const m = r.match(/^(\S+)\s+(\d+)\s+(0x[0-9a-f]+|\d+)/);
    if (!m) continue;
    if (path.basename(m[1]) !== srcName) continue;
    const addr = parseInt(m[3], 16 === 16 && m[3].startsWith('0x') ? 16 : 10);
    if (addr >= textSize) continue;
    byAddr.set(addr, Number(m[2]));
  }
  return [...byAddr.entries()].sort((a, b) => a[0] - b[0]);
}
// crt0 and linker script for the C programs' "what runs before main" note
manifest.crt0 = fs.readFileSync(path.join(here, 'crt0.S'), 'utf8');
manifest.linkerScript = fs.readFileSync(path.join(here, 'link.ld'), 'utf8');
fs.mkdirSync(path.join(here, '../app/public/data'), { recursive: true });
fs.writeFileSync(path.join(here, '../app/public/data/programs.json'), JSON.stringify(manifest));
console.log('wrote app/public/data/programs.json', fs.statSync(path.join(here, '../app/public/data/programs.json')).size, 'bytes');
