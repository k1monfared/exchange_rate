import json
import os

from registry import load_registry, build_sources

META = os.path.join(os.path.dirname(__file__), "..", "..", "data", "meta.json")


def test_registry_lists_all_nine_sources():
    reg = load_registry(META)
    ids = {s["source_id"] for s in reg["sources"]}
    assert ids == {
        "nerkhsanj", "bonbast_archive", "tetherland", "nobitex",
        "ramzinex", "wallex", "tabdeal", "bitpin", "globalfx",
    }


def test_every_source_has_verify_url_and_kind():
    reg = load_registry(META)
    for s in reg["sources"]:
        assert s["verify_url"].startswith("http")
        assert s["kind"] in {"exact", "proxy"}
