// EdgeTX 2.11+ "lvgl" Lua library, simulated.
// The radio keeps a tree of retained UI objects (labels, boxes, buttons...) and draws it itself; scripts only describe it.
// This is the same idea: the tree lives in Lua (so callbacks and tables behave exactly like on the radio) and is painted
// with the lcd.* functions after every frame. Parameters and behaviour follow radio/src/lua/api_colorlcd_lvgl.cpp and
// lua_lvgl_widget.cpp from EdgeTX. NOTE: keep this text free of backslashes, backticks and dollar-brace sequences.
export const LVGL_LUA = `
lvgl = {}
local TYPES = { "label", "rectangle", "circle", "arc", "hline", "vline", "line", "triangle", "image", "qrcode", "box",
  "button", "momentaryButton", "toggle", "textEdit", "numberEdit", "choice", "slider", "verticalSlider", "page",
  "font", "align", "color", "timer", "switch", "source", "file", "setting" }
local TYPE_NO, NAME_OF = {}, {}
for i, n in ipairs(TYPES) do TYPE_NO[string.lower(n)] = i; NAME_OF[i] = n; lvgl[string.upper(n)] = i end
local FIRST_CONTROL = TYPE_NO["button"]
local CONTROLS = { button = 1, momentarybutton = 1, toggle = 1, textedit = 1, numberedit = 1, choice = 1, slider = 1, verticalslider = 1,
  page = 1, font = 1, align = 1, color = 1, timer = 1, switch = 1, source = 1, file = 1, setting = 1 }
lvgl.FLOW_ROW = 0; lvgl.FLOW_COLUMN = 1
-- EdgeTX scales its layout constants on 320-wide and 800-wide landscape screens (etx_lv_theme.h LAYOUT_SCALE)
local function LS(x)
  if LCD_W > LCD_H then
    if LCD_W == 320 then return (x * 8 + 5) // 10 end
    if LCD_W == 800 then return (x * 11 + 4) // 8 end
  end
  return x
end
lvgl.LCD_SCALE = (LCD_W > LCD_H and LCD_W == 320) and 0.8 or ((LCD_W > LCD_H and LCD_W == 800) and 1.375 or 1.0)
lvgl.PAD_ZERO = 0; lvgl.PAD_TINY = LS(2); lvgl.PAD_SMALL = LS(4); lvgl.PAD_MEDIUM = LS(6); lvgl.PAD_LARGE = LS(8); lvgl.PAD_OUTLINE = LS(2); lvgl.PAD_BORDER = 2
lvgl.SCROLL_OFF = 0; lvgl.SCROLL_HOR = 3; lvgl.SCROLL_VER = 12; lvgl.SCROLL_ALL = 15
lvgl.UI_ELEMENT_HEIGHT = LS(32); lvgl.PAGE_BODY_HEIGHT = LCD_H - LS(45)
lvgl.PERCENT_SIZE = 0
for n, v in pairs({ SRC_ALL = -1, SRC_INPUT = 1, SRC_LUA = 2, SRC_STICK = 4, SRC_POT = 8, SRC_OTHER = 16, SRC_HELI = 32, SRC_TRIM = 64, SRC_SWITCH = 128,
  SRC_LOGICAL_SWITCH = 256, SRC_TRAINER = 512, SRC_CHANNEL = 1024, SRC_GVAR = 2048, SRC_TELEM = 4096, SRC_CLEAR = 8192, SRC_INVERT = 16384,
  SW_ALL = -1, SW_SWITCH = 1, SW_TRIM = 2, SW_LOGICAL_SWITCH = 4, SW_TELEM = 8, SW_OTHER = 16, SW_CLEAR = 32 }) do lvgl[n] = v end

local root = { kids = {}, root = true, t = "root", p = {}, x = 0, y = 0, w = LCD_W, h = LCD_H, sx = 0, sy = 0, sw = LCD_W, sh = LCD_H }
local nextId = 1
local full = true            -- tool scripts and full-screen widgets
lvgl.lastError = nil

-- ---------- helpers ----------
local function fail(where, e) lvgl.lastError = where .. ": " .. tostring(e) end
-- parameter that may be a value or a function returning one
local function val(o, k, d)
  local v = o.p[k]
  if type(v) == "function" then
    local ok, r = pcall(v)
    if not ok then fail(o.t .. "." .. k, r); return d end
    v = r
  end
  if v == nil then return d end
  return v
end
local function num(o, k, d) local v = val(o, k, d); return tonumber(v) or d end
local function call(o, k, ...)
  local f = o.p[k]
  if type(f) == "function" then
    local ok, r = pcall(f, ...)
    if not ok then fail(o.t .. "." .. k, r); return nil end
    return r
  end
end

-- ---------- objects ----------
local Obj = {}
Obj.__index = Obj
function Obj:set(params) for k, v in pairs(params or {}) do self.p[k] = v end end
function Obj:clear() for _, c in ipairs(self.kids) do c.dead = true end; self.kids = {} end
function Obj:show() self.hidden = false end
function Obj:hide() self.hidden = true end
function Obj:enable() self.disabled = false end
function Obj:disable() self.disabled = true end
function Obj:close() self.dead = true end
function Obj:build(defs) return lvgl.build(self, defs) end

local function make(parent, tname, params)
  if type(params) ~= "table" then error("bad argument #1 (table expected)", 3) end
  local no = TYPE_NO[string.lower(tname)]
  if not no then error("Invalid type '" .. tostring(tname) .. "'", 3) end
  if CONTROLS[string.lower(tname)] and not full then return nil end
  parent = parent or root
  local o = setmetatable({ t = NAME_OF[no], no = no, p = {}, kids = {}, parent = parent, id = nextId }, Obj)
  nextId = nextId + 1
  for k, v in pairs(params) do if k ~= "children" and k ~= "type" and k ~= "name" then o.p[k] = v end end
  o.p0 = {}   -- the literal values the script started with (used to find this object in the source text)
  for k, v in pairs(o.p) do local tv = type(v); if tv == "number" or tv == "string" or tv == "boolean" then o.p0[k] = v end end
  o.checked = params.checked and true or false
  local info = debug and debug.getinfo and debug.getinfo(3, "l")
  o.line = info and info.currentline or 0
  parent.kids[#parent.kids + 1] = o
  if type(params.children) == "table" then
    for _, def in ipairs(params.children) do
      local kid = lvgl.build(o, { def })
    end
  end
  return o
end

local function ctor(tname)
  return function(a, b)
    local parent, params = nil, a
    if b ~= nil then parent, params = a, b end
    local o = make(parent, tname, params) -- not a tail call, so debug.getinfo can see the caller's line
    return o
  end
end
for _, n in ipairs(TYPES) do
  if n ~= "page" then lvgl[n] = ctor(n) end
end
function lvgl.page(params) local o = make(nil, "page", params); return o end
for _, n in ipairs({ "dialog", "confirm", "message", "menu" }) do lvgl[n] = function() __unsupported("lvgl." .. n) end end

function lvgl.build(a, b)
  local parent, defs = nil, a
  if b ~= nil then parent, defs = a, b end
  local named = {}
  if type(defs) ~= "table" then return named end
  for _, def in ipairs(defs) do
    local t = def.type
    local tn = type(t) == "number" and NAME_OF[t] or t
    if tn == nil then error("Missing or bad type", 2) end
    local o = make(parent, tn, def)
    if o and def.name then named[def.name] = o end
  end
  return named
end
function lvgl.set(obj, params) if obj then obj:set(params) end end
function lvgl.clear(obj)
  if obj then obj:clear() else root:clear() end
end
function lvgl.show(o) if o then o.hidden = false end end
function lvgl.hide(o) if o then o.hidden = true end end
function lvgl.enable(o) if o then o.disabled = false end end
function lvgl.disable(o) if o then o.disabled = true end end
function lvgl.close(o) if o then o.dead = true end end
function lvgl.isAppMode() return false end
function lvgl.isFullScreen() return full end
function lvgl.exitFullScreen() end
function lvgl.getContext() return root end
function lvgl.getScrollPos() return 0, 0 end
function lvgl.getPerf() return 60, 10 end
function lvgl.__setFull(b) full = b and true or false end
function lvgl.__reset() root.kids = {}; nextId = 1; lvgl.lastError = nil end
function lvgl.__count() local n = 0; local function walk(o) for _, c in ipairs(o.kids) do n = n + 1; walk(c) end end; walk(root); return n end

-- ---------- sizes ----------
local function fontOf(o) return tonumber(val(o, "font", 0)) or 0 end
local function textSize(txt, font) local w, h = lcd.sizeText(txt, font); return w, h end
local BTN_H = lvgl.UI_ELEMENT_HEIGHT
-- natural size of an object that did not get explicit w / h
local function naturalSize(o)
  local t = o.t
  if t == "label" then return textSize(tostring(val(o, "text", "")), fontOf(o)) end
  if t == "button" or t == "momentaryButton" then
    local tw, th = textSize(tostring(val(o, "text", "")), fontOf(o)); return tw + 24, BTN_H
  end
  if t == "toggle" then return 52, BTN_H end
  if t == "slider" then return 120, BTN_H end
  if t == "verticalSlider" then return BTN_H, 120 end
  if t == "textEdit" or t == "numberEdit" or t == "choice" then return 100, BTN_H end
  if t == "setting" then return LCD_W, BTN_H end
  return 0, 0
end

-- ---------- layout + drawing ----------
local C = { text = COLOR_THEME_SECONDARY1, prim2 = COLOR_THEME_PRIMARY2, active = COLOR_THEME_ACTIVE, focus = COLOR_THEME_FOCUS,
  sec1 = COLOR_THEME_SECONDARY1, sec2 = COLOR_THEME_SECONDARY2, sec3 = COLOR_THEME_SECONDARY3, edit = COLOR_THEME_EDIT, warn = COLOR_THEME_WARNING }
local function colorOf(o, d) local c = val(o, "color", nil); if c == nil then return d end; return c end

local function size(o)
  local w, h = num(o, "w", 0), num(o, "h", 0)
  local sz = o.p.size
  if type(sz) == "function" then local ok, a, b = pcall(sz); if ok and a then w, h = a, b or h end end
  if o.t == "circle" or o.t == "arc" then local r = num(o, "radius", 0); return r * 2, r * 2 end
  if w == 0 or h == 0 then
    local nw, nh = naturalSize(o)
    if w == 0 then w = nw end
    if h == 0 then h = nh end
  end
  if o.t == "hline" then return w, math.max(1, h) end
  if o.t == "vline" then return math.max(1, w), h end
  return w, h
end
local function pos(o)
  local x, y = num(o, "x", 0), num(o, "y", 0)
  local ps = o.p.pos
  if type(ps) == "function" then local ok, a, b = pcall(ps); if ok and a then x, y = a, b or y end end
  return x, y
end

local function roundRect(x, y, w, h, r, c)
  r = math.min(r, math.floor(math.min(w, h) / 2))
  if r <= 1 then lcd.drawFilledRectangle(x, y, w, h, c); return end
  lcd.drawFilledRectangle(x + r, y, w - 2 * r, h, c)
  lcd.drawFilledRectangle(x, y + r, r, h - 2 * r, c)
  lcd.drawFilledRectangle(x + w - r, y + r, r, h - 2 * r, c)
  lcd.drawFilledCircle(x + r, y + r, r, c); lcd.drawFilledCircle(x + w - r - 1, y + r, r, c)
  lcd.drawFilledCircle(x + r, y + h - r - 1, r, c); lcd.drawFilledCircle(x + w - r - 1, y + h - r - 1, r, c)
end

local function alignedX(o, x, w, tw)
  local a = tonumber(val(o, "align", 0)) or 0
  if w and w > 0 then
    if a & RIGHT ~= 0 then return x + w - tw end
    if a & CENTER ~= 0 then return x + (w - tw) // 2 end
  end
  return x
end

-- place the children of a flex box (row or column); returns a table child -> {x, y}
local function flexPlace(box, bw, bh)
  local flow = box.p.flexFlow
  local pad = tonumber(box.p.flexPad) or lvgl.PAD_OUTLINE
  local bp = box.p.borderPad
  local bl, br, bt, bb = lvgl.PAD_OUTLINE, lvgl.PAD_OUTLINE, lvgl.PAD_OUTLINE, lvgl.PAD_OUTLINE
  if type(bp) == "number" then bl, br, bt, bb = bp, bp, bp, bp
  elseif type(bp) == "table" then bl, br, bt, bb = bp.left or 0, bp.right or 0, bp.top or 0, bp.bottom or 0 end
  local al = tonumber(val(box, "align", 0)) or 0
  local places, vis, total = {}, {}, 0
  for _, k in ipairs(box.kids) do
    if not k.dead and not k.hidden and val(k, "visible", true) ~= false then
      local w, h = size(k); vis[#vis + 1] = { k = k, w = w, h = h }
    end
  end
  local col = (flow == lvgl.FLOW_COLUMN)
  for i, v in ipairs(vis) do total = total + (col and v.h or v.w) + (i > 1 and pad or 0) end
  local innerW, innerH = bw - bl - br, bh - bt - bb
  local cursor = col and bt or bl
  local mainSize = col and innerH or innerW
  -- main axis start/center/end
  local startOff = 0
  if col then
    if al & VCENTER ~= 0 then startOff = (innerH - total) // 2 elseif al & VBOTTOM ~= 0 then startOff = innerH - total end
  else
    if al & RIGHT ~= 0 then startOff = innerW - total elseif al & CENTER ~= 0 then startOff = (innerW - total) // 2 end
  end
  if startOff < 0 then startOff = 0 end
  cursor = cursor + startOff
  for _, v in ipairs(vis) do
    local cross
    if col then
      if al & RIGHT ~= 0 then cross = bw - br - v.w elseif al & CENTER ~= 0 then cross = bl + (innerW - v.w) // 2 else cross = bl end
      places[v.k] = { cross, cursor }
      cursor = cursor + v.h + pad
    else
      if al & VCENTER ~= 0 then cross = bt + (innerH - v.h) // 2 elseif al & VBOTTOM ~= 0 then cross = bh - bb - v.h else cross = bt end
      places[v.k] = { cursor, cross }
      cursor = cursor + v.w + pad
    end
  end
  return places
end

local drawObj
local function drawKids(o, ox, oy, ow, oh)
  local places
  if o.p.flexFlow ~= nil and o.t ~= "root" then places = flexPlace(o, ow, oh) end
  for _, k in ipairs(o.kids) do
    if not k.dead then drawObj(k, ox, oy, ow, oh, places and places[k]) end
  end
end

drawObj = function(o, px, py, pw, ph, flex)
  if o.hidden or val(o, "visible", true) == false then return end
  local t = o.t
  local x, y = pos(o)
  local w, h = size(o)
  if flex then x, y = flex[1], flex[2] end
  -- boxes with a negative size grow up/left from x, y
  if (t == "box" or t == "rectangle") and w < 0 then w = -w; x = x - w + 1 end
  if (t == "box" or t == "rectangle") and h < 0 then h = -h; y = y - h + 1 end
  -- vertical alignment of labels inside the parent
  if t == "label" then
    local a = tonumber(val(o, "align", 0)) or 0
    if a & VCENTER ~= 0 then y = (ph - h) // 2 elseif a & VBOTTOM ~= 0 then y = ph - h end
  end
  local ax, ay = px + x, py + y
  o.sx, o.sy, o.sw, o.sh = ax, ay, w, h
  local color = colorOf(o, nil)
  local disabled = o.disabled
  local innerOx, innerOy = ax, ay
  if t == "label" then
    local txt = tostring(val(o, "text", ""))
    local f = fontOf(o)
    local tw = textSize(txt, f)
    local a = tonumber(val(o, "align", 0)) or 0
    lcd.drawText(alignedX(o, ax, w, tw), ay, txt, f | (color or C.sec1))
  elseif t == "rectangle" then
    local th = num(o, "thickness", 1)
    local c = color or C.sec1
    local rd = num(o, "rounded", 0)
    if val(o, "filled", false) then
      if rd > 0 then roundRect(ax, ay, w, h, rd, c) else lcd.drawFilledRectangle(ax, ay, w, h, c) end
    else
      if rd > 0 and th <= 1 then
        roundRect(ax, ay, w, h, rd, c); roundRect(ax + th, ay + th, w - 2 * th, h - 2 * th, math.max(0, rd - th), C.sec3)
        o.holeWarn = true
      else lcd.drawRectangle(ax, ay, w, h, c, th) end
      innerOx, innerOy = ax + th, ay + th
    end
  elseif t == "circle" then
    local r = num(o, "radius", 0)
    local c = color or C.sec1
    if val(o, "filled", false) then lcd.drawFilledCircle(ax + r, ay + r, r, c)
    else
      local th = num(o, "thickness", 1)
      if th <= 1 then lcd.drawCircle(ax + r, ay + r, r, c) else lcd.drawAnnulus(ax + r, ay + r, r - th, r, 0, 360, c) end
    end
  elseif t == "arc" then
    local r = num(o, "radius", 0)
    local th = num(o, "thickness", 1)
    local cx, cy = ax + r, ay + r
    local bgc = val(o, "bgColor", nil)
    if bgc and num(o, "bgOpacity", 0) > 0 then
      lcd.drawAnnulus(cx, cy, r - th, r, num(o, "bgStartAngle", 0) + 90, num(o, "bgEndAngle", 360) + 90, bgc)
    end
    -- LVGL measures from 3 o'clock; the lcd functions measure from 12 o'clock
    lcd.drawAnnulus(cx, cy, r - th, r, num(o, "startAngle", 0) + 90, num(o, "endAngle", 360) + 90, color or C.sec1)
  elseif t == "hline" then
    local c = color or C.sec1
    local dg, dw = num(o, "dashGap", 0), num(o, "dashWidth", 0)
    if dg > 0 and dw > 0 then
      local xx = 0
      while xx < w do lcd.drawFilledRectangle(ax + xx, ay, math.min(dw, w - xx), h, c); xx = xx + dw + dg end
    else lcd.drawFilledRectangle(ax, ay, w, h, c) end
  elseif t == "vline" then
    local c = color or C.sec1
    local dg, dw = num(o, "dashGap", 0), num(o, "dashWidth", 0)
    if dg > 0 and dw > 0 then
      local yy = 0
      while yy < h do lcd.drawFilledRectangle(ax, ay + yy, w, math.min(dw, h - yy), c); yy = yy + dw + dg end
    else lcd.drawFilledRectangle(ax, ay, w, h, c) end
  elseif t == "line" or t == "triangle" then
    local pts = val(o, "pts", nil)
    local c = color or C.sec1
    if type(pts) == "table" then
      local x1, y1, x2, y2, bx, by, bx2, by2
      if t == "triangle" and #pts >= 3 then
        lcd.drawFilledTriangle(px + pts[1][1], py + pts[1][2], px + pts[2][1], py + pts[2][2], px + pts[3][1], py + pts[3][2], c)
      elseif t == "line" then
        local th = num(o, "thickness", 1)
        for i = 1, #pts - 1 do
          for d = 0, th - 1 do
            local off = d - (th - 1) // 2
            lcd.drawLine(px + pts[i][1], py + pts[i][2] + off, px + pts[i + 1][1], py + pts[i + 1][2] + off, SOLID, c)
          end
        end
      end
      local minx, miny, maxx, maxy = 9999, 9999, -9999, -9999
      for _, p in ipairs(pts) do minx = math.min(minx, p[1]); miny = math.min(miny, p[2]); maxx = math.max(maxx, p[1]); maxy = math.max(maxy, p[2]) end
      if minx <= maxx then ax, ay, w, h = px + minx, py + miny, maxx - minx + 1, maxy - miny + 1; o.sx, o.sy, o.sw, o.sh = ax, ay, w, h end
    end
  elseif t == "box" then
    if color then lcd.drawFilledRectangle(ax, ay, w, h, color) end
  elseif t == "button" or t == "momentaryButton" then
    local bg = colorOf(o, C.prim2)
    if o.checked or o.down then bg = C.active end
    if disabled or call(o, "active") == false then bg = C.sec2 end
    roundRect(ax, ay, w, h, num(o, "cornerRadius", 6), bg)
    local f = fontOf(o)
    local txt = tostring(val(o, "text", ""))
    local tw, th = textSize(txt, f)
    local tc = val(o, "textColor", nil) or C.sec1
    lcd.drawText(ax + (w - tw) // 2, ay + (h - th) // 2, txt, f | tc)
  elseif t == "toggle" then
    local g = o.p.get; local on = false
    if type(g) == "function" then local ok, r = pcall(g); if ok then on = (r == true or r == 1) else fail("toggle.get", r) end else on = o.on and true or false end
    o.on = on
    local kw = h - 6
    roundRect(ax, ay + 2, w, h - 4, (h - 4) // 2, on and C.active or C.sec2)
    local kx = on and (ax + w - kw - 3) or (ax + 3)
    lcd.drawFilledCircle(kx + kw // 2, ay + h // 2, kw // 2 - 1, C.sec1)
  elseif t == "slider" or t == "verticalSlider" then
    local mn, mx = num(o, "min", 0), num(o, "max", 100)
    local g = o.p.get; local v = o.v or mn
    if type(g) == "function" then local ok, r = pcall(g); if ok and tonumber(r) then v = tonumber(r) else if not ok then fail("slider.get", r) end end end
    o.v = v
    local f = (mx > mn) and math.max(0, math.min(1, (v - mn) / (mx - mn))) or 0
    if t == "slider" then
      local ty = ay + h // 2
      lcd.drawFilledRectangle(ax + 6, ty - 2, w - 12, 5, C.sec2)
      lcd.drawFilledRectangle(ax + 6, ty - 2, math.floor((w - 12) * f), 5, C.active)
      lcd.drawFilledCircle(ax + 6 + math.floor((w - 12) * f), ty, 8, C.sec1)
    else
      local tx = ax + w // 2
      lcd.drawFilledRectangle(tx - 2, ay + 6, 5, h - 12, C.sec2)
      local fh = math.floor((h - 12) * f)
      lcd.drawFilledRectangle(tx - 2, ay + h - 6 - fh, 5, fh, C.active)
      lcd.drawFilledCircle(tx, ay + h - 6 - fh, 8, C.sec1)
    end
  elseif t == "textEdit" or t == "numberEdit" or t == "choice" then
    roundRect(ax, ay, w, h, 6, C.sec2)
    local txt
    if t == "textEdit" then txt = tostring(val(o, "value", ""))
    elseif t == "numberEdit" then
      local g = o.p.get; local v = 0
      if type(g) == "function" then local ok, r = pcall(g); if ok then v = r end end
      local d = o.p.display
      if type(d) == "function" then local ok, r = pcall(d, v); if ok then txt = tostring(r) end end
      txt = txt or tostring(v)
    else
      local g = o.p.get; local i = 1
      if type(g) == "function" then local ok, r = pcall(g); if ok then i = r end end
      local vs = o.p.values or {}
      txt = tostring(vs[i] or "")
    end
    local tw, th = textSize(txt, 0)
    lcd.drawText(ax + 8, ay + (h - th) // 2, txt, C.sec1)
  elseif t == "setting" then
    lcd.drawText(ax + 4, ay + (h - 16) // 2, tostring(val(o, "title", "")), C.text)
  else
    -- images, QR codes and pickers are not drawn yet: show a placeholder so the layout is still visible
    __unsupported("lvgl." .. t)
    lcd.drawRectangle(ax, ay, math.max(w, 8), math.max(h, 8), C.sec2, 1)
    lcd.drawText(ax + 2, ay + 2, t, SMLSIZE | C.sec2)
  end
  __lvgl_item(o.id, t, ax, ay, w, h, o.line, flex ~= nil)
  for k, v in pairs(o.p0) do __lvgl_field(o.id, k, v) end
  if #o.kids > 0 then drawKids(o, innerOx, innerOy, w, h) end
end

function lvgl.__draw() drawKids(root, 0, 0, LCD_W, LCD_H) end

-- ---------- touch input ----------
local function hit(o, x, y)
  if o.dead or o.hidden or not o.sx then return nil end
  for i = #o.kids, 1, -1 do local r = hit(o.kids[i], x, y); if r then return r end end
  if CONTROLS[string.lower(o.t)] and x >= o.sx and x < o.sx + o.sw and y >= o.sy and y < o.sy + o.sh then
    if o.disabled or call(o, "active") == false then return nil end
    return o
  end
end
local pressed
function lvgl.__touch(kind, x, y)
  if kind == "down" then
    local o = hit(root, x, y)
    pressed = o
    if o then
      if o.t == "momentaryButton" then o.down = true; call(o, "press") end
      if o.t == "button" then o.down = true end
      if o.t == "slider" or o.t == "verticalSlider" then o.drag = true end
    end
  end
  local o = pressed
  if o and (kind == "down" or kind == "move") and o.drag then
    local mn, mx = num(o, "min", 0), num(o, "max", 100)
    local f
    if o.t == "slider" then f = (x - o.sx - 6) / math.max(1, o.sw - 12) else f = 1 - (y - o.sy - 6) / math.max(1, o.sh - 12) end
    f = math.max(0, math.min(1, f))
    local v = math.floor(mn + (mx - mn) * f + 0.5)
    o.v = v; call(o, "set", v)
  end
  if kind == "up" and o then
    local inside = x >= o.sx and x < o.sx + o.sw and y >= o.sy and y < o.sy + o.sh
    if o.t == "momentaryButton" then o.down = false; call(o, "release")
    elseif o.t == "button" then
      o.down = false
      if inside then local r = call(o, "press"); o.checked = (tonumber(r) or 0) ~= 0 end
    elseif o.t == "toggle" and inside then o.on = not o.on; call(o, "set", o.on and 1 or 0)
    end
    o.drag = false
    pressed = nil
  end
end
`;
