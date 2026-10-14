import pytest

from model import Input, Record
from validate import validate_records


def _exact():
    return Record(source_id="nobitex", kind="proxy", pair_from="USDT", pair_to="IRR",
                  buy_rial=2600990, sell_rial=2601040,
                  verify_url="https://nobitex.ir/markets/usdt-rls")


def _estimate():
    return Record(
        source_id="cad_estimate", kind="estimate", pair_from="CAD", pair_to="IRR",
        buy_rial=1830000, sell_rial=1832000,
        formula="IRR_per_CAD = USD / CAD_per_USD",
        inputs=[
            Input(source_id="bonbast_archive", value=2606000, kind="exact",
                  verify_url="https://bonbast.com/graph/usd", leg="sell"),
            Input(source_id="globalfx", value=1.4221, kind="exact",
                  verify_url="https://open.er-api.com/v6/latest/USD", unit="ratio"),
        ],
    )


def test_valid_records_pass():
    validate_records([_exact(), _estimate()])


def test_estimate_with_empty_inputs_raises():
    rec = _estimate()
    rec.inputs = []
    with pytest.raises(ValueError):
        validate_records([rec])


def test_input_missing_verify_url_raises():
    rec = _estimate()
    rec.inputs[0].verify_url = ""
    with pytest.raises(ValueError):
        validate_records([rec])


def test_unknown_kind_raises():
    rec = _exact()
    rec.kind = "guess"
    with pytest.raises(ValueError):
        validate_records([rec])
