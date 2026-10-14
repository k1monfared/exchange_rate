from sources.nerkhsanj import Nerkhsanj
from sources.bonbast_archive import BonbastArchive

NERKHSANJ_PAYLOAD = {
    "date": "1405/07/21",
    "rates": {"dollar": 257710, "cad": 181380, "euro": 288590},
}

BONBAST_PAYLOAD = {
    "2026/10/11": {"USD": {"sell": 264000, "buy": 263800}, "CAD": {"sell": 184900, "buy": 184800}},
    "2026/10/12": {"USD": {"sell": 260600, "buy": 260400}, "CAD": {"sell": 182500, "buy": 182400}},
}


def test_nerkhsanj_yields_usd_and_cad_single_sided_toman():
    recs = {r.pair_from: r for r in Nerkhsanj().parse(NERKHSANJ_PAYLOAD)}
    assert set(recs) == {"USD", "CAD"}
    assert recs["USD"].price_rial == 2577100
    assert recs["USD"].single_sided is True
    assert recs["USD"].buy_rial is None and recs["USD"].sell_rial is None
    assert recs["USD"].kind == "exact"
    assert recs["CAD"].price_rial == 1813800


def test_bonbast_uses_latest_date_and_both_sides():
    recs = {r.pair_from: r for r in BonbastArchive().parse(BONBAST_PAYLOAD)}
    assert recs["USD"].sell_rial == 2606000
    assert recs["USD"].buy_rial == 2604000
    assert recs["CAD"].sell_rial == 1825000
    assert recs["USD"].as_of.startswith("2026/10/12")
    assert recs["USD"].single_sided is False
