const UNIT = { toman: 10, rial: 1 }

let INDEX = null
let SNAPSHOT = null
let SNAPSHOTS = {}   // date -> snapshot (loaded lazily for charts)
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

function records() { return SNAPSHOT ? SNAPSHOT.records : [] }

function bySource(id) { return records().filter(r => r.source_id === id) }

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
  return (INDEX.sources || []).map(s => s.source_id).filter(id => id !== "globalfx")
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
  prov.textContent = ""
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

async function loadAllSnapshots() {
  for (const d of INDEX.dates) {
    if (!SNAPSHOTS[d]) SNAPSHOTS[d] = await getJson(`./data/snapshots/${d}.json`)
  }
}

function seriesFor(metric) {
  // metric: {sourceId, pair, side}
  return INDEX.dates.map(d => {
    const rec = (SNAPSHOTS[d].records || []).find(r =>
      r.source_id === metric.sourceId && r.pair_from === metric.pair && r.pair_to === "IRR")
    if (!rec) return null
    let v = sideValue(rec, metric.side)
    if (v == null) return null
    return v / UNIT_DIVISOR
  })
}

const PALETTE = ["#00548a", "#136f2f", "#8a5a00", "#8a0050", "#005f5f", "#5a008a", "#7a2e00", "#2e6f7a", "#6f136f"]
let mainChart = null
let perSourceCharts = []

function buildMainChart() {
  const ids = [...new Set(records().map(r => r.source_id))]
  const datasets = []
  ids.forEach((id, i) => {
    const pair = id === "bonbast_archive" || id === "nerkhsanj" ? "USD" : "USDT"
    const data = seriesFor({ sourceId: id, pair, side: "sell" })
    if (data.every(x => x == null)) return
    datasets.push({ label: `${id} sell`, data, borderColor: PALETTE[i % PALETTE.length], spanGaps: true, tension: .2 })
  })
  const avg = INDEX.dates.map((d, idx) => {
    const vals = enabledSourceIds().map(id => {
      const pair = id === "bonbast_archive" || id === "nerkhsanj" ? "USD" : "USDT"
      return seriesFor({ sourceId: id, pair, side: "sell" })[idx]
    }).filter(x => x != null)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  })
  if (document.getElementById("toggle-avg").checked && avg.some(x => x != null)) {
    datasets.push({ label: "average (estimate)", data: avg, borderColor: "#000", borderDash: [6, 4], spanGaps: true })
  }
  const ctx = document.getElementById("main-chart")
  if (mainChart) mainChart.destroy()
  mainChart = new Chart(ctx, {
    type: "line",
    data: { labels: INDEX.dates, datasets },
    options: { responsive: true, interaction: { mode: "index", intersect: false } },
  })
}

function buildPerSourceCharts() {
  const host = document.getElementById("per-source-charts")
  host.innerHTML = ""
  perSourceCharts.forEach(c => c.destroy())
  perSourceCharts = []
  const ids = enabledSourceIds()
  ids.forEach((id, i) => {
    const wrap = document.createElement("div")
    const canvas = document.createElement("canvas")
    wrap.appendChild(document.createElement("h4")).textContent = id
    wrap.appendChild(canvas)
    host.appendChild(wrap)
    const pair = id === "bonbast_archive" || id === "nerkhsanj" ? "USD" : "USDT"
    const ds = [
      { label: "sell", data: seriesFor({ sourceId: id, pair, side: "sell" }), borderColor: "#c00", spanGaps: true },
      { label: "buy", data: seriesFor({ sourceId: id, pair, side: "buy" }), borderColor: "#00c", spanGaps: true },
    ]
    if (document.getElementById("toggle-mid").checked) {
      ds.push({ label: "mid", data: seriesFor({ sourceId: id, pair, side: "mid" }), borderColor: "#0a0", borderDash: [4, 4], spanGaps: true })
    }
    perSourceCharts.push(new Chart(canvas, { type: "line", data: { labels: INDEX.dates, datasets: ds }, options: { responsive: true } }))
  })
}

function buildSourceToggles() {
  const host = document.getElementById("source-toggles")
  const ids = INDEX.sources.map(s => s.source_id).filter(id => id !== "globalfx")
  host.innerHTML = ids.map(id => `<label><input type="checkbox" value="${id}" checked> ${id}</label>`).join("")
  host.querySelectorAll("input").forEach(i => i.addEventListener("change", () => { buildMainChart(); buildPerSourceCharts() }))
}

function rebuildCharts() { buildMainChart(); buildPerSourceCharts() }

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
  await loadAllSnapshots()
  buildSourceToggles()
  rebuildCharts()
  document.getElementById("toggle-mid").addEventListener("change", rebuildCharts)
  document.getElementById("toggle-avg").addEventListener("change", rebuildCharts)
  document.getElementById("unit").addEventListener("change", e => {
    UNIT_DIVISOR = UNIT[e.target.value]
    convert(); renderTables(); rebuildCharts()
  })
}

function badge(r) {
  if (r.kind === "estimate") {
    return `<span class="badge estimate" data-prov='${escapeAttr(JSON.stringify({ formula: r.formula || "", inputs: r.inputs || [] }))}'>estimate</span>`
  }
  if (r.kind === "proxy") {
    return `<span class="badge proxy" title="USDT is used as a proxy for the cash US dollar">proxy</span>`
  }
  return `<span class="badge exact" title="Source publishes this pair directly">exact</span>`
}

function escapeAttr(s) { return s.replace(/'/g, "&#39;") }

function showProvenance(data) {
  const c = document.getElementById("modal-content")
  const rows = (data.inputs || []).map(i =>
    `<li>${i.source_id} <span class="badge ${i.kind}">${i.kind}</span> = ${i.value} <a href="${i.verify_url}" target="_blank" rel="noopener">verify</a></li>`).join("")
  c.innerHTML = `<p>${data.formula || ""}</p><ul>${rows}</ul>`
  document.getElementById("modal").classList.remove("hidden")
}

function pairLabel(r) {
  return `${r.pair_from}/${r.pair_to}`
}

function perSourceTables() {
  const ids = [...new Set(records().map(r => r.source_id))]
  return ids.map(id => {
    const rs = bySource(id)
    const rows = rs.map(r => `
      <tr>
        <td>${pairLabel(r)} ${badge(r)}</td>
        <td>${fmt(r.buy_rial)}</td><td>${fmt(r.sell_rial)}</td>
        <td>${fmt(r.price_rial)}</td><td>${r.status}</td>
        <td><a href="${r.source_url}" target="_blank" rel="noopener">source</a>
            &middot; <a href="${r.verify_url}" target="_blank" rel="noopener">verify</a></td>
      </tr>`).join("")
    return `<h3>${id}</h3>
      <table><thead><tr><th>pair</th><th>buy</th><th>sell</th><th>price</th><th>status</th><th>links</th></tr></thead>
      <tbody>${rows}</tbody></table>`
  }).join("")
}

function combinedTable() {
  const irr = records().filter(r => r.pair_to === "IRR" && r.pair_from !== "IRR")
  const bySourceMap = {}
  for (const r of irr) {
    const key = r.source_id
    bySourceMap[key] = bySourceMap[key] || {}
    bySourceMap[key][r.pair_from] = r
  }
  const cols = Object.keys(bySourceMap)
  const header = cols.map(c => `<th>${c}</th>`).join("")
  const pairs = ["USD", "USDT", "CAD"]
  const body = pairs.map(p => `<tr><td>${p}</td>` + cols.map(c => {
    const r = bySourceMap[c][p]
    if (!r) return `<td>-</td>`
    return `<td>buy ${fmt(r.buy_rial)} / sell ${fmt(r.sell_rial)} ${r.price_rial != null ? "price " + fmt(r.price_rial) : ""}</td>`
  }).join("") + `</tr>`).join("")
  return `<h3>All sources, side by side (never merged)</h3>
    <table><thead><tr><th>pair</th>${header}</tr></thead><tbody>${body}</tbody></table>`
}

function renderTables() {
  const body = document.getElementById("tables-body")
  if (!SNAPSHOT) { body.innerHTML = `<p class="no-data">no data for this date</p>`; return }
  body.innerHTML = combinedTable() + perSourceTables()
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
