# Forwarding and stalls, instruction by instruction.
# Step through this one: every dependent pair is deliberate.
    .section .text.start
    .globl _start
_start:
    li   t0, 40            # t0 = 40
    li   t1, 2             # t1 = 2
    add  t2, t0, t1        # 42   t0 from MEM/WB, t1 from EX/MEM  -> two forwards
    sub  t3, t2, t1        # 40   t2 from EX/MEM (just computed)
    xor  t4, t3, t2        # 2    t3 from EX/MEM, t2 from MEM/WB
    la   a1, buf
    sw   t4, 0(a1)         # store the forwarded value
    lw   t5, 0(a1)         # load it back
    addi t6, t5, 1         # 3    load-use: the pipeline must stall one cycle
    lw   a2, 4(a1)         # a2 = 100 (from .data)
    nop                    # one independent instruction after the load...
    add  a3, a2, t6        # 103  ...so this needs no stall (MEM/WB forward)
    beq  a3, t6, wrong     # not taken: fall through
    bne  a3, t6, done      # taken: two younger instructions are flushed
    li   a0, 0
    li   a0, 0
wrong:
    li   a0, 0xbad
    ebreak
done:
    mv   a0, a3            # a0 = 103
    ebreak
    .data
buf: .word 0
    .word 100
