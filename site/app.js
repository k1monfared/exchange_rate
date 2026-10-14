const UNIT = { toman: 10, rial: 1 }

let INDEX = null
let SNAPSHOTS = {}    // date -> snapshot (loaded lazily)
let HISTORY = null    // consolidated daily series for the chart
let UNIT_DIVISOR = UNIT.toman
let CURRENT_DATE = "" // date selected in the calendar (ISO yyyy-mm-dd)
let DAY = []          // merged records for CURRENT_DATE (snapshot + history)
let CAL = "gregorian" // display calendar: "gregorian" or "jalali"
let VIEW_ANCHOR = ""  // ISO date anchoring the month shown in the calendar

async function getJson(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: ${r.status}`)
  return r.json()
}

/* --- Jalali (Persian) calendar, algorithm from jalaali-js (MIT) --- */
function jdiv(a, b) { return ~~(a / b) }
function jmod(a, b) { return a - ~~(a / b) * b }
const JALAALI_BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178]

function jalCal(jy, withoutLeap) {
  const bl = JALAALI_BREAKS.length
  const gy = jy + 621
  let leapJ = -14
  let jp = JALAALI_BREAKS[0]
  let jm, jump, leap, leapG, march, n
  if (jy < jp || jy >= JALAALI_BREAKS[bl - 1]) throw new Error("invalid jalali year " + jy)
  for (let i = 1; i < bl; i += 1) {
    jm = JALAALI_BREAKS[i]
    jump = jm - jp
    if (jy < jm) break
    leapJ = leapJ + jdiv(jump, 33) * 8 + jdiv(jmod(jump, 33), 4)
    jp = jm
  }
  n = jy - jp
  leapJ = leapJ + jdiv(n, 33) * 8 + jdiv(jmod(n, 33) + 3, 4)
  if (jmod(jump, 33) === 4 && jump - n === 4) leapJ += 1
  leapG = jdiv(gy, 4) - jdiv((jdiv(gy, 100) + 1) * 3, 4) - 150
  march = 20 + leapJ - leapG
  if (!withoutLeap) {
    if (jump - n < 6) n = n - jump + jdiv(jump + 4, 33) * 33
    leap = jmod(jmod(n + 1, 33) - 1, 4)
    if (leap === -1) leap = 4
  }
  return { leap, gy, march }
}

function jG2D(gy, gm, gd) {
  let d = jdiv((gy + jdiv(gm - 8, 6) + 100100) * 1461, 4) + jdiv(153 * jmod(gm + 9, 12) + 2, 5) + gd - 34840408
  d = d - jdiv(jdiv(gy + 100100 + jdiv(gm - 8, 6), 100) * 3, 4) + 752
  return d
}

function jD2G(jdn) {
  let j = 4 * jdn + 139361631
  j = j + jdiv(jdiv(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908
  const i = jdiv(jmod(j, 1461), 4) * 5 + 308
  const gd = jdiv(jmod(i, 153), 5) + 1
  const gm = jmod(jdiv(i, 153), 12) + 1
  const gy = jdiv(j, 1461) - 100100 + jdiv(8 - gm, 6)
  return { gy, gm, gd }
}

function jJ2D(jy, jm, jd) {
  const r = jalCal(jy, true)
  return jG2D(r.gy, 3, r.march) + (jm - 1) * 31 - jdiv(jm, 7) * (jm - 7) + jd - 1
}

function jD2J(jdn) {
  const gy = jD2G(jdn).gy
  let jy = gy - 621
  const r = jalCal(jy, false)
  const jdn1f = jG2D(gy, 3, r.march)
  let k = jdn - jdn1f
  let jd, jm
  if (k >= 0) {
    if (k <= 185) { jm = 1 + jdiv(k, 31); jd = jmod(k, 31) + 1; return { jy, jm, jd } }
    k -= 186
  } else {
    jy -= 1
    k += 179
    if (r.leap === 1) k += 1
  }
  jm = 7 + jdiv(k, 30)
  jd = jmod(k, 30) + 1
  return { jy, jm, jd }
}

function isoToJalali(iso) {
  const [y, m, d] = iso.split("-").map(Number)
  return jD2J(jG2D(y, m, d))
}

function jalaliToIso(jy, jm, jd) {
  const g = jD2G(jJ2D(jy, jm, jd))
  return `${g.gy}-${String(g.gm).padStart(2, "0")}-${String(g.gd).padStart(2, "0")}`
}

function jalaliMonthLength(jy, jm) {
  if (jm <= 6) return 31
  if (jm <= 11) return 30
  return jalCal(jy, false).leap === 0 ? 30 : 29
}

const GREG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const JALALI_MONTHS = ["Farvardin", "Ordibehesht", "Khordad", "Tir", "Mordad", "Shahrivar", "Mehr", "Aban", "Azar", "Dey", "Bahman", "Esfand"]
const JALALI_MONTHS_FA = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"]
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/

function faDigits(s) { return String(s).replace(/[0-9]/g, d => FA_DIGITS[+d]) }

// stored dates are Gregorian ISO (date or datetime); anything else returned verbatim
function fmtDate(iso) {
  if (!iso) return "-"
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso)
  if (!m) return iso
  const g = m[1]
  if (CAL === "gregorian") return g
  const j = isoToJalali(g)
  return faDigits(`${j.jy}/${String(j.jm).padStart(2, "0")}/${String(j.jd).padStart(2, "0")}`)
}

function fmt(rial) {
  if (rial === null || rial === undefined) return "-"
  const v = rial / UNIT_DIVISOR
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function unitName() { return UNIT_DIVISOR === UNIT.toman ? "toman" : "rial" }

function records() { return DAY }

function sideValue(rec, side) {
  if (!rec) return null
  if (rec.pair_to !== "IRR") return rec.value
  if (side === "mid") {
    if (rec.buy_rial != null && rec.sell_rial != null) return (rec.buy_rial + rec.sell_rial) / 2
    if (rec.price_rial != null) return rec.price_rial
    return null
  }
  const v = side === "buy" ? rec.buy_rial : rec.sell_rial
  if (v != null) return v
  return rec.price_rial != null ? rec.price_rial : null
}

function legIrr(cur, sourceId, side) {
  if (cur === "IRR") return 1
  if (sourceId === "average") { return averageLeg(cur, side) }
  const rec = records().find(r =>
    r.source_id === sourceId && r.pair_from === cur && r.pair_to === "IRR" && r.kind !== "estimate")
  return sideValue(rec, side)
}

function averageLeg(cur, side) {
  const vals = []
  for (const id of enabledSourceIds()) {
    const rec = records().find(r => r.source_id === id && r.pair_from === cur && r.pair_to === "IRR")
    const v = sideValue(rec, side)
    if (v != null) vals.push(v)
  }
  if (!vals.length) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

function directPair(from, to, sourceId, side) {
  const rec = records().find(r => r.source_id === sourceId && r.pair_from === from && r.pair_to === to)
  if (rec && rec.pair_to !== "IRR" && rec.value) return 1 / rec.value
  return null
}

function rate(from, to, sourceId, side) {
  if (from === to) return 1

  if (sourceId === "estimate") {
    const cadRec = records().find(x => x.source_id === "cad_estimate")
    const gfxRec = records().find(x => x.source_id === "globalfx")
    const cadIrr = sideValue(cadRec, side)
    const usdIrr = averageLeg("USD", side)
    const gfx = gfxRec ? gfxRec.value : null
    if (from === "CAD" && to === "IRR") return cadIrr
    if (from === "IRR" && to === "CAD") return cadIrr != null ? 1 / cadIrr : null
    if (from === "USD" && to === "IRR") return usdIrr
    if (from === "IRR" && to === "USD") return usdIrr != null ? 1 / usdIrr : null
    if (from === "USD" && to === "CAD") {
      if (gfx != null) return 1 / gfx
      return (cadIrr != null && usdIrr != null) ? usdIrr / cadIrr : null
    }
    if (from === "CAD" && to === "USD") {
      if (gfx != null) return gfx
      return (cadIrr != null && usdIrr != null) ? cadIrr / usdIrr : null
    }
    return null
  }

  if (sourceId === "average") {
    const a = legIrr(from, "average", side)
    const b = legIrr(to, "average", side)
    if (a == null || b == null) return null
    return a / b
  }

  const dp = directPair(from, to, sourceId, side)
  if (dp != null) return dp
  const a = legIrr(from, sourceId, side)
  const b = legIrr(to, sourceId, side)
  if (a == null || b == null) return null
  return a / b
}

function allSourceIds() {
  const h = (HISTORY && HISTORY.sources) ? historySourceIds() : []
  const idx = (INDEX && INDEX.sources ? INDEX.sources : []).map(s => s.source_id)
  return [...new Set([...h, ...idx])].filter(id => id !== "globalfx")
}

function checkedValues(hostId, allValues) {
  const boxes = [...document.querySelectorAll(`#${hostId} input:checked`)]
  if (boxes.length) return boxes.map(b => b.value)
  return allValues
}

function currencyOfSeries(series) {
  if (series.pair_from === "CAD") return "CAD"
  if (series.pair_from === "USD" || series.pair_from === "USDT") return "USD"
  return series.pair_from
}

function currencyOfRecord(r) {
  if (r.pair_from === "CAD") return "CAD"
  if (r.pair_from === "USD" || r.pair_from === "USDT") return "USD"
  return r.pair_from
}

function historyCurrencies() {
  if (!HISTORY || !HISTORY.sources) return []
  return [...new Set(Object.values(HISTORY.sources).map(currencyOfSeries))]
}

function enabledCurrencies() { return checkedValues("currency-toggles", historyCurrencies()) }
function enabledSides() { return checkedValues("side-toggles", ["buy", "sell", "mid"]) }
function enabledSourceIds() { return checkedValues("source-toggles", allSourceIds()) }

/* --- date availability and the daily record view --- */
function historyAvail(sourceId) {
  const s = new Set()
  if (!HISTORY || !HISTORY.sources) return s
  for (const series of Object.values(HISTORY.sources)) {
    if (series.source_id !== sourceId) continue
    for (const d of Object.keys(series.points)) s.add(d)
  }
  return s
}

function snapshotAvail(sourceId) {
  return (INDEX && INDEX.source_dates && INDEX.source_dates[sourceId]) ? INDEX.source_dates[sourceId] : []
}

function availability(sourceId) {
  const s = new Set()
  if (sourceId === "average") {
    for (const id of allSourceIds()) for (const d of availability(id)) s.add(d)
    return s
  }
  if (sourceId === "estimate") {
    for (const id of ["cad_estimate", "globalfx"]) {
      for (const d of historyAvail(id)) s.add(d)
      for (const d of snapshotAvail(id)) s.add(d)
    }
    return s
  }
  for (const d of historyAvail(sourceId)) s.add(d)
  for (const d of snapshotAvail(sourceId)) s.add(d)
  return s
}

function latestDate() {
  if (INDEX && INDEX.latest) return INDEX.latest
  const all = HISTORY ? historyDates() : []
  return all.length ? all[all.length - 1] : ""
}

function seriesPoint(sourceId, pair, date) {
  if (!HISTORY) return null
  const s = HISTORY.sources[sourceId + ":" + pair]
  return s ? (s.points[date] || null) : null
}

function cadInputs(date) {
  const inputs = []
  const usd = seriesPoint("bonbast_archive", "USD", date)
  const gfx = seriesPoint("globalfx", "USD", date)
  if (usd && usd[1] != null) inputs.push({ source_id: "bonbast_archive", value: usd[1], kind: "exact", verify_url: "https://bonbast.com/graph/usd", unit: "rial", leg: "sell" })
  if (usd && usd[0] != null && usd[0] !== usd[1]) inputs.push({ source_id: "bonbast_archive", value: usd[0], kind: "exact", verify_url: "https://bonbast.com/graph/usd", unit: "rial", leg: "buy" })
  if (gfx && gfx[2] != null) inputs.push({ source_id: "globalfx", value: gfx[2], kind: "exact", verify_url: "https://api.frankfurter.dev/v1/latest?base=USD&symbols=CAD", unit: "ratio" })
  return inputs
}

async function loadDay(date) {
  CURRENT_DATE = date || ""
  const recs = []
  if (date && INDEX && (INDEX.dates || []).includes(date)) {
    if (!(date in SNAPSHOTS)) {
      try { SNAPSHOTS[date] = await getJson(`./data/snapshots/${date}.json`) }
      catch (_) { SNAPSHOTS[date] = null }
    }
    const snap = SNAPSHOTS[date]
    if (snap) for (const r of (snap.records || [])) recs.push(r)
  }
  const seen = new Set(recs.map(r => r.source_id + "|" + r.pair_from))
  if (date && HISTORY && HISTORY.sources) {
    for (const series of Object.values(HISTORY.sources)) {
      const p = series.points[date]
      if (!p) continue
      if (series.pair_to !== "IRR") {
        if (series.source_id === "globalfx" && !seen.has("globalfx|USD")) {
          recs.push({ source_id: "globalfx", kind: "exact", pair_from: "USD", pair_to: "CAD", value: 1 / p[2], as_of: date, verify_url: series.verify_url, status: "ok", raw: {} })
          seen.add("globalfx|USD")
        }
        continue
      }
      const key = series.source_id + "|" + series.pair_from
      if (seen.has(key)) continue
      const rec = {
        source_id: series.source_id, kind: series.kind, pair_from: series.pair_from, pair_to: "IRR",
        buy_rial: p[0], sell_rial: p[1], price_rial: p[2], as_of: date,
        verify_url: series.verify_url, source_url: series.verify_url, status: "ok", raw: {},
      }
      if (series.source_id === "cad_estimate") {
        rec.formula = "sell: IRR_per_CAD = USD_sell / CAD_per_USD ; buy: IRR_per_CAD = USD_buy / CAD_per_USD"
        rec.inputs = cadInputs(date)
      }
      recs.push(rec)
      seen.add(key)
    }
  }
  DAY = recs
}

/* --- calendar --- */
function currentSourceId() { return document.getElementById("calc-source").value }
function allDatesFor(sourceId) {
  const s = new Set(availability(sourceId))
  for (const d of (INDEX.dates || [])) s.add(d)
  return [...s].sort()
}

function renderCalendar() {
  const grid = document.getElementById("cal-grid")
  const wrap = document.querySelector(".calendar-wrap")
  if (wrap) wrap.setAttribute("dir", CAL === "jalali" ? "rtl" : "ltr")
  const src = currentSourceId()
  const avail = availability(src)
  if (!VIEW_ANCHOR) VIEW_ANCHOR = CURRENT_DATE || latestDate() || "2026-01-01"
  const days = []
  let title = ""
  let dowLabels
  let firstIso

  if (CAL === "gregorian") {
    const y = +VIEW_ANCHOR.slice(0, 4), m = +VIEW_ANCHOR.slice(5, 7)
    title = `${GREG_MONTHS[m - 1]} ${y}`
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate()
    firstIso = `${y}-${String(m).padStart(2, "0")}-01`
    for (let d = 1; d <= dim; d++) days.push({ iso: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, label: d })
    dowLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  } else {
    const j = isoToJalali(VIEW_ANCHOR)
    title = `${JALALI_MONTHS_FA[j.jm - 1]} ${faDigits(j.jy)}`
    const jmLen = jalaliMonthLength(j.jy, j.jm)
    firstIso = jalaliToIso(j.jy, j.jm, 1)
    for (let d = 1; d <= jmLen; d++) days.push({ iso: jalaliToIso(j.jy, j.jm, d), label: d })
    dowLabels = ["ش", "ی", "د", "س", "چ", "پ", "ج"]
  }

  const rawDow = new Date(firstIso + "T00:00:00Z").getUTCDay() // 0 = Sun
  const pad = (CAL === "gregorian") ? rawDow : (rawDow + 1) % 7 // Sat = 0 for jalali

  document.getElementById("cal-title").textContent = title

  let html = dowLabels.map(d => `<span class="cal-dow">${d}</span>`).join("")
  for (let i = 0; i < pad; i++) html += `<span class="cal-empty"></span>`
  for (const day of days) {
    const on = avail.has(day.iso)
    const sel = day.iso === CURRENT_DATE
    const label = CAL === "jalali" ? faDigits(day.label) : day.label
    html += `<button type="button" class="cal-day${on ? "" : " off"}${sel ? " sel" : ""}" data-date="${day.iso}" ${on ? "" : "disabled"}>${label}</button>`
  }
  grid.innerHTML = html
  grid.querySelectorAll("button.cal-day:not([disabled])").forEach(b =>
    b.addEventListener("click", () => selectDate(b.dataset.date)))
}

function shiftMonth(delta) {
  if (!VIEW_ANCHOR) return
  if (CAL === "gregorian") {
    let y = +VIEW_ANCHOR.slice(0, 4), m = +VIEW_ANCHOR.slice(5, 7) + delta
    while (m < 1) { m += 12; y -= 1 }
    while (m > 12) { m -= 12; y += 1 }
    VIEW_ANCHOR = `${y}-${String(m).padStart(2, "0")}-01`
  } else {
    const j = isoToJalali(VIEW_ANCHOR)
    let jy = j.jy, jm = j.jm + delta
    while (jm < 1) { jm += 12; jy -= 1 }
    while (jm > 12) { jm -= 12; jy += 1 }
    VIEW_ANCHOR = jalaliToIso(jy, jm, 1)
  }
  renderCalendar()
}

function calYearRange() {
  const dates = (HISTORY && HISTORY.sources) ? historyDates() : []
  const first = dates[0] || "1999-01-01"
  const last = dates[dates.length - 1] || "2026-12-31"
  if (CAL === "gregorian") return { min: +first.slice(0, 4), max: +last.slice(0, 4) }
  return { min: isoToJalali(first).jy, max: isoToJalali(last).jy }
}

function openCalModal() {
  const jalali = CAL === "jalali"
  const months = jalali ? JALALI_MONTHS_FA : GREG_MONTHS
  const mSel = document.getElementById("pick-month")
  mSel.innerHTML = months.map((mn, i) => `<option value="${i + 1}">${mn}</option>`).join("")
  const yr = calYearRange()
  const ySel = document.getElementById("pick-year")
  let opts = ""
  for (let y = yr.min; y <= yr.max; y++) opts += `<option value="${y}">${jalali ? faDigits(y) : y}</option>`
  ySel.innerHTML = opts
  if (jalali) {
    const j = isoToJalali(VIEW_ANCHOR)
    mSel.value = String(j.jm)
    ySel.value = String(j.jy)
  } else {
    mSel.value = String(+VIEW_ANCHOR.slice(5, 7))
    ySel.value = String(+VIEW_ANCHOR.slice(0, 4))
  }
  document.getElementById("cal-modal").showModal()
}

function applyCalModal() {
  const jalali = CAL === "jalali"
  const m = +document.getElementById("pick-month").value
  const y = +document.getElementById("pick-year").value
  VIEW_ANCHOR = jalali ? jalaliToIso(y, m, 1) : `${y}-${String(m).padStart(2, "0")}-01`
  renderCalendar()
}

async function selectDate(date) {
  await loadDay(date)
  renderCalendar()
  convert()
  renderTables()
}

function ensureDateAvailable() {
  const avail = availability(currentSourceId())
  if (!CURRENT_DATE || !avail.has(CURRENT_DATE)) {
    const sorted = [...avail].sort()
    CURRENT_DATE = sorted.length ? sorted[sorted.length - 1] : ""
  }
  VIEW_ANCHOR = CURRENT_DATE || VIEW_ANCHOR
}

/* --- calculator --- */
function provLine(r) {
  const verify = r.verify_url
    ? ` &middot; <a href="${esc(r.verify_url)}" target="_blank" rel="noopener">verify</a>`
    : ""
  const asof = r.as_of ? ` &middot; as of ${esc(fmtDate(r.as_of))}` : ""
  return `${badge(r)}${verify}${asof}`
}

function estimateBacking(from, to) {
  if ((from === "USD" && to === "CAD") || (from === "CAD" && to === "USD")) {
    return records().find(r => r.source_id === "globalfx")
  }
  if (from === "CAD" || to === "CAD") {
    return records().find(r => r.source_id === "cad_estimate")
  }
  return null
}

function backingFor(from, to, sourceId) {
  for (const cur of [from, to]) {
    if (cur === "IRR") continue
    const rec = records().find(r =>
      r.source_id === sourceId && r.pair_from === cur && r.pair_to === "IRR" && r.kind !== "estimate")
    if (rec) return rec
  }
  return records().find(r => r.source_id === sourceId)
}

function averageInputs(ids) {
  return ids.map(id => {
    const r = records().find(x => x.source_id === id)
    return { source_id: id, kind: r ? r.kind : "unknown", value: "", verify_url: r ? r.verify_url : "" }
  })
}

function convertProvenance(from, to, sourceId) {
  if (sourceId === "average") {
    const ids = enabledSourceIds()
    const phony = { kind: "estimate", formula: "average of enabled sources' chosen side", inputs: averageInputs(ids) }
    return `${badge(phony)} <span>estimate over: ${esc(ids.join(", "))}</span>`
  }
  if (sourceId === "estimate") {
    const rec = estimateBacking(from, to)
    if (rec) return provLine(rec)
    const ids = enabledSourceIds()
    const phony = { kind: "estimate", formula: "derived from enabled sources", inputs: averageInputs(ids) }
    return `${badge(phony)} <span>estimate over: ${esc(ids.join(", "))}</span>`
  }
  const rec = backingFor(from, to, sourceId)
  return rec ? provLine(rec) : ""
}

function convert() {
  const from = document.getElementById("calc-from").value
  const to = document.getElementById("calc-to").value
  const sourceId = document.getElementById("calc-source").value
  const side = document.getElementById("calc-side").value
  const amount = parseFloat(document.getElementById("calc-amount").value || "0")
  const out = document.getElementById("calc-result")
  const prov = document.getElementById("calc-provenance")
  prov.innerHTML = ""
  out.className = "calc-result"
  if (!DAY.length) { out.textContent = `no data for ${CURRENT_DATE ? fmtDate(CURRENT_DATE) : "this date"}`; out.className = "calc-result no-data"; return }
  const r = rate(from, to, sourceId, side)
  if (r == null) { out.textContent = "no rate for that direction from this source"; out.className = "calc-result no-data"; return }
  let amt = amount
  if (from === "IRR") amt = amount * UNIT_DIVISOR
  let result = amt * r
  if (to === "IRR") result = result / UNIT_DIVISOR
  const unitLabel = to === "IRR" ? (UNIT_DIVISOR === UNIT.toman ? " toman" : " rial") : ""
  out.innerHTML = `${amount} ${from} = ${result.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${to}${unitLabel} <span class="asof-inline">as of ${esc(fmtDate(CURRENT_DATE))}</span>`
  prov.innerHTML = convertProvenance(from, to, sourceId)
}

function fillSourceSelector() {
  const srcSel = document.getElementById("calc-source")
  const opts = ['<option value="estimate">estimate (derived)</option>', '<option value="average">average of enabled</option>']
  for (const s of INDEX.sources) opts.push(`<option value="${s.source_id}">${s.label}</option>`)
  srcSel.innerHTML = opts.join("")
}

async function loadHistory() {
  try {
    HISTORY = await getJson("./data/history.json")
  } catch (_) {
    HISTORY = null
  }
}

/* --- chart --- */
const PALETTE = ["#00548a", "#136f2f", "#8a5a00", "#8a0050", "#005f5f", "#5a008a", "#7a2e00", "#2e6f7a", "#6f136f"]
let mainChart = null
let savedX = null
let chartDates = []

function defaultRange(dates) {
  // last 4 weeks of available data, as a category-index range
  if (!dates.length) return null
  const last = dates[dates.length - 1]
  const cut = new Date(last + "T00:00:00Z")
  cut.setUTCDate(cut.getUTCDate() - 27)
  const cutIso = cut.toISOString().slice(0, 10)
  const idx = dates.findIndex(d => d >= cutIso)
  if (idx <= 0) return null
  return { min: idx, max: dates.length - 1 }
}

function shade(hex, pct) {
  const n = parseInt(hex.slice(1), 16)
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  if (pct < 0) { const k = 1 + pct; r = Math.round(r * k); g = Math.round(g * k); b = Math.round(b * k) }
  else { r = Math.round(r + (255 - r) * pct); g = Math.round(g + (255 - g) * pct); b = Math.round(b + (255 - b) * pct) }
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")
}

function historyDates() {
  const s = new Set()
  for (const series of Object.values(HISTORY.sources)) {
    for (const d of Object.keys(series.points)) s.add(d)
  }
  return [...s].sort()
}

function historySourceIds() {
  return [...new Set(Object.values(HISTORY.sources).map(s => s.source_id))]
}

function seriesKeys() {
  return (HISTORY && HISTORY.sources) ? Object.keys(HISTORY.sources).sort() : []
}

function colorForSeries(key) {
  const keys = seriesKeys()
  let idx = keys.indexOf(key)
  if (idx < 0) idx = 0
  return PALETTE[idx % PALETTE.length]
}

function sourceSwatches(id) {
  if (!HISTORY || !HISTORY.sources) return ""
  return Object.keys(HISTORY.sources)
    .filter(k => HISTORY.sources[k].source_id === id)
    .map(k => `<span class="swatch" style="background:${colorForSeries(k)}" title="${esc(k)}"></span>`)
    .join("")
}

function seriesVisible(series, cur, srcs) {
  return series.pair_to === "IRR" && cur.includes(currencyOfSeries(series)) && srcs.includes(series.source_id)
}

function chartLabels(dates) {
  return dates.map(d => (CAL === "gregorian" ? d : fmtDate(d)))
}

function computeChartData() {
  const dates = historyDates()
  const cur = enabledCurrencies()
  const sides = enabledSides()
  const srcs = enabledSourceIds()
  const datasets = []
  for (const [key, series] of Object.entries(HISTORY.sources)) {
    if (!seriesVisible(series, cur, srcs)) continue
    const base = colorForSeries(key)
    const label = `${series.source_id}:${series.pair_from}`
    const buy = dates.map(d => { const p = series.points[d]; return p && p[0] != null ? p[0] / UNIT_DIVISOR : null })
    const sell = dates.map(d => { const p = series.points[d]; return p && p[1] != null ? p[1] / UNIT_DIVISOR : null })
    const mid = dates.map(d => {
      const p = series.points[d]
      if (!p) return null
      if (p[0] != null && p[1] != null) return (p[0] + p[1]) / 2 / UNIT_DIVISOR
      if (p[2] != null) return p[2] / UNIT_DIVISOR
      return null
    })
    if (sides.includes("buy") && buy.some(x => x != null)) datasets.push({ label: `${label} buy`, data: buy, borderColor: base, borderDash: [], spanGaps: false, pointRadius: 0, tension: .2 })
    if (sides.includes("sell") && sell.some(x => x != null)) datasets.push({ label: `${label} sell`, data: sell, borderColor: shade(base, -0.35), borderDash: [], spanGaps: false, pointRadius: 0, tension: .2 })
    if (sides.includes("mid") && mid.some(x => x != null)) datasets.push({ label: `${label} mid`, data: mid, borderColor: shade(base, 0.45), borderDash: [5, 4], spanGaps: false, pointRadius: 0, tension: .2 })
  }
  if (document.getElementById("toggle-avg").checked) {
    cur.forEach((c, ci) => {
      const avg = dates.map(d => {
        const vals = []
        for (const series of Object.values(HISTORY.sources)) {
          if (currencyOfSeries(series) !== c) continue
          if (!seriesVisible(series, cur, srcs)) continue
          const p = series.points[d]
          if (p && p[1] != null) vals.push(p[1] / UNIT_DIVISOR)
        }
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
      })
      if (avg.some(x => x != null)) {
        datasets.push({ label: `${c} average (estimate)`, data: avg, borderColor: ci === 0 ? "#000" : "#555", borderDash: [6, 4], spanGaps: false, pointRadius: 0 })
      }
    })
  }
  return { dates, datasets }
}

function chartOptions() {
  return {
    responsive: true,
    interaction: { mode: "index", intersect: false },
      scales: {
        x: { ticks: { maxTicksLimit: 20, autoSkip: true, maxRotation: 90, minRotation: 90 } },
        y: {},
      },
    plugins: {
      legend: { display: false },
      zoom: {
        pan: { enabled: true, mode: "x", onPan: ({ chart }) => rescaleY(chart) },
        zoom: {
          wheel: { enabled: true },
          pinch: { enabled: true },
          mode: "x",
          onZoom: ({ chart }) => rescaleY(chart),
        },
      },
    },
  }
}

function buildMainChart() {
  const canvas = document.getElementById("main-chart")
  if (!HISTORY || !HISTORY.sources) return
  const { dates, datasets } = computeChartData()
  chartDates = dates
  const opts = chartOptions()
  const range = (savedX && savedX.min != null) ? savedX : defaultRange(dates)
  if (range) { opts.scales.x.min = range.min; opts.scales.x.max = range.max }
  if (mainChart) mainChart.destroy()
  mainChart = new Chart(canvas, { type: "line", data: { labels: chartLabels(dates), datasets }, options: opts })
  if (range) rescaleY(mainChart)
  updateBrush()
}

function updateChart() {
  if (!HISTORY || !HISTORY.sources) return
  if (!mainChart) { buildMainChart(); return }
  const { dates, datasets } = computeChartData()
  chartDates = dates
  mainChart.data.labels = chartLabels(dates)
  mainChart.data.datasets = datasets
  mainChart.update("none")
  rescaleY(mainChart)
}

let resetting = false

function rescaleY(chart) {
  if (!resetting && chart.scales && chart.scales.x && chart.scales.x.min != null) {
    const xs = chart.scales.x
    let lo = Infinity, hi = -Infinity
    chart.data.datasets.forEach((ds, i) => {
      if (!chart.isDatasetVisible(i)) return
      for (let j = 0; j < ds.data.length; j++) {
        const v = ds.data[j]
        if (v == null) continue
        if (j < xs.min - 0.5 || j > xs.max + 0.5) continue
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
    })
    if (isFinite(lo) && isFinite(hi)) {
      const pad = (hi - lo) * 0.05 || Math.abs(hi) * 0.01 || 1
      chart.options.scales.y.min = lo - pad
      chart.options.scales.y.max = hi + pad
      chart.update("none")
    }
  }
  updateBrush()
}

function setChartRange(a, b) {
  const n = chartDates.length
  if (n < 2 || !mainChart) return
  a = Math.max(0, Math.min(n - 1, a))
  b = Math.max(0, Math.min(n - 1, b))
  if (b - a < 1) b = Math.min(n - 1, a + 1)
  mainChart.options.scales.x.min = a
  mainChart.options.scales.x.max = b
  mainChart.update("none")
  rescaleY(mainChart)
}

function updateBrush() {
  const win = document.getElementById("brush-window")
  const label = document.getElementById("brush-label")
  if (!win || !label) return
  const n = chartDates.length
  if (!mainChart || n < 2) { win.style.display = "none"; label.textContent = ""; return }
  win.style.display = ""
  const xs = mainChart.scales.x
  const a = Math.max(0, Math.min(n - 1, xs.min))
  const b = Math.max(0, Math.min(n - 1, xs.max))
  const lf = a / (n - 1), rf = b / (n - 1)
  const widthPct = Math.max(3, (rf - lf) * 100)
  let leftPct = lf * 100
  if (leftPct + widthPct > 100) leftPct = 100 - widthPct
  win.style.left = leftPct + "%"
  win.style.width = widthPct + "%"
  const lo = Math.floor(a), hi = Math.ceil(b)
  label.textContent = `${fmtDate(chartDates[lo])} to ${fmtDate(chartDates[hi])}  (${hi - lo + 1} of ${n} days)`
}

function initBrush() {
  const brush = document.getElementById("brush")
  if (!brush) return
  let mode = null, startX = 0, startL = 0, startR = 0
  const n = () => chartDates.length
  function cur() {
    const xs = mainChart.scales.x
    return { l: Math.max(0, xs.min) / (n() - 1), r: Math.min(n() - 1, xs.max) / (n() - 1) }
  }
  function onDown(e) {
    if (!mainChart || n() < 2) return
    const t = e.target
    mode = t.id === "brush-left" ? "l" : t.id === "brush-right" ? "r" : "pan"
    const c = cur()
    startL = c.l; startR = c.r; startX = e.clientX
    try { brush.setPointerCapture(e.pointerId) } catch (_) {}
    e.preventDefault()
  }
  function onMove(e) {
    if (!mode) return
    const rect = brush.getBoundingClientRect()
    const dx = (e.clientX - startX) / rect.width
    const minW = 1 / (n() - 1)
    let l = startL, r = startR
    if (mode === "l") l = Math.max(0, Math.min(startR - minW, startL + dx))
    else if (mode === "r") r = Math.min(1, Math.max(startL + minW, startR + dx))
    else { const w = startR - startL; l = Math.max(0, Math.min(1 - w, startL + dx)); r = l + w }
    setChartRange(l * (n() - 1), r * (n() - 1))
  }
  function onUp(e) { mode = null; try { brush.releasePointerCapture(e.pointerId) } catch (_) {} }
  brush.addEventListener("pointerdown", onDown)
  brush.addEventListener("pointermove", onMove)
  brush.addEventListener("pointerup", onUp)
  brush.addEventListener("pointercancel", onUp)
}

function resetZoom() {
  if (!mainChart) return
  savedX = null
  resetting = true
  mainChart.resetZoom()
  if (mainChart.options.scales) {
    delete mainChart.options.scales.y.min
    delete mainChart.options.scales.y.max
  }
  const range = defaultRange(chartDates)
  if (range) {
    mainChart.options.scales.x.min = range.min
    mainChart.options.scales.x.max = range.max
  } else if (mainChart.options.scales && mainChart.options.scales.x) {
    delete mainChart.options.scales.x.min
    delete mainChart.options.scales.x.max
  }
  mainChart.update("none")
  resetting = false
  rescaleY(mainChart)
}

function buildToggles() {
  const curHost = document.getElementById("currency-toggles")
  const sideHost = document.getElementById("side-toggles")
  const srcHost = document.getElementById("source-toggles")
  curHost.innerHTML = historyCurrencies().map(c => `<label><input type="checkbox" value="${c}" checked> ${c}</label>`).join("")
  sideHost.innerHTML = ["buy", "sell", "mid"].map(s => `<label><input type="checkbox" value="${s}" checked> ${s}</label>`).join("")
  srcHost.innerHTML = allSourceIds().map(id => `<label>${sourceSwatches(id)}<input type="checkbox" value="${id}" checked> ${id}</label>`).join("")
  for (const host of [curHost, sideHost, srcHost]) {
    host.querySelectorAll("input").forEach(i => i.addEventListener("change", () => { updateChart(); renderTables() }))
  }
}

function rebuildCharts() { updateChart() }

function updateCalToggleLabel() {
  document.getElementById("cal-toggle").textContent = CAL === "gregorian" ? "Gregorian" : "Jalali (Shamsi)"
}

async function boot() {
  INDEX = await getJson("./data/index.json")
  fillSourceSelector()
  await loadHistory()
  buildToggles()

  document.getElementById("calc-source").addEventListener("change", async () => {
    ensureDateAvailable()
    renderCalendar()
    await loadDay(CURRENT_DATE)
    convert(); renderTables()
  })
  for (const id of ["calc-from", "calc-to", "calc-side", "calc-amount"]) {
    document.getElementById(id).addEventListener("input", convert)
  }
  document.getElementById("calc-source").addEventListener("change", convert)

  document.getElementById("toggle-avg").addEventListener("change", () => { updateChart(); renderTables() })
  document.getElementById("unit").addEventListener("change", e => {
    UNIT_DIVISOR = UNIT[e.target.value]
    convert(); renderTables(); updateChart()
  })
  document.getElementById("reset-zoom").addEventListener("click", resetZoom)
  initBrush()
  document.getElementById("cal-prev").addEventListener("click", () => shiftMonth(-1))
  document.getElementById("cal-next").addEventListener("click", () => shiftMonth(1))
  document.getElementById("cal-title").addEventListener("click", openCalModal)
  const calModal = document.getElementById("cal-modal")
  calModal.addEventListener("close", () => { if (calModal.returnValue === "apply") applyCalModal() })
  calModal.addEventListener("click", e => { if (e.target === calModal) calModal.close("cancel") })
  document.getElementById("cal-toggle").addEventListener("click", () => {
    CAL = CAL === "gregorian" ? "jalali" : "gregorian"
    updateCalToggleLabel()
    renderCalendar()
    convert(); renderTables(); updateChart()
  })

  ensureDateAvailable()
  await loadDay(CURRENT_DATE)
  renderCalendar()
  convert()
  renderTables()
  rebuildCharts()
  updateCalToggleLabel()
}

function badge(r) {
  if (r.kind === "estimate") {
    return `<span class="badge estimate" data-prov='${escapeAttr(JSON.stringify({ formula: r.formula || "", inputs: r.inputs || [] }))}'>estimate</span>`
  }
  if (r.kind === "proxy") {
    return `<span class="badge proxy" title="USDT is used as a proxy for the cash US dollar">proxy</span>`
  }
  if (r.kind === "exact") {
    return `<span class="badge exact" title="Source publishes this pair directly">exact</span>`
  }
  return `<span class="badge unknown" title="unrecognized kind">${esc(r.kind || "unknown")}</span>`
}

function escapeAttr(s) { return s.replace(/'/g, "&#39;") }

function showProvenance(data) {
  const c = document.getElementById("modal-content")
  const rows = (data.inputs || []).map(i =>
    `<li>${esc(i.source_id)} <span class="badge ${esc(i.kind)}">${esc(i.kind)}</span> = ${esc(i.value)}${i.leg ? ` (${esc(i.leg)})` : ""} <a href="${esc(i.verify_url)}" target="_blank" rel="noopener">verify</a></li>`).join("")
  c.innerHTML = `<p>${esc(data.formula || "")}</p><ul>${rows}</ul>`
  document.getElementById("modal").classList.remove("hidden")
}

function midText(r) {
  if (r.buy_rial != null && r.sell_rial != null) return fmt((r.buy_rial + r.sell_rial) / 2)
  if (r.price_rial != null) return fmt(r.price_rial)
  return "-"
}

function averageRowData(c, srcs) {
  const contrib = DAY.filter(r => r.pair_to === "IRR" && currencyOfRecord(r) === c && srcs.includes(r.source_id))
  const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null
  const buys = contrib.map(r => r.buy_rial).filter(v => v != null)
  const sells = contrib.map(r => r.sell_rial).filter(v => v != null)
  const prices = contrib.map(r => r.price_rial).filter(v => v != null)
  if (!buys.length && !sells.length && !prices.length) return null
  const single = !buys.length && !sells.length
  const inputs = contrib.map(r => ({
    source_id: r.source_id, kind: r.kind,
    value: r.sell_rial != null ? r.sell_rial : (r.buy_rial != null ? r.buy_rial : r.price_rial),
    verify_url: r.verify_url,
  }))
  return {
    source_id: `average (${c})`, kind: "estimate", pair_from: c, pair_to: "IRR",
    buy_rial: avg(buys), sell_rial: avg(sells),
    price_rial: single ? avg(prices) : null,
    as_of: CURRENT_DATE, verify_url: "", source_url: "", status: "ok",
    formula: `average of enabled ${c} sources`, inputs,
  }
}

const TABLE_COLS = [
  { key: "source", label: "source", w: "20%" },
  { key: "kind", label: "kind", w: "12%" },
  { key: "currency", label: "currency", w: "11%" },
  { key: "buy", label: "buy", w: "11%", side: "buy" },
  { key: "sell", label: "sell", w: "11%", side: "sell" },
  { key: "mid", label: "mid", w: "11%", side: "mid" },
  { key: "asof", label: "as-of", w: "13%" },
  { key: "status", label: "status", w: "11%" },
]

function tableCell(r, c, sides) {
  const cls = (c.side && !sides.includes(c.side)) ? ' class="dim"' : ""
  switch (c.key) {
    case "source": {
      const name = esc(r.source_id)
      const icon = r.source_url
        ? `<a class="json-icon" href="${esc(r.source_url)}" target="_blank" rel="noopener" title="source JSON">{}</a>`
        : ""
      const label = r.verify_url
        ? `<a href="${esc(r.verify_url)}" target="_blank" rel="noopener">${name}</a>`
        : name
      return `<td${cls}>${icon}${label}</td>`
    }
    case "kind": return `<td${cls}>${badge(r)}</td>`
    case "currency": return `<td${cls}>${esc(r.pair_from)}</td>`
    case "buy": return `<td${cls}>${fmt(r.buy_rial)}</td>`
    case "sell": return `<td${cls}>${fmt(r.sell_rial)}</td>`
    case "mid": return `<td${cls}>${midText(r)}</td>`
    case "asof": return `<td${cls}>${esc(fmtDate(r.as_of || CURRENT_DATE))}</td>`
    case "status": return `<td${cls}>${esc(r.status)}</td>`
  }
  return "<td></td>"
}

function renderTables() {
  const body = document.getElementById("tables-body")
  if (!DAY.length) { body.innerHTML = `<p class="no-data">no data for this date</p>`; return }
  const cur = enabledCurrencies()
  const sides = enabledSides()
  const srcs = enabledSourceIds()

  const rows = DAY.filter(r => r.pair_to === "IRR" && cur.includes(currencyOfRecord(r)) && srcs.includes(r.source_id))
  if (document.getElementById("toggle-avg").checked) {
    for (const c of cur) {
      const ar = averageRowData(c, srcs)
      if (ar) rows.push(ar)
    }
  }

  const colgroup = `<colgroup>${TABLE_COLS.map(c => `<col style="width:${c.w}">`).join("")}</colgroup>`
  const head = `<tr>${TABLE_COLS.map(c => `<th${c.side && !sides.includes(c.side) ? ' class="dim"' : ""}>${c.label}</th>`).join("")}</tr>`
  const rowHtml = rows.map(r => `<tr>${TABLE_COLS.map(c => tableCell(r, c, sides)).join("")}</tr>`).join("")

  const asofs = DAY.map(r => r.as_of).filter(s => ISO_RE.test(s || "")).sort()
  const asof = asofs.length ? asofs[asofs.length - 1] : CURRENT_DATE
  const title = document.getElementById("tables-title")
  if (title) title.textContent = `Sources: rates to IRR, in ${unitName()}`
  const header = `<p class="asof">date ${esc(fmtDate(CURRENT_DATE))} &middot; latest as-of ${esc(fmtDate(asof))}</p>`
  body.innerHTML = header + `<table class="grid">${colgroup}<thead>${head}</thead><tbody>${rowHtml}</tbody></table>`
  body.querySelectorAll(".badge.estimate").forEach(el => {
    el.addEventListener("click", () => showProvenance(JSON.parse(el.dataset.prov)))
  })
}

document.getElementById("modal-close").addEventListener("click", () => {
  document.getElementById("modal").classList.add("hidden")
})

boot().catch(err => {
  document.getElementById("calc-result").textContent = "failed to load data: " + err.message
})
