from jalali import jalaali_to_iso


def test_nowruz_2024():
    assert jalaali_to_iso(1403, 1, 1) == "2024-03-20"


def test_nowruz_2025():
    assert jalaali_to_iso(1404, 1, 1) == "2025-03-21"


def test_roundtrip_recent():
    assert jalaali_to_iso(1405, 7, 22) == "2026-10-14"
