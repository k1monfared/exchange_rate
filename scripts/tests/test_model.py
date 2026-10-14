from model import Input, Record


def test_record_dict_has_core_keys():
    r = Record(source_id="nobitex", kind="proxy", pair_from="USDT", pair_to="IRR",
               buy_rial=2600990, sell_rial=2601040)
    d = r.to_dict()
    assert d["source_id"] == "nobitex"
    assert d["kind"] == "proxy"
    assert d["buy_rial"] == 2600990
    assert d["sell_rial"] == 2601040
    assert d["price_rial"] is None
    assert "inputs" not in d  # omitted when empty


def test_derived_record_serializes_inputs():
    r = Record(source_id="derive", kind="estimate", pair_from="CAD", pair_to="IRR",
               price_rial=18290000, formula="irl = usd / usd_cad",
               inputs=[Input(source_id="bonbast_archive", value=2606000, kind="exact",
                             verify_url="https://bonbast.com/")])
    d = r.to_dict()
    assert d["formula"] == "irl = usd / usd_cad"
    assert d["inputs"][0]["source_id"] == "bonbast_archive"
    assert d["inputs"][0]["kind"] == "exact"
