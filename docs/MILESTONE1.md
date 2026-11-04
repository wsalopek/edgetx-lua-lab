# Milestone 1 - does the idea work?

Goal: in a browser, show the TX16S screen running Yaapu's real messages screen from the Lua
source, with sliders for telemetry, and compare it with a real Companion screenshot.

## Steps
1. Font pipeline: convert EdgeTX's English LVGL fonts (XXS, XS, STD, L, bold STD, bold XL, bold XXL,
   bold LXL) into data the browser can draw. (LZ4 decompress + LVGL glyph bitmap decode.)
2. LCD layer on an HTML canvas: 480x272, lcd.* drawing functions Yaapu uses first
   (drawText, drawNumber, drawTimer, drawFilledRectangle, drawRectangle, drawLine, drawBitmap,
   setColor with CUSTOM_COLOR, RGB, sizeText), font-index flag math, alignment flags.
3. Lua in the browser (Fengari = Lua 5.3) plus shims: bit32, string.format behaviour, getValue,
   getTime, getGeneralSettings, model.*, widget lifecycle (create/update/refresh/background).
4. Controls: sliders for telemetry values, keys/PAGE buttons.
5. Load the Yaapu widget files from the SD layout and run the messages screen.
6. Compare against Companion screenshots (golden images) with a pixel diff.

## Done when
The messages screen and main screen of Yaapu render recognisably the same as Companion, with text
widths within 1px, and we know the list of lcd/getValue calls that are still missing.
