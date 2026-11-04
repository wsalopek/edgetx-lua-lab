# Research notes

## Lua version (important for fidelity)
- EdgeTX docs: up to 2.10 the radio uses Lua 5.2; from 2.11 it uses Lua 5.3. `.luac` files are not
  compatible across the two. `bit32` is included in both; `io` is partial; `os`, `coroutine`,
  `package`, `debug` are not included; `table` only on color radios.
- Source: https://luadoc.edgetx.org/2.11/overview/version-libraries/
- Lua 5.3 has integer/float subtypes, so e.g. `string.format("%d", 1.5)` errors. The simulator
  should reproduce the radio's behaviour, not hide it.
- The EdgeTX repo (radio/src/thirdparty/Lua) has a standalone WASM Lua *compiler* (June 2026,
  PR #7275). It compiles source to radio bytecode in the browser; it is not a simulator.

## Fonts (color radios)
Source of truth: `radio/src/gui/colorlcd/fonts.cpp` and `fonts.h`.
Font index lives in bits 8-11 of the draw flags (`FONT_MASK 0x0F00`):

| index | name | typical flag |
|---|---|---|
| 0 | STD (regular) | STDSIZE / none |
| 1 | BOLD (bold, standard size) | BOLD |
| 2 | XXS | TINSIZE |
| 3 | XS | SMLSIZE |
| 4 | L | MIDSIZE |
| 5 | XL (bold) | DBLSIZE |
| 6 | XXL (bold) | XXLSIZE |
| 7 | LXL (bold) | |

Gotcha: flags are *added*, so the index adds too: `SMLSIZE+BOLD` = index 4 (L), `MIDSIZE+BOLD` =
index 5 (XL). The simulator must add the numbers, not treat BOLD as a modifier.

Glyph data: compiled LVGL font C files in `radio/src/fonts/lvgl/{std,sml,lrg}/lv_font_*.c`
(std = 480x272 and 480x320, sml = 320x240, lrg = 800x480). Some are LZ4 compressed.
Underlying typeface: Roboto (Apache-2.0) in `radio/src/fonts/Roboto`.

## Existing tools found
- edgetx-lua-gen: generates LuaLS type stubs (autocomplete only).
- EdgeTX web-simulator developer contest: closed 2025-04-30 with no submissions; may reopen 2026.
- No browser emulator for EdgeTX Lua scripts found (shallow search - ask on EdgeTX Discord before
  going far).

## Ground truth
Companion 2.12 ships a simulator library for every radio. Use it to capture golden screenshots.
Driving it without a mouse: post window messages to the simulator window and capture only that
window (see tools/). The simulator window is drawn at 2/3 scale on some monitors.
