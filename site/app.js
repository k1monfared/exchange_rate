const UNIT = { toman: 10, rial: 1 }

let INDEX = null
let SNAPSHOT = null
let SNAPSHOTS = {}   // date -> snapshot (loaded lazily for the tables and converter)
let HISTORY = null   // consolidated daily series for the chart
let UNIT_DIVISOR = UNIT.toman

async function getJson(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: ${r.status}`)
  return r.json()
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

function records() { return SNAPSHOT ? SNAPSHOT.records : [] }

function sideValue(rec, side) {
  // returns the value for a leg in RIAL, or the ratio for a non-IRR pair (globalfx)
  if (!rec) return null
  if (rec.pair_to !== "IRR") return rec.value  // direct non-IRR pair, e.g. USD/CAD
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
  // IRR per 1 unit of cur, or null
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
  // a direct non-IRR pair published by the chosen source (globalfx USD/CAD).
  // globalfx stores `value` as USD per CAD (from-per-to), so the to-per-from rate is its reciprocal.
  const rec = records().find(r => r.source_id === sourceId && r.pair_from === from && r.pair_to === to)
  if (rec && rec.pair_to !== "IRR" && rec.value) return 1 / rec.value
  return null
}

function rate(from, to, sourceId, side) {
  // units of `to` per 1 unit of `from`, or null
  if (from === to) return 1

  if (sourceId === "estimate") {
    const cadRec = records().find(x => x.source_id === "cad_estimate")
    const gfxRec = records().find(x => x.source_id === "globalfx")
    const cadIrr = sideValue(cadRec, side)                 // IRR per CAD
    const usdIrr = averageLeg("USD", side)                 // IRR per USD (avg of enabled cash sources)
    const gfx = gfxRec ? gfxRec.value : null               // USD per CAD (stored value)
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
    const a = legIrr(from, "average", side)   // IRR per from (1 when from === "IRR")
    const b = legIrr(to, "average", side)     // IRR per to   (1 when to === "IRR")
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

function enabledSourceIds() {
  const boxes = [...document.querySelectorAll("#source-toggles input:checked")]
  if (boxes.length) return boxes.map(b => b.value)
  if (HISTORY && HISTORY.sources) return historySourceIds()
  return (INDEX.sources || []).map(s => s.source_id).filter(id => id !== "globalfx")
}

function provLine(r) {
  const verify = r.verify_url
    ? ` &middot; <a href="${esc(r.verify_url)}" target="_blank" rel="noopener">verify</a>`
    : ""
  const asof = r.as_of ? ` &middot; as of ${esc(r.as_of)}` : ""
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
  const date = document.getElementById("calc-date").value
  const from = document.getElementById("calc-from").value
  const to = document.getElementById("calc-to").value
  const sourceId = document.getElementById("calc-source").value
  const side = document.getElementById("calc-side").value
  const amount = parseFloat(document.getElementById("calc-amount").value || "0")
  const out = document.getElementById("calc-result")
  const prov = document.getElementById("calc-provenance")
  prov.innerHTML = ""
  out.className = "calc-result"
  if (!SNAPSHOT) { out.textContent = `no data for this date (${date})`; out.className = "calc-result no-data"; return }
  const r = rate(from, to, sourceId, side)
  if (r == null) { out.textContent = "no rate for that direction from this source"; out.className = "calc-result no-data"; return }
  let amt = amount
  if (from === "IRR") amt = amount * UNIT_DIVISOR
  let result = amt * r
  if (to === "IRR") result = result / UNIT_DIVISOR
  const unitLabel = to === "IRR" ? (UNIT_DIVISOR === UNIT.toman ? " toman" : " rial") : ""
  out.textContent = `${amount} ${from} = ${result.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${to}${unitLabel}`
  prov.innerHTML = convertProvenance(from, to, sourceId)
}

function fillSelectors() {
  const dateSel = document.getElementById("calc-date")
  dateSel.innerHTML = (INDEX.dates || []).map(d => `<option>${d}</option>`).join("")
  dateSel.value = INDEX.latest || ""
  const srcSel = document.getElementById("calc-source")
  const opts = ['<option value="estimate">estimate (derived)</option>', '<option value="average">average of enabled</option>']
  for (const s of INDEX.sources) opts.push(`<option value="${s.source_id}">${s.label}</option>`)
  srcSel.innerHTML = opts.join("")
}

async function loadDate(date) {
  if (!date) { SNAPSHOT = null; return }
  if (!SNAPSHOTS[date]) {
    try {
      SNAPSHOTS[date] = await getJson(`./data/snapshots/${date}.json`)
    } catch (err) {
      SNAPSHOT = null
      throw err
    }
  }
  SNAPSHOT = SNAPSHOTS[date]
}

async function loadHistory() {
  try {
    HISTORY = await getJson("./data/history.json")
  } catch (_) {
    HISTORY = null
  }
}

const PALETTE = ["#00548a", "#136f2f", "#8a5a00", "#8a0050", "#005f5f", "#5a008a", "#7a2e00", "#2e6f7a", "#6f136f"]
let mainChart = null

function shade(hex, pct) {
  // pct in [-1,1]; negative darkens, positive lightens
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

function buildMainChart() {
  const host = document.getElementById("main-chart")
  if (!HISTORY || !HISTORY.sources) return
  const dates = historyDates()
  const enabled = enabledSourceIds()
  const datasets = []
  let i = 0
  for (const series of Object.values(HISTORY.sources)) {
    if (!enabled.includes(series.source_id)) continue
    const base = PALETTE[i % PALETTE.length]
    i++
    const label = `${series.source_id}:${series.pair_from}`
    const buy = dates.map(d => { const p = series.points[d]; return p && p[0] != null ? p[0] / UNIT_DIVISOR : null })
    const sell = dates.map(d => { const p = series.points[d]; return p && p[1] != null ? p[1] / UNIT_DIVISOR : null })
    const price = dates.map(d => { const p = series.points[d]; return p && p[2] != null ? p[2] / UNIT_DIVISOR : null })
    const mid = dates.map(d => {
      const p = series.points[d]
      if (!p) return null
      if (p[0] != null && p[1] != null) return (p[0] + p[1]) / 2 / UNIT_DIVISOR
      if (p[2] != null) return p[2] / UNIT_DIVISOR
      return null
    })
    const hasBoth = sell.some(x => x != null)
    if (buy.some(x => x != null)) datasets.push({ label: `${label} buy`, data: buy, borderColor: base, borderDash: [], spanGaps: false, pointRadius: 0, tension: .2 })
    if (hasBoth) datasets.push({ label: `${label} sell`, data: sell, borderColor: shade(base, -0.35), borderDash: [], spanGaps: false, pointRadius: 0, tension: .2 })
    if (mid.some(x => x != null)) datasets.push({ label: `${label} mid`, data: mid, borderColor: shade(base, 0.45), borderDash: [5, 4], spanGaps: false, pointRadius: 0, tension: .2 })
    if (!hasBoth && price.some(x => x != null)) datasets.push({ label: `${label} price`, data: price, borderColor: shade(base, 0.1), borderDash: [2, 2], spanGaps: false, pointRadius: 0, tension: .2 })
  }
  const avg = dates.map((d, idx) => {
    const vals = []
    for (const series of Object.values(HISTORY.sources)) {
      if (!enabled.includes(series.source_id)) continue
      const p = series.points[d]
      if (p && p[1] != null) vals.push(p[1] / UNIT_DIVISOR)
    }
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  })
  if (document.getElementById("toggle-avg").checked && avg.some(x => x != null)) {
    datasets.push({ label: "average (estimate)", data: avg, borderColor: "#000", borderDash: [6, 4], spanGaps: false, pointRadius: 0 })
  }
  const canvas = document.getElementById("main-chart")
  if (mainChart) mainChart.destroy()
  mainChart = new Chart(canvas, {
    type: "line",
    data: { labels: dates, datasets },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { ticks: { maxTicksLimit: 12, autoSkip: true } },
        y: {},
      },
      plugins: {
        legend: { labels: { boxWidth: 12 } },
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
    },
  })
}

let resetting = false

function rescaleY(chart) {
  if (resetting || !chart.scales || !chart.scales.x) return
  const xs = chart.scales.x
  if (xs.min == null) return
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
  if (!isFinite(lo) || !isFinite(hi)) return
  const pad = (hi - lo) * 0.05 || Math.abs(hi) * 0.01 || 1
  chart.options.scales.y.min = lo - pad
  chart.options.scales.y.max = hi + pad
  chart.update("none")
}

function resetZoom() {
  if (!mainChart) return
  resetting = true
  mainChart.resetZoom()
  if (mainChart.options.scales && mainChart.options.scales.y) {
    delete mainChart.options.scales.y.min
    delete mainChart.options.scales.y.max
  }
  mainChart.update("none")
  resetting = false
}

function buildSourceToggles() {
  const host = document.getElementById("source-toggles")
  const ids = HISTORY ? historySourceIds() : []
  host.innerHTML = ids.map(id => `<label><input type="checkbox" value="${id}" checked> ${id}</label>`).join("")
  host.querySelectorAll("input").forEach(i => i.addEventListener("change", buildMainChart))
}

function rebuildCharts() { buildMainChart() }

async function boot() {
  INDEX = await getJson("./data/index.json")
  fillSelectors()
  document.getElementById("calc-date").addEventListener("change", async e => {
    try { await loadDate(e.target.value) } catch (_) { SNAPSHOT = null }
    convert()
    renderTables()
  })
  for (const id of ["calc-from", "calc-to", "calc-source", "calc-side", "calc-amount"]) {
    document.getElementById(id).addEventListener("input", convert)
  }
  await loadDate(INDEX.latest)
  convert()
  renderTables()
  await loadHistory()
  buildSourceToggles()
  rebuildCharts()
  document.getElementById("toggle-avg").addEventListener("change", rebuildCharts)
  document.getElementById("unit").addEventListener("change", e => {
    UNIT_DIVISOR = UNIT[e.target.value]
    convert(); renderTables(); rebuildCharts()
  })
  document.getElementById("reset-zoom").addEventListener("click", resetZoom)
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

function pairLabel(r) {
  return `${r.pair_from}/${r.pair_to}`
}

function midText(r) {
  if (r.buy_rial != null && r.sell_rial != null) return fmt((r.buy_rial + r.sell_rial) / 2)
  return "-"
}

function renderTables() {
  const body = document.getElementById("tables-body")
  if (!SNAPSHOT) { body.innerHTML = `<p class="no-data">no data for this date</p>`; return }
  const rows = records()
    .filter(r => r.pair_to === "IRR")
    .map(r => `
      <tr>
        <td>${esc(r.source_id)} ${badge(r)}</td>
        <td>${esc(pairLabel(r))}</td>
        <td>${fmt(r.buy_rial)}</td>
        <td>${fmt(r.sell_rial)}</td>
        <td>${midText(r)}</td>
        <td>${fmt(r.price_rial)}</td>
        <td>${esc(unitName())}</td>
        <td>${r.as_of ? esc(r.as_of) : "-"}</td>
        <td>${esc(r.status)}</td>
        <td><a href="${esc(r.source_url)}" target="_blank" rel="noopener">source</a>
            &middot; <a href="${esc(r.verify_url)}" target="_blank" rel="noopener">verify</a></td>
      </tr>`).join("")
  const asofs = records().map(r => r.as_of).filter(Boolean).sort()
  const asof = asofs.length ? asofs[asofs.length - 1] : "-"
  const head = `<p class="asof">date ${esc(SNAPSHOT.date || "")} &middot; generated ${esc(SNAPSHOT.generated_at || "-")} &middot; latest as-of ${esc(asof)}</p>`
  const table = `<table>
    <thead><tr><th>source</th><th>pair</th><th>buy</th><th>sell</th><th>mid</th><th>price</th><th>unit</th><th>as-of</th><th>status</th><th>links</th></tr></thead>
    <tbody>${rows}</tbody></table>`
  body.innerHTML = head + table
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
