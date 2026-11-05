#!/usr/bin/env python3
"""Convert the Yosys JSON netlist into the compact, laid-out form the browser uses.

Output (synth/netlist.compact.json):
  types   : list of cell type names (index used in cells)
  nNets   : number of net ids (Yosys bit numbers, plus two constants)
  const0, const1 : net ids holding constant 0 / 1
  cells   : [type, in0, in1, in2, out] per cell (-1 = unused). Gate inputs are
            A,B (and S for MUX); flop inputs are D,E,R in that order, output Q.
  names   : cell index -> readable name (flops: register bit; gates: short id)
  order   : combinational cell indices in topological order
  flops   : flop cell indices
  ports   : {port: [net ids]}
  netNames: {net id: "name[bit]"} for named nets
  aliases : {"other public name[bit]": net id} for RTL names Yosys merged onto a differently named net
  stage   : per cell 0..4 (IF, ID, EX, MEM, WB)
  pos     : per cell [x, y] in layout units
  bounds  : [w, h]
"""
import json, sys, collections, math, re

SRC = sys.argv[1] if len(sys.argv) > 1 else 'synth/silicon_netlist.json'
DST = sys.argv[2] if len(sys.argv) > 2 else 'synth/netlist.compact.json'

n = json.load(open(SRC))
m = n['modules']['silicon_core']
cells_in = m['cells']
nets_in = m['netnames']

# ---- net ids ---------------------------------------------------------------
max_bit = 0
for c in cells_in.values():
    for bits in c['connections'].values():
        for b in bits:
            if isinstance(b, int): max_bit = max(max_bit, b)
for v in nets_in.values():
    for b in v['bits']:
        if isinstance(b, int): max_bit = max(max_bit, b)
CONST0 = max_bit + 1
CONST1 = max_bit + 2
N_NETS = max_bit + 3

def bit_id(b):
    if isinstance(b, int): return b
    if b in ('0', 'x', 'z'): return CONST0
    if b == '1': return CONST1
    raise ValueError(b)

# readable names for nets: prefer public names, shortest
net_name = {}
for name, v in nets_in.items():
    public = not name.startswith('$')
    for i, b in enumerate(v['bits']):
        if not isinstance(b, int): continue
        label = f'{name}[{i}]' if len(v['bits']) > 1 else name
        cur = net_name.get(b)
        if cur is None or (public and cur[0] == '$') or (public == (not cur.startswith('$')) and len(label) < len(cur)):
            net_name[b] = label
# clean names: strip leading backslash
for b in list(net_name):
    net_name[b] = net_name[b].lstrip('\\')

# aliases: public RTL names Yosys merged onto a net that carries another name
# (e.g. exmem_alu[31:2] and dmem_addr[31:2] are the same flops)
aliases = {}
for name, v in nets_in.items():
    if name.startswith('$'): continue
    for i, b in enumerate(v['bits']):
        if not isinstance(b, int): continue
        label = (f'{name}[{i}]' if len(v['bits']) > 1 else name).lstrip('\\')
        if net_name.get(b) != label: aliases[label] = b

ports = {p: [bit_id(b) for b in v['bits']] for p, v in m['ports'].items()}
for p, bits in ports.items():
    for i, b in enumerate(bits):
        if b < CONST0:
            net_name[b] = f'{p}[{i}]' if len(bits) > 1 else p

# ---- cells -----------------------------------------------------------------
types = []
type_idx = {}
def tidx(t):
    t = t.strip('$_')
    if t not in type_idx:
        type_idx[t] = len(types); types.append(t)
    return type_idx[t]

cells = []       # [type, in0, in1, in2, out]
is_flop = []
names = []
driver = {}      # net -> cell index
for cname, c in cells_in.items():
    t = c['type']
    con = c['connections']
    g = lambda p: bit_id(con[p][0]) if p in con else -1
    if 'DFF' in t:
        rec = [tidx(t), g('D'), g('E'), g('R'), g('Q')]
        is_flop.append(True)
        q = rec[4]
        nm = net_name.get(q, cname.split('$')[-1])
        mm = re.match(r'\$\\regs\$rdreg\[(\d)\]\$q\[(\d)\]', nm)
        if mm:  # Yosys memory_map address register: a copy of the IF/ID rs index bits
            nm = f"rdaddr{'12'[int(mm.group(1))]}[{mm.group(2)}]"
        names.append(nm)
    else:
        if 'MUX' in t:
            rec = [tidx(t), g('A'), g('B'), g('S'), g('Y')]
        else:
            rec = [tidx(t), g('A'), g('B'), -1, g('Y')]
        is_flop.append(False)
        names.append(net_name.get(rec[4], ''))
    idx = len(cells)
    cells.append(rec)
    driver[rec[4]] = idx

NC = len(cells)
print(f'{NC} cells, {sum(is_flop)} flops, {N_NETS} nets', file=sys.stderr)

# fanout map
fanout = collections.defaultdict(list)   # net -> [cell idx]
for i, rec in enumerate(cells):
    for inp in rec[1:4]:
        if inp >= 0: fanout[inp].append(i)

# ---- topological order of combinational cells -------------------------------
indeg = [0] * NC
for i, rec in enumerate(cells):
    if is_flop[i]: continue
    for inp in rec[1:4]:
        if inp >= 0 and inp in driver and not is_flop[driver[inp]]:
            indeg[i] += 1
order = []
queue = collections.deque(i for i in range(NC) if not is_flop[i] and indeg[i] == 0)
while queue:
    i = queue.popleft()
    order.append(i)
    for j in fanout[cells[i][4]]:
        if is_flop[j]: continue
        indeg[j] -= 1
        if indeg[j] == 0: queue.append(j)
assert len(order) == NC - sum(is_flop), 'combinational loop?'

# depth (longest path from a flop output / primary input), in topological order
depth = [0] * NC
for i in order:
    d = 0
    for inp in cells[i][1:4]:
        if inp >= 0 and inp in driver and not is_flop[driver[inp]]:
            d = max(d, depth[driver[inp]] + 1)
    depth[i] = d
print('max logic depth', max(depth), file=sys.stderr)

# ---- stage assignment --------------------------------------------------------
STAGES = ['IF', 'ID', 'EX', 'MEM', 'WB']
def flop_stage(name):
    base = name.split('[')[0]
    if base in ('imem_addr', 'pc', 'fetch_stopped') or base.startswith('ifid_') or base.startswith('id_') or 'rdreg' in base: return 0
    if base.startswith('idex_'): return 1
    if base.startswith('exmem_') or base.startswith('dmem_'): return 2
    if base.startswith('memwb_') or base == 'load_result': return 3
    if base.startswith('regs') or base == 'halted': return 4
    return None

stage = [None] * NC
unknown_flops = []
for i in range(NC):
    if is_flop[i]:
        s = flop_stage(names[i])
        if s is None: unknown_flops.append(i)
        stage[i] = s
print('flops without a stage name:', [(names[i], cells[i]) for i in unknown_flops], file=sys.stderr)

# reach: for each comb cell, weighted vote over the stages of the flops / ports it feeds
PORT_STAGE = {'imem_addr': 0, 'dmem_addr': 2, 'dmem_wdata': 2, 'dmem_be': 2, 'dmem_we': 2, 'dmem_re': 2, 'halted': 4}
port_of_net = {}
for p, bits in ports.items():
    if m['ports'][p]['direction'] == 'output':
        for b in bits: port_of_net[b] = p

votes = [None] * NC
for i in reversed(order):
    v = collections.Counter()
    out = cells[i][4]
    if out in port_of_net:
        v[PORT_STAGE[port_of_net[out]]] += 1
    for j in fanout[out]:
        if is_flop[j]:
            if stage[j] is not None: v[stage[j]] += 1
        else:
            if votes[j]: v.update(votes[j])
    votes[i] = v
for i in order:
    v = votes[i]
    if v:
        best = max(v.values())
        stage[i] = min(s for s, c in v.items() if c == best)
    else:
        stage[i] = 2  # dangling (should not happen after opt_clean)
# flops of unknown stage: by the stage of their D-cone sources, default WB
for i in unknown_flops:
    stage[i] = 4

# ---- layout ------------------------------------------------------------------
# Each stage is a column made of two packed blocks: combinational cells in a
# depth-ordered raster (logic depth increases left to right, cells within a
# depth layer ordered by the rows of the cells they feed) and the stage's
# flip-flops in a bank at the right (one vertical run per register, bit 0 at
# the top). The WB bank is the register file: row = register, column = bit.
R = 112                      # rows per block
BLOCK_GAP = 2.0
COL_GAP = 4.0

pos = [[0.0, 0.0] for _ in range(NC)]
col_x0 = 0.0
layout_info = {}

def natural_key(s):
    return [int(t) if t.isdigit() else t for t in re.split(r'(\d+)', s)]

for st in range(5):
    comb = [i for i in order if stage[i] == st]
    flops = [i for i in range(NC) if is_flop[i] and stage[i] == st]
    flops.sort(key=lambda i: natural_key(names[i]))
    layers = collections.defaultdict(list)
    for i in comb: layers[depth[i]].append(i)
    L = (max(layers) + 1) if layers else 0

    # --- flop bank (relative coordinates)
    flop_rel = {}
    if st == 4:
        regbits = [i for i in flops if names[i].startswith('regs')]
        others = [i for i in flops if not names[i].startswith('regs')]
        for i in regbits:
            mm = re.match(r'regs\[(\d+)\]\[(\d+)\]', names[i])
            r, b = int(mm.group(1)), int(mm.group(2))
            flop_rel[i] = (float(b), float(r - 1))
        for k, i in enumerate(others):
            flop_rel[i] = (33.0, float(k))
        bank_w = 34.0 if others else 32.0
    else:
        groups = collections.OrderedDict()
        for i in flops:
            groups.setdefault(names[i].split('[')[0], []).append(i)
        gx, gy = 0, 0
        for gname, members in groups.items():
            members.sort(key=lambda i: natural_key(names[i]))
            if gy + len(members) > R and gy > 0:
                gx += 1; gy = 0
            for i in members:
                if gy >= R: gx += 1; gy = 0
                flop_rel[i] = (float(gx), float(gy)); gy += 1
        bank_w = float(gx + 1) if flops else 0.0

    # --- comb raster: order by (depth, barycenter of fed rows), fill columns of R rows
    comb_cols = (len(comb) + R - 1) // R if comb else 0
    row_of = {}
    for i, (fx, fy) in flop_rel.items(): row_of[i] = fy
    ordered = []
    for d in range(L - 1, -1, -1):
        cs = layers[d]
        bary = {}
        for i in cs:
            tgt = [row_of[j] for j in fanout[cells[i][4]] if j in row_of]
            bary[i] = sum(tgt) / len(tgt) if tgt else R / 2
        cs.sort(key=lambda i: bary[i])
        layers[d] = cs
        # provisional rows for shallower layers: spread over the block height in bary order
        for k, i in enumerate(cs):
            row_of[i] = (k + 0.5) * R / max(1, len(cs))
    idx = 0
    for d in range(L):
        for i in layers[d]:
            pos[i] = [col_x0 + idx // R, float(idx % R)]
            idx += 1
    bank_x0 = col_x0 + comb_cols + ((6.0 if st == 4 else BLOCK_GAP) if comb_cols else 0.0)  # WB: room for register-file row labels
    for i, (fx, fy) in flop_rel.items():
        pos[i] = [bank_x0 + fx, fy]
    col_w = (bank_x0 - col_x0) + bank_w
    layout_info[STAGES[st]] = {'x0': col_x0, 'w': col_w, 'comb': len(comb), 'flops': len(flops), 'layers': L, 'combCols': comb_cols, 'bankX0': bank_x0, 'bankW': bank_w}
    col_x0 += col_w + COL_GAP

bounds_w = col_x0 - COL_GAP
bounds_h = float(R)

out = {
    'types': types, 'nNets': N_NETS, 'const0': CONST0, 'const1': CONST1,
    'cells': cells, 'names': names, 'order': order,
    'flops': [i for i in range(NC) if is_flop[i]],
    'ports': ports, 'portDir': {p: m['ports'][p]['direction'] for p in ports},
    'netNames': {str(b): nm for b, nm in net_name.items()},
    'aliases': aliases,
    'stage': stage, 'stages': STAGES, 'pos': [[round(x, 2), round(y, 2)] for x, y in pos],
    'bounds': [round(bounds_w, 2), round(bounds_h, 2)], 'columns': layout_info,
    'depth': depth,
}
json.dump(out, open(DST, 'w'), separators=(',', ':'))
print('stage counts', collections.Counter(STAGES[s] for s in stage), file=sys.stderr)
print('columns', json.dumps(layout_info), file=sys.stderr)
print(f'wrote {DST}', file=sys.stderr)
