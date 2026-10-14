import pytest
from normalize import to_rial, to_toman


def test_toman_to_rial_multiplies_by_ten():
    assert to_rial(260104, "toman") == 2601040


def test_rial_passthrough():
    assert to_rial(2601040, "rial") == 2601040


def test_rial_to_toman_divides_by_ten():
    assert to_toman(2601040) == 260104.0


def test_unknown_unit_raises():
    with pytest.raises(ValueError):
        to_rial(1, "usd")


def test_float_string_would_be_caught():
    # strings must be converted by the caller, not here
    with pytest.raises(TypeError):
        to_rial("260104", "toman")
