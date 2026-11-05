# A8 · Silicon — v2.1 checkpoint (captioned release candidate + clean film), 2026-10-17

To the coordination parent `f192aaa2-55d7-4551-ae2f-8eacad18daa5`. Cross-session mail is down, so this checkpoint is written here as asked. Private only; nothing published or posted.

## Assets

| Deliverable | Asset ID | Bytes | SHA-256 |
|---|---|---:|---|
| `silicon-45s-captioned.mp4` — release candidate, burned-in captions | `2caaed51-540f-465d-9f62-39bce45e06a2` ("Silicon — 45 s film, captioned") | 27,618,964 | `e9ccf3b180dd40bbb9e039918c5aa4f4b776e5edf4eb78f59e54ec1ed7583d82` |
| `silicon-45s.mp4` — clean, identical 2,700 frames, no captions, no scrim | `22e473e9-3422-4a7a-a9b2-2fadabb82339` (new version of "Silicon — 45 s film"; c11 `89306a4a-…` superseded) | 26,441,736 | `630b9a21742a7923a145c12ff0f19b758e63153c1757997d3e8aa805941907c9` |
| `silicon-45s-master.mp4` — master, CRF 8 yuv444p | session only | 57,139,279 | `2e97c4202ddd67c2b484a1f7b7027636c7ec1be4d61d75d800b953ca872db82a` |
| Contact sheets (captioned / clean), final frame 2,699 (captioned) | `9e69f7a3-1a0d-40d6-a9a0-6eb5a3633ca2` / `10bafdc9-746b-41f2-a86c-ec92ed85f93e`; `bdc34b85-6dbf-4b56-bd1f-48e2db8dd725` | | |
| `films-v2.md` (receipts) / `HANDOFF.md` / full build bundle (v2.1) | `2583869e-4c60-461c-98de-35f88173955d` ("A8 · Silicon — films v2 receipts") / `ea5d6f95-a94c-4128-b283-92b3b9a28a31` (new version of "A8 · Silicon — handoff") / `bdd1cd39-0d39-4680-951d-8ae3731daf29` (new version of "A8 · Silicon — full build bundle", 49,360,545 B, SHA-256 `09c4dca8…4ab7`) | | |
| App "Silicon" (redeployed in place; pipeline-card typography change) | `b1e153b5-4e88-4563-b2be-01faa40bb8b0` | | bundle hash `b4d01a9128db4784b950b40eda3be5fcb89005bea26300f09b7c51d1fe78f07a` |

Bundle hash = SHA-256 over the sorted per-file SHA-256 list of `app/dist` (`film/v3/measure/app-hashes.txt`); capture build = deployed build.

## Repo note

The Project repo is at its 5 GiB limit: the full v2.1 folder (all film/v3 sources, logs and measurements, 2.5 MB) failed with REPOSITORY_CONTENT_SIZE_LIMIT_EXCEEDED (current 5,368,636,963 B, limit 5,368,709,120 B, 72 KB free), so this checkpoint submits only `PARENT-MAIL-v2.1.md`, `HANDOFF.md`, `STATUS.md` and `README.md`. The repo's `film/v3/` and `app/src/` are still the c11 (v2 pass) trees. The complete v2.1 build folder (487 files, incl. `film/v3/lib4.mjs`, v11 `film-45.mjs`, `work/` capture/camera/probe logs, `measure/` with the caption compositor, every script and output, reviews 2–6, `films-v2.md`, `superseded-c11/`) is the session asset "A8 · Silicon — full build bundle" `bdd1cd39-0d39-4680-951d-8ae3731daf29`: `Silicon-A8-full.zip`, 49,360,545 B, SHA-256 `09c4dca8e76675c69be86afdc866c7167d01aed80392d0491336235557bd4ab7`. If space is freed, the folder can be submitted as-is from that zip.

## ffprobe (both deliveries)

h264 High, 1920×1080, yuv420p, r_frame_rate = avg_frame_rate = 60/1, duration 45.000000 s, nb_read_frames 2700, one stream, no audio, +faststart; bit rate 4,910,038 b/s (captioned) / 4,700,753 b/s (clean). Full decodes with `-xerror` exit 0; every pts delta 256/15360 s = 1/60 s, monotonic (`film/v3/measure/ffprobe.txt`, `decode.txt`). Master: High 4:4:4 Predictive, yuv444p, 10,158,094 b/s, 2,700 frames.

## Caption band and treatment

Top band for the whole film. Letterbox composition: rows 0–239 are a flat matte in the page background (#121214, luminance 0.04), rows 240–1079 hold the camera window at 1920×840, so no interface text, pointer or subject ever enters y 0–240 (pointer sprite top edge ≥ y 260 in every frame; decoded band deviation from the matte ≤ 15 levels, 4:2:0 ringing at the matte edge, present in the clean film too; band luminance 0.042). The clean film is the re-framed film the mail asked for: same composition, same 2,700 frames, same cut, no captions or scrim. Captioned film: Inter SemiBold 600, 64 px (cap 47–48 px measured, x-height 36), white, shadow black 65 % offset 0/+3 blur 7, no box; one line centred at y 150 (widest caption 1,652 px, no wrapping); scrim a0 0.40 over y 0–200 fading to 0 at y 300, fading with the caption; 12-frame linear fades at beat boundaries or holds, never during a camera move; caption 1 opaque from frame 0 without fade-in; caption 11 holds to frame 2,699; 10 hand-offs of 23 frames (0.383 s). Compositing in numpy/PIL on the master's decoded frames before the encode (`measure/caption.py`), both deliveries encoded from the same decode; rows 300–1079 are handed to both encoders byte-identical (by construction of the compositor), decoded difference below the scrim is encoder noise only (mean |Δ| 0.51; reviewer: no structured difference). Font SHA-256 `78a843fade9d4612a5567302fb595b56976eb5fcebf4fea5a5912d638bafcde3` (Inter-4.1.zip `9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e`).

## Caption table

| # | Caption | Chars | Opaque frames | Duration |
|---|---|---:|---|---|
| 1 | A RISC-V CPU built by Computer runs this C program. | 51 | 0–213 | 3.57 s |
| 2 | In machine code, this program is 55 instructions. | 49 | 237–479 | 4.05 s |
| 3 | A breakpoint stops the CPU at cycle 1,465. | 42 | 503–759 | 4.28 s |
| 4 | Space steps the pipeline one clock cycle at a time. | 51 | 783–1003 | 3.68 s |
| 5 | A load-use hazard inserts a bubble. | 35 | 1027–1214 | 3.13 s |
| 6 | The loaded value is forwarded to the branch. | 44 | 1238–1424 | 3.12 s |
| 7 | The same CPU is 8,297 gates and flip-flops. | 43 | 1448–1629 | 3.03 s |
| 8 | The CPU runs again. Gates light up as they switch. | 50 | 1653–1876 | 3.73 s |
| 9 | The result register a0 is 32 of those flip-flops. | 49 | 1900–2132 | 3.88 s |
| 10 | Stop pauses the CPU. To end finishes at full speed. | 51 | 2156–2440 | 4.75 s |
| 11 | Halted at cycle 16,700: a0 = 541, the 100th prime. | 50 | 2464–2699 | 3.93 s |

Every duration ≥ 3.0 s (opener ≥ 3.5 s) and ≥ 0.065 s × chars; no gap > 0.4 s; every figure matches a receipt (`films-v2.md` section 7 and 9). The beats were re-cut for the captions (longer load-use / forward / cell-count holds, hover detour dropped); no footage was re-timed.

## Beat list (render v11; frame = first frame of the state; clicks logged at mouse-up)

| Time | Frame | Beat | Zoom |
|---|---:|---|---:|
| 0.00 s | 0 | C source primes.c | 5.05× |
| 2.73 s | 164 | click Machine code tab → listing (f166) | 5.097× |
| 5.35 s | 321 | click breakpoint at 0x44 (`j 0x58`) → row marked (f323) | 3.857× |
| 7.92 s | 475 | click Run (1 k cycles/s) → Pause · Stop (f477) | 3.257× |
| 10.12 s | 607 | stopped at the breakpoint: cycle 1,465 · instret 975 · CPI 1.503 | 5.5× |
| 13.02 s | 781 | cycle 1,465: `j 0x58` in EX — REDIRECT, IF/ID and ID/EX FLUSH | 2.84× |
| 14.22–20.25 s | 853–1215 | Space ×5: cycles 1,466 → 1,470 (STALL · HOLD · BUBBLE at 1,468; bubble at 1,469; FORWARD ×1 at 1,470) | 2.84× |
| 22.08–23.18 s | 1325–1391 | move to the view tabs | 2.84× → 4.61× |
| 23.52 s | 1411 | click Netlist tab → netlist view (f1413) | 4.61× |
| 24.15–24.95 s | 1449–1497 | pull back to the MEM and WB columns | 4.61× → 4× |
| 25.35 s | 1521 | read beat: MEM · WB, `52 gates · 1003 flops · depth 8`, the 32×31 register file | 4× |
| 26.95 s | 1617 | Enter = Run → cells toggling (f1619) | 4× |
| 28.18–29.38 s | 1691–1763 | pull back to the whole netlist running | 4× → 1× |
| 30.07 s | 1804 | whole netlist toggling (picture beat) | 1× |
| 31.62–32.13 s | 1897–1928 | click Find, type `a0` → "register a0 (x10) — all 32 flops" | 6.575× |
| 32.88 s | 1973 | Enter → group a0 selected (f1975); pan to the group block (2013–2061); value, toggled now, bits (f2085) | 6.575× |
| 37.58 s | 2255 | click Stop → paused at cycle 12,103 (f2257) | 5.402× |
| 38.85 s | 2331 | click To end → halted (f2333): cycle 16,700 · instret 11,451 · CPI 1.458 | 5.402× |
| 41.08 s | 2465 | halted machine (picture beat, 0.42 s) | 1× |
| 42.68–45.00 s | 2561–2699 | payoff `halted · a0 = 0000021d (541) · same as the Verilator run`, static hold | 5.7× |

Camera moves (13): 78–144, 241–301, 395–455, 547–607, 679–757, 1325–1391, 1449–1497, 1691–1763, 1805–1877, 2013–2061, 2157–2235, 2369–2441, 2465–2537 — all smootherstep eases of 0.8–1.3 s; a move starts only after the previous one has settled ≥ 0.4 s and any click is ≥ 0.6 s old; the pointer dwells ≥ 0.3 s on a control before clicking it; no caption fade during a move. Pointer peak 1,090 px/s; mouse-down and mouse-up two frames apart; typing 12 and 10 chars/s with a visible caret.

## Receipts and review

`film/v3/films-v2.md`: sections 1–11 (files and hashes, beats, text heights on native frames, motion, rules check, disclosures, captions 7.2–7.5 incl. per-caption first opaque frame / cap height / band luminance / band-clean confirmation / compositing / diff, contact sheets, receipts for every number — 13/13 counter states, 17/17 event states in the per-frame probe, 183/183 a0 group values in the running hold f1975–2157, final a0 = 0x21d = 541 —, app hashes and QA, review dispositions). Independent review #6 (fresh agent, sections 3 and 7 on the captioned film, `film/v3/measure/independent-review-6.md`): PASS; two literal-reading items stated for adjudication, both disclosed before — the normalised duplicate-pair metric (29.8 % of camera-moving pairs; 0 exact duplicates, no cadence) and the Run button's `Enter` kbd hint (23 px caps at 3.257×). Caption 7 was reworded after the review (verbless fragment → "The same CPU is 8,297 gates and flip-flops."), re-composited from the same master and re-checked by the reviewer; the clean film is byte-identical to the reviewed one. Craft note from the mail (pointer parked during 13–20 s): the five steps are made with the Space key (the Step button's shortcut) with the pointer parked inside the EX card below its text rows; the Step button cannot share a ≥ 2.2× window with the stage cards (cards at page y 184–480, transport bar at y ≈ 1047), so captions 4–6 state the cause of each card change instead. Disclosed in `films-v2.md` section 6.

Deployed app re-checked after the redeploy: 22/22 viewport checks, 13/13 defect checks, 0 console errors (`film/v3/measure/qa-summary.md`).
