"""Shared builder for USD/CAD quotes from Canadian banks.

Rates are stored as CAD per 1 USD in ``native``:

- ``cad_buy``: what the bank pays you for 1 USD (you sell USD)
- ``cad_sell``: what the bank charges you for 1 USD (you buy USD)
- ``cad_mid``: midpoint, or the single published rate

This matches the IRR convention used elsewhere (buy is the lower, dealer-buy
price). ``value`` stays USD per CAD, the same convention as ``globalfx``.
"""
from __future__ import annotations

from typing import Optional

from model import Record

# plausible CAD per USD band; anything outside means a broken or changed payload
LOW, HIGH = 0.8, 2.5


def _check(name: str, v: Optional[float]) -> None:
    if v is not None and not (LOW <= v <= HIGH):
        raise ValueError(f"{name}={v} outside plausible CAD/USD range [{LOW}, {HIGH}]")


def usd_cad_record(source_id: str, *, buy: Optional[float] = None,
                   sell: Optional[float] = None, mid: Optional[float] = None,
                   as_of: str, source_url: str, verify_url: str,
                   raw: dict, extra: Optional[dict] = None) -> Record:
    for name, v in (("buy", buy), ("sell", sell), ("mid", mid)):
        _check(name, v)
    if buy is not None and sell is not None:
        if buy > sell:
            raise ValueError(f"buy {buy} above sell {sell}: sides look inverted")
        mid = (buy + sell) / 2
    if mid is None:
        raise ValueError("no usable USD/CAD rate")
    native = {"cad_buy": buy, "cad_sell": sell, "cad_mid": mid, "unit": "CAD per USD"}
    native.update(extra or {})
    return Record(
        source_id=source_id, kind="exact", pair_from="USD", pair_to="CAD",
        value=1.0 / mid, single_sided=(buy is None or sell is None),
        as_of=as_of, native=native, source_url=source_url, verify_url=verify_url,
        raw=raw,
    )
