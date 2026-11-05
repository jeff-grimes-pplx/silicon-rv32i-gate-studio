# smoke: forwarding chain and a load-use, result in a0
    .section .text.start
    .globl _start
_start:
    li   a1, 7
    li   a2, 5
    add  a3, a1, a2      # 12  (EX/MEM -> EX forward of a1? no: a1 came 2 cycles ago -> MEM/WB fwd)
    add  a4, a3, a3      # 24  (EX/MEM -> EX forward of a3)
    sub  a5, a4, a1      # 17  (EX/MEM fwd a4, MEM/WB fwd? a1 is older -> regfile)
    la   t0, buf
    sw   a5, 0(t0)
    lw   a6, 0(t0)       # 17
    addi a0, a6, 1       # 18, load-use stall
    beq  a0, a5, fail    # not taken
    bne  a0, a5, ok      # taken -> flush
    li   a0, 99
ok:
    ebreak
fail:
    li   a0, 0xbad
    ebreak
    .data
buf: .word 0
