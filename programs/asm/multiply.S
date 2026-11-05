# Shift-and-add multiplication, the way libgcc does it for RV32I.
# a0 = 123 * 456 = 56088 (0xDB18)
    .section .text.start
    .globl _start
_start:
    li   a1, 123           # multiplicand
    li   a2, 456           # multiplier
    li   a0, 0
mul_loop:
    andi t0, a2, 1
    beqz t0, skip
    add  a0, a0, a1
skip:
    slli a1, a1, 1
    srli a2, a2, 1
    bnez a2, mul_loop
    ebreak
