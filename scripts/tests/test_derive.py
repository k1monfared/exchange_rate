from model import Record
from derive import mid, cad_estimate, enabled_average


def test_mid_only_when_both_sides():
    assert mid(Record(source_id="x", kind="proxy", pair_from="USDT", pair_to="IRR",
                      buy_rial=100, sell_rial=200)) == 150
    assert mid(Record(source_id="x", kind="exact", pair_from="USD", pair_to="IRR",
                      price_rial=100, single_sided=True)) is None


def test_cad_estimate_formula_and_inputs():
    usd = Record(source_id="bonbast_archive", kind="exact", pair_from="USD", pair_to="IRR",
                 buy_rial=2604000, sell_rial=2606000)
    fx = Record(source_id="globalfx", kind="exact", pair_from="USD", pair_to="CAD", value=1 / 1.4221)
    est = cad_estimate(usd, fx)
    assert est.kind == "estimate"
    assert est.pair_from == "CAD" and est.pair_to == "IRR"
    assert abs(est.sell_rial - round(2606000 / 1.4221)) <= 1
    assert {i.source_id for i in est.inputs} == {"bonbast_archive", "globalfx"}
    assert est.formula


def test_enabled_average_uses_only_requested_side_and_flags_estimate():
    recs = [
        Record(source_id="a", kind="proxy", pair_from="USDT", pair_to="IRR", sell_rial=100),
        Record(source_id="b", kind="proxy", pair_from="USDT", pair_to="IRR", sell_rial=200),
        Record(source_id="c", kind="exact", pair_from="USD", pair_to="IRR", price_rial=999),
    ]
    avg = enabled_average(recs, "sell")
    assert avg.kind == "estimate"
    assert avg.sell_rial == 150
    assert {i.source_id for i in avg.inputs} == {"a", "b"}
