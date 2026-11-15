import pytest

from sources.boc import BankOfCanada
from sources.td import TD
from sources.tangerine import Tangerine

BOC_PAYLOAD = {
    "seriesDetail": {"FXUSDCAD": {"label": "USD/CAD"}},
    "observations": [
        {"d": "2026-10-28", "FXUSDCAD": {"v": "1.4036"}},
        {"d": "2026-10-30", "FXUSDCAD": {"v": "1.3960"}},
        {"d": "2026-10-29", "FXUSDCAD": {"v": "1.3985"}},
    ],
}

TD_PAYLOAD = {
    "timestamp": "Sat Oct 31 2026 5:45 PM Eastern Daylight Time",
    "conversionTableFXCAL": [
        {"currencyCode": "USD", "currencyTier": "4999.99",
         "currencyRateRec": "1.3568", "currencyRatePay": "1.4352"},
        {"currencyCode": "USD", "currencyTier": "999.99",
         "currencyRateRec": "1.3561", "currencyRatePay": "1.4358"},
        {"currencyCode": "GBP", "currencyTier": "2899.99",
         "currencyRateRec": "1.8223", "currencyRatePay": "1.9256"},
    ],
}

TANGERINE_PAYLOAD = {
    "exchange_rates": [{"date": "10-29-2026", "buy": 1.42, "sell": 1.375, "currency": "USD"}],
    "rates": [],
}


def test_boc_takes_latest_observation_as_mid():
    r = BankOfCanada().parse(BOC_PAYLOAD)[0]
    assert r.source_id == "boc" and r.kind == "exact"
    assert r.pair_from == "USD" and r.pair_to == "CAD"
    assert r.as_of == "2026-10-30"
    assert r.native["cad_mid"] == 1.3960
    assert r.native.get("cad_buy") is None and r.native.get("cad_sell") is None
    assert r.single_sided
    assert abs(r.value - 1 / 1.3960) < 1e-12  # USD per CAD, same convention as globalfx


def test_td_uses_smallest_usd_tier_and_maps_sides():
    r = TD().parse(TD_PAYLOAD)[0]
    assert r.source_id == "td"
    # buy = what the bank pays you per USD, sell = what it charges you per USD
    assert r.native["cad_buy"] == 1.3561
    assert r.native["cad_sell"] == 1.4358
    assert r.native["cad_mid"] == pytest.approx((1.3561 + 1.4358) / 2)
    assert r.native["tier_max_usd"] == 999.99
    assert r.as_of == "2026-10-31T17:45:00-04:00"
    assert abs(r.value - 1 / r.native["cad_mid"]) < 1e-12


def test_td_keeps_raw_timestamp_when_unparseable():
    p = dict(TD_PAYLOAD, timestamp="sometime")
    assert TD().parse(p)[0].as_of == "sometime"


def test_tangerine_maps_customer_buy_to_our_sell():
    r = Tangerine().parse(TANGERINE_PAYLOAD)[0]
    assert r.source_id == "tangerine"
    assert r.native["cad_buy"] == 1.375  # you sell 1 USD, you get 1.375 CAD
    assert r.native["cad_sell"] == 1.42  # you buy 1 USD, it costs 1.42 CAD
    assert r.as_of == "2026-10-29"


@pytest.mark.parametrize("bad", [
    {"exchange_rates": [{"date": "10-29-2026", "buy": 1.30, "sell": 1.42, "currency": "USD"}]},  # inverted
    {"exchange_rates": [{"date": "10-29-2026", "buy": 14.2, "sell": 13.75, "currency": "USD"}]},  # absurd
    {"exchange_rates": []},
])
def test_tangerine_rejects_implausible_payloads(bad):
    with pytest.raises(ValueError):
        Tangerine().parse(bad)


def test_td_rejects_missing_usd():
    with pytest.raises(ValueError):
        TD().parse({"timestamp": "x", "conversionTableFXCAL": []})
