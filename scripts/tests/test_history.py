import history as hist
from model import Record


BONBAST = {
    "2026/10/12": {"USD": {"sell": 260600, "buy": 260400}, "CAD": {"sell": 182500, "buy": 182400}},
    "2026/10/13": {"USD": {"sell": 259800, "buy": 259600}, "CAD": {"sell": 182700, "buy": 182600}},
}
FRANKFURTER = {"rates": {"2026-10-13": {"CAD": 1.4221}}}


def test_bonbast_series_converts_toman_to_rial_and_iso_dates():
    bb = hist.bonbast_series(BONBAST)
    assert bb["USD"]["2026-10-13"] == [2596000, 2598000, None]
    assert bb["CAD"]["2026-10-13"] == [1826000, 1827000, None]


def test_frankfurter_series_is_cad_per_usd():
    ff = hist.frankfurter_series(FRANKFURTER)
    assert ff["2026-10-13"] == 1.4221


def test_build_from_archive_makes_cad_estimate_in_rial():
    h = hist.build_from_archive(BONBAST, FRANKFURTER, None, "t")
    est = h["sources"]["cad_estimate:CAD"]["points"]["2026-10-13"]
    assert est[1] == round(2598000 / 1.4221)
    assert est[0] == round(2596000 / 1.4221)
    assert h["sources"]["bonbast_archive:USD"]["kind"] == "exact"
    assert h["sources"]["cad_estimate:CAD"]["kind"] == "estimate"


def test_add_records_merges_irr_records_only():
    h = hist.load_history("/nonexistent/none.json")
    recs = [
        Record(source_id="nobitex", kind="proxy", pair_from="USDT", pair_to="IRR",
               buy_rial=2600990, sell_rial=2601040),
        Record(source_id="globalfx", kind="exact", pair_from="USD", pair_to="CAD", value=0.703),
    ]
    hist.add_records(h, "2026-10-14", recs)
    assert "nobitex:USDT" in h["sources"]
    assert h["sources"]["nobitex:USDT"]["points"]["2026-10-14"] == [2600990, 2601040, None]
    assert "globalfx:USD" not in h["sources"]


def test_add_records_keeps_usd_cad_bank_quotes():
    h = hist.load_history("/nonexistent/none.json")
    recs = [
        Record(source_id="td", kind="exact", pair_from="USD", pair_to="CAD", value=0.7,
               native={"cad_buy": 1.3561, "cad_sell": 1.4358, "cad_mid": 1.39595}),
        Record(source_id="boc", kind="exact", pair_from="USD", pair_to="CAD", value=0.7,
               single_sided=True, native={"cad_mid": 1.396}),
        Record(source_id="td", kind="exact", pair_from="USD", pair_to="CAD", status="error"),
    ]
    hist.add_records(h, "2026-10-31", recs)
    td = h["sources"]["td:USD"]
    assert td["pair_to"] == "CAD"
    assert td["points"]["2026-10-31"] == [1.3561, 1.4358, None]
    assert h["sources"]["boc:USD"]["points"]["2026-10-31"] == [None, None, 1.396]


def test_build_from_archive_adds_boc_series():
    boc = {"observations": [{"d": "2026-10-13", "FXUSDCAD": {"v": "1.4010"}},
                            {"d": "2026-10-14", "FXUSDCAD": {}}]}
    h = hist.build_from_archive(BONBAST, FRANKFURTER, None, "t", boc)
    s = h["sources"]["boc:USD"]
    assert s["pair_to"] == "CAD" and s["kind"] == "exact"
    assert s["points"] == {"2026-10-13": [None, None, 1.401]}
