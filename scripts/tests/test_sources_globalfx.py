from sources.globalfx import GlobalFx


def test_globalfx_stores_usd_per_cad():
    p = {"result": "success", "rates": {"CAD": 1.4221}, "time_last_update_utc": "Wed, 14 Oct 2026 00:02:32 +0000"}
    r = GlobalFx().parse(p)[0]
    assert r.pair_from == "USD" and r.pair_to == "CAD"
    assert abs(r.value - (1 / 1.4221)) < 1e-9
    assert r.kind == "exact"
