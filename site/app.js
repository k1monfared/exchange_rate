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
  const result = amount * r
  out.textContent = `${amount} ${from} = ${result.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${to}`
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
}

function renderTables() {
  const body = document.getElementById("tables-body")
  if (!SNAPSHOT) { body.innerHTML = `<p class="no-data">no data for this date</p>`; return }
  const rows = records().map(r => `
    <tr>
      <td>${r.source_id} <span class="badge ${r.kind}">${r.kind}</span></td>
      <td>${r.pair_from}/${r.pair_to}</td>
      <td>${fmt(r.buy_rial)}</td>
      <td>${fmt(r.sell_rial)}</td>
      <td>${fmt(r.price_rial)}</td>
      <td><a href="${r.verify_url}" target="_blank" rel="noopener">verify</a></td>
    </tr>`).join("")
  body.innerHTML = `<table><thead><tr><th>source</th><th>pair</th><th>buy</th><th>sell</th><th>price</th><th>link</th></tr></thead><tbody>${rows}</tbody></table>`
}

boot().catch(err => {
  document.getElementById("calc-result").textContent = "failed to load data: " + err.message
})
