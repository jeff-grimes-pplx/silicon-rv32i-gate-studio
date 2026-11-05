# A8 · Silicon — v2 pass delivered (message to the coordination parent)

Written to the repo because cross-session mail to `f192aaa2-55d7-4551-ae2f-8eacad18daa5` (and its resolved id `d3780825-0953-4586-b886-dea0ae31b6ec`) returned "agent not found" on 2026-10-16 12:3x UTC; the parent's own last status reports the same relay failure. Same content as the intended one-message mail.

The 45 s film replaces the 60 s and 30 s cuts; both stay as superseded assets (`1f3f761b-a929-48ad-b1a3-6871898ee064`, `55601af4-77ac-4808-9776-8c42e8b96e10`).

## Film (render c11)

- Asset `89306a4a-e573-418c-a7d8-899b01d4feff` · 32,756,233 B · SHA-256 `b2ff82c31761160284cc0453d0c977df21eec7a5d5ec86b7795c2d970dc3155e`
- ffprobe: h264 High, 1920×1080, yuv420p, r_frame_rate 60/1 = avg_frame_rate, 2,700 frames, duration 45.000000 s, 1 video stream, no audio; libx264 preset slow, CRF 16, +faststart, 5.82 Mb/s; every pts delta 1/60 s; decodes clean (`film/v3/measure/ffprobe.txt`, `decode.txt`).
- Master `film/v3/out/Silicon-45s-master.mp4`: CRF 8, yuv444p (High 4:4:4 Predictive), 71,694,450 B, SHA-256 `217ef3c4b2da372f4727c8c540e98b8d8af8712ea60fdd9c5b96b8cbc89f8f44`. Delivery-vs-master PSNR 45.20 dB global / 36.04 min / 48.04 median.
- Contact sheet asset `f88cb603-5f1c-4a77-8a80-5a1bdffa56e1`; final frame asset `87ed4fa3-0791-4233-b0d4-c3dcc44ca84c`; HANDOFF.md asset `72aabf26-1683-49dc-b789-443ca446c691`.
- Repo commits `f62b4dd`, `671921f`: `film/v3/` (capture/encode scripts, action and camera logs, `films-v2.md` receipts, `measure/independent-review-2…5.md`), HANDOFF/STATUS/README.

## Beats (t | frame | beat | zoom)

| t | frame | beat | zoom |
|---|---|---|---|
| 0.00 | 0 | C source `primes.c` | 3.86× |
| 2.73 | 164 | click Machine code tab | 5.10× |
| 5.35 | 321 | click breakpoint 0x44 (`j 0x58`) | 3.86× |
| 7.92 | 475 | click Run | 4.33× |
| 10.12 | 607 | stopped at breakpoint: cycle 1,465 · instret 975 · CPI 1.503 | 5.5× |
| 13.32 | 799 | `j 0x58` in EX — REDIRECT/FLUSH | 3.1× |
| 14.52–19.73 | 871–1184 | Space ×5, cycles 1,466→1,470 (STALL/HOLD/BUBBLE at 1,468; FORWARD at 1,470) | 3.1× |
| 22.42 | 1345 | click Netlist tab | 4× |
| 24.25 | 1455 | read beat: MEM/WB columns + 32×31 register file | 4× |
| 25.05 | 1503 | Enter = Run, cells toggling | 4× |
| 28.22 | 1693 | whole netlist toggling | 1× |
| 29.77–30.28 | 1786–1817 | click search, type `a0` | 4.8× |
| 31.03 | 1862 | Enter → group a0 (32 DFFs) selected | 4.8× |
| 33.77 | 2026 | hover DFF tooltip `regs[10][3]` | 4× |
| 36.65 | 2199 | click Stop | 6.37× |
| 37.92 | 2275 | click To end → halted | 6.37× |
| 40.15 | 2409 | halted machine | 1× |
| 41.75–45.00 | 2505–2699 | payoff `halted · a0 = 0000021d (541) · same as the Verilator run` (hex 52 px; static hold 3.67 s) | 5.7× |

## Capture method

Real app (the deployed bundle) in headless Chromium at DPR 3; in-page virtual clock stepped exactly 1000/60 ms per frame; eased camera rendered natively via CDP clip capture (no post-hoc crop or upscale); pointer composited from the real input log; one continuous take, no cuts. Frame-stepped, not real-time GPU performance. Receipts: 13/13 counters, 79/79 a0 values and 100/100 tooltip pins match the simulator; a0 = 0x21d = 541 = the Verilator run. Text: 65/65 crops ≥ 28/32/48 px; rules check 61 ok / 0 FAIL; dwell, hold, settle and pointer continuity pass (`film/v3/films-v2.md`).

## App

Asset `b1e153b5-4e88-4563-b2be-01faa40bb8b0`, redeployed in place; bundle SHA-256 `232fe67ab921bd1aef827fb3611843ed6e5b8e44ce563dd17dbdafd6912e06b8` (unchanged since render c8). One change: the netlist hover tooltip now refreshes while the simulation runs (it was stale during Run). 0 console errors at 1440×900 / 1280×720 / 390×844; 22/22 viewport and 13/13 defect re-checks pass.

## Review

Independent review #5 (c11, `film/v3/measure/independent-review-5.md`): clock PASS, text PASS (T1 closed), changed-range motion PASS, SHA match. Only open item: the normalised duplicate-pair metric — 195/906 = 21.5 % of consecutive moving-frame pairs differ by less than 0.02 of full scale; on the 0–255 reading it is 0/906, there are 0 exact duplicates and no cadence, and every frame advances (sub-pixel camera steps). Stated for your adjudication, not hidden. Frozen again pending acceptance.
