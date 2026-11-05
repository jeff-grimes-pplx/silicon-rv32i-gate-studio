/* Silicon memory map: 64 KiB RAM at 0; code at 0, data follows, stack at top. */
OUTPUT_ARCH("riscv")
ENTRY(_start)
MEMORY { ram (rwx) : ORIGIN = 0x00000000, LENGTH = 64K }
SECTIONS {
  .text : { KEEP(*(.text.start)) *(.text .text.*) } > ram
  .rodata : { *(.rodata .rodata.* .srodata .srodata.*) } > ram
  .data : { *(.data .data.* .sdata .sdata.*) } > ram
  .bss (NOLOAD) : { . = ALIGN(4); __bss_start = .; *(.bss .bss.* .sbss .sbss.* COMMON) . = ALIGN(4); __bss_end = .; } > ram
  __stack_top = ORIGIN(ram) + LENGTH(ram);
  /DISCARD/ : { *(.comment .note* .riscv.attributes .eh_frame*) }
}
