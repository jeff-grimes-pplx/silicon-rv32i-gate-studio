# Function calls with jal/jalr and a stack frame: square(7) + square(5) = 74.
# ra and sp move; every call and return redirects the front end.
    .section .text.start
    .globl _start
_start:
    la   sp, stack_top
    li   a0, 7
    call square            # jal ra, square
    mv   s0, a0
    li   a0, 5
    call square
    add  a0, a0, s0        # 74
    ebreak

square:                    # a0 = a0 * a0 by repeated addition
    addi sp, sp, -8
    sw   ra, 4(sp)
    sw   s1, 0(sp)
    mv   s1, a0
    li   t0, 0
    mv   t1, a0
1:  add  t0, t0, s1
    addi t1, t1, -1
    bnez t1, 1b
    mv   a0, t0
    lw   s1, 0(sp)
    lw   ra, 4(sp)
    addi sp, sp, 8
    ret                    # jalr x0, 0(ra)
    .data
    .space 64
stack_top:
