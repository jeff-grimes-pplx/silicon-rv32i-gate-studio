# A counting loop: one taken branch per iteration, flushed fetches each time.
# Sums 1..10 into a0 (55); a1 counts iterations.
    .section .text.start
    .globl _start
_start:
    li   a0, 0
    li   a1, 0
    li   a2, 10
loop:
    addi a1, a1, 1
    add  a0, a0, a1
    blt  a1, a2, loop      # taken 9 times, not taken once
    ebreak
