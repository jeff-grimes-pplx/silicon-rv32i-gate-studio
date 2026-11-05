# Sum an array two ways. The naive loop puts the load right before its use
# (one stall per element); the scheduled loop reorders so the pointer and
# counter updates fill the slot. Both sums land in a0 and a1 (both 1240).
    .section .text.start
    .globl _start
_start:
    la   t0, data
    li   t1, 8
    li   a0, 0
naive:
    lw   t2, 0(t0)
    add  a0, a0, t2        # load-use stall here, every iteration
    addi t0, t0, 4
    addi t1, t1, -1
    bnez t1, naive

    la   t0, data
    li   t1, 8
    li   a1, 0
scheduled:
    lw   t2, 0(t0)
    addi t0, t0, 4         # independent work covers the load latency
    addi t1, t1, -1
    add  a1, a1, t2        # value arrives from MEM/WB, no stall
    bnez t1, scheduled
    ebreak
    .data
data: .word 10, 20, 30, 40, 50, 60, 70, 960
