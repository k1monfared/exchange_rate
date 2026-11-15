from __future__ import annotations

import json

from sources.base import Source
from sources import bitpin, boc, bonbast_archive, globalfx, nerkhsanj, nobitex
from sources import ramzinex, tabdeal, tangerine, td, tetherland, wallex

_ADAPTERS = {
    "nerkhsanj": nerkhsanj.Nerkhsanj,
    "bonbast_archive": bonbast_archive.BonbastArchive,
    "tetherland": tetherland.Tetherland,
    "nobitex": nobitex.Nobitex,
    "ramzinex": ramzinex.Ramzinex,
    "wallex": wallex.Wallex,
    "tabdeal": tabdeal.Tabdeal,
    "bitpin": bitpin.Bitpin,
    "globalfx": globalfx.GlobalFx,
    "boc": boc.BankOfCanada,
    "td": td.TD,
    "tangerine": tangerine.Tangerine,
}


def load_registry(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def build_sources(registry: dict) -> dict[str, Source]:
    out: dict[str, Source] = {}
    for entry in registry["sources"]:
        cls = _ADAPTERS[entry["source_id"]]
        out[entry["source_id"]] = cls()
    return out
