# Copy 16 bytes from src to dst, first byte by byte, then word by word
# into a second buffer. Watch both destinations fill in the memory view.
# a0 = number of bytes copied (32).
    .section .text.start
    .globl _start
_start:
    la   t0, src
    la   t1, dst_bytes
    li   t2, 16
bytes:
    lbu  t3, 0(t0)
    sb   t3, 0(t1)
    addi t0, t0, 1
    addi t1, t1, 1
    addi t2, t2, -1
    bnez t2, bytes

    la   t0, src
    la   t1, dst_words
    li   t2, 4
words:
    lw   t3, 0(t0)
    sw   t3, 0(t1)
    addi t0, t0, 4
    addi t1, t1, 4
    addi t2, t2, -1
    bnez t2, words
    li   a0, 32
    ebreak
    .data
src:       .ascii "silicon gates ok"
    .align 2
dst_bytes: .space 16
dst_words: .space 16
